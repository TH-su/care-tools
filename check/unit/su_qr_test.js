/* QR の絵の部品（su-qr.js・2026-11-08 端末登録の QR）の試験。外の部品を使わない。
   1. 8つの模様とも、別の作り方（Python の qrcode 8.x・誤り訂正 M・バイトの形）で作った絵と1マスずつ同じ（指紋で比べる。
      指紋は作業の時に qrcode で作り、zxing-cpp で読めることも確かめた値。型番 1・6・10 と、端末登録の住所と同じ長さの文）
   2. 形の決まり: 大きさ＝型番×4＋17・3つの角の位置合わせの印・時間の印・暗いマス・模様を決めない時は減点の少ない模様を選ぶ
   3. 入りきらない長さは例外にする（黙って切らない）。SVG は文字を入れず、白地に黒だけ
   実行: node check/unit/su_qr_test.js
   ★出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-qr.js'), 'utf8');
let ok = 0, ng = 0;
const say = (m) => process.stdout.write(m + '\n');
function group(n) { say('\n— ' + n + ' —'); }
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

function mkDoc() {
  const mk = (tag) => ({ tag, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); return c; } });
  return { createElementNS: (ns, tag) => Object.assign(mk(tag), { ns }) };
}
const win = {};
vm.runInNewContext(SRC, { window: win, document: mkDoc(), unescape, encodeURIComponent, Math, Array, String, Error, Infinity });
const Q = win.SUQr;
function fp(q) {
  const rows = [];
  for (let y = 0; y < q.size; y++) { let r = ''; for (let x = 0; x < q.size; x++) r += q.dark(x, y) ? '1' : '0'; rows.push(r); }
  return crypto.createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
}

group('1. 別の作り方と1マスずつ同じ（8つの模様）');
const URL1 = 'https://example.invalid/care-tools/enroll.html#c=0123456789abcdef0123456789abcdef01234567';
const REF = [
  ['a', 1, ['ad65f877bf9411d1', '50b2ea55f7ddab9e', '65c3f1acd0d11214', '8503acd70f562cac', 'ed92d118774a8ffc', 'e8ab680854e4019c', 'a8a0fd4aecd444f8', '5f34dc0326dd2454']],
  [URL1, 6, ['118f9e1803fc4b97', '3b47000920b495c5', '8d93b60136b46138', '93cc72d1daf65f8b', 'f2e2851508ef74ac', '86138443dde38db0', '80ad43c214ad5002', 'fb6a9fe326c9dacf']],
  ['y'.repeat(100), 6, ['7e493e4d3583ecb3', '8dabbe40eb273542', 'd99e25e2ac4e4222', '8bc3bd8d5e1eff0b', 'fefd0fe0f2ac8678', 'bc9bbe6b1cc18ca2', '77557a5d553ae628', 'db9814ce3b85a6dc']],
  ['w'.repeat(200), 10, ['b17bbe5b1d725b75', '343845e26645cd28', 'fff3b4b047d0936c', 'aacd1eed0347c3d0', '48ebf3d55274e749', '3069cb5e1933d578', '8c9fdd4ce3270b99', '2dda0f5557f6075e']],
];
for (const [text, ver, fps] of REF) {
  const got = fps.map((_, m) => fp(Q.matrix(text, { mask: m })));
  t('長さ ' + text.length + '（型番 ' + ver + '）: 型番が同じ・8つの模様の指紋が同じ',
    Q.matrix(text, { mask: 0 }).version === ver && got.every((g, i) => g === fps[i]), got);
}

group('2. 形の決まり');
const q = Q.matrix(URL1);
t('大きさは型番×4＋17', q.size === q.version * 4 + 17);
function finderOk(cx, cy) {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (q.dark(cx + dx, cy + dy) !== (d !== 2)) return false;
  }
  return true;
}
t('3つの角に位置合わせの印', finderOk(3, 3) && finderOk(q.size - 4, 3) && finderOk(3, q.size - 4));
let timing = true;
for (let i = 8; i < q.size - 8; i++) if (q.dark(i, 6) !== (i % 2 === 0) || q.dark(6, i) !== (i % 2 === 0)) timing = false;
t('時間の印（6行目・6列目の白黒の交互）', timing);
t('暗いマス（左下の位置合わせの印の右上）', q.dark(8, q.size - 8));
t('模様を決めない時は0〜7のどれかを選ぶ・選んだ模様の絵と同じ', q.mask >= 0 && q.mask <= 7 && fp(q) === fp(Q.matrix(URL1, { mask: q.mask })));
t('同じ文からは毎回同じ絵', fp(Q.matrix(URL1)) === fp(Q.matrix(URL1)));
t('外は白（範囲の外を聞いても暗くない）', !q.dark(-1, 0) && !q.dark(0, q.size));

group('3. 入りきらない長さ・SVG');
let threw = false;
try { Q.matrix('x'.repeat(300)); } catch (e) { threw = true; }
t('型番10に入りきらない長さは例外（黙って切らない）', threw);
const s = Q.svg(URL1, { px: 200, label: '見本の QR' });
const pathEl = s.children.find((c) => c.tag === 'path');
const n = q.size + 8;
t('SVG: 余白4マスの viewBox・大きさ・読み上げ用の名前', s.attrs.viewBox === '0 0 ' + n + ' ' + n && s.attrs.width === '200' && s.attrs['aria-label'] === '見本の QR' && s.attrs.role === 'img');
t('SVG: 白い地と黒いマスだけ（文字の部品が無い）',
  s.children.length === 2 && s.children[0].tag === 'rect' && s.children[0].attrs.fill === '#ffffff' && pathEl.attrs.fill === '#000000'
  && !s.children.some((c) => c.tag === 'text'));
let dark = 0; for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) dark++;
t('SVG: 黒いマスの数だけ四角を描く', (pathEl.attrs.d.match(/M/g) || []).length === dark);
t('部品は通信しない・端末に何も残さない', !/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(SRC));

say('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
process.exit(ng ? 1 : 0);
