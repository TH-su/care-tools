/*
 * su-export-crypt.js — 全データの書き出しの暗号化・復号（2026-10-26 新設・本人指示／代表者の決定）
 * ════════════════════════════════════════════════════════════════
 * ここは通信も画面も触らない純関数だけ（試験は check/unit/export_crypt_test.js）。
 * 画面（accounts-export.js）とターミナルの道具（check/export-decrypt.mjs）の両方がこの1本を使う（道具は vm で読む）。
 *   encrypt(bytes, pass) … Uint8Array（ZIP 1つ）→ Promise<Uint8Array>（暗号ファイルの中身）
 *   decrypt(bytes, pass) … 暗号ファイルの中身 → Promise<Uint8Array>（元の ZIP）
 * 方式は接続設定の控え（connection-settings.html の BK_ITER・bkKey）と同じ:
 *   PBKDF2-SHA256 600,000 回でパスフレーズから鍵 → AES-GCM 256（salt 16・iv 12 はその都度の乱数）
 * ファイルの形（バイナリ）:
 *   印 8 バイト "SUEXP1" + 0x0A + 0x00 | salt 16 | iv 12 | AES-GCM の暗号文（認証タグ 16 バイト込み）
 * ★crypto.subtle だけを使う（外の部品は使わない）。ブラウザでも Node の webcrypto でも同じに動く。
 * ★値・パスフレーズを例外の文やログに入れない。パスフレーズはどこにも保存しない（呼ぶ側も持ち続けない）。
 * ★0024 の決定「ZIP に鍵はかけない」は、2026-10-26 の代表者の決定（既定で暗号化する）で置き換わった。
 */
(function (global) {
  'use strict';

  var MAGIC = [0x53, 0x55, 0x45, 0x58, 0x50, 0x31, 0x0A, 0x00];   // "SUEXP1\n\0"
  var ITER = 600000;       // connection-settings.html の BK_ITER と同じ（試験で文字を突き合わせる）
  var MIN_PASS = 8;        // 接続設定の控えの BK_MIN_PASS と同じ
  var SALT = 16, IV = 12, TAG = 16;
  var HEAD = MAGIC.length + SALT + IV;

  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function subtle() {
    var c = global.crypto;
    if (!c || !c.subtle || typeof c.getRandomValues !== 'function') throw fail('nocrypto', 'この端末では暗号を扱えません（https で開いているか、ブラウザが新しいかを確かめてください）。');
    return c;
  }
  function asBytes(b) {
    if (b instanceof Uint8Array) return b;
    if (b && typeof b.byteLength === 'number' && typeof b.slice === 'function' && !ArrayBuffer.isView(b)) return new Uint8Array(b);   // ArrayBuffer
    if (b && ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    throw fail('input', '暗号にする中身がありません。');
  }

  /* 接続設定の bkKey と同じ鍵の作り方（パスフレーズは TextEncoder の UTF-8 をそのまま使う） */
  function key(c, pass, salt) {
    return c.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (k) {
        return c.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' },
          k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  function encrypt(bytes, pass) {
    return Promise.resolve().then(function () {
      var c = subtle();
      var plain = asBytes(bytes);
      if (typeof pass !== 'string' || pass.length < MIN_PASS) throw fail('pass', 'パスフレーズは ' + MIN_PASS + ' 文字以上にしてください。');
      var salt = c.getRandomValues(new Uint8Array(SALT)), iv = c.getRandomValues(new Uint8Array(IV));
      return key(c, pass, salt).then(function (k) {
        return c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, plain);
      }).then(function (ct) {
        var body = new Uint8Array(ct), out = new Uint8Array(HEAD + body.length);
        out.set(MAGIC, 0); out.set(salt, MAGIC.length); out.set(iv, MAGIC.length + SALT); out.set(body, HEAD);
        return out;
      });
    });
  }

  function decrypt(bytes, pass) {
    return Promise.resolve().then(function () {
      var c = subtle();
      var all = asBytes(bytes);
      /* 印より短い: 印の始まりと合っていれば「切れている」、合わなければ「違うファイル」 */
      for (var i = 0; i < MAGIC.length; i++) {
        if (i >= all.length) throw fail('short', '途中で切れています');
        if (all[i] !== MAGIC[i]) throw fail('magic', 'この書き出しの暗号ファイルではありません');
      }
      if (all.length < HEAD + TAG) throw fail('short', '途中で切れています');
      var salt = all.slice(MAGIC.length, MAGIC.length + SALT), iv = all.slice(MAGIC.length + SALT, HEAD);
      return Promise.resolve().then(function () {
        return key(c, String(pass == null ? '' : pass), salt);
      }).then(function (k) {
        return c.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, all.subarray(HEAD));
      }).then(function (buf) {
        return new Uint8Array(buf);
      }, function () {
        throw fail('auth', 'パスフレーズが違うか、ファイルが壊れています');
      });
    });
  }

  global.SUExportCrypt = { encrypt: encrypt, decrypt: decrypt, MAGIC: MAGIC.slice(), ITER: ITER, MIN_PASS: MIN_PASS };
})(typeof window !== 'undefined' ? window : globalThis);
