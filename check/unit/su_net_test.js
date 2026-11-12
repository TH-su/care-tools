/* su-net.js（インターネットにつながっていない時の帯・2026-11-12）の試験。架空の window / document で動かす（外へは通信しない）。
 * 確かめること: つながらない→帯が出る／つながった→消える／開いた時に offline なら出る／枠の中では出さない／
 *   印刷の間は隠す／端末に何も書かない／二重に読み込んでも帯は1本／例外を外に出さない／
 *   通信切れを自分で扱う画面には入れず、扱わない11画面には入れている（重ねて出さない） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-net.js'), 'utf8');
let ok = 0, ng = 0;
function t(name, cond, extra){ if(cond){ ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } }

function makeEnv(opt){
  opt = opt || {};
  const listeners = {}, docListeners = {}, appended = [], writes = [];
  function el(tag){ return { tagName: tag, style: {}, attrs: {}, hidden: false, textContent: '', className: '',
    setAttribute(k, v){ this.attrs[k] = String(v); } }; }
  const body = { appendChild(n){ appended.push(n); return n; } };
  const document = { readyState: opt.loading ? 'loading' : 'complete', body, documentElement: body,
    createElement: el, addEventListener(ev, fn){ (docListeners[ev] = docListeners[ev] || []).push(fn); } };
  const storage = { setItem(k, v){ writes.push(k); }, getItem(){ return null; }, removeItem(k){ writes.push(k); } };
  const win = { document, navigator: { onLine: opt.onLine !== false }, localStorage: storage, sessionStorage: storage,
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev] || []).push(fn); } };
  win.self = win; win.top = opt.inFrame ? {} : win; win.window = win;
  const mqL = []; win.matchMedia = (q) => ({ matches: false, addEventListener(ev, fn){ if(q === 'print') mqL.push(fn); } });
  const ctx = vm.createContext(win);
  return { ctx, win, appended, writes, mq(m){ mqL.forEach((f) => f({ matches: m })); },
    load(){ vm.runInContext(SRC, ctx); },
    fire(ev){ (listeners[ev] || []).forEach((f) => f()); },
    ready(){ (docListeners.DOMContentLoaded || []).forEach((f) => f()); } };
}
const shown = (E) => E.appended.length === 1 && E.appended[0].style.display === 'block';
const hiddenOrNone = (E) => E.appended.length === 0 || E.appended[0].style.display === 'none';

console.log('su-net.js');
{
  const E = makeEnv(); E.load();
  t('つながっている時に開いた: 帯を作らない', E.appended.length === 0);
  E.fire('offline');
  t('つながらなくなった: 帯が1本出る', shown(E), E.appended.length);
  const b = E.appended[0];
  t('帯の文は固定の文（外からの文字を入れない）', b && b.textContent === '📡 ' + E.win.SUNet.MSG);
  t('帯の文に「保存しておきます」「自動で送ります」の約束を書かない', b && !/送ります|残します|保存しておき/.test(b.textContent));
  t('読み上げに知らせる（role=status・aria-live=polite）', b && b.attrs.role === 'status' && b.attrs['aria-live'] === 'polite');
  t('文字は15px・1行の札', b && /15px/.test(b.style.font) && b.style.whiteSpace === 'nowrap');
  t('札の上を押しても下のボタンに届く（pointer-events:none）', b && b.style.pointerEvents === 'none');
  t('重なり順は見出し（〜100）より上・窓（200〜）より下', b && Number(b.style.zIndex) > 100 && Number(b.style.zIndex) < 200);
  E.fire('online');
  t('つながった: 帯が消える', hiddenOrNone(E) && b.hidden === true);
  E.fire('offline');
  t('もう一度切れた: 同じ帯をまた出す（増やさない）', shown(E));
  E.fire('beforeprint');
  t('印刷の間は隠す', E.appended[0].style.display === 'none');
  E.fire('afterprint');
  t('印刷の後は戻す（まだつながっていない時）', E.appended[0].style.display === 'block');
  E.mq(true);
  t('印刷の見た目に切り替わった（出来事なし）: 隠す', E.appended[0].style.display === 'none');
  E.mq(false);
  t('印刷の見た目から戻った: また出す', E.appended[0].style.display === 'block');
  t('端末に何も書かない', E.writes.length === 0, E.writes);
  E.load();
  E.fire('offline');
  t('二重に読み込んでも帯は1本', E.appended.length === 1, E.appended.length);
}
{
  const E = makeEnv({ onLine: false }); E.load();
  t('開いた時につながっていない: すぐ帯が出る', shown(E));
}
{
  const E = makeEnv({ onLine: false, loading: true }); E.load();
  t('読み込み途中では作らない（DOMContentLoaded を待つ）', E.appended.length === 0);
  E.ready();
  t('DOMContentLoaded の後に帯が出る', shown(E));
}
{
  const E = makeEnv({ inFrame: true }); E.load();
  E.fire('offline');
  t('枠（iframe）の中では出さない（親の画面が出す）', E.appended.length === 0);
}
{
  const E = makeEnv();
  E.win.document.createElement = () => { throw new Error('架空の失敗'); };
  let threw = false;
  try { E.load(); E.fire('offline'); } catch (e) { threw = true; }
  t('帯を作れなくても例外を外に出さない', !threw);
}

console.log('入れる画面');
const WITH = ['overview-compare', 'index', 'daycare-roster', 'support-overview', 'visit-overview', 'staff-master', 'supplies', 'training-plan',
  'moushiokuri-viewer', 'care-meeting', 'ats', 'equip-log'];
const SELF = ['admission-flow', 'connection-settings', 'care-schedule', 'facesheet', 'genogram', 'shift-app', 'patch-calendar',
  'shift-analyzer', 'weight-record', 'resident-master', 'work-schedule'];
for (const p of WITH) {
  const s = fs.readFileSync(path.join(ROOT, p + '.html'), 'utf8');
  const i = s.indexOf('<script src="su-net.js?v='), j = s.indexOf('<script src="su-errors.js?v=');
  t(p + '.html: su-net.js を su-errors.js の後に読む', i > j && j >= 0);
}
for (const p of SELF) {
  const f = path.join(ROOT, p + '.html');
  if (!fs.existsSync(f)) continue;
  t(p + '.html: 自分で通信切れを扱うので su-net.js を読まない', fs.readFileSync(f, 'utf8').indexOf('su-net.js') < 0);
}
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const v = (idx.match(/<script src="su-net\.js\?v=([^"]+)"/) || [])[1];
  t('メニューの同時読み込みの指示も同じ版', !!v && idx.indexOf('<link rel="preload" as="script" href="su-net.js?v=' + v + '">') >= 0);
}
console.log('\n結果: 成功 ' + ok + ' / 失敗 ' + ng);
process.exit(ng ? 1 : 0);
