/* 全データの書き出しの暗号（su-export-crypt.js）の試験（2026-10-26 新設・本人指示／反証レビューで区切りごとの暗号化に変えた）
   実行: node check/unit/export_crypt_test.js
   守ること:
     (1) 暗号にして戻すと、元の中身と1バイトも違わない（0 バイト・1 バイト・区切りの境目ちょうど・境目を1つ越えた・部品の並びで渡した時も）
     (2) 違うパスフレーズ・書き換えられたファイルは開けない（文は「パスフレーズが違うか、ファイルが壊れています」）
     (3) 途中で切れた（最後の区切りが無い）・区切りを入れ替えた・区切りの大きさを書き換えたファイルは、どれも開けない
     (4) 印が違うファイル・ヘッダの途中で切れたファイルは、それぞれの文で断る（値・パスフレーズを文に入れない）
     (5) 同じ中身・同じパスフレーズでも、毎回違う暗号ファイルになる（salt・iv の元が乱数）
     (6) 方式は接続設定の控えと同じ（BK_ITER・BK_MIN_PASS と数が一致・PBKDF2-SHA256・AES-GCM 256）で、
         Node の標準の crypto で同じ形を作ると1バイトも違わない
     (7) 8 文字より短いパスフレーズでは作らない
     (8) 渡した部品の並びは、読み終えた所から手放す（全体を1本に写さない）
   データはすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-export-crypt.js'), 'utf8');
const CS = fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

function load() {
  const b = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise, Error, String, Math, Array, crypto: globalThis.crypto };
  b.window = b; b.globalThis = b;
  vm.createContext(b);
  vm.runInContext(SRC, b);
  return b.SUExportCrypt;
}
const X = load();
const cat = (list) => Buffer.concat(list.map((x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength)));
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
async function err(p) { try { await p; return null; } catch (e) { return e; } }
function bytes(n, seed) { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xFF; return b; }
const H = 8 + 16 + 12 + 4;
const CH = 1024;   // 試験は区切りを小さくして、区切りの多いファイルを小さく作る

(async () => {
  console.log('\n— 1. 形と方式 —');
  t('印は "SUEXP2" + 改行 + 0 の 8 バイト', same(Uint8Array.from(X.MAGIC), Buffer.from('SUEXP2\n\0', 'latin1')), X.MAGIC);
  const csIter = /BK_ITER\s*=\s*(\d+)/.exec(CS), csMin = /BK_MIN_PASS\s*=\s*(\d+)/.exec(CS);
  t('回数は接続設定の控え（BK_ITER）と同じ', csIter && Number(csIter[1]) === X.ITER && X.ITER === 600000, [csIter && csIter[1], X.ITER]);
  t('パスフレーズの最小の長さは接続設定の控え（BK_MIN_PASS）と同じ', csMin && Number(csMin[1]) === X.MIN_PASS && X.MIN_PASS === 8, [csMin && csMin[1], X.MIN_PASS]);
  t('鍵の作り方が接続設定と同じ（PBKDF2・SHA-256・AES-GCM 256）', /name:\s*'PBKDF2'[^}]*hash:\s*'SHA-256'/.test(SRC) && /name:\s*'AES-GCM',\s*length:\s*256/.test(SRC) &&
    /name:'PBKDF2'[^}]*hash:'SHA-256'/.test(CS) && /name:'AES-GCM', length:256/.test(CS), '');
  t('既定の区切りは 4MiB・ヘッダは 40 バイト', X.CHUNK === 4 * 1024 * 1024 && X.HEAD === H, [X.CHUNK, X.HEAD]);
  t('使うのは crypto.subtle だけ（外の部品・通信なし）', !/require\(|import |fetch\(|XMLHttpRequest|console\./.test(SRC), '');
  t('暗号を扱えるか確かめる口がある（Node の webcrypto では使える）', X.available() === true, '');

  console.log('\n— 2. 暗号にして戻す —');
  const PASS = 'kaku-pass-0001';   // 架空
  const plain = bytes(70000, 7);
  const enc1 = await X.encrypt(plain, PASS);
  const enc2 = await X.encrypt(plain, PASS);
  const f1 = cat(enc1), f2 = cat(enc2);
  t('出力は部品の並び（ヘッダ＋区切り。70,000 バイトは既定の区切りで1つ）', Array.isArray(enc1) && enc1.length === 2 && enc1[0].length === H, enc1.length);
  t('暗号ファイルは印で始まり、区切りの大きさ 4MiB を持つ', same(f1.subarray(0, 8), X.MAGIC) && f1.readUInt32BE(36) === 4 * 1024 * 1024, Array.from(f1.subarray(0, 8)));
  t('長さ = ヘッダ 40 + 中身 + 認証タグ 16', f1.length === H + plain.length + 16, f1.length);
  t('暗号ファイルに元の中身がそのまま並んでいない', f1.indexOf(Buffer.from(plain.subarray(100, 164))) < 0, '');
  t('同じ中身・同じパスフレーズでも毎回違う（salt・iv の元・暗号文）',
    !same(f1.subarray(8, 24), f2.subarray(8, 24)) && !same(f1.subarray(24, 36), f2.subarray(24, 36)) && !same(f1.subarray(H), f2.subarray(H)), '');
  t('戻すと元の中身と1バイトも違わない（70,000 バイト）', same(cat(await X.decrypt(f1, PASS)), plain), '');

  /* 大きさの境目（区切り 1KiB）。0・1・境目ちょうど・境目＋1・3区切りちょうど */
  const sizes = [0, 1, CH - 1, CH, CH + 1, 3 * CH, 3 * CH + 17];
  const res = [];
  for (const n of sizes) {
    const p = bytes(n, n & 0xFF);
    const e = cat(await X.encrypt(p, PASS, { chunkSize: CH }));
    const want = H + Math.max(1, Math.ceil(n / CH)) * 16 + n;
    const d = cat(await X.decrypt(e, PASS));
    res.push(n + ':' + (e.length === want && same(d, p)));
  }
  t('0・1 バイト・区切りの境目ちょうど・境目を1つ越えた大きさでも往復できる（長さも決まりどおり）', res.every((x) => /true$/.test(x)), res);

  /* 部品の並びで渡す（ZIP の parts と同じ渡し方。区切りが部品をまたぐ・部品が空・部品が区切りより大きい） */
  const ps = [bytes(10, 1), new Uint8Array(0), bytes(3000, 2), bytes(5, 3), bytes(CH, 4), bytes(1, 5)];
  const whole = cat(ps);
  const given = ps.slice();
  const ep = cat(await X.encrypt(given, PASS, { chunkSize: CH }));
  t('部品の並びで渡しても、つないだ中身と同じに戻る', same(cat(await X.decrypt(ep, PASS)), whole), '');
  t('渡した部品の並びは、読み終えたものから手放す（全部 null）', given.every((x) => x === null), given.map((x) => x === null));

  /* Blob の読み口（画面の File と同じ。区切りごとに slice で読む） */
  const reads = [];
  const blob = new Blob([ep]);
  const src = X.fromBlob(blob);
  const orig = src.read;
  src.read = (s, e) => { reads.push(e - s); return orig(s, e); };
  t('File・Blob の読み口で戻せる', same(cat(await X.decrypt(src, PASS)), whole), '');
  t('読み口は区切りごとに読む（一度に全体を読まない）', reads.length > 2 && Math.max(...reads) <= CH + 16, reads);
  const got = [];
  const rr = await X.decrypt(ep, PASS, { onChunk: (c) => { got.push(Buffer.from(c)); } });
  t('onChunk を渡すと、区切りごとに渡して並びに溜めない', rr.length === 0 && same(Buffer.concat(got), whole), rr.length);

  console.log('\n— 3. 断る時 —');
  const big = bytes(3 * CH + 100, 9);
  const eb = cat(await X.encrypt(big, PASS, { chunkSize: CH }));   // 区切り 4 つ
  const blk = CH + 16;
  const isAuth = (e) => e && e.code === 'auth' && e.message === 'パスフレーズが違うか、ファイルが壊れています';
  const e1 = await err(X.decrypt(eb, PASS + 'x'));
  t('違うパスフレーズ: 「パスフレーズが違うか、ファイルが壊れています」', isAuth(e1), e1 && e1.message);
  const bad = Buffer.from(eb); bad[H + blk + 5] ^= 1;
  t('1 バイト書き換えたファイル: 同じ文で断る（壊れた中身を渡さない）', isAuth(await err(X.decrypt(bad, PASS))), '');
  t('途中で切れた（最後の区切りが無い＝区切りの境目で切った）: 開けない', isAuth(await err(X.decrypt(eb.subarray(0, H + 3 * blk), PASS))), '');
  t('途中で切れた（区切りの途中で切った）: 開けない', isAuth(await err(X.decrypt(eb.subarray(0, H + 2 * blk + 100), PASS))), '');
  t('最後の 1 バイトが欠けている: 開けない', isAuth(await err(X.decrypt(eb.subarray(0, eb.length - 1), PASS))), '');
  const sw = Buffer.concat([eb.subarray(0, H), eb.subarray(H + blk, H + 2 * blk), eb.subarray(H, H + blk), eb.subarray(H + 2 * blk)]);
  t('区切りを入れ替えた（0 番と 1 番）: 開けない', isAuth(await err(X.decrypt(sw, PASS))), '');
  const dup = Buffer.concat([eb.subarray(0, H + blk), eb.subarray(H, H + blk), eb.subarray(H + 2 * blk)]);
  t('区切りを差し替えた（1 番の代わりに 0 番をもう一度）: 開けない', isAuth(await err(X.decrypt(dup, PASS))), '');
  const tail2 = Buffer.concat([eb.subarray(0, H + 2 * blk), eb.subarray(H + 3 * blk)]);
  t('途中の区切りを1つ抜いた: 開けない', isAuth(await err(X.decrypt(tail2, PASS))), '');
  const resized = Buffer.from(eb); resized.writeUInt32BE(2 * CH, 36);
  t('区切りの大きさを書き換えた（1KiB → 2KiB）: 開けない', isAuth(await err(X.decrypt(resized, PASS))), '');
  const huge = Buffer.from(eb); huge.writeUInt32BE(0xFFFFFFFF, 36);
  t('区切りの大きさを巨大な値に書き換えた: 読み込まずに断る', isAuth(await err(X.decrypt(huge, PASS))), '');
  const e3 = await err(X.decrypt(new TextEncoder().encode('PK\u0003\u0004 これは ZIP'), PASS));
  t('印が違う（暗号にしていない ZIP など）: 「この書き出しの暗号ファイルではありません」', e3 && e3.message === 'この書き出しの暗号ファイルではありません' && e3.code === 'magic', e3 && e3.message);
  const old = Buffer.from(eb); old[5] = 0x31;
  t('前の形の印（SUEXP1）は開かない（違うファイルとして断る）', (await err(X.decrypt(old, PASS))).code === 'magic', '');
  const e4 = await err(X.decrypt(eb.subarray(0, 30), PASS));
  t('ヘッダの途中で切れている: 「途中で切れています」', e4 && e4.message === '途中で切れています' && e4.code === 'short', e4 && e4.message);
  t('印の途中で切れている: 「途中で切れています」', (await err(X.decrypt(eb.subarray(0, 5), PASS))).code === 'short', '');
  t('空のファイル: 「途中で切れています」', (await err(X.decrypt(new Uint8Array(0), PASS))).code === 'short', '');
  t('ヘッダだけで区切りが1つも無い: 「途中で切れています」', (await err(X.decrypt(eb.subarray(0, H), PASS))).code === 'short', '');
  const e8 = await err(X.encrypt(plain, 'short7c'));
  t('7 文字のパスフレーズでは作らない', e8 && e8.code === 'pass' && /8 文字以上/.test(e8.message), e8 && e8.message);
  t('断りの文にパスフレーズが入らない', [e1, e3, e4, e8].every((e) => e && !String(e.message).includes(PASS) && !String(e.message).includes('short7c')), '');

  console.log('\n— 4. Node の標準の暗号で同じ形を作ると1バイトも違わない —');
  /* 区切り i: iv = iv の元の最後の4バイト（大きい桁から）+ i、追加の認証データ = i（4バイト）+ 最後の印（1バイト） */
  const salt = eb.subarray(8, 24), base = eb.subarray(24, 36);
  const k = nodeCrypto.pbkdf2Sync(Buffer.from(PASS, 'utf8'), Buffer.from(salt), 600000, 32, 'sha256');
  const n = Math.ceil(big.length / CH);
  const ref = [Buffer.from(eb.subarray(0, H))];
  for (let i = 0; i < n; i++) {
    const iv = Buffer.from(base); iv.writeUInt32BE((iv.readUInt32BE(8) + i) >>> 0, 8);
    const aad = Buffer.alloc(5); aad.writeUInt32BE(i, 0); aad[4] = i === n - 1 ? 1 : 0;
    const c = nodeCrypto.createCipheriv('aes-256-gcm', k, iv);
    c.setAAD(aad);
    ref.push(c.update(Buffer.from(big.subarray(i * CH, (i + 1) * CH))), c.final(), c.getAuthTag());
  }
  t('PBKDF2-SHA256 600,000 回・AES-GCM 256・区切りごとの iv と追加の認証データまで1バイトも違わない（区切り 4 つ）', same(Buffer.concat(ref), eb), [Buffer.concat(ref).length, eb.length]);

  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 例外  → ' + (e && e.stack || e)); process.exit(1); });
