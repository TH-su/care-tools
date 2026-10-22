/* 訪問／全支援 左右比較（overview-compare.html）の、2画面の取り込みと連動の試験（2026-10-22 新設・改善プロンプト第4弾の7）
   実行: node check/unit/overview_compare_test.js
   （画面を差し替えて試す時: OC_HTML=差し替えた画面のパス node check/unit/overview_compare_test.js）
   ★画面の本物の連動の処理（<script> の中身）を、偽物の左右の枠（iframe）で動かす。偽物にするのは枠の中の画面
     （window.OVLINK・盤面の位置と大きさ）とタイマーだけ。氏名は扱わない。
   守ること:
     1. 取り込み: 左は訪問 週間俯瞰（visit-overview.html）・右は全支援 週間俯瞰（support-overview.html）を同じ場所から枠で開く。
        2画面とも、連動が使う入口（OVLINK の centerTime・scrollToTime・centerDay・scrollToDay・setZoom・getZoom）と、
        盤面の部品（boardWrap・board・bCanvas・印刷ボタン btnPrint）を持っている。枠を開ける決まり（frame-src 'self'）と、
        氏名を残さない決まり（Cache-Control no-store）がある
     2. 比べ方（縦横の位置）: 連動中は、片方を動かすと、もう片方を同じ時刻・同じ曜日へ合わせる。
        自分で合わせた分の知らせ（反響）は無視して押し戻さない（1px のずれまでは反響とみなす）。
        相手が動かなかった時でも、まだ届いていない反響の控えは消さない（後から届いた反響を人の操作と取り違えない）
     3. 連動を切っている間は、もう片方を動かさない（位置も倍率も）。凡例の文言は入/切で言い換える
     4. 比べ方（倍率）: 片方の倍率を変えると、もう片方を同じ倍率にする。合わせた側からの知らせで元の側を動かし直さない
     5. 起動時の倍率そろえ: 両方の盤面が描き終わるまで待ち、狭い方に合わせた同じ倍率（下限 0.5・収まるなら 1）にそろえる。そろえるのは1回だけ。
        盤面が出てこなくても、待つのは約30秒（150回）で止まる
     6. 枠の中の画面を読み込み直したら、配線と倍率そろえをやり直す（同じ見張りを二重に付けない）。
        比較の中では各画面の印刷ボタン・切替スイッチ・比較へのリンクを隠す
     7. 状態の保存（2026-10-22 代表者の決定 B）: 連動の入／切だけを端末の ocmp_sync に '1'／'0' で残し、読み込み直したら戻す。決まった値以外は既定（入）。ほかのキー・共有データ・通信には触れない。保存領域が使えなくても動く。
        再読み込みすると連動は「入」で始まる（チェックボックスの既定が checked） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = fs.readFileSync(process.env.OC_HTML || path.join(ROOT, 'overview-compare.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

/* 連動の処理（fVisit を探す <script>）を取り出す */
const at = HTML.indexOf("document.getElementById('fVisit')");
const SRC = HTML.slice(HTML.lastIndexOf('<script>', at) + '<script>'.length, HTML.indexOf('</script>', at));

/* ── 偽物の枠（iframe）。縦は 1分=10px・横は 1曜日=100px で、合わせられる範囲は 0〜max に収める ── */
function makePane(opt) {
  opt = opt || {};
  const st = { zoom: 1, natural: opt.natural || 700, maxTop: 5000, maxLeft: 600, scrollToTime: 0, scrollToDay: 0, setZoom: 0, rendered: !!opt.rendered };
  const listeners = { scroll: [] };
  const wrap = {
    scrollTop: 0, scrollLeft: 0, clientWidth: opt.clientWidth || 800,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  };
  const kit = {
    centerTime: () => wrap.scrollTop / 10,
    centerDay: () => wrap.scrollLeft / 100,
    scrollToTime(tm) { st.scrollToTime++; wrap.scrollTop = Math.max(0, Math.min(st.maxTop, Math.round(tm * 10))); },
    scrollToDay(d) { st.scrollToDay++; wrap.scrollLeft = Math.max(0, Math.min(st.maxLeft, Math.round(d * 100))); },
    getZoom: () => st.zoom,
    setZoom(z) { st.setZoom++; st.zoom = z; if (typeof kit.onZoom === 'function') kit.onZoom(z); }   // 本物も setZoom の中で onZoom を呼ぶ
  };
  const hidden = [];
  const mkHide = id => ({ id, style: { set display(v) { hidden.push(id + '=' + v); } } });
  const doc = {
    getElementById(id) {
      if (id === 'boardWrap') return wrap;
      if (id === 'board') return { getBoundingClientRect: () => ({ width: st.natural * st.zoom }), scrollWidth: st.natural };
      if (id === 'bCanvas') return { children: { length: st.rendered ? 3 : 0 } };
      if (id === 'btnPrint') return mkHide('btnPrint');
      return null;
    },
    querySelectorAll(sel) { return sel === '.ovsw, .ovcmp' ? [mkHide('ovsw'), mkHide('ovcmp')] : []; }
  };
  /* 本物と同じく、枠の中の画面が読み込まれるまでは OVLINK も盤面も無い（about:blank）。load で中身が入る */
  const blank = { getElementById: () => null, querySelectorAll: () => [] };
  let loaded = false;
  const ifr = { _load: [], addEventListener(ev, fn) { if (ev === 'load') this._load.push(fn); },
    get contentWindow() { return loaded ? { OVLINK: kit } : {}; },
    get contentDocument() { return loaded ? doc : blank; } };
  /* 人がスクロールした（位置を変えてから scroll の知らせ） */
  const userScroll = (top, left) => { wrap.scrollTop = top; if (left != null) wrap.scrollLeft = left; fire(); };
  const fire = () => listeners.scroll.slice().forEach(fn => fn());
  const load = () => { loaded = true; ifr._load.forEach(fn => fn()); };
  return { ifr, wrap, kit, st, listeners, hidden, userScroll, fire, load };
}

function boot(opt) {
  opt = opt || {};
  const A = makePane(opt.A), B = makePane(opt.B);
  const timers = [];
  const storage = [];
  const syncOn = { checked: true, _ch: [], addEventListener(ev, fn) { if (ev === 'change') this._ch.push(fn); } };
  const legend = { textContent: '' };
  const spyStore = new Proxy({}, { get(_, k) { storage.push(String(k)); return () => null; } });
  const box = {
    document: { getElementById: id => ({ fVisit: A.ifr, fSupport: B.ifr, syncOn, cmpLegend: legend }[id] || null) },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout(id) { if (id) timers[id - 1] = null; },
    localStorage: spyStore, sessionStorage: spyStore,
    fetch: () => { storage.push('fetch'); return Promise.reject(new Error('no')); },
    Math, JSON
  };
  vm.createContext(box);
  let err = null;
  try { vm.runInContext(SRC, box); } catch (e) { err = e.message; }
  /* タイマーを1本ずつ回す（本物は 200ms ごと）。回した数を返す */
  const runTimers = (limit) => {
    let n = 0;
    for (let i = 0; i < timers.length && n < (limit || 1000); i++) { const fn = timers[i]; if (fn) { timers[i] = null; n++; fn(); } }
    return n;
  };
  const toggle = on => { syncOn.checked = on; syncOn._ch.forEach(fn => fn()); };
  return { A, B, timers, runTimers, storage, syncOn, legend, toggle, err };
}
/* 両方が描き終わって起動し、そろえ終わった状態にする */
function ready(opt) {
  const r = boot(Object.assign({ A: { rendered: true }, B: { rendered: true } }, opt || {}));
  r.A.load(); r.B.load();
  r.runTimers();
  r.A.st.setZoom = r.B.st.setZoom = 0;
  r.A.st.scrollToTime = r.B.st.scrollToTime = r.A.st.scrollToDay = r.B.st.scrollToDay = 0;
  return r;
}

console.log('\n— 1. 2画面の取り込み —');
{
  const ifr = [...HTML.matchAll(/<iframe id="(\w+)"[^>]*src="([^"]+)"/g)].map(m => m[1] + '=' + m[2]);
  t('枠は2つで、左＝訪問 週間俯瞰・右＝全支援 週間俯瞰（同じ場所の相対パス）', ifr.join() === 'fVisit=visit-overview.html,fSupport=support-overview.html', ifr);
  t('枠を開ける決まり（frame-src \'self\'）が CSP にある', /Content-Security-Policy[^>]*frame-src 'self'/.test(HTML), '');
  t('氏名を残さない決まり（Cache-Control no-store）がある', /<meta http-equiv="Cache-Control" content="no-store">/.test(HTML), '');
  for (const f of ['visit-overview.html', 'support-overview.html']) {
    const s = read(f);
    const m = s.match(/window\.OVLINK = \{([\s\S]*?)\};/);
    const keys = m ? [...m[1].matchAll(/(\w+):/g)].map(x => x[1]) : [];
    const need = ['centerTime', 'scrollToTime', 'centerDay', 'scrollToDay', 'setZoom', 'getZoom'];
    t(f + ' は連動の入口（' + need.join('・') + '）を出している', need.every(k => keys.indexOf(k) >= 0), keys);
    t(f + ' は倍率を変えた時に OVLINK.onZoom を呼ぶ', /window\.OVLINK\.onZoom\(z\)/.test(s), '');
    t(f + ' は盤面の部品（boardWrap・board・bCanvas・btnPrint）と切替スイッチ・比較リンクを持つ',
      ['boardWrap', 'board', 'bCanvas', 'btnPrint'].every(id => s.indexOf('id="' + id + '"') >= 0) && /class="[^"]*\bovsw\b/.test(s) && /class="[^"]*\bovcmp\b/.test(s), '');
  }
  const r = boot();
  t('連動の処理が例外なく動く', !r.err, r.err);
}

console.log('\n— 2. 縦横の位置を合わせる —');
{
  const r = ready();
  t('両方の枠にスクロールの見張りが1つずつ付いた', r.A.listeners.scroll.length === 1 && r.B.listeners.scroll.length === 1, [r.A.listeners.scroll.length, r.B.listeners.scroll.length]);
  r.A.userScroll(3000, 200);   // 左＝300分・2曜日目
  t('左を動かすと、右を同じ時刻・同じ曜日へ合わせる', r.B.wrap.scrollTop === 3000 && r.B.wrap.scrollLeft === 200, [r.B.wrap.scrollTop, r.B.wrap.scrollLeft]);
  r.B.fire();                  // 右の反響が届く
  t('右からの反響では左を動かし直さない', r.A.st.scrollToTime === 0, r.A.st);
  r.B.userScroll(1200, 0);
  t('反響の後に人が右を動かせば、左を合わせる', r.A.wrap.scrollTop === 1200 && r.A.wrap.scrollLeft === 0, [r.A.wrap.scrollTop, r.A.wrap.scrollLeft]);
}
{
  const r = ready();
  r.A.userScroll(3000, 200);
  r.B.wrap.scrollTop = 3001;   // 小数の丸めで 1px ずれて届いた反響
  r.B.fire();
  t('1px のずれまでは反響とみなす（左を押し戻さない）', r.A.st.scrollToTime === 0, r.A.st);
}
{
  const r = ready();
  r.A.userScroll(3000, 200);
  r.B.wrap.scrollTop = 3050;   // 反響の控えから 5px 離れた＝人の操作
  r.B.fire();
  t('2px 以上離れていれば人の操作として左を合わせる', r.A.st.scrollToTime === 1 && r.A.wrap.scrollTop === 3050, r.A.st);
}
{
  const r = ready();
  r.A.userScroll(3000, 200);   // 右へ 3000 を合わせた＝反響の控えあり（まだ届いていない）
  r.A.userScroll(3000, 200);   // 同じ位置でもう一度＝右は動かない
  r.B.fire();                  // 1回目の反響が今届いた
  t('相手が動かなかった時も、届いていない反響の控えは消さない（後から届いた反響で左を押し戻さない）', r.A.st.scrollToTime === 0, r.A.st);
}
{
  const r = ready();
  r.B.st.maxTop = 2000;        // 右は盤面が短く、端で止まる
  r.A.userScroll(3000, 0);
  t('相手が端で止まった時は、止まった位置を反響の控えにする', r.B.wrap.scrollTop === 2000, r.B.wrap.scrollTop);
  r.B.fire();
  t('端で止まった位置からの反響でも左を動かし直さない', r.A.st.scrollToTime === 0, r.A.st);
}

console.log('\n— 3. 連動を切っている間 —');
{
  const r = ready();
  t('既定は連動「入」・凡例は「連動中」', r.syncOn.checked === true && /^連動中：/.test(r.legend.textContent), r.legend.textContent);
  r.toggle(false);
  t('切ると凡例は「連動を切っています」に言い換える', /^連動を切っています：/.test(r.legend.textContent), r.legend.textContent);
  r.A.userScroll(3000, 200);
  t('切っている間は右を動かさない', r.B.st.scrollToTime === 0 && r.B.wrap.scrollTop === 0, r.B.st);
  r.A.kit.setZoom(1.5);
  t('切っている間は右の倍率も変えない', r.B.st.setZoom === 0 && r.B.st.zoom !== 1.5, r.B.st);
  r.toggle(true);
  r.A.userScroll(1000, 100);
  t('入れ直すと、次に動かした時からまたそろう', r.B.wrap.scrollTop === 1000 && r.B.wrap.scrollLeft === 100, [r.B.wrap.scrollTop, r.B.wrap.scrollLeft]);
}

console.log('\n— 4. 倍率を合わせる —');
{
  const r = ready();
  r.A.userScroll(3000, 200);
  r.B.fire();
  r.A.st.scrollToTime = r.B.st.scrollToTime = r.A.st.scrollToDay = r.B.st.scrollToDay = 0;
  r.A.kit.setZoom(1.5);        // 人が左を拡大
  t('左の倍率を変えると右も同じ倍率にする', r.B.st.zoom === 1.5 && r.B.st.setZoom === 1, r.B.st);
  t('右へ合わせた知らせで左の倍率を動かし直さない（左の setZoom は人の1回だけ）', r.A.st.setZoom === 1 && r.A.st.zoom === 1.5, r.A.st);
  t('倍率を合わせた後に、右の時刻・曜日も合わせ直す', r.B.st.scrollToTime === 1 && r.B.st.scrollToDay === 1, r.B.st);
  r.B.kit.setZoom(1.5);        // 同じ倍率の知らせ
  t('同じ倍率なら左の setZoom を呼ばない', r.A.st.setZoom === 1, r.A.st);
}

console.log('\n— 5. 起動時の倍率そろえ —');
{
  const r = boot({ A: { rendered: false, natural: 1000, clientWidth: 500 }, B: { rendered: true, natural: 800, clientWidth: 500 } });
  r.A.load(); r.B.load();
  r.runTimers(3);
  t('片方の盤面が描き終わるまでは、倍率をそろえない', r.A.st.setZoom === 0 && r.B.st.setZoom === 0, [r.A.st.setZoom, r.B.st.setZoom]);
  r.A.st.rendered = true;
  r.runTimers(1);
  t('両方が描き終わったら、狭い方（左 500/1000=0.5・右 500/800=0.625 の小さい方）に合わせて両方 0.5', r.A.st.zoom === 0.5 && r.B.st.zoom === 0.5, [r.A.st.zoom, r.B.st.zoom]);
  const n = r.A.st.setZoom + r.B.st.setZoom;
  t('そろえる時は両方1回ずつだけ（相互の知らせで増えない）', n === 2, [r.A.st.setZoom, r.B.st.setZoom]);
  r.runTimers();
  t('そろえ終わったら、それ以上は倍率に触らない', r.A.st.setZoom + r.B.st.setZoom === 2 && r.timers.filter(Boolean).length === 0, [r.A.st.setZoom, r.B.st.setZoom]);
}
{
  const r = boot({ A: { rendered: true, natural: 4000, clientWidth: 500 }, B: { rendered: true, natural: 400, clientWidth: 500 } });
  r.A.load(); r.B.load(); r.runTimers();
  t('縮める下限は 0.5（500/4000=0.125 にしない）', r.A.st.zoom === 0.5 && r.B.st.zoom === 0.5, [r.A.st.zoom, r.B.st.zoom]);
}
{
  const r = boot({ A: { rendered: true, natural: 503, clientWidth: 500 }, B: { rendered: true, natural: 400, clientWidth: 500 } });
  r.A.load(); r.B.load(); r.runTimers();
  t('はみ出しが 4px 以内なら縮めない（倍率 1）', r.A.st.zoom === 1 && r.B.st.zoom === 1, [r.A.st.zoom, r.B.st.zoom]);
}
{
  const r = boot({ A: { rendered: true }, B: { rendered: false } });
  r.A.load(); r.B.load();
  let n = 0, k;
  while ((k = r.runTimers(1))) { n += k; if (n > 1000) break; }
  t('盤面が出てこなくても、待つのは約30秒（150回程度）で止まる', n >= 140 && n <= 160 && r.B.st.setZoom === 0, n);
}

console.log('\n— 6. 枠の中を読み込み直した時 —');
{
  const r = ready();
  t('比較の中では印刷ボタン・切替スイッチ・比較へのリンクを隠す', ['btnPrint=none', 'ovsw=none', 'ovcmp=none'].every(x => r.A.hidden.indexOf(x) >= 0 && r.B.hidden.indexOf(x) >= 0), [r.A.hidden, r.B.hidden]);
  r.runTimers();
  t('ポーリングを何度回しても、見張りは二重に付かない', r.A.listeners.scroll.length === 1 && r.B.listeners.scroll.length === 1, [r.A.listeners.scroll.length, r.B.listeners.scroll.length]);
  /* 右の画面を読み込み直した＝新しい盤面・倍率 1 に戻る */
  const old = r.B.listeners.scroll.length;
  r.B.listeners.scroll = []; r.B.st.zoom = 1; r.B.st.setZoom = 0; r.A.st.setZoom = 0;   // 新しい盤面（前の見張りは古い盤面ごと消える）
  r.A.kit.setZoom(0.8); r.A.st.setZoom = 0;   // 左は 0.8 のまま（右は今は倍率 1）
  r.B.load();
  r.runTimers();
  t('読み込み直した側に見張りを付け直す', old === 1 && r.B.listeners.scroll.length === 1, r.B.listeners.scroll.length);
  t('読み込み直した側の倍率を、もう一度そろえ直す', r.A.st.zoom === r.B.st.zoom && r.B.st.setZoom >= 1, [r.A.st.zoom, r.B.st.zoom]);
  r.A.userScroll(2500, 300);
  t('読み込み直した後も位置の連動が効く', r.B.wrap.scrollTop === 2500 && r.B.wrap.scrollLeft === 300, [r.B.wrap.scrollTop, r.B.wrap.scrollLeft]);
}
{
  /* 別の場所の画面に変わった（中を読めない＝例外）時も止まらない */
  const r = boot();
  Object.defineProperty(r.A.ifr, 'contentDocument', { get() { throw new Error('SecurityError'); } });
  Object.defineProperty(r.A.ifr, 'contentWindow', { get() { throw new Error('SecurityError'); } });
  let err = null;
  try { r.A.load(); r.B.load(); r.runTimers(5); } catch (e) { err = e.message; }
  t('枠の中を読めない（別の場所）時も例外を外に出さない', err === null, err);
}

console.log('\n— 7. 連動の入／切だけを覚える —');
{
  const r = ready();
  r.A.userScroll(3000, 200); r.A.kit.setZoom(1.2);
  t('連動の操作のほかは、端末の保存領域・通信に触れない（読み込み時の ocmp_sync の読み取りだけ）', r.storage.every(k => k === 'getItem'), r.storage);
  const SC = SRC;
  t('残すキーは ocmp_sync だけ・値は 1／0 だけ', /var SYNC_KEY = 'ocmp_sync';/.test(SC) && /setItem\(SYNC_KEY, syncOn\.checked \? '1' : '0'\)/.test(SC) && (SC.match(/setItem\(/g) || []).length === 1, '');
  t('読み込み直しで戻すのは保存値が 0 の時だけ（ほかの値・壊れた値は既定の入）', /if \(localStorage\.getItem\(SYNC_KEY\) === '0'\) syncOn\.checked = false;/.test(SC), '');
  t('保存領域の読み書きは try で包む（使えない端末でも止まらない）', /try \{ if \(localStorage\.getItem\(SYNC_KEY\)/.test(SC) && /try \{ localStorage\.setItem\(SYNC_KEY/.test(SC), '');
  t('fetch・XMLHttpRequest・SUKv・gasCall・sessionStorage は使わない', !/sessionStorage\.|fetch\(|XMLHttpRequest|SUKv\.|gasCall\(/.test(SRC), '');
  t('連動のチェックボックスの既定は「入」（checked）', /<input type="checkbox" id="syncOn" checked/.test(HTML), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
