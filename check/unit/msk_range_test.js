/* 申送ビューア 共有期間（moushiokuri-viewer.html）のテスト（2026-09-07 新設）
   実行: node check/unit/msk_range_test.js
   対象を差し替える: MSK_HTML=/tmp/変異版.html node check/unit/msk_range_test.js（変異試験用）

   背景（この機能で壊れうること）:
     ①期間がタブごとに別々に戻る（検索タブで6月を探したつもりが、入居者別が読んだ8月を探す）
     ②期間を変えてから読み直すまでの間、古い期間のデータが新しい期間の結果として描かれる
     ③サーバーが返す from/to と比べてしまい、丸められた時に読み直しが止まらなくなる
     ④旧キー（msk_days / msk_vmDays）からの引き継ぎが効かず、全員の期間が既定へ飛ぶ
     ⑤期間を変えたのに、開いていない他のタブがそれを読み直さない（通信を惜しんで古い結果を出す）
     ⑥期間に個人情報が紛れて localStorage へ入る

   方針:
     既存の試験（check/unit・gas/tests）と同じ vm 方式。ただし対象が DOM を触る関数なので、
     最小限の偽 DOM を用意して【実関数をそのまま動かす】。正規表現の一致だけでは
     中身を保証できないため（2026-09-07 の知見）。
   ★このファイルは公開リポジトリの check/unit にある（2026-10-08 に gas/tests から移した）。氏名は全て架空にすること。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.MSK_HTML || path.join(ROOT, 'moushiokuri-viewer.html'), 'utf8');

/* ── 切り出し（文字列とコメントの中のかっこを数えないスキャナ）── */
function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(SRC, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return SRC.slice(start, end + 1);
}
function grabDecl(name) {
  const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=\\s*', 'm').exec(SRC);
  if (!m) throw new Error('宣言が見つかりません: ' + name);
  const vpos = m.index + m[0].length;
  const open = SRC[vpos];
  if (open === '{' || open === '[') {
    const end = scanBlock(SRC, vpos, open, open === '{' ? '}' : ']');
    if (end < 0) throw new Error('宣言の終わりが見つかりません: ' + name);
    let j = end + 1;
    while (j < SRC.length && SRC[j] !== ';') j++;
    return SRC.slice(m.index, j + 1);
  }
  const eol = SRC.indexOf('\n', vpos);
  return SRC.slice(m.index, eol < 0 ? SRC.length : eol);
}

/* ── 判定（★真偽を受け取る t() は作らない。実測値をそのまま渡すと truthy なだけで通るため）── */
let ok = 0, ng = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function has(label, hay, needle) { eq(label, String(hay).indexOf(needle) >= 0, true); }
function hasNot(label, hay, needle) { eq(label, String(hay).indexOf(needle) >= 0, false); }
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }

/* ══════════════════════════════════════════════════════════
   偽 DOM（実関数をそのまま動かすための最小の器）
   ══════════════════════════════════════════════════════════ */
function makeDom() {
  const els = Object.create(null);
  function node(tag) {
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      children: [], _text: '', className: '', id: '', hidden: false,
      disabled: false, value: '', checked: false, selectedIndex: 0,
      dataset: {}, style: {}, attrs: {}, _opts: null, _listeners: {},
      get textContent() {
        return this._text + this.children.map(c => c.textContent).join('');
      },
      set textContent(v) { this.children = []; this._text = String(v == null ? '' : v); },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      focus() {},
      getBoundingClientRect() { return { top: 0 }; },
      classList: {
        _set: {},
        add(c) { this._set[c] = true; },
        remove(c) { delete this._set[c]; },
        toggle(c, on) { if (on === undefined) on = !this._set[c]; if (on) this._set[c] = true; else delete this._set[c]; },
        contains(c) { return !!this._set[c]; }
      }
    };
    el.classList = Object.create(el.classList);
    el.classList._set = {};
    return el;
  }
  /* select は「選択肢に無い値を入れると selectedIndex が -1」を再現する（rgSyncUI が見る） */
  function select(opts) {
    const el = node('select');
    el._opts = opts.slice();
    Object.defineProperty(el, 'value', {
      get() { return el._value === undefined ? el._opts[0] : el._value; },
      set(v) { el._value = String(v); el.selectedIndex = el._opts.indexOf(String(v)); }
    });
    el.value = opts[0];
    return el;
  }
  const document = {
    createElement: node,
    createElementNS: (ns, t) => node(t),
    createTextNode: (s) => ({ children: [], textContent: String(s), _text: String(s) }),
    getElementById: (id) => (els[id] || null),
    querySelectorAll: () => [],
    querySelector: () => null,
    documentElement: { style: { setProperty() {} } }
  };
  const put = (id, el) => { el.id = id; els[id] = el; return el; };
  const DAY_OPTS = ['7', '14', '30', '60', '90', '150'];
  ['r', 'v', 's'].forEach(p => {
    put('rgDays-' + p, select(DAY_OPTS));
    put('rgSpan-' + p, node('input'));
    put('rgFrom-' + p, node('input'));
    put('rgTo-' + p, node('input'));
    put('rgLoad-' + p, node('button'));
  });
  ['banner', 'status', 'sqStatus', 'rlist', 'timeline', 'who', 'ractions', 'dtimeline', 'dstatus',
    'theDate', 'dateGo', 'dateFresh', 'copyDate', 'vmBanner', 'vmStatus', 'vmList',
    'vmWho', 'vmActions', 'vmBody', 'sqBanner', 'sqScope', 'sqCats', 'sqText', 'sqSyn',
    'sqActions', 'sqStat', 'sqResult', 'toast', 'block', 'cfgUrl', 'cfgToken', 'cfgInfo'
  ].forEach(id => put(id, node('div')));
  ['scr-resident', 'scr-date', 'scr-vm', 'scr-cfg', 'scr-search'].forEach(id => put(id, node('section')));
  els['scr-resident'].classList.add('on');
  return { document, els };
}

/* 画面を切り替える（.on は1つだけ） */
function showScreen(box, id) {
  ['scr-resident', 'scr-date', 'scr-vm', 'scr-cfg', 'scr-search'].forEach(s => {
    box.document.getElementById(s).classList.toggle('on', s === id);
  });
}

/* ── 砂場を作る ── */
const REAL_DATE = Date;
let NOW = REAL_DATE.parse('2026-09-07T10:00:00');
class FakeDate extends REAL_DATE {
  constructor(...args) { if (args.length === 0) super(NOW); else super(...args); }
  static now() { return NOW; }
}

function makeBox(opts) {
  opts = opts || {};
  const dom = makeDom();
  const store = Object.assign(Object.create(null), opts.storage || {});
  const calls = { load: 0, vmLoad: 0 };
  const box = {
    JSON, Math, Number, String, Array, Object, isFinite, parseInt, parseFloat, RegExp,
    console, Date: FakeDate,
    document: dom.document,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    _store: store, _calls: calls, _els: dom.els
  };
  vm.createContext(box);
  vm.runInContext([
    /* 画面の一覧・小物 */
    grabDecl('SCREENS').replace(/^(?:const|let)\s/, 'var '),
    grabDecl('WD').replace(/^(?:const|let)\s/, 'var '),
    grabDecl('SHIFT_LABEL').replace(/^(?:const|let)\s/, 'var '),
    grabDecl('SHIFT_ORDER').replace(/^(?:const|let)\s/, 'var '),
    grabDecl('SQ_CATS').replace(/^(?:const|let)\s/, 'var '),
    'var $ = function(id){ return document.getElementById(id); };',
    'var SEL = "", VMSEL = "", ROSTER = [], SQ_SEL = {}, SQ_LAST = null, SQ_CATSIG = "";',
    'var LOADING = false, LOAD_ERR = "";',
    grabDecl('LS_CFG'), grabDecl('LS_RANGE'), grabDecl('LS_DAYS'), grabDecl('LS_VMDAYS'),
    grabDecl('DATA'), grabDecl('VM'),
    'var VM_LOADING = false, VM_ERR = "";',
    grabFn('lsGet'), grabFn('lsSet'), grabFn('ymd'), grabFn('addDays'), grabFn('fmtDate'),
    grabFn('okYmd'), grabFn('normName'), grabFn('hhmm'), grabFn('loadCfg'),
    /* 期間まわり（本体） */
    grabDecl('VM_MAX_DAYS'), grabDecl('RG_DAYS_OPTS'), grabDecl('RG_DEF_DAYS'),
    grabDecl('RG_TABS'), grabDecl('RG_BASE_SCREENS'), grabDecl('RANGE'), grabDecl('RG_STALE_MSG'),
    grabFn('rgDays'), grabFn('rgSpecStale'), grabFn('rgSetStatus'), grabFn('sharedRange'), grabFn('rgSave'), grabFn('rgRestore'), grabFn('rgSyncUI'),
    grabFn('rgReadUI'), grabFn('currentScreen'), grabFn('rgStaleInto'),
    grabFn('baseStale'), grabFn('vmStale'), grabFn('rgClearBase'), grabFn('rgClearVm'),
    grabFn('rgApply'), grabFn('rgReload'), grabFn('rgBusyBase'), grabFn('rgBusyVm'),
    grabFn('dataLoaded'), grabFn('vmLoaded'), grabFn('sqUsable'),
    grabFn('ensureBaseData'), grabFn('ensureVmData'),
    /* 描画（stale ガードを実際に動かす） */
    grabFn('rosterByNorm'), grabFn('kanaKey'), grabFn('byKana'),
    grabFn('residentIndex'), grabFn('renderResidentList'),
    grabFn('allDatesInRange'), grabFn('bannerLine'), grabFn('briefDates'), grabFn('renderBanner'),
    grabFn('eventsFor'), grabFn('ledgerFor'), grabFn('groupByDate'),
    grabFn('sortKeyTime'), grabFn('sortWithin'), grabFn('hlText'), grabFn('jumpBtn'),
    grabFn('sumNode'), grabFn('evNode'), grabFn('renderTimeline'),
    grabFn('sqBuildQuery'), grabDecl('SQ_SYN').replace(/^(?:const|let)\s/, 'var '),
    grabFn('sqSyncScope'), grabFn('renderSearch'),
    grabFn('vmIndex'), grabFn('vmRenderList'),
    grabFn('vmAllDates'), grabFn('vmRenderBanner'), grabFn('mergeBy'), grabFn('vmRenderBody'),
    grabDecl('VM_SERIES').replace(/^(?:const|let)\s/, 'var '),
    grabDecl('VM_MEALS').replace(/^(?:const|let)\s/, 'var '),
    /* グラフ・表の中身はこのテストの対象外（見たいのは stale ガードと本人確認バー） */
    'function vmChart(){ return null; }',
    'function vmTable(){ return document.createElement("table"); }',
    'function vmLegend(){ return document.createElement("div"); }',
    'function vmFocusDate(){}',
    'function vmMarkDate(){}',
    'var VMFOCUS = "";',
    /* 読み込みは数えるだけの偽物に差し替える（ここで見たいのは「読み直すと決めたか」） */
    'function load(){ _calls.load++; return null; }',
    'function vmLoad(){ _calls.vmLoad++; return null; }',
    'function goto(){}',
    'function toast(){}',
    'function apiErrMsg(e){ return "err"; }'
  ].join('\n'), box);
  return box;
}

/* 便利関数 */
function setRange(box, r) { Object.assign(box.RANGE, r); }
function txt(box, id) { return box.document.getElementById(id).textContent; }

/* ══════════════════════════════════════════════════════════
   ① 期間の解決（recent / span / 逆順 / 150日超 / 不正値）
   ══════════════════════════════════════════════════════════ */
group('① 期間の解決 sharedRange()');
{
  const b = makeBox();
  const sr = () => b.sharedRange();

  setRange(b, { mode: 'recent', days: 14, from: '', to: '' });
  eq('直近14日（既定）', sr(), { from: '2026-08-25', to: '2026-09-07', mode: 'recent' });

  setRange(b, { days: 7 });
  eq('直近7日', sr(), { from: '2026-09-01', to: '2026-09-07', mode: 'recent' });

  setRange(b, { days: 150 });
  eq('直近150日（上限ちょうど）', sr(), { from: '2026-04-11', to: '2026-09-07', mode: 'recent' });

  setRange(b, { days: 151 });
  eq('151日は上限超え→既定14日', sr(), { from: '2026-08-25', to: '2026-09-07', mode: 'recent' });
  setRange(b, { days: 0 });
  eq('0日→既定14日', sr(), { from: '2026-08-25', to: '2026-09-07', mode: 'recent' });
  setRange(b, { days: -30 });
  eq('負の日数→既定14日', sr(), { from: '2026-08-25', to: '2026-09-07', mode: 'recent' });
  setRange(b, { days: 'abc' });
  eq('数でない→既定14日', sr(), { from: '2026-08-25', to: '2026-09-07', mode: 'recent' });
  setRange(b, { days: null });
  eq('null→既定14日', sr(), { from: '2026-08-25', to: '2026-09-07', mode: 'recent' });

  setRange(b, { mode: 'span', from: '2026-06-01', to: '2026-06-30' });
  eq('日付で指定', sr(), { from: '2026-06-01', to: '2026-06-30', mode: 'span' });

  setRange(b, { mode: 'span', from: '2026-06-30', to: '2026-06-01' });
  eq('開始と終了が逆でも受け付ける', sr(), { from: '2026-06-01', to: '2026-06-30', mode: 'span' });

  setRange(b, { mode: 'span', from: '2020-01-01', to: '2026-06-30' });
  eq('150日超は開始日を切り上げる', sr(), { from: '2026-02-01', to: '2026-06-30', mode: 'span' });
  {
    const r = sr();
    const days = Math.round((REAL_DATE.parse(r.to) - REAL_DATE.parse(r.from)) / 86400000) + 1;
    eq('切り上げ後はちょうど150日', days, 150);
  }

  setRange(b, { mode: 'span', from: '2026-02-01', to: '2026-06-30' });
  eq('ちょうど150日は切り上げない', sr(), { from: '2026-02-01', to: '2026-06-30', mode: 'span' });

  setRange(b, { mode: 'span', from: '', to: '2026-06-30' });
  eq('開始日が空→invalid', sr(), { from: '', to: '', mode: 'span', invalid: true });
  setRange(b, { mode: 'span', from: '20260601', to: '2026-06-30' });
  eq('形式違い→invalid', sr(), { from: '', to: '', mode: 'span', invalid: true });
  setRange(b, { mode: 'span', from: '2026-06-01', to: '' });
  eq('終了日が空→invalid', sr(), { from: '', to: '', mode: 'span', invalid: true });

  setRange(b, { mode: 'よそから来た値', days: 30, from: '', to: '' });
  eq('未知の mode は直近扱い', sr(), { from: '2026-08-09', to: '2026-09-07', mode: 'recent' });
}

/* ══════════════════════════════════════════════════════════
   ② 3タブの値が同期すること
   ══════════════════════════════════════════════════════════ */
group('② 3タブの同期（rgSyncUI / rgReadUI）');
{
  const b = makeBox();
  const g = (id) => b.document.getElementById(id);

  setRange(b, { mode: 'recent', days: 30, from: '', to: '' });
  b.rgSyncUI();
  ['r', 'v', 's'].forEach(p => {
    eq('日数プルダウンが同じ値（' + p + '）', g('rgDays-' + p).value, '30');
    eq('チェックOFF（' + p + '）', g('rgSpan-' + p).checked, false);
    eq('プルダウンは有効（' + p + '）', g('rgDays-' + p).disabled, false);
    eq('日付は無効（' + p + '）', [g('rgFrom-' + p).disabled, g('rgTo-' + p).disabled], [true, true]);
  });

  setRange(b, { mode: 'span', days: 30, from: '2026-06-01', to: '2026-06-30' });
  b.rgSyncUI();
  ['r', 'v', 's'].forEach(p => {
    eq('日付が同じ値（' + p + '）', [g('rgFrom-' + p).value, g('rgTo-' + p).value], ['2026-06-01', '2026-06-30']);
    eq('チェックON（' + p + '）', g('rgSpan-' + p).checked, true);
    eq('プルダウンは無効（' + p + '）', g('rgDays-' + p).disabled, true);
    eq('日付は有効（' + p + '）', [g('rgFrom-' + p).disabled, g('rgTo-' + p).disabled], [false, false]);
  });

  /* 選択肢に無い日数は既定へ落とす（プルダウンが空欄にならない） */
  setRange(b, { mode: 'recent', days: 45, from: '', to: '' });
  b.rgSyncUI();
  eq('選択肢に無い45日は既定14へ', g('rgDays-r').value, '14');
  /* ★画面だけ直すと RANGE と食い違い、以後 sharedRange と表示がずれる */
  eq('RANGE 側の日数も既定へ戻す', b.RANGE.days, 14);

  /* バイタルタブで操作 → 残り2タブが即座に同じ値になる */
  const b2 = makeBox();
  const g2 = (id) => b2.document.getElementById(id);
  b2.rgSyncUI();
  g2('rgDays-v').value = '90';
  b2.rgReadUI('v');
  eq('バイタルで90日→RANGE', [b2.RANGE.mode, b2.RANGE.days], ['recent', 90]);
  eq('入居者別のプルダウンも90', g2('rgDays-r').value, '90');
  eq('検索のプルダウンも90', g2('rgDays-s').value, '90');
  eq('保存された', b2._store['msk_range'] === undefined ? '(未保存)' : JSON.parse(b2._store['msk_range']),
    { mode: 'recent', days: 90, from: '', to: '' });

  /* 検索タブで「日付で指定」にすると、空欄なら今の直近N日が入る */
  g2('rgSpan-s').checked = true;
  b2.rgReadUI('s');
  eq('日付で指定に切替→mode', b2.RANGE.mode, 'span');
  eq('空欄は今の直近90日で埋まる', [b2.RANGE.from, b2.RANGE.to], ['2026-06-10', '2026-09-07']);
  eq('入居者別の日付欄も同じ', [g2('rgFrom-r').value, g2('rgTo-r').value], ['2026-06-10', '2026-09-07']);
  eq('バイタルのチェックもON', g2('rgSpan-v').checked, true);
  eq('切替直後は期間が変わらない（無駄な読み込みをしない）',
    b2.sharedRange().from + '/' + b2.sharedRange().to, '2026-06-10/2026-09-07');

  /* 入居者別で日付を直す → 3タブに反映 */
  g2('rgFrom-r').value = '2026-06-01';
  g2('rgTo-r').value = '2026-06-30';
  b2.rgReadUI('r');
  eq('入居者別で日付変更→RANGE', [b2.RANGE.from, b2.RANGE.to], ['2026-06-01', '2026-06-30']);
  eq('検索の日付欄も同じ', [g2('rgFrom-s').value, g2('rgTo-s').value], ['2026-06-01', '2026-06-30']);
  eq('バイタルの日付欄も同じ', [g2('rgFrom-v').value, g2('rgTo-v').value], ['2026-06-01', '2026-06-30']);

  /* チェックを外すと直近へ戻る（日付は残す＝また入れ直させない） */
  g2('rgSpan-r').checked = false;
  b2.rgReadUI('r');
  eq('チェックOFF→直近へ', b2.RANGE.mode, 'recent');
  eq('日付欄の値は残す', [b2.RANGE.from, b2.RANGE.to], ['2026-06-01', '2026-06-30']);
  eq('日数は保たれている', b2.RANGE.days, 90);

  /* 壊れた日付は取り込まない */
  const b3 = makeBox();
  b3.rgSyncUI();
  b3.document.getElementById('rgSpan-r').checked = true;
  b3.document.getElementById('rgFrom-r').value = 'あ';
  b3.document.getElementById('rgTo-r').value = '2026-06-30';
  b3.rgReadUI('r');
  eq('壊れた開始日は空扱い→今の直近で埋める', b3.RANGE.from, '2026-08-25');
  eq('終了日はそのまま', b3.RANGE.to, '2026-06-30');

  /* 保存されるのは UI 状態の4つだけ（氏名・記録を保存しない） */
  const b4 = makeBox();
  setRange(b4, { mode: 'span', days: 30, from: '2026-06-01', to: '2026-06-30' });
  b4.rgSave();
  eq('保存キーは msk_range のみ', Object.keys(b4._store), ['msk_range']);
  eq('保存する項目は4つだけ',
    b4._store['msk_range'] === undefined ? '(未保存)' : Object.keys(JSON.parse(b4._store['msk_range'])).sort(),
    ['days', 'from', 'mode', 'to']);
}

/* ══════════════════════════════════════════════════════════
   ③ 旧キーからの引き継ぎ（msk_days → msk_vmDays・custom は無視）
   ══════════════════════════════════════════════════════════ */
group('③ 旧キーからの引き継ぎ（rgRestore）');
{
  const cases = [
    ['新キー（直近）', { msk_range: '{"mode":"recent","days":60,"from":"","to":""}' },
      { mode: 'recent', days: 60, from: '', to: '' }],
    ['新キー（日付で指定）', { msk_range: '{"mode":"span","days":30,"from":"2026-06-01","to":"2026-06-30"}' },
      { mode: 'span', days: 30, from: '2026-06-01', to: '2026-06-30' }],
    ['新キーの span で日付が壊れている→直近へ', { msk_range: '{"mode":"span","days":30,"from":"xx","to":""}' },
      { mode: 'recent', days: 30, from: '', to: '' }],
    ['新キーの日数が選択肢に無い→既定14', { msk_range: '{"mode":"recent","days":45,"from":"","to":""}' },
      { mode: 'recent', days: 14, from: '', to: '' }],
    ['新キーが壊れたJSON→旧キーを見る', { msk_range: '{壊れ', msk_days: '30' },
      { mode: 'recent', days: 30, from: '', to: '' }],
    ['新キーが配列→旧キーを見る', { msk_range: '[1,2]', msk_days: '90' },
      { mode: 'recent', days: 90, from: '', to: '' }],
    ['旧 msk_days から引き継ぐ', { msk_days: '30' }, { mode: 'recent', days: 30, from: '', to: '' }],
    ['msk_days が優先（両方ある）', { msk_days: '7', msk_vmDays: '150' },
      { mode: 'recent', days: 7, from: '', to: '' }],
    ['msk_days が不正なら msk_vmDays', { msk_days: 'zzz', msk_vmDays: '60' },
      { mode: 'recent', days: 60, from: '', to: '' }],
    ['旧 msk_vmDays の custom は無視して既定14', { msk_vmDays: 'custom' },
      { mode: 'recent', days: 14, from: '', to: '' }],
    ['旧 msk_vmDays から引き継ぐ', { msk_vmDays: '150' }, { mode: 'recent', days: 150, from: '', to: '' }],
    ['何も無い→既定14', {}, { mode: 'recent', days: 14, from: '', to: '' }],
    ['未知の mode は直近へ', { msk_range: '{"mode":"zzz","days":30}' },
      { mode: 'recent', days: 30, from: '', to: '' }]
  ];
  cases.forEach(([label, store, want]) => {
    const b = makeBox({ storage: store });
    b.rgRestore();
    eq(label, b.RANGE, want);
  });

  /* 旧キーは読み捨てにして消さない */
  const b = makeBox({ storage: { msk_days: '30', msk_vmDays: 'custom' } });
  b.rgRestore();
  eq('旧 msk_days を消さない', b._store['msk_days'], '30');
  eq('旧 msk_vmDays を消さない', b._store['msk_vmDays'], 'custom');
  eq('復元しただけでは新キーを書かない', b._store['msk_range'], undefined);
}

/* ══════════════════════════════════════════════════════════
   ④ 読み直す前に古い期間のデータを描かない
   ══════════════════════════════════════════════════════════ */
group('④ 古い期間のデータを新しい期間の結果として描かない');
{
  /* 読み込み済みの状態を作る（架空の氏名・架空の記録） */
  function loaded(b, reqFrom, reqTo) {
    b.DATA = {
      from: reqFrom, to: reqTo, reqFrom: reqFrom, reqTo: reqTo,
      reqMode: b.RANGE.mode, reqDays: b.rgDays(),
      events: [
        { kind: 'resident', name: '見本 一郎', date: reqTo, time: '09:00', shift: 'day', body: '架空の記録', row: 1 },
        { kind: 'resident', name: '見本 花子', date: reqTo, time: '10:00', shift: 'day', body: '架空の記録', row: 2 }
      ],
      ledger: [], ingested: [reqTo], loadedAt: NOW, lastTick: ''
    };
  }

  const b = makeBox();
  setRange(b, { mode: 'span', days: 14, from: '2026-08-01', to: '2026-08-31' });
  loaded(b, '2026-08-01', '2026-08-31');

  eq('期間が一致していれば stale ではない', b.baseStale(), false);
  b.renderResidentList();
  eq('一覧に2名出る', b._els['rlist'].children.length, 2);

  /* 検索タブで6月へ変更（まだ読み直していない） */
  setRange(b, { from: '2026-06-01', to: '2026-06-30' });
  eq('期間を変えたら stale', b.baseStale(), true);

  b.renderResidentList();
  eq('一覧は古い2名を出さない', b._els['rlist'].children.length, 1);
  has('一覧に「期間が変わりました」', txt(b, 'rlist'), '期間が変わりました');
  hasNot('一覧に古い氏名が残らない', txt(b, 'rlist'), '見本');

  b.SEL = b.normName('見本 一郎');
  b.renderTimeline();
  has('タイムラインも止まる', txt(b, 'timeline'), '期間が変わりました');
  hasNot('タイムラインに古い記録が残らない', txt(b, 'timeline'), '架空の記録');
  eq('コピー・印刷ボタンを隠す', b._els['ractions'].hidden, true);
  eq('本人確認バーを消す', txt(b, 'who'), '');

  b.renderBanner();
  eq('古い期間の⚠️帯を出さない', txt(b, 'banner'), '');

  showScreen(b, 'scr-search');
  b.renderSearch();
  has('検索結果も止まる', txt(b, 'sqResult'), '期間が変わりました');
  eq('まとめコピーを隠す', b._els['sqActions'].hidden, true);
  has('検索対象期間の表示も止まる', txt(b, 'sqScope'), '期間が変わりました');
  hasNot('古い期間を「検索対象期間」として出さない', txt(b, 'sqScope'), '2026-08-01');
  eq('検索してよい状態ではない', b.sqUsable(), false);

  /* 読み直しが終わった（新しい期間のデータが入った）*/
  loaded(b, '2026-06-01', '2026-06-30');
  eq('読み直したら stale ではない', b.baseStale(), false);
  b.renderResidentList();
  eq('一覧が戻る', b._els['rlist'].children.length, 2);
  b.renderSearch();
  eq('検索対象期間の文言（全文）', txt(b, 'sqScope'),
    '検索対象期間: 2026-06-01 〜 2026-06-30（10:00 に読み込んだ内容です。取り込み済みの記録だけを探します）');
  eq('検索してよい状態', b.sqUsable(), true);

  /* ★サーバーが返す from/to ではなく、要求した期間で判定する */
  const b5 = makeBox();
  setRange(b5, { mode: 'span', days: 14, from: '2026-06-01', to: '2026-06-30' });
  b5.DATA = {
    from: '2026-06-03', to: '2026-06-28',      // サーバーが丸めて返した値
    reqFrom: '2026-06-01', reqTo: '2026-06-30', reqMode: 'span', reqDays: 14, // 要求した指定内容
    events: [], ledger: [], ingested: [], loadedAt: NOW
  };
  eq('サーバーが丸めても stale にしない（読み直しが止まらなくなる）', b5.baseStale(), false);

  /* 未読は stale ではない（「まだ読み込んでいません」側の表示に任せる） */
  const b6 = makeBox();
  eq('未読は stale ではない', b6.baseStale(), false);
  showScreen(b6, 'scr-search');
  b6.renderSearch();
  has('未読は従来どおりの案内', txt(b6, 'sqStat'), 'まだ読み込んでいません');
  has('案内は上の期間バーを指す', txt(b6, 'sqStat'), '「読み込み」');
  hasNot('「入居者別タブで読み込め」とは言わない', txt(b6, 'sqStat'), '「入居者別」タブで期間');

  /* 期間が invalid（日付未入力）の間は stale 判定しない */
  const b7 = makeBox();
  loaded(b7, '2026-08-01', '2026-08-31');
  setRange(b7, { mode: 'span', from: '', to: '' });
  eq('期間が未確定なら stale 判定しない', b7.baseStale(), false);

  /* バイタル側 */
  const b8 = makeBox();
  setRange(b8, { mode: 'span', days: 14, from: '2026-08-01', to: '2026-08-31' });
  b8.VM = {
    from: '2026-08-01', to: '2026-08-31', reqFrom: '2026-08-01', reqTo: '2026-08-31',
    reqMode: 'span', reqDays: 14,
    vitals: [{ name: '見本 一郎', room: '101', date: '2026-08-31', temp: 36.5 }],
    meals: [], vitalDates: ['2026-08-31'], mealDates: [], notes: '', fails: ''
  };
  eq('バイタル: 一致なら stale ではない', b8.vmStale(), false);
  b8.vmRenderList();
  eq('バイタル一覧に1名', b8._els['vmList'].children.length, 1);
  b8.VMSEL = b8.normName('見本 一郎');
  b8.vmRenderBody();
  has('バイタル本体に本人確認バーが出る（stale でない時）', txt(b8, 'vmWho'), '様');
  eq('印刷・数値コピーが押せる', b8._els['vmActions'].hidden, false);
  setRange(b8, { from: '2026-06-01', to: '2026-06-30' });
  eq('バイタル: 期間を変えたら stale', b8.vmStale(), true);
  b8.vmRenderList();
  has('バイタル一覧も止まる', txt(b8, 'vmList'), '期間が変わりました');
  hasNot('バイタル一覧に古い氏名が残らない', txt(b8, 'vmList'), '見本');
  b8.vmRenderBody();
  has('グラフ・表も止まる', txt(b8, 'vmBody'), '期間が変わりました');
  eq('印刷・数値コピーを止める（期間の違う紙を作らせない）', b8._els['vmActions'].hidden, true);
  eq('本人確認バーを消す', txt(b8, 'vmWho'), '');
  b8.vmRenderBanner();
  eq('バイタルの⚠️帯も出さない', txt(b8, 'vmBanner'), '');

  /* 文言の出し分け（読み込み中／失敗／押し待ち） */
  const b9 = makeBox();
  const mk = (loading, err) => {
    const box = b9.document.createElement('div');
    b9.rgStaleInto(box, loading, err);
    return box.textContent;
  };
  eq('読み込み中の文言', mk(true, ''), '期間が変わりました。読み込み中…');
  has('失敗した時は理由を出す', mk(false, '通信がタイムアウトしました'), '通信がタイムアウトしました');
  has('失敗した時は次の一手を書く', mk(false, '通信がタイムアウトしました'), 'もう一度押してください');
  has('待ちの時は押す先を書く', mk(false, ''), '「読み込み」を押してください');
}

/* ══════════════════════════════════════════════════════════
   ⑤ 期間変更後に他タブを開くと読み直すこと（通信は増やさない）
   ══════════════════════════════════════════════════════════ */
group('⑤ 表示中のタブだけ読み直す（ensureBaseData / ensureVmData / rgApply）');
{
  const CFG = { msk_cfg: '{"url":"https://script.google.com/macros/s/x/exec","token":"t"}' };
  function ready(b, from, to) {
    var spec = { reqFrom: from, reqTo: to, reqMode: b.RANGE.mode, reqDays: b.rgDays() };
    b.DATA = Object.assign({ from: from, to: to, events: [], ledger: [], ingested: [], loadedAt: NOW }, spec);
    b.VM = Object.assign({ from: from, to: to, vitals: [], meals: [], vitalDates: [], mealDates: [], notes: '' }, spec);
  }

  /* 未読なら読む */
  let b = makeBox({ storage: CFG });
  b.ensureBaseData();
  eq('未読なら読む', b._calls.load, 1);

  /* 読み込み済みで期間も一致なら読まない */
  b = makeBox({ storage: CFG });
  setRange(b, { mode: 'span', from: '2026-08-01', to: '2026-08-31' });
  ready(b, '2026-08-01', '2026-08-31');
  b.ensureBaseData();
  eq('一致していれば通信しない', b._calls.load, 0);
  b.ensureVmData();
  eq('バイタルも通信しない', b._calls.vmLoad, 0);

  /* 期間が変わっていれば読み直す */
  setRange(b, { from: '2026-06-01', to: '2026-06-30' });
  b.ensureBaseData();
  eq('期間が変わったら読み直す', b._calls.load, 1);
  b.ensureVmData();
  eq('バイタルも読み直す', b._calls.vmLoad, 1);

  /* 通信中は重ねて読まない */
  b = makeBox({ storage: CFG });
  b.LOADING = true;
  b.ensureBaseData();
  eq('通信中は重ねて読まない', b._calls.load, 0);
  b.VM_LOADING = true;
  b.ensureVmData();
  eq('バイタルも重ねて読まない', b._calls.vmLoad, 0);

  /* 接続先が未設定なら読まない（画面は古いデータを下ろす） */
  b = makeBox();
  setRange(b, { mode: 'span', from: '2026-08-01', to: '2026-08-31' });
  ready(b, '2026-08-01', '2026-08-31');
  setRange(b, { from: '2026-06-01', to: '2026-06-30' });
  b.ensureBaseData();
  eq('未設定なら読まない', b._calls.load, 0);
  has('それでも古いデータは下ろす', txt(b, 'rlist'), '期間が変わりました');

  /* rgApply: 表示中のタブだけ読み直す */
  ['scr-resident', 'scr-date', 'scr-search'].forEach(scr => {
    const x = makeBox({ storage: CFG });
    showScreen(x, scr);
    setRange(x, { mode: 'span', from: '2026-08-01', to: '2026-08-31' });
    ready(x, '2026-08-01', '2026-08-31');
    setRange(x, { from: '2026-06-01', to: '2026-06-30' });
    x.rgApply();
    eq(scr + ' では申し送りだけ読む', [x._calls.load, x._calls.vmLoad], [1, 0]);
    has(scr + ' でもバイタルの画面は古い値を下ろす', txt(x, 'vmList'), '期間が変わりました');
  });
  {
    const x = makeBox({ storage: CFG });
    showScreen(x, 'scr-vm');
    setRange(x, { mode: 'span', from: '2026-08-01', to: '2026-08-31' });
    ready(x, '2026-08-01', '2026-08-31');
    setRange(x, { from: '2026-06-01', to: '2026-06-30' });
    x.rgApply();
    eq('バイタルタブではバイタルだけ読む', [x._calls.load, x._calls.vmLoad], [0, 1]);
    has('申し送り側の画面は古い値を下ろす', txt(x, 'rlist'), '期間が変わりました');
  }

  /* 読み込みボタン: いま見ているタブを取り直す（期間が同じでも読む） */
  {
    const x = makeBox({ storage: CFG });
    showScreen(x, 'scr-search');
    setRange(x, { mode: 'span', from: '2026-08-01', to: '2026-08-31' });
    ready(x, '2026-08-01', '2026-08-31');
    x.rgReload();
    eq('検索タブの読み込み→申し送りを取り直す', [x._calls.load, x._calls.vmLoad], [1, 0]);
    showScreen(x, 'scr-vm');
    x.rgReload();
    eq('バイタルタブの読み込み→バイタルを取り直す', [x._calls.load, x._calls.vmLoad], [1, 1]);
  }

  /* 通信中は「読み込み」を押せなくする */
  {
    const x = makeBox();
    x.rgBusyBase(true);
    eq('申し送り側の2つを止める', ['r', 's'].map(p => x.document.getElementById('rgLoad-' + p).disabled), [true, true]);
    eq('バイタル側は止めない', x.document.getElementById('rgLoad-v').disabled, false);
    x.rgBusyVm(true);
    eq('バイタル側を止める', x.document.getElementById('rgLoad-v').disabled, true);
    x.rgBusyBase(false); x.rgBusyVm(false);
    eq('戻る', ['r', 'v', 's'].map(p => x.document.getElementById('rgLoad-' + p).disabled), [false, false, false]);
  }

  /* currentScreen */
  {
    const x = makeBox();
    showScreen(x, 'scr-vm');
    eq('現在の画面を返す', x.currentScreen(), 'scr-vm');
    showScreen(x, 'scr-cfg');
    eq('設定画面も返す', x.currentScreen(), 'scr-cfg');
  }
}

/* ══════════════════════════════════════════════════════════
   ⑥ 日付が変わっただけでは stale にしない（毎晩0時・夜勤帯）
   ══════════════════════════════════════════════════════════ */
group('⑥ 日付跨ぎ・片方の日付を消した時');
{
  const CFG = { msk_cfg: '{"url":"https://script.google.com/macros/s/x/exec","token":"t"}' };
  const b = makeBox({ storage: CFG });
  setRange(b, { mode: 'recent', days: 14, from: '', to: '' });
  const r0 = b.sharedRange();
  b.DATA = { from: r0.from, to: r0.to, reqFrom: r0.from, reqTo: r0.to,
             reqMode: 'recent', reqDays: 14,
             events: [{ kind: 'resident', name: '見本 一郎', date: r0.to, time: '09:00',
                        shift: 'day', body: '架空の記録', row: 1 }],
             ledger: [], ingested: [r0.to], loadedAt: NOW };
  b.VM = { from: r0.from, to: r0.to, reqFrom: r0.from, reqTo: r0.to, reqMode: 'recent', reqDays: 14,
           vitals: [], meals: [], vitalDates: [], mealDates: [], notes: '' };
  eq('日付が変わる前は stale ではない', [b.baseStale(), b.vmStale()], [false, false]);

  const KEEP = NOW;
  NOW = REAL_DATE.parse('2026-09-08T00:30:00');       // 0時を跨いだ（夜勤帯）
  eq('直近N日は日付が変わっただけでは stale にしない', [b.baseStale(), b.vmStale()], [false, false]);
  b.renderResidentList();
  eq('入居者の一覧が消えない', b._els['rlist'].children.length, 1);
  hasNot('一覧に「期間が変わりました」を出さない', txt(b, 'rlist'), '期間が変わりました');
  showScreen(b, 'scr-search');
  b.renderSearch();
  hasNot('検索も止まらない', txt(b, 'sqScope'), '期間が変わりました');
  b.ensureBaseData();
  eq('日付が変わっただけでは読み直しに行かない', b._calls.load, 0);

  /* 日数を変えたら（＝指定内容が変わったら）ちゃんと stale になる */
  setRange(b, { days: 30 });
  eq('日数を変えたら stale', b.baseStale(), true);
  setRange(b, { days: 14 });
  eq('戻したら stale ではない', b.baseStale(), false);

  /* 「日付で指定」は解決した日付そのものが指定内容なので、そちらで比べる */
  setRange(b, { mode: 'span', from: r0.from, to: r0.to });
  eq('直近→日付で指定 は同じ日付でも指定内容が違う＝stale', b.baseStale(), true);
  NOW = KEEP;
}

group('⑦ 日付を片方だけ消した時（意図しない期間で読みに行かない）');
{
  const b = makeBox();
  const g = (id) => b.document.getElementById(id);
  b.rgSyncUI();
  /* 「日付で指定」に切り替え → 空欄が今の直近14日で埋まる */
  g('rgSpan-r').checked = true;
  b.rgReadUI('r');
  eq('切替時は空欄を埋める', [b.RANGE.from, b.RANGE.to], ['2026-08-25', '2026-09-07']);
  /* 6月を指定し直す */
  g('rgFrom-r').value = '2026-06-01'; g('rgTo-r').value = '2026-06-30';
  b.rgReadUI('r');
  eq('6月を指定', [b.RANGE.from, b.RANGE.to], ['2026-06-01', '2026-06-30']);
  /* 開始日だけ消す → 「今日」を勝手に入れて逆転した期間を作らない */
  g('rgFrom-r').value = '';
  b.rgReadUI('r');
  eq('消した欄は埋め直さない', b.RANGE.from, '');
  eq('終了日はそのまま', b.RANGE.to, '2026-06-30');
  eq('期間は未確定（読みに行かない）', b.sharedRange().invalid, true);
  eq('未確定の間は stale 判定しない', b.baseStale(), false);
  /* 入れ直せば元どおり */
  g('rgFrom-r').value = '2026-05-01';
  b.rgReadUI('r');
  eq('入れ直せば確定する', [b.sharedRange().from, b.sharedRange().to], ['2026-05-01', '2026-06-30']);
}

group('⑧ 状態表示（2箇所同時・下ろす時は消す・読み込み中と押し待ちの書き分け）');
{
  const b = makeBox();
  b.rgSetStatus('読み込み中…');
  eq('入居者別と検索の両方に書く', [txt(b, 'status'), txt(b, 'sqStatus')], ['読み込み中…', '読み込み中…']);

  setRange(b, { mode: 'span', days: 14, from: '2026-08-01', to: '2026-08-31' });
  b.DATA = { from: '2026-08-01', to: '2026-08-31', reqFrom: '2026-08-01', reqTo: '2026-08-31',
             reqMode: 'span', reqDays: 14, events: [], ledger: [], ingested: [], loadedAt: NOW };
  b.rgSetStatus('2026-08-01 〜 2026-08-31（120件）');
  setRange(b, { from: '2026-06-01', to: '2026-06-30' });
  b.rgClearBase();
  eq('古い期間の件数を残さない', [txt(b, 'status'), txt(b, 'sqStatus')], ['', '']);
  /* 通信していない時に「読み込み中…」と書かない（0時の日付跨ぎ・接続先未設定で起きる） */
  b.LOADING = false;
  b.sqSyncScope();
  has('押し待ちの時は押す先を書く', txt(b, 'sqScope'), '「読み込み」を押してください');
  hasNot('押し待ちの時に「読み込み中」と書かない', txt(b, 'sqScope'), '読み込み中');
  b.LOADING = true;
  b.sqSyncScope();
  has('通信中は読み込み中と書く', txt(b, 'sqScope'), '読み込み中…');

  /* 追いかけ読みは「そのタブを見ている時」だけ */
  eq('申し送りを使う画面の一覧', b.RG_BASE_SCREENS, ['scr-resident', 'scr-date', 'scr-search']);
}

/* ══════════════════════════════════════════════════════════
   ⑨ 配線の静的照合（実装が別経路へ戻っていないこと）
   ══════════════════════════════════════════════════════════ */
group('⑨ 配線（HTML・呼び出し側）');
{
  /* 3タブぶんの部品がそろっている */
  ['r', 'v', 's'].forEach(p => {
    ['rgDays-', 'rgSpan-', 'rgFrom-', 'rgTo-', 'rgLoad-'].forEach(k => {
      eq('id ' + k + p + ' がある', new RegExp('id="' + k + p + '"').test(SRC), true);
    });
  });
  eq('日数の選択肢は6つ×3タブ', (SRC.match(/<option value="150">直近150日<\/option>/g) || []).length, 3);
  eq('期間バーは印刷しない', (SRC.match(/class="bar rgbar noprint"/g) || []).length, 3);
  eq('チェックの当たり判定44px', /\.rgbar label\.rgchk\s*\{[^}]*min-height:44px/.test(SRC), true);

  /* 旧部品・旧関数が残っていない */
  ['id="days"', 'id="reload"', 'id="vmDays"', 'id="vmSpan"', 'id="vmFrom"', 'id="vmTo"', 'id="vmReload"']
    .forEach(s => eq('旧部品 ' + s + ' は消えている', SRC.indexOf(s) >= 0, false));
  eq('currentRange は消えている', /function currentRange\(/.test(SRC), false);
  eq('vmRange は消えている', /function vmRange\(/.test(SRC), false);
  eq('日付を指定の選択肢は消えている', SRC.indexOf('>日付を指定<') >= 0, false);

  /* load / vmLoad が共有期間を使う */
  const load = grabFn('load'), vmLoad = grabFn('vmLoad');
  has('load は sharedRange を使う', load, 'var r = sharedRange();');
  has('vmLoad は sharedRange を使う', vmLoad, 'var r = sharedRange();');
  has('load は要求した期間を控える', load, 'reqFrom:r.from, reqTo:r.to');
  has('vmLoad は要求した期間を控える', vmLoad, 'reqFrom:r.from, reqTo:r.to');
  has('load は期間未確定なら読みに行かない', load, "if(r.invalid){ rgSetStatus(");
  has('load は古いデータを下ろしてから読む', load, 'if(baseStale()) rgClearBase();');
  has('vmLoad は古いデータを下ろしてから読む', vmLoad, 'if(vmStale()) rgClearVm();');
  /* ★通信中に期間がもう一度変わった時は追いかける（失敗時は追いかけない＝else if） */
  has('load は通信中に変わった期間を追いかける', load,
    'else if(baseStale() && RG_BASE_SCREENS.indexOf(currentScreen()) >= 0) load();');
  has('vmLoad は通信中に変わった期間を追いかける', vmLoad,
    "else if(vmStale() && currentScreen() === 'scr-vm') vmLoad();");
  eq('load の追いかけは失敗時に走らない（else if）',
    /if\(LOAD_ERR\)\{[\s\S]*?\}\n[\s\S]*?else if\(baseStale\(\)/.test(load), true);
  eq('vmLoad の追いかけは失敗時に走らない（else if）',
    /if\(VM_ERR\)\{[\s\S]*?\}\n[\s\S]*?else if\(vmStale\(\)/.test(vmLoad), true);
  has('状態表示は入居者別と検索の2箇所へ同時に書く', grabFn('rgSetStatus'), "var e = $('sqStatus');");
  has('古いデータを下ろす時は状態表示も消す', grabFn('rgClearBase'), "$('status').textContent = '';");
  has('バイタルの状態表示も消す', grabFn('rgClearVm'), "$('vmStatus').textContent = '';");
  has('補完は日付で指定へ切り替えた瞬間だけ', grabFn('rgReadUI'), "!wasSpan && !(RANGE.from && RANGE.to)");
  eq('検索タブ限定のラベル指定は期間バーに掛けない',
    SRC.indexOf('#scr-search .bar:not(.rgbar) label {') >= 0, true);
  eq('使っていない data-rg 属性は残っていない', /data-rg=/.test(SRC), false);
  eq('検索タブにも状態表示がある', SRC.indexOf('id="sqStatus"') >= 0, true);

  /* 各描画にガードが入っている */
  has('renderBanner にガード', grabFn('renderBanner'), 'if(baseStale()) return;');
  has('renderResidentList にガード', grabFn('renderResidentList'), 'if(baseStale()){ rgStaleInto(box');
  has('renderTimeline にガード', grabFn('renderTimeline'), 'if(baseStale()){ rgStaleInto(box');
  has('renderSearch にガード', grabFn('renderSearch'), 'if(baseStale()){');
  has('vmRenderBanner にガード', grabFn('vmRenderBanner'), 'if(vmStale()) return;');
  has('vmRenderList にガード', grabFn('vmRenderList'), 'if(vmStale()){ rgStaleInto(box');
  has('vmRenderBody にガード', grabFn('vmRenderBody'), 'if(vmStale()){ rgStaleInto(box');
  has('日付別は古い写しで描かない', grabFn('renderDateView'), '!baseStale()');

  /* タブ切替と起動時の両方から呼ぶ */
  const init = SRC.slice(SRC.indexOf('(function init(){'));
  has('タブ切替から ensureBaseData', init, "if(scr === 'scr-resident' || scr === 'scr-date' || scr === 'scr-search') ensureBaseData();");
  has('タブ切替から ensureVmData', init, "if(scr === 'scr-vm') ensureVmData();");
  has('起動時に期間を復元する', init, 'rgRestore();');
  has('起動時に3タブへ反映する', init, 'rgSyncUI();');
  has('起動時の復元も ensure 経由（バイタル）', init, 'ensureVmData();\n    sqSyncScope();');
  has('起動時の復元も ensure 経由（申し送り）', init, 'ensureBaseData();\n    if(opened === ');
  has('3タブぶんの配線がある', init, "RG_TABS.forEach(function(p){");
  eq('バイタル専用の2本目の bnav 配線は消えている',
    (init.match(/document\.querySelectorAll\('\.bnav button'\)/g) || []).length, 1);

  /* 触らないと約束したもの */
  has('印刷CSSの .bar 非表示はそのまま', SRC, '.noprint, .bnav, .hdr, .bar, .rlist, .ev .acts, .sum .acts { display:none !important; }');
  has('保存キー msk_cfg は変えていない', SRC, "var LS_CFG   = 'msk_cfg';");
  has('保存キー msk_view は変えていない', SRC, "var LS_VIEW  = 'msk_view';");
  has('保存キー msk_copyDate は変えていない', SRC, "var LS_CPDT  = 'msk_copyDate';");
  has('0件の文言は現状のまま', SRC, 'この期間の取り込み済み記録の中には見つかりません');
  has('未取込日の⚠️帯は現状のまま', SRC, '⚠️ まだ取り込まれていない日: ');
  has('日付別タブに期間バーを置いていない',
    SRC.slice(SRC.indexOf('id="scr-date"'), SRC.indexOf('id="scr-vm"')).indexOf('rgbar') < 0, true);
  has('検索の説明文を書き換えた', SRC, '検索対象期間: ');
  eq('「入居者別タブで読み込んだ範囲」は消えている', SRC.indexOf('「入居者別」タブで読み込んだ範囲の') >= 0, false);
  eq('「追加の通信はしません」は消えている', SRC.indexOf('追加の通信はしません）') >= 0, false);

  /* 個人情報を保存しない */
  const rgSave = grabFn('rgSave');
  eq('保存するのは mode/days/from/to だけ',
    /mode:RANGE\.mode, days:RANGE\.days, from:RANGE\.from, to:RANGE\.to/.test(rgSave), true);
  ['name', 'events', 'ledger', 'SEL', 'VMSEL'].forEach(k =>
    eq('rgSave に ' + k + ' を入れない', rgSave.indexOf(k) >= 0, false));
}

/* ── 結果 ── */
process.stdout.write('\n────────────────────────\n');
process.stdout.write('合格 ' + ok + ' / 不合格 ' + ng + '\n');
process.exit(ng ? 1 : 0);
