/*
 * su-export-crypt.js — 全データの書き出しの暗号化・復号（2026-10-26 新設・本人指示／代表者の決定）
 * ════════════════════════════════════════════════════════════════
 * ここは通信も画面も触らない純関数だけ（試験は check/unit/export_crypt_test.js）。
 * 画面（accounts-export.js）とターミナルの道具（check/export-decrypt.mjs）の両方がこの1本を使う（道具は vm で読む）。
 *   encrypt(input, pass[, {chunkSize}]) … input = Uint8Array か、Uint8Array の並び（ZIP の部品 parts）
 *                                         → Promise<Uint8Array の並び>（ヘッダ1つ＋区切りごとの暗号文。new Blob(並び) で保存する）
 *                                         ★全体を1本の配列に写さない。並びで渡された部品は、読み終えた所から null にして手放す
 *   decrypt(source, pass[, {onChunk}])   … source = Uint8Array か、読み口 {size, read(start, end) → Promise<Uint8Array>}
 *                                         （File なら fromBlob(file)）→ Promise<Uint8Array の並び>（元の ZIP の区切り）
 *                                         onChunk(区切り) を渡すと並びに溜めず、区切りごとに渡す（ターミナルの道具がファイルへ書く）
 *   fromBlob(blob)                       … File・Blob の読み口（区切りごとに slice で読む＝全体を一度に読まない）
 * 鍵の作り方は接続設定の控え（connection-settings.html の BK_ITER・bkKey）と同じ:
 *   PBKDF2-SHA256 600,000 回でパスフレーズから鍵 → AES-GCM 256
 * ファイルの形（バイナリ・数は大きい桁から並べる）:
 *   印 8 バイト "SUEXP2" + 0x0A + 0x00 | salt 16 | iv の元 12 | 区切りの大きさ 4（既定 4MiB）| 区切り 0 | 区切り 1 | …
 *   区切り i = AES-GCM（元の中身の i 番目の区切り）＋認証タグ 16。最後の区切りだけ短くてよい（0 バイトの中身なら 16 バイト）
 *   ・iv は「iv の元」の最後の4バイトに i を足したもの（区切りごとに違う）
 *   ・追加の認証データ = 区切りの番号 i（4バイト）＋ 最後の区切りかの印（1バイト。最後 1・それ以外 0）
 *     → 区切りを入れ替えた・途中で切った（最後の印の付いた区切りが無い）・区切りの大きさを書き換えたファイルは、復号で必ず失敗する
 * ★crypto.subtle だけを使う（外の部品は使わない）。ブラウザでも Node の webcrypto でも同じに動く。
 * ★値・パスフレーズを例外の文やログに入れない。パスフレーズはどこにも保存しない（呼ぶ側も持ち続けない）。
 * ★0024 の決定「ZIP に鍵はかけない」は、2026-10-26 の代表者の決定（既定で暗号化する）で置き換わった。
 */
(function (global) {
  'use strict';

  var MAGIC = [0x53, 0x55, 0x45, 0x58, 0x50, 0x32, 0x0A, 0x00];   // "SUEXP2\n\0"
  var ITER = 600000;       // connection-settings.html の BK_ITER と同じ（試験で文字を突き合わせる）
  var MIN_PASS = 8;        // 接続設定の控えの BK_MIN_PASS と同じ
  var SALT = 16, IV = 12, TAG = 16;
  var CHUNK = 4 * 1024 * 1024;                 // 既定の区切りの大きさ（4MiB）
  var CHUNK_MIN = 1024, CHUNK_MAX = 64 * 1024 * 1024;   // 開く時に受ける区切りの大きさ（書き換えで巨大な読み込みをさせない）
  var HEAD = MAGIC.length + SALT + IV + 4;

  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function subtle() {
    var c = global.crypto;
    if (!c || !c.subtle || typeof c.getRandomValues !== 'function') throw fail('nocrypto', 'この端末では暗号を扱えません（https で開いているか、ブラウザが新しいかを確かめてください）。');
    return c;
  }
  /* 暗号を扱えるか（画面が始める前に確かめる） */
  function available() { try { subtle(); return typeof TextEncoder === 'function'; } catch (e) { return false; } }

  /* いつも素の Uint8Array の見え方にする（Node の Buffer の slice は写しでなく同じ中身を指すため、そのまま使うと iv を作る時に元を書き換える） */
  function u8(b) {
    if (b && ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (b && typeof b.byteLength === 'number' && typeof b.slice === 'function') return new Uint8Array(b);   // ArrayBuffer
    throw fail('input', '暗号にする中身がありません。');
  }
  function be32(n) { return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]; }
  function rd32(b, at) { return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]; }
  function ivOf(base, i) {
    var iv = base.slice(0), n = (rd32(base, 8) + i) >>> 0, x = be32(n);
    iv[8] = x[0]; iv[9] = x[1]; iv[10] = x[2]; iv[11] = x[3];
    return iv;
  }
  function aadOf(i, last) { var x = be32(i >>> 0); return new Uint8Array([x[0], x[1], x[2], x[3], last ? 1 : 0]); }

  /* 接続設定の bkKey と同じ鍵の作り方（パスフレーズは TextEncoder の UTF-8 をそのまま使う） */
  function key(c, pass, salt) {
    return c.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (k) {
        return c.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' },
          k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  async function encrypt(input, pass, opt) {
    var c = subtle();
    var parts = Array.isArray(input) ? input : [u8(input)];
    for (var p = 0; p < parts.length; p++) parts[p] = u8(parts[p]);
    if (typeof pass !== 'string' || pass.length < MIN_PASS) throw fail('pass', 'パスフレーズは ' + MIN_PASS + ' 文字以上にしてください。');
    var size = (opt && opt.chunkSize) || CHUNK;
    if (!(size >= CHUNK_MIN && size <= CHUNK_MAX && size % 1 === 0)) throw fail('input', '区切りの大きさが正しくありません。');
    var total = parts.reduce(function (s, x) { return s + x.length; }, 0);
    var n = Math.max(1, Math.ceil(total / size));
    var salt = c.getRandomValues(new Uint8Array(SALT)), base = c.getRandomValues(new Uint8Array(IV));
    var k = await key(c, pass, salt);
    var head = new Uint8Array(HEAD);
    head.set(MAGIC, 0); head.set(salt, MAGIC.length); head.set(base, MAGIC.length + SALT); head.set(be32(size), MAGIC.length + SALT + IV);
    var out = [head];
    var pi = 0, po = 0;   // 今読んでいる部品と、その中の位置
    for (var i = 0; i < n; i++) {
      var want = Math.min(size, total - i * size), chunk;
      /* 1つの部品の中に収まる区切りは写さずにそのまま渡す。またがる時だけ区切りの大きさの入れ物へ写す */
      while (pi < parts.length && po >= parts[pi].length) { parts[pi] = null; pi++; po = 0; }
      if (pi < parts.length && parts[pi].length - po >= want) {
        chunk = parts[pi].subarray(po, po + want); po += want;
      } else {
        chunk = new Uint8Array(want);
        var at = 0;
        while (at < want) {
          while (po >= parts[pi].length) { parts[pi] = null; pi++; po = 0; }
          var take = Math.min(want - at, parts[pi].length - po);
          chunk.set(parts[pi].subarray(po, po + take), at);
          at += take; po += take;
        }
      }
      var ct = await c.subtle.encrypt({ name: 'AES-GCM', iv: ivOf(base, i), additionalData: aadOf(i, i === n - 1) }, k, chunk);
      chunk = null;
      out.push(new Uint8Array(ct));
    }
    for (; pi < parts.length; pi++) parts[pi] = null;
    return out;
  }

  function fromBytes(b) {
    var all = u8(b);
    return { size: all.length, read: function (s, e) { return Promise.resolve(all.subarray(s, e)); } };
  }
  function fromBlob(blob) {
    return { size: blob.size, read: function (s, e) { return blob.slice(s, e).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); } };
  }

  async function decrypt(source, pass, opt) {
    var c = subtle();
    var src = (source && typeof source.read === 'function' && typeof source.size === 'number') ? source : fromBytes(source);
    var onChunk = opt && typeof opt.onChunk === 'function' ? opt.onChunk : null;
    var head = u8(await src.read(0, Math.min(HEAD, src.size)));
    /* 印より短い: 印の始まりと合っていれば「切れている」、合わなければ「違うファイル」 */
    for (var m = 0; m < MAGIC.length; m++) {
      if (m >= head.length) throw fail('short', '途中で切れています');
      if (head[m] !== MAGIC[m]) throw fail('magic', 'この書き出しの暗号ファイルではありません');
    }
    if (src.size < HEAD + TAG) throw fail('short', '途中で切れています');
    var salt = head.slice(MAGIC.length, MAGIC.length + SALT), base = head.slice(MAGIC.length + SALT, MAGIC.length + SALT + IV);
    var size = rd32(head, MAGIC.length + SALT + IV);
    var AUTH = function () { return fail('auth', 'パスフレーズが違うか、ファイルが壊れています'); };
    var rest = src.size - HEAD, block = size + TAG;
    /* 区切りの大きさが受ける範囲に無い・端数が認証タグより短い → 書き換えられたか壊れている */
    if (size < CHUNK_MIN || size > CHUNK_MAX || (rest % block !== 0 && rest % block < TAG)) throw AUTH();
    var n = Math.ceil(rest / block);
    var k;
    try { k = await key(c, String(pass == null ? '' : pass), salt); } catch (e) { throw AUTH(); }
    var out = [];
    for (var i = 0; i < n; i++) {
      var s = HEAD + i * block, e = Math.min(s + block, src.size);
      var ct = u8(await src.read(s, e)), pt;
      try {
        pt = await c.subtle.decrypt({ name: 'AES-GCM', iv: ivOf(base, i), additionalData: aadOf(i, i === n - 1) }, k, ct);
      } catch (x) { throw AUTH(); }
      ct = null;
      if (onChunk) await onChunk(new Uint8Array(pt)); else out.push(new Uint8Array(pt));
    }
    return out;
  }

  global.SUExportCrypt = { encrypt: encrypt, decrypt: decrypt, fromBlob: fromBlob, available: available,
                           MAGIC: MAGIC.slice(), ITER: ITER, MIN_PASS: MIN_PASS, CHUNK: CHUNK, HEAD: HEAD };
})(typeof window !== 'undefined' ? window : globalThis);
