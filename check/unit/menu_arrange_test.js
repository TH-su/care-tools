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
     8 メニュー（index.html）の定義に、ケアログ・デイが並び、入居者の区分の末尾に担当者会議の記録がある。
       後から足したボタンを区分の末尾に置くので、前の定義で保存した設定でも並びと「新しい行から始める」が崩れない
     9 区分の作成・名前・削除・ボタンの移し先（0023・2026-10-26 本人指示）
       - デイの区分は入居者の直後。前の定義で保存した設定（入居者の並びにデイのボタンが残る）でも、デイの区分に出て入居者の直後に置く
       - 作った区分・名前の上書き・移し先が効く。移し先が無い・消した区分なら既定の区分へ（ボタンを失わない）
       - 消した区分は、ボタンが残る時だけ出す。事務所専用の区分から移したボタンは事務所専用のまま
       - 形の違う1件だけを捨てる（名前が長い・制御文字など）
       - 隠せないボタン（使い方・困った時）は事務所専用の区分へ移さない
    10 施設の既定の毬の柄（ball・0025・2026-10-26 代表者の決定）
       - 'asanoha' だけを受け付ける。'kiku'・不正な値は捨てる（キーごと持たない＝無い時は菊かがり）
       - ball の有無で並び・非表示は変わらない
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
t('2c 区分の並び: 設定の順が先・設定に無い区分は既定で前にある区分の直後（2026-10-26 から。前は末尾）', (function () {
  const got = v2.sections.map(s => s.id), ids = DEF.sections.map(s => s.id);
  if (got.length !== ids.length || got.indexOf('sec-kitchen') > got.indexOf('sec-staff')) return false;
  // 設定に無い区分は、既定で1つ前の区分のすぐ後ろ（先頭の区分なら先頭）
  return ids.every((id, i) => ['sec-kitchen', 'sec-staff'].indexOf(id) >= 0 || (i === 0 ? got[0] === id : got[got.indexOf(ids[i - 1]) + 1] === id));
})(), v2.sections.map(s => s.id));
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
t('6c 区分ごとの事務所専用の印も残る', M.arrange(DEF, { ver: 1, secs: ['sec-setup'] }, 'admin').sections.find(s => s.id === 'sec-setup').officeOnly === true);

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
const resTiles = DEF.sections.find(s => s.id === 'sec-resident').tiles;
const care = resTiles.slice(-2)[0], day = DEF.sections.find(s => s.id === 'sec-daycare').tiles.slice(-1)[0], mtg = resTiles.slice(-1)[0];
t('8a 入居者の区分の末尾から2枚目にケアログ（別サイト・事務所専用ではない。デイは 2026-10-26 にデイの区分へ移した）',
  care.href === 'https://th-su.github.io/care-log/' && care.nm === 'ケアログ' && care.ext === true && !care.officeOnly, care);
t('8c デイの区分の末尾はデイ（ケアログのデイの画面・名前の事業所名は施設情報から・別サイト・事務所専用ではない）',
  day.href === 'https://th-su.github.io/care-log/#/record/daycare' && day.nm === 'デイ {{通所}}' && day.ext === true && !day.officeOnly, day);
t('8d 末尾は担当者会議の記録（事務所専用・2026-10-25）',
  mtg.href === 'care-meeting.html' && mtg.nm === '担当者会議の記録' && mtg.officeOnly === true && !mtg.ext, mtg);
t('8e 担当者会議の記録を足す前の並びで保存した設定でも、入居者の区分の並びは既定のまま・フェイスシートの新しい行の印も残る（2026-10-25 審査の指摘）', (function () {
  const prev = {}; DEF.sections.forEach(s => { prev[s.id] = s.tiles.map(x => x.href).filter(h => h !== 'care-meeting.html'); });
  const out = M.arrange(DEF, { ver: 1, order: prev, secs: DEF.sections.map(s => s.id) }, 'office');
  const got = out.sections.find(s => s.id === 'sec-resident').tiles;
  return got.map(x => x.href).join('|') === resTiles.map(x => x.href).join('|') && got.some(x => x.href === 'facesheet.html' && x.newrow === true);
})());
t('8b ボタンの鍵（リンク先）はすべてデータベースの検査に通る形・重複なし', (function () {
  const all = []; DEF.sections.forEach(s => s.tiles.forEach(x => all.push(x.href)));
  return all.every(h => /^[A-Za-z0-9_.:\/?=&#%~-]{1,200}$/.test(h)) && new Set(all).size === all.length
    && DEF.sections.every(s => /^[A-Za-z0-9_-]{1,40}$/.test(s.id));
})());

console.log('9 区分の作成・名前・削除・ボタンの移し先');
const ids = v => v.sections.map(s => s && s.id);
const DAY = ['daycare-roster.html', 'training-plan.html', 'https://th-su.github.io/care-log/#/record/daycare'];
const daySec = DEF.sections.find(s => s.id === 'sec-daycare');
t('9a 定義: デイの区分は入居者の直後・名前は「デイ {{通所}}」・3つのボタン', !!daySec && ids(DEF)[ids(DEF).indexOf('sec-resident') + 1] === 'sec-daycare'
  && daySec.title === 'デイ {{通所}}' && JSON.stringify(daySec.tiles.map(x => x.href)) === JSON.stringify(DAY), daySec && daySec.tiles.map(x => x.href));
t('9b 定義: 3つのボタンは入居者の区分にもう無い', DAY.every(h => res('sec-resident').indexOf(h) < 0));
t('9c 定義: 訓練計画は事務所専用・期限の札の印のまま', daySec.tiles[1].officeOnly === true && daySec.tiles[1].due === 'tp_menu_due');
const OLD = { ver: 1, secs: ['sec-staff', 'sec-resident', 'sec-kitchen', 'sec-setup', 'sec-help'],
  order: { 'sec-resident': res('sec-resident').slice(0, 3).concat(DAY).concat(res('sec-resident').slice(3)) } };
const v9 = M.arrange(DEF, OLD, 'office');
t('9d 前の定義で保存した設定: デイの区分は入居者の直後に出る（末尾に回らない）', ids(v9)[ids(v9).indexOf('sec-resident') + 1] === 'sec-daycare', ids(v9));
t('9e 前の定義で保存した設定: 入居者の並びに残ったデイのボタンはデイの区分に出る（入居者には出ない）',
  JSON.stringify(hrefs(v9, 'sec-daycare')) === JSON.stringify(DAY) && DAY.every(h => hrefs(v9, 'sec-resident').indexOf(h) < 0));
t('9f 前の定義で保存した設定: 入居者の並びは既定のまま・フェイスシートの新しい行の印も残る',
  hrefs(v9, 'sec-resident').join('|') === res('sec-resident').join('|') && v9.sections.find(s => s.id === 'sec-resident').tiles.some(x => x.href === 'facesheet.html' && x.newrow));
const C9 = { ver: 1, secs: ['sec-staff', 'c-new1', 'sec-resident'],
  sdef: { 'c-new1': { mk: '🧪', title: '試しの区分' }, 'sec-staff': { mk: '', title: '職員さん' } },
  mv: { 'weight-record.html': 'c-new1', 'connection-settings.html': 'sec-staff', 'supplies.html': 'no-such', 'shift-app.html': 'sec-kitchen' },
  gone: ['sec-kitchen'], order: { 'c-new1': ['weight-record.html'] } };
const w = M.arrange(DEF, C9, 'admin');
const sec = (v, id) => v.sections.find(s => s.id === id);
t('9g 作った区分が設定の位置に出て、名前・絵文字・移したボタンが入る', ids(w)[1] === 'c-new1' && sec(w, 'c-new1').title === '試しの区分' && sec(w, 'c-new1').mk === '🧪'
  && hrefs(w, 'c-new1').join() === 'weight-record.html' && sec(w, 'c-new1').custom === true, ids(w));
t('9h 最初からある区分の名前・絵文字を上書きできる（絵文字は空でもよい）', sec(w, 'sec-staff').title === '職員さん' && sec(w, 'sec-staff').mk === '');
t('9i 移したボタンは元の区分に無い', hrefs(w, 'sec-resident').indexOf('weight-record.html') < 0);
t('9j 移し先が無い区分なら既定の区分に出す', hrefs(w, 'sec-resident').indexOf('supplies.html') >= 0);
t('9k 消した区分へは移せない（既定の区分に出す）', hrefs(w, 'sec-staff').indexOf('shift-app.html') >= 0);
t('9l 消した区分は、ボタンが残っていると消さずに出す（後から足したボタンを失わない）', !!sec(w, 'sec-kitchen'));
const w2 = M.arrange(DEF, Object.assign({}, C9, { mv: Object.assign({}, C9.mv, { 'https://kitchen-app-9o7.pages.dev/': 'sec-staff' }) }), 'admin');
t('9m 消した区分は、ボタンを全部移せば出ない', !sec(w2, 'sec-kitchen') && hrefs(w2, 'sec-staff').indexOf('https://kitchen-app-9o7.pages.dev/') >= 0);
const cs = sec(w, 'sec-staff').tiles.find(x => x.href === 'connection-settings.html');
t('9n 事務所専用の区分（設定）から移したボタンは、移した先でも事務所専用', cs && cs.officeOnly === true);
t('9o 移したボタンの元の定義は書き換わらない', !DEF.sections.find(s => s.id === 'sec-setup').tiles[0].officeOnly && JSON.stringify(DEF) === DEF_TEXT);
t('9p ボタンが出入りした区分では「新しい行から始める」を外す', !sec(w, 'sec-resident').tiles.some(x => x.newrow));
t('9q 役割の非表示は移した先でも効く', hrefs(M.arrange(DEF, Object.assign({}, C9, { hide: { field: ['weight-record.html'] } }), 'field'), 'c-new1').length === 0);
const e9 = M.clean({ ver: 1, sdef: { 'c-a': { mk: '', title: 'あ'.repeat(21) }, 'c-b': { mk: '', title: 'a\nb' }, 'c-c': { mk: '123456789', title: 'x' },
  'c-d': { title: 'x' }, 'c ok': { mk: '', title: 'x' }, 'c-e': { mk: '🌊', title: 'あ'.repeat(20) } }, gone: 'x', mv: { 'a b': 'sec-a', 'x.html': 'sec/a', 'y.html': 'sec-a' } });
t('9r 形の違う1件だけを捨てる（名前21字・改行・絵文字9字・絵文字なし・区分idが変）', JSON.stringify(Object.keys(e9.sdef)) === '["c-e"]', e9.sdef);
t('9s 名前の字数は文字で数える（絵文字1つで1字）', !!M.clean({ ver: 1, sdef: { 'c-a': { mk: '🏃‍♀️', title: 'x' } } }).sdef['c-a'] === (Array.from('🏃‍♀️').length <= 8));
t('9t 形の違う gone・mv は捨てる（ほかは効く）', e9.gone.length === 0 && JSON.stringify(e9.mv) === '{"y.html":"sec-a"}', e9);
t('9u 作った区分はボタンが無くても配置（layout）に残る（設定の画面で中を空にしても消えない）',
  M.layout(DEF, M.clean({ ver: 1, sdef: { 'c-z': { mk: '', title: '空' } } })).some(s => s.id === 'c-z' && s.tiles.length === 0));
t('9w 「使い方・困った時」は事務所専用の区分（設定）へ移さない（現場端末から消えないように・反証レビューの指摘）', (function () {
  const v = M.arrange(DEF, { ver: 1, mv: { 'help.html': 'sec-setup' }, gone: ['sec-help'] }, 'field');
  return hrefs(v, 'sec-help').join() === 'help.html' && hrefs(v, 'sec-setup').indexOf('help.html') < 0;
})());
t('9x 「使い方・困った時」はふつうの区分へは移せる', hrefs(M.arrange(DEF, { ver: 1, mv: { 'help.html': 'sec-staff' } }, 'field'), 'sec-staff').indexOf('help.html') >= 0);
t('9v 0023 のキーだけの設定でも、区分の並びは既定のまま', ids(M.arrange(DEF, { ver: 1, sdef: { 'sec-staff': { mk: '', title: 'x' } } }, 'admin')).join() === ids(DEF).join());

console.log('10 施設の既定の毬の柄');
t('10a ball:"asanoha" は受け付ける', M.clean({ ver: 1, ball: 'asanoha' }).ball === 'asanoha');
t('10b ball:"kiku" は捨てる（キーごと持たない）', !('ball' in M.clean({ ver: 1, ball: 'kiku' })));
t('10c 不正な値（大文字・空白つき・数・null・配列・オブジェクト）は捨てる',
  ['ASANOHA', ' asanoha', 'asanoha ', '', 1, null, ['asanoha'], { k: 'asanoha' }, true].every(v => !('ball' in M.clean({ ver: 1, ball: v }))));
t('10d ball が無い設定は今までどおり（キーを足さない）', !('ball' in M.clean({ ver: 1 })));
t('10e 形の違う ball があっても、ほかの並び・非表示は効く', hrefs(M.arrange(DEF, { ver: 1, ball: 7, hide: { field: ['weight-record.html'] } }, 'field'), 'sec-resident').indexOf('weight-record.html') < 0);
t('10f ball の有無で並び・非表示は変わらない', JSON.stringify(M.arrange(DEF, { ver: 1, ball: 'asanoha', order: { 'sec-resident': sw } }, 'admin')) === JSON.stringify(M.arrange(DEF, { ver: 1, order: { 'sec-resident': sw } }, 'admin')));
t('10g ver が違う設定の ball は効かない（設定ごと無し）', M.clean({ ver: 2, ball: 'asanoha' }) === null);

console.log(`\n合格 ${pass} / 不合格 ${fail}`);
process.exit(fail ? 1 : 0);
