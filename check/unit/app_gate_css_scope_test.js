/* 覆いの見た目（su-app-gate.css）が、覆いの箱の外の部品に当たらないことの試験（2026-11-27 新設）
   実行: node check/unit/app_gate_css_scope_test.js
   守りたいこと:
     su-app-gate.css は su-app-gate.js を読む全画面に足される。決まりの頭（選び方）は、覆いの箱の id（#su-app-gate）・
     覆っている間の印（html.sug-on）・部品の接頭辞つきの名前（.sug-…）だけで書く（箱の id は :where() で包み、su-theme.css の型の色が上に効く強さのままにする）。
     裸の短い名前（例 .sug）は、画面の部品（打刻の画面の勧めるボタン button.sug）に当たり、そのボタンが全画面を覆った（2026-11-27） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const css = fs.readFileSync(path.join(ROOT, 'su-app-gate.css'), 'utf8');
/* 注釈と @keyframes の中身（to・from など）を外し、残った「{」の前の頭を全部集める（@media・@supports の頭は数えない） */
const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
const heads = [];
const re = /(?:^|[{};])\s*([^{};]+?)\s*\{/g;
let m;
while ((m = re.exec(body))) { if (!/^@/.test(m[1])) heads.push(m[1]); re.lastIndex = m.index + m[0].length - 1; }   /* 「{」を次の頭の区切りにも使う（@media の中の最初の決まりも数える） */
const sels = [].concat(...heads.map((h) => h.split(',').map((x) => x.trim()))).filter(Boolean);
const okHead = (s) => /^(html\.sug-on\b|#su-app-gate\b|:where\(#su-app-gate\)|\.sug-[a-z])/.test(s);
const bad = sels.filter((s) => !okHead(s));

console.log('\n— 覆いの見た目の決まりの頭 —');
t('決まりを読めた（頭が10個以上）', sels.length >= 10, sels.length);
t('頭は html.sug-on・#su-app-gate・.sug- で始まる名前だけ（裸の短い名前が無い）', bad.length === 0, bad);
t('覆いの箱（全画面・最前面）は id で絞って書く（:where(#su-app-gate).sug＝強さは前の .sug のまま）', /:where\(#su-app-gate\)\.sug\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/.test(body));
t('裸の .sug（すぐ後が - でない）を頭に使わない', !sels.some((s) => /(^|[\s>+~,])\.sug(?![-\w])/.test(s) && !/#su-app-gate\)?\.sug(?![-\w])/.test(s)), sels.filter((s) => /\.sug(?![-\w])/.test(s)));
t('su-app-gate.js が読む css の版は 2026-11-27 以降（直した css を端末が読み直す）', /V_CSS = 'su-app-gate\.css\?v=(\d{4}-\d{2}-\d{2})/.test(fs.readFileSync(path.join(ROOT, 'su-app-gate.js'), 'utf8')) && RegExp.$1 >= '2026-11-27');

console.log('\n結果: ' + pass + ' 合格 / ' + fail + ' 不合格');
process.exit(fail ? 1 : 0);
