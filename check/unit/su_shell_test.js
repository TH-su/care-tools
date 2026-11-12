/* 見出しの共通の部品（su-shell.js・su-shell.css）の試験（2026-11-12 商用90点・案1 第2段・代表者の決定 2026-11-12「推奨どおりで」）
   実行: node check/unit/su_shell_test.js
   守ること:
     1. 役割の札は、ログインの確かめが「使える」の時だけ、メニューの帯と同じ3つの文のどれかを出す。それ以外（ログインしていない・失敗・知らない役割）は出さない
     2. su-auth.js が後から現れても、待ってから1回だけ聞く。現れなければ聞かない。部品から su-auth.js を読み込まない
     3. 枠（iframe）の中では出さない。端末に何も書かない。二重に読み込んでも1つ。例外を外に出さない
     4. 管理者向け3画面: 「‹ 戻る」の右に「← メニュー」（index.html）が1本・題の右に札の場所が1つ・部品の版がそろう・印刷で消す
     5. ログインの画面には当てない */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('su-shell.js');
const CSS = read('su-shell.css');

let ok = 0, ng = 0;
function t(name, cond, info) {
  if (cond) { ok++; console.log('  ✓ ' + name); }
  else { ng++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

/* 架空の画面を作って部品を動かす */
function env(opts) {
  opts = opts || {};
  const cls = new Set();
  const hdr = { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
  const slot = { textContent: '', hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    closest: (sel) => (sel === '.su-shell-hdr' ? hdr : null) };
  const winL = {}, docL = {};
  const timers = [];
  const writes = [];
  const store = { setItem: (k) => writes.push(k), getItem: () => null, removeItem: (k) => writes.push(k) };
  const win = {
    SUAuth: opts.auth,
    localStorage: store, sessionStorage: store,
    Promise,
    addEventListener: (k, fn) => { (winL[k] = winL[k] || []).push(fn); },
  };
  win.top = opts.inFrame ? {} : win; win.self = win;
  const doc = {
    readyState: opts.loading ? 'loading' : 'complete',
    querySelectorAll: (sel) => (sel === '.su-shell-role' && !opts.noSlot ? [slot] : []),
    addEventListener: (k, fn) => { (docL[k] = docL[k] || []).push(fn); },
  };
  const ctx = {
    window: win, document: doc, Promise,
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval: (id) => { timers[id - 1] = null; },
  };
  ctx.window.window = win;
  vm.createContext(ctx);
  const load = () => vm.runInContext(SRC, ctx);
  const tick = (n) => { for (let i = 0; i < n; i++) timers.forEach((f) => f && f()); };
  const fire = (target, k, ev) => ((target === 'doc' ? docL : winL)[k] || []).forEach((fn) => fn(ev || {}));
  return { ctx, slot, load, tick, writes, win, cls, fire };
}
const STATUS = { OK: 'ok', SIGNED_OUT: 'signed_out', ERROR: 'error' };
const auth = (res, counter) => ({ STATUS, check: () => { if (counter) counter.n++; return res instanceof Error ? Promise.reject(res) : Promise.resolve(res); } });
const flush = () => new Promise((r) => setImmediate(r));

(async () => {
  console.log('1 役割の文');
  for (const [role, text] of [['admin', '管理者としてログイン中'], ['office', '事務所としてログイン中'], ['field', '現場としてログイン中']]) {
    const e = env({ auth: auth({ status: 'ok', role }) });
    e.load(); await flush();
    t(role + ' → 「' + text + '」を出す', e.slot.textContent === text && e.slot.hidden === false && e.slot.attrs.role === 'status', e.slot);
  }
  for (const [label, res] of [['ログインしていない', { status: 'signed_out' }], ['確かめの失敗', { status: 'error' }], ['知らない役割', { status: 'ok', role: 'boss' }], ['例外', new Error('x')], ['空の答え', null]]) {
    const e = env({ auth: auth(res) });
    e.load(); await flush();
    t(label + ' → 札を出さない', e.slot.hidden === true && e.slot.textContent === '', e.slot);
  }


  console.log('1b 見出しの2段の印・読み込み中・戻った時');
  {
    const e = env({ auth: auth({ status: 'ok', role: 'admin' }) });
    e.load(); await flush();
    t('札が出ている時だけ見出しに su-shell-on を付ける', e.cls.has('su-shell-on'));
    e.ctx.window.SUShell._draw('');
    t('札を隠すと印も外す', !e.cls.has('su-shell-on'));
  }
  {
    const c = { n: 0 };
    const e = env({ auth: auth({ status: 'ok', role: 'office' }, c), loading: true });
    e.load(); await flush();
    t('読み込み中はまだ聞かない', c.n === 0);
    e.fire('doc', 'DOMContentLoaded'); await flush();
    t('DOMContentLoaded の後に聞いて出す', c.n === 1 && e.slot.textContent === '事務所としてログイン中');
  }
  {
    const c = { n: 0 };
    let res = { status: 'ok', role: 'admin' };
    const e = env({ auth: { STATUS, check: () => { c.n++; return Promise.resolve(res); } } });
    e.load(); await flush();
    res = { status: 'signed_out' };
    e.fire('win', 'pageshow', { persisted: false }); await flush();
    t('ふつうの pageshow では聞き直さない', c.n === 1);
    e.fire('win', 'pageshow', { persisted: true }); await flush();
    t('「戻る」で戻った時は聞き直し、ログアウトしていれば札を消す', c.n === 2 && e.slot.hidden === true && !e.cls.has('su-shell-on'));
  }
  t('hidden の札は必ず隠れる（display:inline-flex より強い指定）', /\.su-shell-role\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(CSS));
  {
    /* 699px 以下の折り返しは札が出ている時（su-shell-on）だけ。札なしでも折り返すのは、文字を大きくした iPhone（299px 以下）で題を2段目に置く時だけ */
    const blocks = [...CSS.matchAll(/@media screen and \(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => ({ w: Number(m[1]), body: m[2] }));
    const b699 = blocks.find((b) => b.w === 699), b299 = blocks.find((b) => b.w === 299);
    t('699px 以下の折り返しは札が出ている時（su-shell-on）だけ', !!b699 && /\.hdr\.su-shell-hdr\.su-shell-on\s*\{\s*flex-wrap:\s*wrap/.test(b699.body) && !/\.hdr\.su-shell-hdr\s*\{[^}]*flex-wrap/.test(b699.body));
    t('札なしの折り返しは 299px 以下の塊の中だけ', !!b299 && /\.hdr\.su-shell-hdr\s*\{[^}]*flex-wrap:\s*wrap/.test(b299.body)
      && blocks.filter((b) => b.w > 299).every((b) => !/\.hdr\.su-shell-hdr\s*\{[^}]*flex-wrap/.test(b.body)) && !/^\.hdr\.su-shell-hdr\s*\{[^}]*flex-wrap/m.test(CSS));
  }
  t('PC の見出しの高さを変えない（札の上下の余白を -6px で収める）', /\.su-shell-role\s*\{[^}]*margin:\s*-6px 0;/.test(CSS));

  console.log('2 後から現れる su-auth.js');
  {
    const c = { n: 0 };
    const e = env({});
    e.load(); await flush();
    t('SUAuth が無い間は札を出さない', e.slot.hidden === true);
    e.win.SUAuth = auth({ status: 'ok', role: 'office' }, c);
    e.tick(1); await flush();
    e.tick(5); await flush();
    t('現れたら1回だけ聞いて出す', c.n === 1 && e.slot.textContent === '事務所としてログイン中', { n: c.n, s: e.slot.textContent });
  }
  {
    const e = env({});
    e.load(); e.tick(20); await flush();
    t('現れなければ聞かずに札を出さない', e.slot.hidden === true);
  }
  t('部品から su-auth.js を読み込まない', !/su-auth\.js['"]/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')) && !/createElement\(\s*['"]script/.test(SRC));

  console.log('3 守り');
  {
    const c = { n: 0 };
    const e = env({ auth: auth({ status: 'ok', role: 'admin' }, c), inFrame: true });
    e.load(); await flush();
    t('枠の中では聞かず出さない', c.n === 0 && e.slot.hidden === true);
  }
  {
    const c = { n: 0 };
    const e = env({ auth: auth({ status: 'ok', role: 'admin' }, c), noSlot: true });
    e.load(); await flush();
    t('札の場所の無い画面では聞かない', c.n === 0);
  }
  {
    const c = { n: 0 };
    const e = env({ auth: auth({ status: 'ok', role: 'admin' }, c) });
    e.load(); e.load(); await flush();
    t('二重に読み込んでも1回だけ', c.n === 1);
    t('端末に何も書かない', e.writes.length === 0, e.writes);
  }
  {
    const e = env({ auth: { STATUS, get check() { throw new Error('壊れた'); } } });
    let threw = false;
    try { e.load(); await flush(); } catch (err) { threw = true; }
    t('su-auth が壊れていても例外を外に出さない', !threw && e.slot.hidden === true);
  }
  t('文は textContent で入れる（innerHTML を使わない）', !/innerHTML/.test(SRC));
  t('印刷では「← メニュー」と札を消す', /@media print\s*\{[^}]*\.su-menu-back[^}]*\.su-shell-role[^}]*display:\s*none\s*!important/.test(CSS));
  t('札の字と地の差 7:1 以上（藍 #1F2A44 と白）', /background:\s*#fff;\s*color:\s*#1F2A44/i.test(CSS));

  console.log('4 管理者向け3画面');
  const vJs = (SRC && (read('accounts.html').match(/su-shell\.js\?v=([^"]+)"/) || [])[1]);
  const vCss = (read('accounts.html').match(/su-shell\.css\?v=([^"]+)"/) || [])[1];
  for (const f of ['accounts.html', 'app-access.html', 'menu-settings.html']) {
    const s = read(f).replace(/<!--[\s\S]*?-->/g, '');
    const hdr = (s.match(/<header class="hdr su-shell-hdr">([\s\S]*?)<\/header>/) || [])[1] || '';
    const backAt = hdr.indexOf('href="login.html"'), menuAt = hdr.indexOf('<a class="back su-menu-back" href="index.html" aria-label="メニューへ戻る">← メニュー</a>');
    const h1At = hdr.indexOf('<h1>'), roleAt = hdr.indexOf('<span class="su-shell-role" hidden></span>');
    t(f + ': 「‹ 戻る」の右に「← メニュー」が1本', backAt >= 0 && menuAt > backAt && hdr.split('su-menu-back').length === 2, { backAt, menuAt });
    t(f + ': 題の右に札の場所が1つ', h1At > menuAt && roleAt > h1At && hdr.split('su-shell-role').length === 2);
    t(f + ': 部品の版がそろう', (s.match(/su-shell\.js\?v=([^"]+)"/) || [])[1] === vJs && (s.match(/su-shell\.css\?v=([^"]+)"/) || [])[1] === vCss && !!vJs && !!vCss);
    const iA = s.indexOf('<script src="su-auth.js'), iS = s.indexOf('<script src="su-shell.js');
    t(f + ': su-auth.js の後で su-shell.js を読む', iA >= 0 && iS > iA);
  }
  console.log('5 当てない画面');
  for (const f of ['login.html', 'index.html']) t(f + ': su-shell.js を読まない', read(f).indexOf('su-shell.js') < 0);

  console.log('\n結果: 成功 ' + ok + ' / 失敗 ' + ng);
  process.exit(ng ? 1 : 0);
})();
