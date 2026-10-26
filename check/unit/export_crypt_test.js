/* 全データの書き出しの暗号（su-export-crypt.js）の試験（2026-10-26 新設・本人指示）
   実行: node check/unit/export_crypt_test.js
   守ること:
     (1) 暗号にして戻すと、元の中身と1バイトも違わない
     (2) 違うパスフレーズ・書き換えられたファイルは開けない（文は「パスフレーズが違うか、ファイルが壊れています」）
     (3) 印が違うファイル・途中で切れたファイルは、それぞれの文で断る（値・パスフレーズを文に入れない）
     (4) 同じ中身・同じパスフレーズでも、毎回違う暗号ファイルになる（salt・iv が乱数）
     (5) 方式は接続設定の控えと同じ（connection-settings.html の BK_ITER・BK_MIN_PASS と数が一致・PBKDF2-SHA256・AES-GCM 256）
     (6) 8 文字より短いパスフレーズでは作らない
   データはすべて架空。PBKDF2 は 1回 0.5〜1 秒かかるので、鍵を作る回数を少なく保つ。 */
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
  const b = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise, Error, String, crypto: globalThis.crypto };
  b.window = b; b.globalThis = b;
  vm.createContext(b);
  vm.runInContext(SRC, b);
  return b.SUExportCrypt;
}
const X = load();
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
async function err(p) { try { await p; return null; } catch (e) { return e; } }

(async () => {
  console.log('\n— 1. 形と方式 —');
  t('印は "SUEXP1" + 改行 + 0 の 8 バイト', JSON.stringify(Array.from(X.MAGIC)) === JSON.stringify([...Buffer.from('SUEXP1\n\0', 'latin1')]), X.MAGIC);
  const csIter = /BK_ITER\s*=\s*(\d+)/.exec(CS), csMin = /BK_MIN_PASS\s*=\s*(\d+)/.exec(CS);
  t('回数は接続設定の控え（BK_ITER）と同じ', csIter && Number(csIter[1]) === X.ITER && X.ITER === 600000, [csIter && csIter[1], X.ITER]);
  t('パスフレーズの最小の長さは接続設定の控え（BK_MIN_PASS）と同じ', csMin && Number(csMin[1]) === X.MIN_PASS && X.MIN_PASS === 8, [csMin && csMin[1], X.MIN_PASS]);
  t('鍵の作り方が接続設定と同じ（PBKDF2・SHA-256・AES-GCM 256）', /name:\s*'PBKDF2'[^}]*hash:\s*'SHA-256'/.test(SRC) && /name:\s*'AES-GCM',\s*length:\s*256/.test(SRC) &&
    /name:'PBKDF2'[^}]*hash:'SHA-256'/.test(CS) && /name:'AES-GCM', length:256/.test(CS), '');
  t('使うのは crypto.subtle だけ（外の部品・通信なし）', !/require\(|import |fetch\(|XMLHttpRequest|console\./.test(SRC), '');

  console.log('\n— 2. 暗号にして戻す —');
  const PASS = 'kaku-pass-0001';   // 架空
  const plain = new Uint8Array(70000);
  for (let i = 0; i < plain.length; i++) plain[i] = (i * 31 + 7) & 0xFF;
  const enc1 = await X.encrypt(plain, PASS);
  const enc2 = await X.encrypt(plain, PASS);
  t('暗号ファイルは印で始まる', same(enc1.subarray(0, 8), X.MAGIC), Array.from(enc1.subarray(0, 8)));
  t('長さ = 印 8 + salt 16 + iv 12 + 中身 + 認証タグ 16', enc1.length === 8 + 16 + 12 + plain.length + 16, enc1.length);
  t('暗号ファイルに元の中身がそのまま並んでいない', Buffer.from(enc1).indexOf(Buffer.from(plain.subarray(100, 164))) < 0, '');
  t('同じ中身・同じパスフレーズでも毎回違う（salt・iv・暗号文）',
    !same(enc1.subarray(8, 24), enc2.subarray(8, 24)) && !same(enc1.subarray(24, 36), enc2.subarray(24, 36)) && !same(enc1.subarray(36), enc2.subarray(36)), '');
  const dec = await X.decrypt(enc1, PASS);
  t('戻すと元の中身と1バイトも違わない（70,000 バイト）', same(dec, plain), dec.length);
  const decBuf = await X.decrypt(Buffer.from(enc2), PASS);
  t('Node の Buffer で渡しても戻せる（道具の読み方）', same(decBuf, plain), decBuf.length);

  console.log('\n— 3. 断る時 —');
  const e1 = await err(X.decrypt(enc1, PASS + 'x'));
  t('違うパスフレーズ: 「パスフレーズが違うか、ファイルが壊れています」', e1 && e1.message === 'パスフレーズが違うか、ファイルが壊れています' && e1.code === 'auth', e1 && e1.message);
  const bad = enc1.slice(); bad[bad.length - 40] ^= 1;
  const e2 = await err(X.decrypt(bad, PASS));
  t('1 バイト書き換えたファイル: 同じ文で断る（壊れた中身を渡さない）', e2 && e2.code === 'auth', e2 && e2.message);
  const e3 = await err(X.decrypt(new TextEncoder().encode('PK\u0003\u0004 これは ZIP'), PASS));
  t('印が違う（暗号にしていない ZIP など）: 「この書き出しの暗号ファイルではありません」', e3 && e3.message === 'この書き出しの暗号ファイルではありません' && e3.code === 'magic', e3 && e3.message);
  const e4 = await err(X.decrypt(enc1.subarray(0, 30), PASS));
  t('印の後で切れている: 「途中で切れています」', e4 && e4.message === '途中で切れています' && e4.code === 'short', e4 && e4.message);
  const e5 = await err(X.decrypt(enc1.subarray(0, 5), PASS));
  t('印の途中で切れている: 「途中で切れています」', e5 && e5.code === 'short', e5 && e5.message);
  const e6 = await err(X.decrypt(new Uint8Array(0), PASS));
  t('空のファイル: 「途中で切れています」', e6 && e6.code === 'short', e6 && e6.message);
  const e7 = await err(X.decrypt(enc1.subarray(0, enc1.length - 1), PASS));
  t('最後の 1 バイトが欠けている: 開けない（認証で断る）', e7 && e7.code === 'auth', e7 && e7.message);
  const e8 = await err(X.encrypt(plain, 'short7c'));
  t('7 文字のパスフレーズでは作らない', e8 && e8.code === 'pass' && /8 文字以上/.test(e8.message), e8 && e8.message);
  t('断りの文にパスフレーズが入らない', [e1, e2, e3, e4, e5, e6, e7, e8].every((e) => e && !String(e.message).includes(PASS) && !String(e.message).includes('short7c')), '');

  console.log('\n— 4. 接続設定の控えと同じ鍵になる（同じ salt・iv なら同じ暗号文）—');
  /* 接続設定の bkKey と同じ手順で、Node の crypto（pbkdf2Sync＋aes-256-gcm）が作る暗号文と突き合わせる */
  const salt = enc1.subarray(8, 24), iv = enc1.subarray(24, 36);
  const k = nodeCrypto.pbkdf2Sync(Buffer.from(PASS, 'utf8'), Buffer.from(salt), 600000, 32, 'sha256');
  const c = nodeCrypto.createCipheriv('aes-256-gcm', k, Buffer.from(iv));
  const ref = Buffer.concat([c.update(Buffer.from(plain)), c.final(), c.getAuthTag()]);
  t('Node の標準の暗号で作った物と1バイトも違わない（PBKDF2-SHA256 600,000 回・AES-GCM 256）', same(ref, enc1.subarray(36)), ref.length);

  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 例外  → ' + (e && e.stack || e)); process.exit(1); });
