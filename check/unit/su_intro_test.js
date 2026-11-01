/* 見出しの下の初回の案内の帯（su-intro.js・2026-11-02 本人の決定「この文言で作る」）の試験。架空の画面だけを使う。
   守りたいこと:
     A 8画面の文言が本人の決定と一字一句同じ（左右比較は2行だけ）
     B 見出しの入れ物（body 直下の .hdr）の直後に入れる・×（案内を閉じる）で閉じて印を残す
     C 枠（iframe）の中では出さない・閉じた印がある端末では出さない・知らない画面では何もしない
     D localStorage が投げても例外を外に出さず、帯は出す
     E 印刷で消える CSS がある・CSS を外から読む（<style> を差し込まない）・文字の入れ方・公開のホワイトリスト
     F 8画面が同じ版の su-intro.js を読み込んでいる
   実行: node check/unit/su_intro_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('su-intro.js');
const CSS = read('su-intro.css');
const GI = read('.gitignore');
let ok = 0, ng = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const HELP = '困った時：画面の「不具合を報告」ボタンから知らせてください。';
const EXPECT = {
  'daycare-roster': ['この画面でできること：デイの利用日と時間を、帳票（利用表・利用者一覧・全員リスト・薬用・週間名簿）で見て印刷します。', 'はじめに：上のタブで帳票を選び、「印刷」で紙にします。', HELP],
  'facesheet': ['この画面でできること：入居者お一人ずつの基本情報を1枚で見て、印刷します。', 'はじめに：「入居者を検索」に氏名・ふりがな・居室を入れて、一覧から選びます。', HELP],
  'support-overview': ['この画面でできること：施設の支援の配置を、何週か重ねて1枚に並べ、支援の薄い時間帯を見つけます。', 'はじめに：「重ね週数」を選んで「更新」を押すと集計します。', HELP],
  'visit-overview': ['この画面でできること：訪問の予定（週間計画）を、月〜日の1枚に並べて見ます。', 'はじめに：上の「施設」「外部」で、見る利用者を切り替えます。', HELP],
  'overview-compare': ['はじめに：片方を動かすと、もう片方も同じ時刻・曜日にそろいます（「連動」を外すと別々に動きます）。', HELP],
  'admission-flow': ['この画面でできること：入居のご相談から入居まで、案件ごとの進み具合と、今日やることを管理します。', 'はじめに：下の「今日」でやることを確かめ、新しいご相談は右下の「＋」で足します。くわしくは下の「使い方」へ。', HELP],
  'patch-calendar': ['この画面でできること：貼り薬の貼る場所の順番を、月のカレンダーにして印刷します。', 'はじめに：「入居者」と「開始日」を選び、年月を確かめてから「印刷」を押します。', HELP],
  'resident-master': ['この画面でできること：入居者の情報の確かめと直し、帳票（食形態・ケアマネ一覧・居室一覧など）の印刷をします。', 'はじめに：検索欄に氏名・ふりがな・居室を入れて選ぶか、上のタブで帳票を選びます。', HELP],
};

/* 偽物の DOM で su-intro.js を読み込む。CSS の link は読み込み成功（onload）として扱う */
function load(opt) {
  opt = opt || {};
  const store = new Map(Object.entries(opt.storage || {}));
  const winListeners = {};
  let docReady = null;
  function mkEl(tag) {
    return {
      tag, children: [], attrs: {}, className: '', textContent: '', style: {}, parentNode: null, listeners: {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); },
      get nextSibling() { if (!this.parentNode) return null; const s = this.parentNode.children; return s[s.indexOf(this) + 1] || null; },
    };
  }
  const body = mkEl('body');
  const hdr = mkEl('header'); hdr.className = 'hdr';
  const after = mkEl('main');
  if (opt.noHdr) body.children = [after]; else body.children = [hdr, after];
  body.children.forEach((c) => { c.parentNode = body; });
  const head = mkEl('head');
  head.appendChild = function (c) { this.children.push(c); c.parentNode = this; if (!opt.cssNever) setImmediate(() => { if (c.onload) c.onload(); }); return c; };
  const timers = [];
  const ls = {
    getItem(k) { if (opt.lsThrows) throw new Error('SecurityError'); return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { if (opt.lsThrows) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
  };
  const win = {
    addEventListener(k, fn) { (winListeners[k] = winListeners[k] || []).push(fn); },
  };
  win.self = win;
  win.top = opt.inFrame ? {} : win;
  if (opt.topThrows) Object.defineProperty(win, 'top', { get() { throw new Error('cross-origin'); } });
  Object.defineProperty(win, 'localStorage', { get() { if (opt.lsGetterThrows) throw new Error('SecurityError'); return ls; } });
  const doc = {
    body, head, readyState: opt.loading ? 'loading' : 'complete',
    createElement: mkEl,
    querySelector(sel) { if (sel !== 'body > .hdr') throw new Error('予定外のセレクタ: ' + sel); return body.children.find((c) => c.className === 'hdr') || null; },
    addEventListener(k, fn) { if (k === 'DOMContentLoaded') docReady = fn; },
  };
  const ctx = {
    window: win, document: doc, location: { pathname: opt.path || '/resident-master.html' },
    setTimeout(fn, ms) { timers.push(fn); return timers.length; },
    String, Object, Array, Error, RegExp,
  };
  let thrown = null;
  try { vm.runInNewContext(SRC, ctx, { filename: 'su-intro.js' }); } catch (e) { thrown = e; }
  return {
    thrown, body, hdr, head, store, winListeners, timers,
    ready() { if (docReady) { doc.readyState = 'interactive'; docReady(); } },
    band() { return body.children.find((c) => c.className === 'sui-band') || null; },
  };
}
const tick = () => new Promise((r) => setImmediate(r));
function texts(band) { return band.children[0].children.map((p) => p.textContent); }
function closeBtn(band) { return band.children[1]; }

(async () => {
  say('— A 8画面の文言が一字一句同じ —');
  for (const id of Object.keys(EXPECT)) {
    const r = load({ path: '/care-tools/' + id + '.html' });
    await tick();
    const b = r.band();
    t(id + ': 帯が出る', !!b);
    if (b) t(id + ': 文言（' + EXPECT[id].length + '行）が一致', JSON.stringify(texts(b)) === JSON.stringify(EXPECT[id]), texts(b));
    t(id + ': 例外を外に出さない', !r.thrown);
  }
  t('左右比較は「この画面でできること」の行が無い', !EXPECT['overview-compare'].some((l) => l.indexOf('この画面でできること') === 0));

  say('— B 置き場所と閉じる —');
  {
    const r = load({ path: '/resident-master.html' });
    await tick();
    const b = r.band();
    t('見出しの入れ物の直後に入る', r.body.children[0] === r.hdr && r.body.children[1] === b);
    t('CSS の link を su-intro.css?v=2026-11-02 で読む', r.head.children.some((c) => c.rel === 'stylesheet' && c.href === 'su-intro.css?v=2026-11-02'));
    const x = closeBtn(b);
    t('×は button・aria-label「案内を閉じる」', x.tag === 'button' && x.attrs['aria-label'] === '案内を閉じる' && x.type === 'button');
    t('帯は印刷に出さない印を持たない（data-k が無い）', !('data-k' in b.attrs));
    t('印刷の前に帯を隠す守りがある', (r.winListeners.beforeprint || []).length === 1);
    r.winListeners.beforeprint[0]();
    t('印刷の前に display:none', b.style.display === 'none');
    r.winListeners.afterprint[0]();
    t('印刷の後に戻す', b.style.display === '');
    x.listeners.click[0]();
    t('×で帯が消える', !r.band());
    t('×で su_intro_closed_resident-master に \'1\' だけ残す', r.store.get('su_intro_closed_resident-master') === '1' && r.store.size === 1);
  }
  {
    const r = load({ path: '/facesheet.html', loading: true });
    await tick();
    t('読み込み中の時は DOMContentLoaded まで待つ', !r.band());
    r.ready(); await tick();
    t('DOMContentLoaded の後に出る', !!r.band());
  }
  {
    const r = load({ path: '/facesheet.html' });
    await tick();
    r.timers.forEach((fn) => fn());
    t('CSS の到着と時間切れの両方が来ても帯は1つだけ', r.body.children.filter((c) => c.className === 'sui-band').length === 1);
  }
  {
    const r = load({ path: '/facesheet.html', cssNever: true });
    t('CSS が届く前は出さない', !r.band());
    r.timers.forEach((fn) => fn());
    t('CSS が届かない時も時間切れで帯は出る', !!r.band());
  }
  {
    const r = load({ path: '/facesheet.html', noHdr: true });
    await tick(); r.timers.forEach((fn) => fn());
    t('見出しの入れ物が無い時は何もしない・例外なし', !r.band() && !r.thrown && r.body.children.length === 1);
  }

  say('— C 出さない場面 —');
  {
    const r = load({ path: '/visit-overview.html', inFrame: true });
    await tick(); r.timers.forEach((fn) => fn());
    t('枠（iframe）の中では出さない・CSS も読まない', !r.band() && r.head.children.length === 0 && !r.thrown);
  }
  {
    const r = load({ path: '/support-overview.html', topThrows: true });
    await tick(); r.timers.forEach((fn) => fn());
    t('window.top が読めない（別オリジンの枠）時も出さない', !r.band() && !r.thrown);
  }
  {
    const r = load({ path: '/daycare-roster.html', storage: { 'su_intro_closed_daycare-roster': '1' } });
    await tick(); r.timers.forEach((fn) => fn());
    t('閉じた印がある端末では出さない・CSS も読まない', !r.band() && r.head.children.length === 0);
  }
  {
    const r = load({ path: '/daycare-roster.html', storage: { 'su_intro_closed_facesheet': '1' } });
    await tick();
    t('印は画面ごと（別の画面の印では消えない）', !!r.band());
  }
  for (const p of ['/index.html', '/care-schedule.html', '/', '/resident-master.htm', '/constructor.html', '/__proto__.html']) {
    const r = load({ path: p });
    await tick(); r.timers.forEach((fn) => fn());
    t('知らない画面（' + p + '）では何もしない', !r.band() && r.head.children.length === 0 && !r.thrown);
  }

  say('— D localStorage が投げる端末 —');
  for (const k of ['lsThrows', 'lsGetterThrows']) {
    const r = load({ path: '/patch-calendar.html', [k]: true });
    await tick();
    const b = r.band();
    t(k + ': 例外を外に出さず帯を出す', !r.thrown && !!b);
    let threw = false;
    try { closeBtn(b).listeners.click[0](); } catch (e) { threw = true; }
    t(k + ': ×を押しても例外を出さず、今の表示は閉じる', !threw && !r.band());
  }

  say('— E 部品の作り —');
  const C = code(SRC);
  t('innerHTML を使っていない（コメントにも書かない）', SRC.indexOf('innerHTML') < 0 && SRC.indexOf('insertAdjacentHTML') < 0 && SRC.indexOf('outerHTML') < 0);
  t('<style> を差し込まない', !/createElement\(\s*['"]style['"]\s*\)/.test(C));
  t('console を使わない', !/console\./.test(C));
  t('通信しない（fetch・XMLHttpRequest・sendBeacon が無い）', !/fetch\(|XMLHttpRequest|sendBeacon/.test(C));
  t('localStorage に書くのは su_intro_closed_ の印だけ', (C.match(/setItem\(/g) || []).length === 1 && /var KEY = 'su_intro_closed_' \+ ID;/.test(C) && /setItem\(KEY, '1'\)/.test(C));
  t('全体を try で包む（例外を外に出さない）', /^\(function \(\) \{\n  'use strict';\n  try \{\n/m.test(SRC) && /\} catch \(e\) \{ \/\* 例外を外に出さない \*\/ \}\n\}\)\(\);\n$/.test(SRC));
  t('印刷で帯を消す CSS がある', /@media print\{\.sui-band\{display:none!important\}\}/.test(CSS));
  t('帯は flex の並びで潰れない（flex:0 0 auto）', /\.sui-band\{flex:0 0 auto;/.test(CSS));
  t('×は 44px 以上', /\.sui-x\{[^}]*min-width:44px;min-height:44px;/.test(CSS));
  t('文字は折り返す（overflow-wrap:anywhere）', /overflow-wrap:anywhere/.test(CSS));
  t('公開のホワイトリストに su-intro.js・su-intro.css がある', /^!\/su-intro\.js$/m.test(GI) && /^!\/su-intro\.css$/m.test(GI));
  /* 色のコントラスト（地と文字・×の地と文字）が 7:1 以上 */
  function lum(h) { const c = [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  const band = /\.sui-band\{[^}]*background:(#[0-9a-f]{6});color:(#[0-9a-f]{6});/.exec(CSS) || [];
  const xb = /\.sui-x\{[^}]*background:(#[0-9a-f]{6});color:(#[0-9a-f]{6});/.exec(CSS) || [];
  const xh = /\.sui-x:hover\{background:(#[0-9a-f]{6})\}/.exec(CSS) || [];
  t('帯の文字のコントラスト 7:1 以上', band[1] && ratio(band[1], band[2]) >= 7, band[1] && ratio(band[1], band[2]).toFixed(2));
  t('×の文字のコントラスト 7:1 以上（ふだん・押す前）', xb[1] && ratio(xb[1], xb[2]) >= 7 && xh[1] && ratio(xh[1], xb[2]) >= 7);

  say('— F 8画面が読み込んでいる —');
  for (const id of Object.keys(EXPECT)) {
    const html = read(id + '.html');
    const tags = html.match(/<script src="su-intro\.js\?v=[^"]+"><\/script>/g) || [];
    t(id + '.html: su-intro.js?v=2026-11-02 を1回だけ読む', tags.length === 1 && tags[0] === '<script src="su-intro.js?v=2026-11-02"></script>', tags);
    t(id + '.html: 見出しの入れ物（body 直下の .hdr）が1つある', (html.match(/<(?:header|div) class="hdr(?: noprint)?">/g) || []).length === 1);
  }
  const all = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && /su-intro\.js/.test(read(f)));
  t('su-intro.js を読む画面は8画面だけ', all.length === 8 && all.every((f) => EXPECT[f.replace(/\.html$/, '')]), all);

  say('\n' + (ng ? '✗' : '✓') + ' su_intro: 成功 ' + ok + '／失敗 ' + ng);
  process.exit(ng ? 1 : 0);
})();
