/* 紙の見出しの「施設名・印刷日」の試験（2026-11-13 代表者の決定「紙の見出しに施設名と印刷日を入れる」）。
   守ること:
     1. 共通の印刷部品（su-print.js）の headText / fillHeads が、施設情報（SUFacility）の施設名と印刷した日の日付を1行で出す
        （事業所の種類を付けた印はその事業所の名前・無ければ施設名）
     2. 施設情報が読めない時は施設名を出さない（印刷日だけ）。ボタンからの印刷の門（facGate）は、読めていればその場で刷り、
        読めなければ最大3秒待って「施設情報が読めません」を出して刷らない
     3. 二重に出さない: 印刷日・作成日・「〜 現在」が既にある紙は施設名だけ（印 name）、事業所名が表題に入っている利用登録表には足さない
     4. 画面では出さない（su-print.css の .su-print-head は印刷の時だけ出る）・施設名を画面のコードに直接書かない
     5. 当てる9画面が部品を読み、印刷のボタンが門を通る
   実行: node check/unit/print_head_stamp_test.js */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

/* 架空の施設情報（見本の語だけ） */
function fakeFacility(ready, names) {
  const waiters = [];
  const F = {
    _ready: ready,
    ready() { return this._ready; },
    onReady(fn) { waiters.push(fn); },
    nameOf(kind) { return (names || {})[kind] || ''; },
    settle(ok) { this._ready = ok; while (waiters.length) waiters.shift()(); }
  };
  return F;
}
/* 印の付いた要素（querySelectorAll が返す形だけ） */
function fakeNode(tag) {
  const kids = [];
  return {
    tag, className: '', _text: '', kids,
    get firstChild() { return kids[0] || null; },
    removeChild(c) { kids.splice(kids.indexOf(c), 1); },
    appendChild(c) { kids.push(c); return c; },
    get textContent() { return kids.length ? kids.map((c) => c.textContent).join('') : this._text; },
    set textContent(v) { kids.length = 0; this._text = String(v); }
  };
}
function fakeEl(parts, kind) {
  const el = fakeNode('div');
  el.getAttribute = (k) => (k === 'data-su-print-head' ? parts : (k === 'data-su-print-kind' ? (kind || null) : null));
  return el;
}
function load(F, els, timers) {
  const docListeners = {};
  const document = {
    readyState: 'complete', styleSheets: [],
    addEventListener(k, fn) { (docListeners[k] = docListeners[k] || []).push(fn); },
    querySelectorAll(sel) { return sel === '[data-su-print-head]' ? els : []; },
    querySelector() { return null; }, getElementById() { return null; }, body: { classList: { add() {}, remove() {} } },
    createElement: (tag) => fakeNode(tag)
  };
  const win = {
    SUFacility: F, document, location: { pathname: '/x.html' }, navigator: { userAgent: 'test' },
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {}, matchMedia: null, console,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}
  };
  win.window = win;
  const ctx = Object.assign({ Promise, Date, String, Math, JSON, Object, Array, RegExp, parseFloat }, win);
  ctx.global = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('su-print.js'), ctx, { filename: 'su-print.js' });
  return ctx.SUPrint || ctx.window.SUPrint;
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const d = new Date(), TODAY = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';

console.log('\n— 1. 文の作り方（施設名・印刷日） —');
{
  const F = fakeFacility(true, { '施設名': '見本ホーム', '通所': '見本デイ' });
  const P = load(F, [], []);
  t('施設名と印刷日を1行に（全角の空白で区切る）', P.headText('name date') === '見本ホーム　印刷日：' + TODAY, P.headText('name date'));
  t('施設名だけ（その紙に印刷日が既にある時）', P.headText('name') === '見本ホーム');
  t('印刷日だけ', P.headText('date') === '印刷日：' + TODAY);
  t('事業所の種類を付けるとその事業所の名前', P.headText('name', '通所') === '見本デイ');
  const F2 = fakeFacility(true, { '施設名': '見本ホーム' });
  t('事業所の名前が空なら施設名に戻る', load(F2, [], []).headText('name', '通所') === '見本ホーム');
  const els = [fakeEl('name date'), fakeEl('name', '通所'), fakeEl('date')];
  const P3 = load(F, els, []);
  P3.fillHeads();
  t('印の付いた要素を埋める（読み込んだ時にも埋まる）', els[0].textContent === '見本ホーム　印刷日：' + TODAY && els[1].textContent === '見本デイ' && els[2].textContent === '印刷日：' + TODAY, els.map((e) => e.textContent));
  t('施設名と印刷日は別の span（長い施設名を … で切っても印刷日は残る）', els[0].kids.length === 2 && els[0].kids[0].className === 'su-print-head-n' && els[0].kids[0].textContent === '見本ホーム' && els[0].kids[1].className === 'su-print-head-d' && els[0].kids[1].textContent === '　印刷日：' + TODAY, els[0].kids.map((k) => [k.className, k.textContent]));
  const css0 = read('su-print.css');
  t('…CSS は施設名だけを切り、印刷日は縮めない', /\.su-print-head > \.su-print-head-n \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/.test(css0) && /\.su-print-head > \.su-print-head-d \{ flex: 0 0 auto; \}/.test(css0));
  P3.fillHeads();
  t('2回埋めても重ならない（同じ中身なら作り直さない）', els[0].kids.length === 2 && els[0].textContent === '見本ホーム　印刷日：' + TODAY);
  const F4 = fakeFacility(true, { '施設名': '見本\n  ホーム' });
  t('施設名の改行・続く空白は1つの空白にする（1行のまま）', load(F4, [], []).headText('name') === '見本 ホーム');
}

console.log('\n— 2. 施設情報が読めない時 —');
{
  const F = fakeFacility(false, { '施設名': '見本ホーム' });
  const els = [fakeEl('name date'), fakeEl('name')];
  const P = load(F, els, []);
  P.fillHeads();
  t('読めていない間は施設名を出さず印刷日だけ（Cmd/Ctrl+P は止められないため）', els[0].textContent === '印刷日：' + TODAY && els[1].textContent === '', els.map((e) => e.textContent));
  const P0 = load(undefined, [], []);
  t('施設情報の部品が無い画面でも例外を出さず、施設名は空', P0.headText('name date') === '印刷日：' + TODAY);
}

(async () => {
  console.log('\n— 3. ボタンからの印刷の門（facGate） —');
  {
    const F = fakeFacility(true, { '施設名': '見本ホーム' });
    const P = load(F, [], []);
    let went = 0, ng = [];
    const r = P.facGate(() => { went++; }, (m) => ng.push(m));
    t('読めていれば待たずにその場で刷る（同じ順のまま）', went === 1 && ng.length === 0);
    t('…その時は true を返す', (await r) === true);
  }
  {
    const F = fakeFacility(false, { '施設名': '見本ホーム' });
    const timers = [];
    const P = load(F, [], timers);
    let went = 0, ng = [];
    const r = P.facGate(() => { went++; }, (m) => ng.push(m));
    t('読めていない時はその場では刷らない', went === 0);
    const tm = timers.find((x) => x.ms === 3000);
    t('待つのは3秒', !!tm && P.FAC_WAIT_MS === 3000, timers.map((x) => x.ms));
    tm.fn();
    const ok = await r;
    t('3秒たっても読めなければ刷らず「施設情報が読めません」を出す', ok === false && went === 0 && ng.length === 1 && /^⚠️ 施設情報が読めません。印刷を中止しました。/.test(ng[0]), ng);
  }
  {
    const F = fakeFacility(false, { '施設名': '見本ホーム' });
    const P = load(F, [], []);
    let went = 0, ng = [];
    const r = P.facGate(() => { went++; }, (m) => ng.push(m));
    F.settle(true);
    t('待っている間に読めれば刷る', (await r) === true && went === 1 && ng.length === 0);
  }
  {
    const P = load(undefined, [], []);
    let went = 0, ng = [];
    const ok = await P.facGate(() => { went++; }, (m) => ng.push(m));
    t('施設情報の部品が無ければ刷らずに知らせる', ok === false && went === 0 && ng.length === 1);
  }

  console.log('\n— 3b. 待つ間の二重押し（facility_print_gate_test の F 節と同じ形）—');
  {
    const F = fakeFacility(false, { '施設名': '見本ホーム' });
    const timers = [];
    const P = load(F, [], timers);
    let went = 0; const ng = [];
    const go = () => { went++; }, no = (m) => ng.push(m);
    P.facGate(go, no); P.facGate(go, no); P.facGate(go, no);
    t('待っている間に3回押しても、待ちは1本だけ', timers.filter((x) => x.ms === 3000).length === 1, timers.map((x) => x.ms));
    F.settle(true); await settle();
    t('待ちが終わると1回だけ刷る', went === 1 && ng.length === 0, { went, ng });
    F._ready = false;
    P.facGate(go, no); P.facGate(go, no);
    t('刷った後は止めを外す（次の押下でまた待ちを始める・待ち中の2回目は無視）', timers.filter((x) => x.ms === 3000).length === 2);
    timers.filter((x) => x.ms === 3000)[1].fn(); await settle();
    t('読めなかった時は知らせは1回だけで刷らない', went === 1 && ng.length === 1, { went, ng });
    P.facGate(go, no);
    t('断った後も止めを外す（その次は押せる）', timers.filter((x) => x.ms === 3000).length === 3);
    F.settle(true); await settle();
    t('止めを外した後の押下は、もう一度刷る', went === 2);
  }

  console.log('\n— 4. 画面では出さない・CSS の型 —');
  {
    const css = read('su-print.css');
    const top = css.split('@media print')[0];
    t('画面では .su-print-head を出さない（@media の外で display:none）', /\.su-print-head \{ display: none; \}/.test(top));
    t('紙では1行（折り返さない・あふれは … で切る）', /@media print \{\s*\.su-print-head \{ display: flex;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/.test(css));
    t('位置を外す型は見出しの箱の右上へ重ねる（本文を押し下げない）', /\.su-print-head\.su-print-head-abs \{ position: absolute;/.test(css) && /\.su-print-head-host \{ position: relative; \}/.test(css));
    const js = read('su-print.js');
    t('印刷の準備（before の後）と beforeprint で埋め直す', /spec\.before\(state\);[^\n]*\n\s*fillHeads\(document\);/.test(js) && /'beforeprint', function \(\) \{\s*fillHeads\(document\);/.test(js));
  }

  console.log('\n— 5. 当てる紙ごとの印と二重に出さないこと —');
  const PAGES = {
    'care-schedule.html': { parts: ['name'], why: 'A3 週間予定表は「印刷日：」が既にある' },
    'weight-record.html': { parts: ['name'], why: '測定用紙は「作成日：」が既にある' },
    'moushiokuri-viewer.html': { parts: ['name date'], why: '' },
    'patch-calendar.html': { parts: ['name date'], why: '' },
    'care-meeting.html': { parts: ['name date'], why: '' },
    'ats.html': { parts: ['name'], why: '面接予定は「〜 現在」が既にある' },
    'daycare-roster.html': { parts: ['name'], why: '凡例の右端に印刷日が既にある' },
    'support-overview.html': { parts: ['name date'], why: '' },
    'shift-analyzer.html': { parts: ['name date'], why: '' },
    'visit-overview.html': { parts: ['name date'], why: '' }
  };
  for (const [f, exp] of Object.entries(PAGES)) {
    const src = read(f);
    const got = [...new Set([...src.matchAll(/data-su-print-head(?:"|', ')?[=,]\s*['"]?([a-z ]+)['"]/g)].map((m) => m[1]))];
    const gotAttr = [...new Set([...src.matchAll(/data-su-print-head="([a-z ]+)"/g)].map((m) => m[1]).concat([...src.matchAll(/setAttribute\('data-su-print-head', '([a-z ]+)'\)/g)].map((m) => m[1])))];
    t(f + ': 印は ' + exp.parts.join('・') + (exp.why ? '（' + exp.why + '）' : ''), JSON.stringify(gotAttr) === JSON.stringify(exp.parts), { gotAttr, got });
    t(f + ': su-print.js と su-print.css を読む', /<script src="su-print\.js\?v=2026-11-13"><\/script>/.test(src) && /<link rel="stylesheet" href="su-print\.css\?v=2026-11-13">/.test(src));
    t(f + ': 施設情報の部品を読む', /<script src="su-facility\.js\?v=[^"]+"><\/script>/.test(src));
  }
  {
    const dc = read('daycare-roster.html');
    const rosterSec = dc.slice(dc.indexOf('<section id="sc-roster"'), dc.indexOf('</section>', dc.indexOf('<section id="sc-roster"')));
    t('デイ利用表: 利用登録表は表題に事業所名が入っているので印を足さない', /dcrSheetTitle/.test(rosterSec) && !/data-su-print-head/.test(rosterSec));
    t('デイ利用表: 一覧表・全員リスト・薬用の表題に事業所（通所）の印', (dc.match(/class="sheet-title su-print-head-host"[^>]*>(?:<span id="\w+">[^<]*<\/span>|[^<]*)<span class="su-print-head su-print-head-abs dc-fac" data-su-print-head="name" data-su-print-kind="通所"><\/span><\/div>/g) || []).length === 3);
    t('デイ利用表: 週間名簿の各ページの先頭の行は事業所名と印刷日を1行に', /pg\.appendChild\(el\('div', 'pg-date', pgDateText_\(\)\)\)/.test(dc) && /SUPrint\.headText\('name', '通所'\)/.test(dc));
    const cs = read('care-schedule.html');
    t('週間計画: 印刷日の箱（印刷日：）は今のまま残し、施設名だけを見出しの段の右上に重ねる', /'<div class="wk-printed">印刷日：' \+ escHtml\(printed\) \+ '<\/div>'\s*\+\s*'<div class="su-print-head su-print-head-abs wk-fac" data-su-print-head="name"><\/div>'/.test(cs) && /'<div class="wk-head-row su-print-head-host">'/.test(cs));
    const wr = read('weight-record.html');
    t('体重管理: 作成日と同じ行の左に施設名（行を増やさない）', /<div><span class="su-print-head ps-fac" data-su-print-head="name"><\/span>作成日：\$\{todayStr\}<\/div>/.test(wr));
    t('体重管理: 施設名が空の時は箱も余白も出さない（作成日の位置は今のまま）', /#printOverlay \.ps-meta \.ps-fac:empty\{display:none\}/.test(wr));
  }

  console.log('\n— 6. 印刷のボタンは施設情報の門を通る —');
  {
    const gate = {
      'care-schedule.html': /data-on-click="printWeeklySheetGated_"[\s\S]*function printWeeklySheetGated_\(\) \{\s*if \(window\.SUPrint && SUPrint\.facGate\) SUPrint\.facGate\(\(\) => printWeeklySheet\(\), \(msg\) => showToast\(msg\)\);/,
      'weight-record.html': /SUPrint\.facGate\(\(\)=>\{ window\.print\(\); \}, \(msg\)=>SUDialog\.alert\(msg\)\)/,
      'patch-calendar.html': /suFacReady_\(\)\.then\(function \(ok\) \{\s*pcPrintWaiting = false;\s*if \(!ok\) \{ window\.alert\(PC_FAC_NG_MSG\); return; \}/,
      'shift-analyzer.html': /function printResults\(\) \{[\s\S]*?if \(window\.SUPrint && typeof window\.SUPrint\.facGate === 'function'\) window\.SUPrint\.facGate\(function \(\) \{ printResultsNow_\(\); \}, function \(msg\) \{ saAlert_\(msg\); \}\);/,
      'support-overview.html': /function printNow\(\) \{\s*if \(window\.SUPrint && SUPrint\.facGate\) SUPrint\.facGate\(function \(\) \{ window\.print\(\); \}/,
      'visit-overview.html': /function printNow\(\) \{\s*if \(window\.SUPrint && SUPrint\.facGate\) SUPrint\.facGate\(function \(\) \{ window\.print\(\); \}/,
      'moushiokuri-viewer.html': /if\(SUPrint\.facGate\) SUPrint\.facGate\(function\(\)\{ SUPrint\.print\(view\); \}/,
      'care-meeting.html': /return SUPrint\.facGate\(function\(\)\{ if\(ed&&cur\) SUPrint\.print\('meeting'\); \}/,
      'ats.html': /return suFacReady_\(\)\.then\(function\(ok\)\{\s*if\(!ok\)\{ toast\(SU_FAC_NG_MSG\); return false; \}/,
      'daycare-roster.html': /suFacReady_\(\)\.then\(ok => \{\s*if \(!ok\) \{ toast\(SU_FAC_NG_MSG, true\); return; \}/
    };
    for (const [f, re] of Object.entries(gate)) t(f + ': 印刷のボタンは施設情報を待ち、読めなければ刷らない', re.test(read(f)));
  }

  console.log('\n— 7. 施設名をコードに書かない —');
  {
    const sample = JSON.parse(read('facility-profile.sample.json'));
    const names = [sample.facilityName].concat((sample.offices || []).map((o) => o.name)).filter(Boolean);
    const hits = [];
    for (const f of ['su-print.js', 'su-print.css'].concat(Object.keys(PAGES))) for (const n of names) if (read(f).indexOf(n) >= 0) hits.push(f);
    t('部品と9画面に見本の施設名・事業所名が書かれていない（施設情報から読む）', hits.length === 0, hits);
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
