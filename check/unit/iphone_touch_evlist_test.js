/* iphone_touch_evlist_test.js — iPhone での押しやすさと、予定一覧の表示を再読み込みで戻す（2026-10-18 改善プロンプト第2弾の12）
 * 守ること:
 *   1. 家族構成図: 幅700px以下だけ、見出し・倍率・同期・道具のボタンと閉じるボタンを 44px 以上、入力の文字を 16px（iPhone で拡大されない）。
 *      幅700px の外（PC）と印刷には効かない。利用者名の入力と図の選択に読み上げ用の名前
 *   2. 体重管理: 幅700px以下だけ見出しのボタンを 44px（PC は今までどおり 40px）
 *   3. 週間計画: 予定一覧の表示（曜日別・種別別・簡易）を端末に残し、起動時に戻す。既知の値だけ信じる・それ以外は曜日別。
 *      残すのは表示の名前だけ（氏名・予定は残さない）。残せない端末でも切り替えは動く
 * 実物のソースから切り出して確かめる（写経しない）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function mediaBlock(src, cond) {
  const i = src.indexOf('@media (max-width:700px){');
  if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) return src.slice(i, j + 1); } }
  return '';
}

console.log('\n— 1. 家族構成図 —');
{
  const s = read('genogram.html');
  const m = mediaBlock(s);
  t('幅700px以下の区切りがある', !!m, m.slice(0, 80));
  t('見出し・倍率・同期のボタンは高さを外して 44px 以上', /\.hbtn,\.zbtn,\.sync-btn\{height:auto;min-height:44px\}/.test(m));
  t('道具のボタンも 44px 以上', /\.tbtn\{min-height:44px\}/.test(m));
  t('閉じるボタンは 44px の丸', /\.modal-close\{width:44px;height:44px\}/.test(m));
  t('入力・選択・文章の文字は 16px（入力の時に拡大されない）', /\.hdr-r input,\.hdr-r select,\.fi,input,select,textarea\{font-size:16px\}/.test(m));
  t('PC 用の元の大きさは変えていない（幅700px の外）', /\.zbtn\{height:26px;/.test(s) && /\.sync-btn\{height:24px;/.test(s) && /\.modal-close\{[^}]*width:30px;height:30px;/.test(s));
  t('利用者名の入力に読み上げ用の名前', /<input type="text" id="clientName"[^>]*aria-label="利用者名"/.test(s));
  t('図の選択に読み上げ用の名前', /<select id="docList"[^>]*aria-label="[^"]+"/.test(s));
  t('印刷の区切りの中は触っていない（44px・16px は @media print に無い）', !/@media print[^{]*\{[^}]*(min-height:44px|font-size:16px)/.test(s));
}

console.log('\n— 2. 体重管理 —');
{
  const s = read('weight-record.html');
  t('幅700px以下だけ見出しのボタンを 44px', /@media \(max-width:700px\)\{\.hdr-btn\{min-height:44px\}\}/.test(s));
  t('PC は今までどおり 40px', /\.hdr-btn\{min-height:40px;/.test(s));
}

console.log('\n— 3. 週間計画の予定一覧の表示 —');
{
  const s = read('care-schedule.html');
  const start = s.indexOf("let _evlistView = 'day';");
  const initBlock = s.slice(start, s.indexOf('\n', s.indexOf("try { const v0 = localStorage.getItem(CS_EVLIST_VIEW_KEY)")) + 1);
  const viewsLine = (s.match(/const EVLIST_VIEWS_ = \[[^\]]*\];/) || [''])[0];
  function cutF(name) {
    const h = s.indexOf('function ' + name + '(');
    let i = s.indexOf('{', h), d = 0;
    for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) return s.slice(h, i + 1); } }
    throw new Error(name);
  }
  function box(stored, opt) {
    const o = opt || {};
    const store = {}; if (stored !== undefined) store.cs_evlist_view_v1 = stored;
    const sets = [], btns = {}, renders = [];
    ['day', 'svc', 'simple'].forEach(v => { btns[v] = { on: false, classList: { toggle: (c, x) => { btns[v].on = !!x; } } }; });
    const b = {
      localStorage: o.throws ? { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }
        : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { sets.push([k, v]); store[k] = String(v); } },
      $: sel => { const m = /^#evlist-tab-(\w+)$/.exec(sel); return m ? btns[m[1]] : null; },
      renderEventListBody: () => renders.push(1)
    };
    vm.createContext(b);
    vm.runInContext(initBlock.replace(/^let /m, 'var ').replace(/const CS_EVLIST_VIEW_KEY/, 'var CS_EVLIST_VIEW_KEY') + '\n' + viewsLine.replace('const', 'var') + '\n' + cutF('syncEventListTabs_') + '\n' + cutF('setEventListView') + '\nthis.get = () => _evlistView;', b);
    return { b, sets, btns, store };
  }
  t('残っていない時は曜日別', box(undefined).b.get() === 'day');
  t('残っていた表示（svc・simple）で起動する', box('svc').b.get() === 'svc' && box('simple').b.get() === 'simple');
  t('知らない値・壊れた値は曜日別（壊れた値で起動できなくしない）', box('evil').b.get() === 'day' && box('').b.get() === 'day' && box('SVC').b.get() === 'day');
  t('読めない端末でも曜日別で起動する', box(undefined, { throws: true }).b.get() === 'day');
  {
    const x = box(undefined);
    x.b.setEventListView('simple');
    t('切り替えたら表示の名前だけを残す', x.sets.length === 1 && x.sets[0][0] === 'cs_evlist_view_v1' && x.sets[0][1] === 'simple' && x.btns.simple.on && !x.btns.day.on);
    x.b.setEventListView('<img src=x>');
    t('知らない名前で切り替えようとしても曜日別を残す', x.b.get() === 'day' && x.store.cs_evlist_view_v1 === 'day');
  }
  {
    const x = box(undefined, { throws: true });
    x.b.setEventListView('svc');
    t('残せない端末でも切り替えは動く', x.b.get() === 'svc' && x.btns.svc.on);
  }
  t('一覧を開いた時に、残っていた表示に合わせてボタンの印をそろえる', /function openEventListModal\(\) \{[\s\S]{0,260}syncEventListTabs_\(\);[\s\S]{0,40}renderEventListBody\(\);/.test(s));
  t('残すのは表示の名前だけ（キーは1つ・氏名や予定を書かない）', (s.match(/CS_EVLIST_VIEW_KEY/g) || []).length === 3 && /localStorage\.setItem\(CS_EVLIST_VIEW_KEY, _evlistView\)/.test(s));
}

console.log('\n合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
