/* xss_small_screens_test.js — HTML の代入が少ない6画面の全数点検の守り（2026-10-25・本人指示）
 *
 * 6つの画面の innerHTML への代入（数え方は xss_weight_record_test の W13 と同じ /\.innerHTML\s*\+?=(?!=)/g）と、
 * insertAdjacentHTML・outerHTML・document.write・srcdoc・createContextualFragment・parseFromString を全部洗った。
 * 依頼の数（機能訓練計画書1・申送ビューア2・家族構成図2・接続設定1・全支援の週間俯瞰1・訪問支援の週間俯瞰1）は
 * 「innerHTML という語が出てくる行」の数で、家族構成図の2か所以外はどれもコメント（「innerHTML は使わない」の注記）だった。
 * 実物の代入の数は次のとおり。利用者・職員の入力やサーバーの文が HTML として入る所は無かった＝直す所なし。
 *
 * 点検表
 *   画面                         innerHTML  ほか   入る値と esc
 *   機能訓練計画書               0          1      parseFromString 1か所＝様式を入れる mountSheet の中だけ。
 *    （training-plan.html）                         4か所の呼び出しは全部 TP_FORM.buildSheet(…) の戻り値（createElement で
 *                                                   作った要素）を渡すので、文字列の経路は通らない。様式の欄（氏名・目標・
 *                                                   備考など記録由来）は training-plan-form.js が textContent で入れる
 *   申送ビューア                 0          0      記録の本文・要約・記入者・検索語は textContent／createTextNode と
 *    （moushiokuri-viewer.html）                     <mark> の createElement（hlText・sumNode・evNode・jumpBtn）
 *   家族構成図                   2          0      1 保存済みの一覧の先頭（refreshDocList）＝固定文
 *    （genogram.html）                               '<option value="">— 保存済みから読込 —</option>' だけ。図の名前・
 *                                                    最後に直した人（クラウド由来）は option の textContent で入れる
 *                                                  2 同梱の Konva（圧縮済みの描画部品）が入れ物を空にする
 *                                                    t.innerHTML=""＝固定の空文字（部品には触らない）
 *   接続設定                     0          0      系統名・説明・端末に保存された URL・接続確認の応答文は textContent と
 *    （connection-settings.html）                    input の value（el・field・input・setRes・buildCard）
 *   全支援の週間俯瞰             0          0      氏名・支援コード・吹き出しは textContent・title・aria-label（render）
 *    （support-overview.html）
 *   訪問支援の週間俯瞰           0          0      氏名・支援コード・吹き出しは textContent・title（render）
 *    （visit-overview.html）
 *
 * 固定する約束（利用者・職員の入力やサーバーの値に <img src=x onerror=…>・"><script>・属性を抜ける " onmouseover=" を
 * 入れても、出来上がった部品に img・script 要素や on で始まる属性が入らない。値は文字として残る＝黙って落とさない）:
 *   Z  6画面の HTML の代入の数が上の表のまま（増えても減っても落ちる＝点検し直して表を直す）。家族構成図の2か所は固定文のまま。
 *      機能訓練計画書の parseFromString は mountSheet の中の1か所だけで、mountSheet には buildSheet の戻り値だけを渡す
 *   T  機能訓練計画書：様式（本物の training-plan-form.js の buildSheet。印刷と画面の編集の両方）・mountSheet の要素の経路
 *   M  申送ビューア：該当語の印（hlText）・AI要約（sumNode）・申し送り（evNode）・移動ボタン（jumpBtn）
 *   G  家族構成図：保存済みの一覧（refreshDocList。端末の図とクラウドの図の名前・最後に直した人）
 *   C  接続設定：系統の欄（buildCard。端末に保存された URL を含む）・接続確認の結果の文（setRes）
 *   S  全支援の週間俯瞰：盤面（render。事務所PCと現場端末の表記の両方）
 *   V  訪問支援の週間俯瞰：盤面（render。事務所PCと現場端末の表記の両方）
 * 実物の画面のソースから関数を切り出して、最小の偽の document（createElement・textContent・appendChild・setAttribute を
 * 記録するだけ。innerHTML への代入は記録して、その中身も調べる）で動かす（写経しない）。
 * TP_HTML・TP_FORM_JS・MSK_HTML・GENO_HTML・CS_HTML・SO_HTML・VO_HTML で差し替えるのは、わざと壊した版で落ちるかの確認用。
 * 固定値の氏名・記録はすべて架空。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const rd = (env, name) => fs.readFileSync(process.env[env] || path.join(ROOT, name), 'utf8');
const TP = rd('TP_HTML', 'training-plan.html');
const TPF = rd('TP_FORM_JS', 'training-plan-form.js');
const MSK = rd('MSK_HTML', 'moushiokuri-viewer.html');
const GENO = rd('GENO_HTML', 'genogram.html');
const CS = rd('CS_HTML', 'connection-settings.html');
const SO = rd('SO_HTML', 'support-overview.html');
const VO = rd('VO_HTML', 'visit-overview.html');

/* { } の対応を数えて関数の終わりを探す（文字列・コメントは飛ばす） */
function scanBlock(src, from, open, close) {
  open = open || '{'; close = close || '}';
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
/* トップレベルの関数（async も）を切り出す */
function grabFn(src, name) {
  const m = new RegExp('\\n(?:async )?function ' + name.replace(/\$/g, '\\$') + '\\(').exec(src);
  if (!m) throw new Error('関数が見つかりません: ' + name);
  const pe = scanBlock(src, m.index + m[0].length - 1, '(', ')');
  const end = pe < 0 ? -1 : scanBlock(src, pe);
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
/* const X = …; の文（括弧の深さ0の ; まで） */
function grabConst(src, name) {
  const m = new RegExp('\\n(?:const|let|var) ' + name + '\\s*=').exec(src);
  if (!m) throw new Error('定数が見つかりません: ' + name);
  let d = 0, q = null;
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) return src.slice(m.index, i + 1);
  }
  throw new Error('定数の終わりが見つかりません: ' + name);
}

let pass = 0, fail = 0;
/* 合計は家族構成図（async）の後の finish() が出す。そこへ届かずに終わった時（待ちが解けない版など）は失敗で終わる */
process.exitCode = 1;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(String(info).slice(0, 400))); }
}
const EVIL = '<img src=x onerror=alert(1)>';
const BREAK = '"><script>alert(1)</script>';
const ATTR = '" onmouseover="alert(1)';

/* ══════════════ Z HTML の代入の数（点検表のまま） ══════════════ */
console.log('— 6画面：HTML の代入の数 —');
const INNER = /\.innerHTML\s*\+?=(?!=)/g;
const OTHER = /insertAdjacentHTML|\.outerHTML\s*\+?=(?!=)|document\.write|\bsrcdoc\b|createContextualFragment|parseFromString/g;
const cntOf = (src, re) => (src.match(re) || []).length;
[
  ['機能訓練計画書', TP, 0, 1], ['申送ビューア', MSK, 0, 0], ['家族構成図', GENO, 2, 0],
  ['接続設定', CS, 0, 0], ['全支援の週間俯瞰', SO, 0, 0], ['訪問支援の週間俯瞰', VO, 0, 0]
].forEach(([nm, src, inner, other]) => {
  const a = cntOf(src, INNER), b = cntOf(src, OTHER);
  t('Z ' + nm + '：innerHTML への代入は点検した' + inner + 'か所のまま（増えたら点検してこの表に足してから通す）', a === inner, a);
  t('Z ' + nm + '：insertAdjacentHTML・outerHTML・document.write・srcdoc・parseFromString 等は点検した' + other + 'か所のまま', b === other, b);
});
/* 家族構成図の2か所は固定文のまま（値をつないでいない） */
{
  const rhs = [...GENO.matchAll(/\.innerHTML\s*\+?=(?!=)\s*([^;\n]*?)\s*[;,]/g)].map((m) => m[1]);
  t('Z 家族構成図：2か所は固定の空文字（同梱の Konva）と固定の先頭行だけ',
    rhs.length === 2 && rhs.includes('""') && rhs.includes("'<option value=\"\">— 保存済みから読込 —</option>'"), rhs.join(' / '));
  t('Z 家族構成図：先頭行の代入は保存済みの一覧（refreshDocList）の中', /sel\.innerHTML = '<option value="">— 保存済みから読込 —<\/option>';/.test(grabFn(GENO, 'refreshDocList')), '');
}
/* 機能訓練計画書の parseFromString は mountSheet の中だけ・mountSheet には buildSheet の戻り値だけを渡す */
{
  const ms = grabFn(TP, 'mountSheet');
  t('Z 機能訓練計画書：parseFromString は mountSheet の中の1か所だけ', cntOf(ms, /parseFromString/g) === 1 && cntOf(TP, /parseFromString/g) === 1, '');
  const calls = TP.match(/mountSheet\(/g).length - 1;                        /* 定義の1つを除く */
  const viaBuild = (TP.match(/mountSheet\([A-Za-z_$][\w$]*, TP_FORM\.buildSheet\(/g) || []).length;
  t('Z 機能訓練計画書：mountSheet の呼び出し' + calls + 'か所は全部 TP_FORM.buildSheet(…) の戻り値を渡す', calls === 4 && viaBuild === calls, calls + '/' + viaBuild);
  t('Z 様式の部品：buildSheet は createElement で作った要素を返す・innerHTML 等を使わない',
    /var sheet = doc\.createElement\('div'\);[\s\S]*return sheet;\n  \}/.test(grabFn('\n' + TPF.replace(/\n  function /g, '\nfunction '), 'buildSheet')) &&
    cntOf(TPF, INNER) === 0 && cntOf(TPF, OTHER) === 0, '');
}

/* ══════════════ 偽の document（作った部品を記録するだけ） ══════════════ */
const HTML_LOG = [];   /* innerHTML 等に入れられた文字列（画面のどこで入れても全部ここに残る） */
const textNode = (s) => ({ nodeType: 3, textContent: String(s) });
function FNode(tag) {
  this.tagName = String(tag).toUpperCase(); this.nodeType = 1; this.attrs = {}; this.childNodes = []; this.dataset = {};
  this.style = { setProperty() {}, removeProperty() {}, cssText: '' }; this.className = ''; this.hidden = false;
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
FNode.prototype = {
  setAttribute(k, v) { this.attrs[String(k)] = String(v); },
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
  removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
  appendChild(c) { if (c && c.isFrag) { this.childNodes.push(...c.childNodes); c.childNodes = []; } else this.childNodes.push(c); return c; },
  append(...cs) { cs.forEach((c) => this.appendChild(typeof c === 'object' ? c : textNode(c))); },
  replaceChildren(...cs) { this.childNodes = []; this.append(...cs); },
  insertBefore(c) { return this.appendChild(c); },
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); return c; },
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); },
  get firstChild() { return this.childNodes[0] || null; },
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); },
  set textContent(v) { this.childNodes = (v === '' || v == null) ? [] : [textNode(v)]; },
  /* HTML の文字列は記録する。中身に値が混ざっていれば後で audit が見つける */
  get innerHTML() { return this._html || ''; },
  set innerHTML(v) { HTML_LOG.push(String(v)); this._html = String(v); this.childNodes = []; },
  set outerHTML(v) { HTML_LOG.push('outerHTML:' + String(v)); },
  insertAdjacentHTML(p, v) { HTML_LOG.push('insertAdjacentHTML:' + String(v)); },
  addEventListener() {}, removeEventListener() {}, remove() {}, focus() {}, click() {},
  querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
};
function fakeDoc() {
  const byId = {};
  const doc = {
    createElement: (tag) => new FNode(tag),
    createElementNS: (ns, tag) => new FNode(tag),
    createTextNode: (s) => textNode(s),
    createDocumentFragment: () => Object.assign(new FNode('#frag'), { isFrag: true }),
    getElementById: (id) => (byId[id] = byId[id] || Object.assign(new FNode('div'), { id })),
    querySelector: () => null, querySelectorAll: () => [],
    write(s) { HTML_LOG.push('document.write:' + String(s)); },
    byId
  };
  doc.body = new FNode('body'); doc.head = new FNode('head'); doc.documentElement = new FNode('html');
  return doc;
}
function fakeLS(init) {
  const m = Object.assign({}, init || {});
  return { getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}

/* 作った部品の木を歩いて、実行される形が無いかを調べる */
const INTERNAL = new Set(['tagName', 'nodeType', 'attrs', 'childNodes', 'dataset', 'style', 'className', 'classList', 'isFrag', '_html']);
function audit(root) {
  const bad = [], strs = [];
  (function walk(n) {
    if (!n) return;
    if (n.nodeType === 3) { strs.push(n.textContent); return; }
    if (/^(IMG|SCRIPT|IFRAME|OBJECT|EMBED)$/.test(n.tagName)) bad.push('要素 ' + n.tagName);
    if (n._html && (/<img\b/i.test(n._html) || /<script\b/i.test(n._html) || /["']\s*on[a-z]+\s*=/i.test(n._html))) bad.push('HTML ' + n._html.slice(0, 80));
    Object.keys(n.attrs || {}).forEach((k) => {
      if (/^on/i.test(k)) bad.push('属性 ' + k);
      if (/^(href|src|action|formaction|xlink:href)$/i.test(k) && /^\s*javascript:/i.test(n.attrs[k])) bad.push('URL ' + k);
      strs.push(n.attrs[k]);
    });
    Object.keys(n).forEach((k) => {
      if (INTERNAL.has(k)) return;
      const v = n[k];
      if (/^on/i.test(k) && typeof v === 'string') bad.push('プロパティ ' + k);
      if (/^(href|src|action)$/i.test(k) && typeof v === 'string' && /^\s*javascript:/i.test(v)) bad.push('URL ' + k);
      if (typeof v === 'string') strs.push(v);
    });
    Object.keys(n.dataset || {}).forEach((k) => strs.push(String(n.dataset[k])));
    (n.childNodes || []).forEach(walk);
  })(root);
  return { bad, strs };
}
/* 部品に実行される形が無く、悪い値が文字のまま（崩れず・落とされず）残っていること。HTML の文字列も入れていないこと */
function safeAndKept(root, values) {
  const a = audit(root);
  const joined = a.strs.join('\n');
  const lost = values.filter((v) => !a.strs.some((s) => s.includes(v)) && !joined.includes(v));
  return { ok: a.bad.length === 0 && lost.length === 0, info: a.bad.concat(lost.map((v) => '文字として残っていない: ' + v)).join(' / ') };
}
function quiet() { return { log() {}, warn() {}, error() {} }; }
/* 1画面ぶんを動かす。途中の例外も失敗として数え、続きの画面も調べる */
function section(title, fn) {
  console.log('\n— ' + title + ' —');
  const before = HTML_LOG.length;
  try { fn(); } catch (e) { t(title + '：例外なく動く', false, e && e.stack); }
  return HTML_LOG.slice(before);
}

/* ══════════════ T 機能訓練計画書 ══════════════ */
{
  const html = section('機能訓練計画書', () => {
    const document = fakeDoc();
    const box = { document, console: quiet(), setTimeout() { return 0; }, clearTimeout() {}, window: null };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(TPF, box);   /* 本物の様式の部品（root＝この箱に TP_FORM が付く） */
    vm.runInContext(grabFn(TP, 'mountSheet'), box);
    /* 記録由来の欄（氏名・目標・備考など）に悪い値を入れる。様式が使う欄は {{…}} の名前から集める */
    const fields = Array.from(new Set((TPF.match(/\{\{([A-Za-z0-9_]+)\}\}/g) || []).map((s) => s.slice(2, -2))));
    const plan = {};
    fields.forEach((f, i) => { plan[f] = [EVIL, BREAK, ATTR][i % 3]; });
    plan.facility = { dayFooter: EVIL };
    const sheet = box.TP_FORM.buildSheet(plan, { signature: true, doc: document });
    const r1 = safeAndKept(sheet, [EVIL, BREAK, ATTR]);
    t('T1 様式（印刷）：記録の欄に入れても実行される形にならず、文字として残る', sheet && sheet.nodeType === 1 && r1.ok, r1.info);
    const sheet2 = box.TP_FORM.buildSheet(plan, { signature: true, doc: document, editable: true, labels: { name: EVIL } });
    const r2 = safeAndKept(sheet2, [EVIL, BREAK, ATTR]);
    t('T2 様式（画面の編集）：同じ値でも実行される形にならない', sheet2 && sheet2.nodeType === 1 && r2.ok, r2.info);
    const host = new FNode('div');
    box.mountSheet(host, sheet);
    t('T3 mountSheet：作った要素はそのまま入れる（文字列の経路を通らない）', host.childNodes.length === 1 && host.childNodes[0] === sheet, host.childNodes.length);
  });
  t('T4 機能訓練計画書：HTML の文字列を一度も入れていない', html.length === 0, html.join(' | '));
}

/* ══════════════ M 申送ビューア ══════════════ */
{
  const html = section('申送ビューア', () => {
    const document = fakeDoc();
    const box = { document, console: quiet(), setTimeout() { return 0; }, clearTimeout() {}, navigator: {} };
    vm.createContext(box);
    vm.runInContext([
      'function $(id) { return document.getElementById(id); }',
      grabConst(MSK, 'SHIFT_LABEL'),
      grabFn(MSK, 'hlText'), grabFn(MSK, 'jumpBtn'), grabFn(MSK, 'sumNode'), grabFn(MSK, 'evNode')
    ].join('\n'), box);
    /* M1 該当語の印：本文・検索語に悪い値 */
    const e1 = new FNode('div');
    box.hlText(e1, '架空の記録 ' + EVIL + ' と ' + BREAK, ['img', 'script', 'onerror']);
    const r1 = safeAndKept(e1, []);
    t('M1 該当語の印（hlText）：本文に入れても実行される形にならず、印を付けても文字が1字も変わらない',
      r1.ok && e1.textContent === '架空の記録 ' + EVIL + ' と ' + BREAK && e1.children.some((c) => c.tagName === 'MARK'), r1.info + ' ' + e1.textContent);
    /* M2 AI要約（検索タブの移動ボタンつき） */
    const s = box.sumNode({ time: '9:00' + ATTR, summary: EVIL, categories: [BREAK, ATTR] }, ['img'], { label: EVIL, aria: ATTR, go() {} });
    const r2 = safeAndKept(s, [EVIL, BREAK, ATTR]);
    t('M2 AI要約（sumNode）：要約・分類・移動ボタンに入れても実行される形にならない', r2.ok, r2.info);
    /* M3 申し送り（時刻・勤務・施設・記入者・本文） */
    const ev = box.evNode({ time: ATTR, shift: BREAK, facility: EVIL, reporter: BREAK, body: EVIL + ATTR, kind: 'notice' }, '2026-10-25', ['alert'], { label: BREAK, go() {} });
    const r3 = safeAndKept(ev, [EVIL, BREAK, ATTR]);
    t('M3 申し送り（evNode）：時刻・勤務・施設・記入者・本文に入れても実行される形にならない', r3.ok, r3.info);
    const ev2 = box.evNode({ time: '10:00', shift: 'day', body: EVIL }, '2026-10-25');
    const r4 = safeAndKept(ev2, [EVIL]);
    t('M4 申し送り（検索語なし）：本文は文字のまま', r4.ok, r4.info);
  });
  t('M5 申送ビューア：HTML の文字列を一度も入れていない', html.length === 0, html.join(' | '));
}

/* ══════════════ C 接続設定 ══════════════ */
{
  const html = section('接続設定', () => {
    const document = fakeDoc();
    const ls = fakeLS({ cs_test_url: 'https://example.invalid/' + BREAK, cs_test_obj: JSON.stringify({ url: EVIL, token: 'x', extra: ATTR }) });
    const box = { document, console: quiet(), setTimeout() { return 0; }, clearTimeout() {}, localStorage: ls, window: {} };
    vm.createContext(box);
    vm.runInContext([
      'function $(id) { return document.getElementById(id); }',
      grabFn(CS, 'lsGetStr'), grabFn(CS, 'lsGetObj'), grabFn(CS, 'readCur'), grabFn(CS, 'el'), grabFn(CS, 'field'),
      grabFn(CS, 'input'), grabFn(CS, 'setRes'), grabFn(CS, 'facText'), grabFn(CS, 'buildCard')
    ].join('\n'), box);
    /* 系統の名前・説明は画面の固定表だが、端末に保存された URL・追加の欄（端末の値）は外から来る */
    const c1 = box.buildCard({ id: 'a', title: EVIL, apps: BREAK, liveWriteback: ATTR, shape: 'str', key: 'cs_test_url' });
    const r1 = safeAndKept(c1.node, [EVIL, BREAK, ATTR]);
    t('C1 系統の欄（buildCard・1つの値の形）：名前・説明・端末の URL に入れても実行される形にならない', r1.ok, r1.info);
    const c2 = box.buildCard({ id: 'b', title: '架空の系統', apps: '説明', shape: 'obj', key: 'cs_test_obj', urlF: 'url', tokenF: 'token',
      extra: { field: 'extra', label: BREAK, hint: ATTR } });
    const r2 = safeAndKept(c2.node, [EVIL, BREAK, ATTR]);
    t('C2 系統の欄（buildCard・まとめた形）：端末の URL・追加の欄に入れても value のまま', r2.ok, r2.info);
    const res = new FNode('p');
    box.setRes(res, 'ng', EVIL + BREAK);
    const r3 = safeAndKept(res, [EVIL, BREAK]);
    t('C3 接続確認の結果の文（setRes・サーバーの応答から作る文）：文字として入る', r3.ok && res.textContent === '⚠ ' + EVIL + BREAK, r3.info);
  });
  t('C4 接続設定：HTML の文字列を一度も入れていない', html.length === 0, html.join(' | '));
}

/* ══════════════ S 全支援の週間俯瞰 ══════════════ */
{
  const html = section('全支援の週間俯瞰', () => {
    for (const role of ['office', 'field']) {
      const document = fakeDoc();
      const box = { document, console: quiet(), setTimeout() { return 0; }, clearTimeout() {}, localStorage: fakeLS({ su_device_role: role }) };
      vm.createContext(box);
      vm.runInContext([
        grabConst(SO, 'DAYS_JA'), grabConst(SO, 'HOUR_PX'), 'var SLOT = 15;', grabConst(SO, 'GAP_RATIO'), grabConst(SO, 'GAP_MIN'),
        grabConst(SO, 'SVC_CLS'), grabConst(SO, 'SOGO_LABEL'), grabConst(SO, '\\$'), 'var MASKS = { cuts: {} };',
        grabFn(SO, 'codeClass'), grabFn(SO, 'codeLabel'), grabFn(SO, 'minToLabel'),
        grabFn(SO, 'ovIsField_'), grabFn(SO, 'ovBareName_'), grabFn(SO, 'ovSplitName_'), grabFn(SO, 'ovNameLabeler_'),
        grabFn(SO, 'computeDomain'), grabFn(SO, 'computeGaps'), grabFn(SO, 'assignLayout'), grabFn(SO, 'render')
      ].join('\n'), box);
      const blk = (dow, name, code) => ({ dow, s: 540, e: 600, name, code, cls: 'oth', est: 'hi', persist: 1, n: 8, N: 8, zone: 'visit', currentlyHosp: false });
      const byDow = [[blk(0, EVIL, BREAK)], [blk(1, BREAK + ' ' + ATTR, ATTR)], [], [], [], [], []];
      const observed = byDow.map(() => new Set([1]));
      const coverage = byDow.map(() => ({}));
      box.render({ byDow, observed, coverage }, 8, 'fac');
      const r = safeAndKept(document.getElementById('bCanvas'), role === 'office' ? [EVIL, BREAK, ATTR] : [BREAK, ATTR]);
      t('S1 盤面（render・' + (role === 'office' ? '事務所PC' : '現場端末') + '）：氏名・支援コードに入れても実行される形にならず、文字として残る', r.ok, r.info);
    }
  });
  t('S2 全支援の週間俯瞰：HTML の文字列を一度も入れていない', html.length === 0, html.join(' | '));
}

/* ══════════════ V 訪問支援の週間俯瞰 ══════════════ */
{
  const html = section('訪問支援の週間俯瞰', () => {
    for (const role of ['office', 'field']) {
      const document = fakeDoc();
      const box = { document, console: quiet(), setTimeout() { return 0; }, clearTimeout() {}, localStorage: fakeLS({ su_device_role: role }) };
      vm.createContext(box);
      vm.runInContext([
        grabConst(VO, 'DAYS_JA'), grabConst(VO, 'HOUR_PX'), grabConst(VO, 'SVC_CLS'), grabConst(VO, 'SOGO_LABEL'), grabConst(VO, '\\$'), "var VIEW = 'fac';",
        'function voApplyHosp() {}',
        grabFn(VO, 'codeClass'), grabFn(VO, 'codeLabel'), grabFn(VO, 'toMin'), grabFn(VO, 'minToLabel'),
        grabFn(VO, 'ovIsField_'), grabFn(VO, 'ovBareName_'), grabFn(VO, 'ovSplitName_'), grabFn(VO, 'ovNameLabeler_'), grabFn(VO, 'ovCutsFrom_'),
        grabFn(VO, 'collectVisits'), grabFn(VO, 'computeDomain'), grabFn(VO, 'assignLayout'), grabFn(VO, 'render')
      ].join('\n'), box);
      const ev = (d, cat) => ({ serviceType: 'visit', dayOfWeek: d, startTime: '09:00', endTime: '10:00', category: cat });
      box.render({ residents: [
        { name: EVIL, hospitalized: true, events: [ev(0, BREAK), ev(2, ATTR)] },
        { name: BREAK + ' ' + ATTR, events: [ev(0, EVIL)] }
      ] });
      const r = safeAndKept(document.getElementById('bCanvas'), role === 'office' ? [EVIL, BREAK, ATTR] : [BREAK, ATTR]);
      t('V1 盤面（render・' + (role === 'office' ? '事務所PC' : '現場端末') + '）：氏名・支援コードに入れても実行される形にならず、文字として残る', r.ok, r.info);
    }
  });
  t('V2 訪問支援の週間俯瞰：HTML の文字列を一度も入れていない', html.length === 0, html.join(' | '));
}

/* ══════════════ G 家族構成図（一覧はクラウドを待つ async なので最後に調べる） ══════════════ */
(async () => {
  console.log('\n— 家族構成図 —');
  const before = HTML_LOG.length;
  let sel = null;
  try {
    const document = fakeDoc();
    const box = {
      document, console: quiet(), setTimeout() { return 0; }, clearTimeout() {},
      listDocs: () => [{ name: EVIL, updatedAt: '2026-10-01T00:00:00Z' }, { name: '架空 太郎の家族' + ATTR, updatedAt: '2026-10-02T00:00:00Z' }],
      CloudSync: {
        isConfigured: () => true,
        list: () => Promise.resolve([{ name: BREAK, updatedAt: '2026-10-03T00:00:00Z', updatedBy: EVIL }, { name: EVIL, updatedAt: '2026-10-04T00:00:00Z', updatedBy: ATTR }])
      }
    };
    vm.createContext(box);
    vm.runInContext([grabConst(GENO, '\\$'), grabFn(GENO, 'parseTs'), grabFn(GENO, 'fmtTsLabel'), grabFn(GENO, 'refreshDocList')].join('\n'), box);
    sel = document.getElementById('docList');
    await box.refreshDocList();
  } catch (e) { t('家族構成図：例外なく動く', false, e && e.stack); }
  const html = HTML_LOG.slice(before);
  const r1 = sel ? safeAndKept(sel, [EVIL, BREAK, ATTR]) : { ok: false, info: '一覧が作られていない' };
  t('G1 保存済みの一覧（refreshDocList）：図の名前・最後に直した人に入れても実行される形にならず、文字として残る',
    r1.ok && !!sel && sel.children.length === 3, r1.info + ' 件数=' + (sel && sel.children.length));
  t('G2 一覧の先頭行だけが固定の HTML（ほかの文字列は入れていない）',
    html.length === 1 && html[0] === '<option value="">— 保存済みから読込 —</option>', html.join(' | '));
  finish();
})();

function finish() {
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
}
