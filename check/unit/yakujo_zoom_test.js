/* 薬情の取り込みの振り分けの画面で、氏名の所を拡大する範囲（yakujo-calc.js の nameZoom・本人指示 2026-11-12）の試験
   実行: node check/unit/yakujo_zoom_test.js（環境変数 YAKUJO_CALC で別の版を当てられる）
   架空データのみ（氏名は「架空」「見本」の架空の名前）。
   守りたいこと:
     1. 探す順は、選んでいる方の氏名の行 → カナの行 → 1字違いの行 → 「様」「氏名」の行 → ページの上の方
     2. 範囲はページの中（0〜1）に収まり、読んだ行の枠を含む
     3. 2ページ目にしか氏名が無い時は2ページ目を返す。ページが無い・形が崩れている時に例外を出さない */
'use strict';
const path = require('path');
const Y = require(process.env.YAKUJO_CALC || path.join(__dirname, '..', '..', 'yakujo-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const L = (t, x, y, w, h) => ({ t, x, y, w: w ?? 0.3, h: h ?? 0.02 });
const doc = (...pages) => ({ pages: pages.map((lines, i) => ({ no: i + 1, lines })) });
const P = { name: '架空 一郎', kana: 'カクウ イチロウ' };
const inside = (z) => z.x >= 0 && z.y >= 0 && z.x + z.w <= 1 + 1e-9 && z.y + z.h <= 1 + 1e-9;
const holds = (z) => z.box && z.x <= z.box.x && z.y <= z.box.y && z.x + z.w >= z.box.x + z.box.w - 1e-9 && z.y + z.h >= z.box.y + z.box.h - 1e-9;

let z = Y.nameZoom(doc([L('調剤日 2026年11月01日', 0.5, 0.02), L('見本 二郎 様', 0.1, 0.5), L('架空 一郎 様', 0.1, 0.1)]), P);
t('選んでいる方の氏名の行を返す（ほかの方の「様」の行より先）', z.hit === 'name' && z.box.y === 0.1, z);
t('範囲はページの中で、読んだ行の枠を含む', inside(z) && holds(z), z);
t('範囲はページ全体より小さい（拡大になる）', z.w <= 0.7 && z.h <= 0.3, z);

z = Y.nameZoom(doc([L('ｶｸｳ ｲﾁﾛｳ', 0.2, 0.3)]), P);
t('氏名が無い時はカナの行（半角カナでも）', z.hit === 'kana' && z.box.y === 0.3, z);

z = Y.nameZoom(doc([L('架空 一朗 様', 0.1, 0.2)]), P);
t('1字違いの行', z.hit === 'near' && z.box.y === 0.2, z);

z = Y.nameZoom(doc([L('お薬の説明', 0.1, 0.02), L('患者氏名 ＊＊＊', 0.6, 0.15)]), P);
t('見つからない時は「氏名」の見出しの行', z.hit === 'label' && z.box.y === 0.15, z);
z = Y.nameZoom(doc([L('お薬の説明', 0.1, 0.02), L('＊＊＊ 様', 0.6, 0.15)]), null);
t('方を選んでいない時も「様」の行を探す', z.hit === 'label' && z.box.x === 0.6, z);

z = Y.nameZoom(doc([L('お薬の説明', 0.1, 0.02)]), P);
t('何も無い時はページの上の方（4分の1）', z.hit === 'top' && z.box === null && z.y === 0 && z.h === 0.25 && z.page === 1, z);

z = Y.nameZoom(doc([L('お薬の説明', 0.1, 0.02)], [L('架空 一郎 様', 0.1, 0.05)]), P);
t('2ページ目にだけ氏名がある時は2ページ目', z.page === 2 && z.hit === 'name', z);

z = Y.nameZoom(doc([L('架空 一郎 様', 0.85, 0.97, 0.15, 0.03)]), P);
t('ページの端の行でも範囲はページの中に収まる', inside(z) && holds(z), z);

z = Y.nameZoom(doc([L('架空 一郎 様', 0.1, 0.1, 0, 0), L('架空 一郎', 0.1, 0.4)]), P);
t('大きさの無い行は使わない', z.box.y === 0.4, z);

t('ページが無い時は null', Y.nameZoom({ pages: [] }, P) === null && Y.nameZoom(null, P) === null);
let ok = true; try { Y.nameZoom({ pages: [{ no: 1, lines: null }, { no: 2 }] }, { name: '', kana: '' }); } catch (e) { ok = false; }
t('行の無いページ・空の名前でも例外を出さない', ok);
t('名前の1字だけの方では氏名の行と見なさない', Y.nameZoom(doc([L('架 様', 0.1, 0.1)]), { name: '架', kana: '' }).hit !== 'name');

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
