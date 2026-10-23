/* メニューの役割ごとの表示・並び（su-menu.js・2026-10-23 代表者の決定）の試験
   実行: node check/unit/menu_arrange_test.js
   守ること:
     1 設定が無い・形が違う時は、ページの中の定義をそのまま使う（壊れた設定でメニューが出なくなるのを防ぐ）
     2 区分の中の並び・区分の並びを設定どおりにする。設定に無いボタン（後から足したもの）は既定の位置関係のまま末尾へ
     3 その役割で隠したボタンだけを出さない。ほかの役割・ログインしていない時（役割なし）には効かない
     4 「使い方・困った時」は隠せない
     5 並びを変えた区分では「新しい行から始める」を外す。並びが既定のままの区分では残す
     6 元の定義を書き換えない。事務所専用の印（officeOnly）は並べ替えても残る（現場端末で出さない仕組みを外さない）
     7 端末の控えは役割が分からない時・ログインの記録が無い時は使わない
     8 メニュー（index.html）の定義に、ケアログが入居者の区分の末尾にある
   画面のコードは書き換えず、su-menu.js をそのまま読み込んで動かす。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-menu.js'), 'utf8');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

function load(store) {
  const ls = {
    _d: Object.assign({}, store || {}),
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    key(i) { return Object.keys(this._d)[i]; },
    get length() { return Object.keys(this._d).length; }
  };
  const win = { localStorage: ls };
  const ctx = { window: win, localStorage: ls, document: { readyState: 'loading', getElementsByTagName: () => [] }, JSON, Promise, setTimeout };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return win.SUMenu;
}

const m = IDX.match(/<script type="application\/json" id="menuDef">([\s\S]*?)<\/script>/);
const DEF = JSON.parse(m[1]);
const DEF_TEXT = JSON.stringify(DEF);
const M = load();
const hrefs = (v, id) => v.sections.find(s => s.id === id).tiles.map(x => x.href);
const res = id => hrefs(DEF, id);

console.log('1 設定なし・形違い');
t('1a 設定 null → 定義そのもの', M.arrange(DEF, null, 'field') === DEF);
t('1b ver が 1 でない → 定義そのもの', M.arrange(DEF, { ver: 2, hide: { field: ['weight-record.html'] } }, 'field') === DEF);
t('1c 配列 → 定義そのもの', M.arrange(DEF, [], 'field') === DEF);
t('1d 区分の一覧が無い定義 → そのまま返す', M.arrange({ x: 1 }, { ver: 1 }, 'admin').x === 1);
const bad = M.arrange(DEF, { ver: 1, order: { 'sec-resident': ['<x>', 3] }, hide: { field: 'weight-record.html', guest: ['facesheet.html'] }, secs: 'x' }, 'field');
t('1e 中身の形が違う項目は無視して既定の並び・全部出す', JSON.stringify(hrefs(bad, 'sec-resident')) === JSON.stringify(res('sec-resident')), hrefs(bad, 'sec-resident'));

console.log('2 並び');
const r0 = res('sec-resident');
const want = [r0[3], r0[0]];
const v2 = M.arrange(DEF, { ver: 1, order: { 'sec-resident': want.concat(['no-such.html', r0[3]]) }, secs: ['sec-kitchen', 'sec-staff', 'nope'] }, 'admin');
const got = hrefs(v2, 'sec-resident');
t('2a 区分の中: 設定の順が先・存在しない鍵と重複は飛ばす', got[0] === want[0] && got[1] === want[1], got.slice(0, 3));
t('2b 残りは既定の位置関係のまま末尾（数も同じ）', JSON.stringify(got.slice(2)) === JSON.stringify(r0.filter(h => want.indexOf(h) < 0)) && got.length === r0.length);
t('2c 区分の並び: 設定の順が先・残りは既定の順', JSON.stringify(v2.sections.map(s => s.id)) ===
  JSON.stringify(['sec-kitchen', 'sec-staff'].concat(DEF.sections.map(s => s.id).filter(id => id !== 'sec-kitchen' && id !== 'sec-staff'))));
t('2d 並べ替えない区分は同じ並び', JSON.stringify(hrefs(v2, 'sec-staff')) === JSON.stringify(res('sec-staff')));

console.log('3 役割ごとの非表示');
const cfg3 = { ver: 1, hide: { field: ['weight-record.html', 'shift-app.html'], office: ['supplies.html'] } };
const f = M.arrange(DEF, cfg3, 'field'), o = M.arrange(DEF, cfg3, 'office'), a = M.arrange(DEF, cfg3, 'admin'), n = M.arrange(DEF, cfg3, null);
t('3a 現場: 隠したボタンが無い', hrefs(f, 'sec-resident').indexOf('weight-record.html') < 0 && hrefs(f, 'sec-staff').indexOf('shift-app.html') < 0);
t('3b 現場: ほかは残る（入居者の区分は1枚だけ減る）', hrefs(f, 'sec-resident').length === r0.length - 1);
t('3c 事務所: 事務所で隠したものだけ無い', hrefs(o, 'sec-resident').indexOf('supplies.html') < 0 && hrefs(o, 'sec-resident').indexOf('weight-record.html') >= 0);
t('3d 管理者: 全部出る', hrefs(a, 'sec-resident').length === r0.length && hrefs(a, 'sec-staff').length === res('sec-staff').length);
t('3e 役割なし（ログインしていない）: 全部出る', hrefs(n, 'sec-resident').length === r0.length);
t('3f 知らない役割: 全部出る', hrefs(M.arrange(DEF, cfg3, 'guest'), 'sec-resident').length === r0.length);

console.log('4 隠せないボタン');
const v4 = M.arrange(DEF, { ver: 1, hide: { field: ['help.html'] } }, 'field');
t('4a 困った時の入口は隠しても出る', hrefs(v4, 'sec-help').indexOf('help.html') >= 0);

console.log('5 新しい行から始める印');
const nr = DEF.sections.find(s => s.id === 'sec-resident').tiles.find(x => x.newrow);
t('5-前提 入居者の区分に印のあるボタンがある', !!nr);
const keep = M.arrange(DEF, { ver: 1, order: { 'sec-resident': r0 }, hide: { admin: ['supplies.html'] } }, 'admin');
t('5a 並びが既定のまま（隠しただけ）→ 印は残る', keep.sections.find(s => s.id === 'sec-resident').tiles.find(x => x.href === nr.href).newrow === true);
const sw = r0.slice(); const x0 = sw[0]; sw[0] = sw[1]; sw[1] = x0;
const moved = M.arrange(DEF, { ver: 1, order: { 'sec-resident': sw } }, 'admin');
t('5b 並びを変えた区分 → 印を外す', !moved.sections.find(s => s.id === 'sec-resident').tiles.some(x => x.newrow));

console.log('6 元の定義と事務所専用の印');
M.arrange(DEF, { ver: 1, order: { 'sec-resident': sw }, hide: { field: r0 }, secs: ['sec-help'] }, 'field');
t('6a 元の定義は書き換わらない', JSON.stringify(DEF) === DEF_TEXT);
const off = DEF.sections.find(s => s.id === 'sec-resident').tiles.filter(x => x.officeOnly).map(x => x.href);
const v6 = M.arrange(DEF, { ver: 1, order: { 'sec-resident': r0.slice().reverse() } }, 'admin');
t('6b 並べ替えても事務所専用の印は残る', off.length > 0 && off.every(h => v6.sections.find(s => s.id === 'sec-resident').tiles.find(x => x.href === h).officeOnly === true));
t('6c 区分ごとの事務所専用の印も残る', M.arrange(DEF, { ver: 1, secs: ['sec-setup'] }, 'admin').sections[0].officeOnly === true);

console.log('7 端末の控え');
t('7a 控えが無い → null', load().readCache() === null);
t('7b 役割の無い控え → null', load({ su_menu_v1: JSON.stringify({ config: { ver: 1 } }) }).readCache() === null);
t('7c 壊れた控え → null', load({ su_menu_v1: '{x' }).readCache() === null);
const LOGIN = { 'sb-example-auth-token': '{}' };   // ログインの記録（キーの名前だけを見る）
const c7 = load(Object.assign({ su_menu_v1: JSON.stringify({ role: 'field', config: { ver: 1, hide: { field: ['weight-record.html'] } } }) }, LOGIN)).readCache();
t('7d 正しい控え（ログインの記録あり）→ 役割と設定', c7 && c7.role === 'field' && c7.config.hide.field[0] === 'weight-record.html', c7);
t('7e ログインの記録が無い端末では控えを使わない（ログアウトした後に前の人の並びを出さない）',
  load({ su_menu_v1: JSON.stringify({ role: 'field', config: { ver: 1 } }) }).readCache() === null);

console.log('8 ケアログのボタン');
const care = DEF.sections.find(s => s.id === 'sec-resident').tiles.slice(-1)[0];
t('8a 入居者の区分の末尾にケアログ（別サイト・事務所専用ではない）',
  care.href === 'https://th-su.github.io/care-log/' && care.nm === 'ケアログ' && care.ext === true && !care.officeOnly, care);
t('8b ボタンの鍵（リンク先）はすべてデータベースの検査に通る形・重複なし', (function () {
  const all = []; DEF.sections.forEach(s => s.tiles.forEach(x => all.push(x.href)));
  return all.every(h => /^[A-Za-z0-9_.:\/?=&#%~-]{1,200}$/.test(h)) && new Set(all).size === all.length
    && DEF.sections.every(s => /^[A-Za-z0-9_-]{1,40}$/.test(s.id));
})());

console.log(`\n合格 ${pass} / 不合格 ${fail}`);
process.exit(fail ? 1 : 0);
