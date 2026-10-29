/* メニューの設定（menu-settings.html・menu-settings.js）の「メニューの毬の柄（施設の既定）」の試験（2026-10-26 代表者の決定）
   実行: node check/unit/menu_settings_ball_test.js
   守ること:
     1 保存の規則: 麻の葉の時だけ ball:'asanoha' を書く。菊かがりは書かない（無い＝菊かがり）
     2 麻の葉を保存 → ほかの設定（役割の表示）だけ直して保存 → 柄は残る
     3 「既定に戻す」で菊かがりに戻る。確かめの文に「毬の柄（施設の既定）」が入る
     4 データベースがまだ柄を受け付けない（移行 0025 の前・badshape）時は NEED_0025 の案内。形が違う（badball）時の文
     5 見本は毬の部品が描く。部品が無くても選べて保存できる
     6 画面の決まり: CSP は style を許さないまま・部品の版をそろえる・欄の見出しと1行の説明
   画面のコードは書き換えず、そのまま読み込んで小さな DOM と偽のログイン・データベースで動かす（通信しない・架空の設定だけ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGE = read('menu-settings.html');
const JS = read('menu-settings.js');
const MENU_SRC = read('su-menu.js');
const BALL_SRC = read('su-itomari.js');
const INDEX = read('index.html');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

/* ── 小さな DOM（この画面に要る分だけ）── */
function makeEl(tag, ns) {
  const e = {
    tagName: ns ? tag : String(tag).toUpperCase(), attrs: {}, children: [], parentNode: null, _text: '', listeners: {},
    hidden: false, disabled: false, checked: false, value: '', type: '', className: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { if (c.isFrag) { c.children.slice().forEach(x => this.appendChild(x)); c.children = []; return c; } c.parentNode = this; this.children.push(c); return c; },
    replaceChildren(...cs) { this.children = []; cs.forEach(c => this.appendChild(c)); },
    get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); },
    set textContent(v) { this._text = String(v); this.children = []; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    fire(ev) { (this.listeners[ev] || []).forEach(fn => fn({ target: this, key: '', preventDefault() {} })); },
    click() { if (!this.disabled) this.fire('click'); },
    focus() {}, select() {}, scrollIntoView() {},
    walk(fn) { for (const c of this.children) { if (c && c.tagName) { fn(c); c.walk(fn); } } },
    querySelectorAll(sel) { const out = []; if (sel === 'button[data-focus]') this.walk(c => { if (c.tagName === 'BUTTON' && 'data-focus' in c.attrs) out.push(c); }); return out; },
    querySelector() { return null; }
  };
  return e;
}
const DEF_JSON = INDEX.slice(INDEX.indexOf('>', INDEX.indexOf('id="menuDef"')) + 1, INDEX.indexOf('</script>', INDEX.indexOf('id="menuDef"')));

/* 画面を動かす。db: {config, accepts(cfg)→{ok,error}}。itomari=false で毬の部品を読まない */
function run(opt) {
  opt = opt || {};
  const ids = {};
  ['msg', 'v-loading', 'v-gate', 'v-admin', 'gate-why', 'secs', 'state', 'b-save', 'b-undo', 'b-reset'].forEach(id => { ids[id] = makeEl(id === 'secs' ? 'div' : 'section'); ids[id].id = id; });
  ['b-save', 'b-undo', 'b-reset'].forEach(id => { ids[id].tagName = 'BUTTON'; });
  const radios = ['kiku', 'asanoha'].map(v => { const r = makeEl('input'); r.type = 'radio'; r.value = v; r.name = 'ball'; return r; });
  const pvs = ['kiku', 'asanoha'].map(v => { const s = makeEl('span'); s.setAttribute('data-ball', v); return s; });
  const db = { config: opt.config === undefined ? null : opt.config, puts: [], updatedAt: 't0' };
  const confirms = [];
  const box = {
    JSON, Array, String, Object, Error, Math, Number, Promise, setTimeout, isFinite, parseInt, Date,
    document: {
      readyState: 'complete',
      getElementById: id => ids[id] || null,
      createElement: tag => makeEl(tag),
      createElementNS: (ns, tag) => makeEl(tag, ns),
      createTextNode: s => ({ textContent: String(s) }),
      createDocumentFragment: () => { const f = makeEl('frag'); f.isFrag = true; return f; },
      querySelectorAll: sel => (sel === '#ball-card input[name="ball"]' ? radios : sel === '#ball-card .ms-ball-pv' ? pvs : []),
      getElementsByTagName: () => []
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
    fetch: async () => ({ ok: true, status: 200, text: async () => INDEX }),
    DOMParser: function () { this.parseFromString = () => ({ getElementById: id => (id === 'menuDef' ? { textContent: DEF_JSON } : null) }); },
    confirm: m => { confirms.push(m); return true; },
    location: { reload() {} },
    addEventListener() {}, removeEventListener() {},
    SUAuth: {
      STATUS: { OK: 'ok', MFA_VERIFY: 'mfa', MFA_ENROLL: 'enroll', SIGNED_OUT: 'out', ERROR: 'error' },
      check: async () => ({ status: 'ok', role: 'admin' }),
      client: () => ({ rpc: async (name, args) => {
        if (name === 'menu_get') return { data: { ok: true, role: 'admin', config: db.config, updatedAt: db.updatedAt } };
        if (name === 'menu_put') {
          const cfg = args.p_config == null ? null : JSON.parse(JSON.stringify(args.p_config));
          db.puts.push(cfg);
          const r = opt.accepts ? opt.accepts(cfg) : { ok: true };
          if (!r.ok) return { data: { ok: false, error: r.error } };
          db.config = cfg; db.updatedAt = 't' + db.puts.length;
          return { data: { ok: true, updatedAt: db.updatedAt } };
        }
        return { error: { code: 'PGRST202', message: name } };
      } })
    }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(MENU_SRC, box);
  if (opt.itomari !== false) vm.runInContext(BALL_SRC, box);
  vm.runInContext(JS, box);
  const tick = () => new Promise(r => setImmediate(r));
  const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };
  const pick = v => { const r = radios.find(x => x.value === v); radios.forEach(x => { x.checked = x === r; }); r.fire('change'); };
  const firstCheckbox = () => { let c = null; ids.secs.walk(x => { if (!c && x.tagName === 'INPUT' && x.type === 'checkbox' && !x.disabled) c = x; }); return c; };
  return { ids, radios, pvs, db, confirms, settle, pick, firstCheckbox, box };
}

(async function main() {
  console.log('\n— 1・2. 保存の規則と柄が残ること —');
  {
    const p = run({ config: null });
    await p.settle();
    t('1a 開いた時（設定なし）は菊かがりが選ばれ、保存のボタンは押せない', p.ids['v-admin'].hidden === false && p.radios[0].checked && !p.radios[1].checked && p.ids['b-save'].disabled, [p.ids['v-admin'].hidden, p.radios.map(r => r.checked)]);
    p.pick('asanoha');
    t('1b 麻の葉を選ぶと「保存していない変更があります」・保存のボタンが押せる', !p.ids['b-save'].disabled && /保存していない変更があります/.test(p.ids.state.textContent), p.ids.state.textContent);
    p.ids['b-save'].click(); await p.settle();
    t('1c 麻の葉で保存すると ball:"asanoha" を書く', p.db.puts.length === 1 && p.db.puts[0].ball === 'asanoha', p.db.puts);
    t('1d 保存の後は麻の葉のまま・変更なし', p.radios[1].checked && p.ids['b-save'].disabled, p.radios.map(r => r.checked));
    const cb = p.firstCheckbox();
    cb.checked = false; cb.fire('change');
    p.ids['b-save'].click(); await p.settle();
    t('2a ほかの設定（役割の表示）だけ直して保存しても、柄（ball:"asanoha"）は残る', p.db.puts.length === 2 && p.db.puts[1].ball === 'asanoha'
      && Object.keys(p.db.puts[1].hide).some(r => p.db.puts[1].hide[r].length === 1), p.db.puts[1]);
    p.pick('kiku');
    p.ids['b-save'].click(); await p.settle();
    t('1e 菊かがりに戻して保存すると ball を書かない（無い＝菊かがり）', p.db.puts.length === 3 && !('ball' in p.db.puts[2]), p.db.puts[2]);
  }
  {
    const p = run({ config: { ver: 1, ball: 'asanoha', hide: { field: ['weight-record.html'] } } });
    await p.settle();
    t('2b 保存済みの麻の葉を読んで、麻の葉が選ばれる', p.radios[1].checked && !p.radios[0].checked, p.radios.map(r => r.checked));
    const cb = p.firstCheckbox();
    cb.checked = false; cb.fire('change');
    p.ids['b-save'].click(); await p.settle();
    t('2c 開き直した画面でほかの設定だけ直して保存しても、柄は残る', p.db.puts.length === 1 && p.db.puts[0].ball === 'asanoha', p.db.puts);
    p.pick('kiku');
    p.ids['b-undo'].click(); await p.settle();
    t('2d 「変更を取り消す」で保存済みの麻の葉に戻る', p.radios[1].checked, p.radios.map(r => r.checked));
  }
  {
    const p = run({ config: { ver: 1, ball: 'kiku' } });
    await p.settle();
    t('1f 不正な ball（"kiku" を書いた古い設定）は菊かがりとして読み、保存の時は書かない', p.radios[0].checked && p.ids['b-save'].disabled, p.radios.map(r => r.checked));
  }

  console.log('\n— 3. 既定に戻す —');
  {
    const p = run({ config: { ver: 1, ball: 'asanoha' } });
    await p.settle();
    p.ids['b-reset'].click(); await p.settle();
    const msg = p.confirms[p.confirms.length - 1] || '';
    t('3a 確かめの文に「毬の柄（施設の既定）」が入る', msg.indexOf('毬の柄（施設の既定）') >= 0 && /ボタンの移動・毬の柄（施設の既定）の設定は消えます。/.test(msg), msg);
    t('3b 既定に戻すと設定を消し（null）、菊かがりに戻る', p.db.puts.length === 1 && p.db.puts[0] === null && p.radios[0].checked, [p.db.puts, p.radios.map(r => r.checked)]);
  }

  console.log('\n— 4. データベースが断った時の文 —');
  {
    const p = run({ config: null, accepts: cfg => (cfg && 'ball' in cfg ? { ok: false, error: 'badshape' } : { ok: true }) });
    await p.settle();
    p.pick('asanoha');
    p.ids['b-save'].click(); await p.settle();
    const m = p.ids.msg.textContent;
    t('4a 移行 0025 の前（ball を badshape で断る）: 0025 が要ることと、菊かがりに戻せば保存できることを出す', /移行 0025/.test(m) && /「菊かがり」に戻す/.test(m) && !/badshape/.test(m), m);
    t('4b 断られた時は保存しない・麻の葉の選択は画面に残る', p.db.config === null && p.radios[1].checked && !p.ids['b-save'].disabled, [p.db.config, p.radios.map(r => r.checked)]);
    p.pick('kiku');
    const cb = p.firstCheckbox(); cb.checked = false; cb.fire('change');
    p.ids['b-save'].click(); await p.settle();
    t('4c 0025 の前でも、菊かがりのままならほかの変更は保存できる', p.db.config && !('ball' in p.db.config), p.db.config);
  }
  {
    const p = run({ config: null, accepts: () => ({ ok: false, error: 'badball' }) });
    await p.settle();
    p.pick('asanoha');
    p.ids['b-save'].click(); await p.settle();
    const m = p.ids.msg.textContent;
    t('4d 形が違う（badball）: 職員に分かる文を出す（技術の語を出さない）', /毬の柄の形が正しくありません/.test(m) && !/badball/.test(m), m);
  }
  {
    const p = run({ config: null, accepts: () => ({ ok: false, error: 'badshape' }) });
    await p.settle();
    const cb = p.firstCheckbox(); cb.checked = false; cb.fire('change');
    p.ids['b-save'].click(); await p.settle();
    const m = p.ids.msg.textContent;
    t('4e 柄を書かない保存の badshape は今までどおりの文（0025 の案内を出さない）', m === '設定の形が正しくありません。', m);
  }

  console.log('\n— 5. 見本と部品が無い時 —');
  {
    const p = run({ config: null });
    await p.settle();
    t('5a 見本を2つ描く（どちらも SVG・style を使わない）', p.pvs.every(s => s.children.length === 1 && s.children[0].tagName === 'svg')
      && p.pvs.every(s => { let hit = false; const w = e => { if ('style' in e.attrs) hit = true; (e.children || []).forEach(c => c.attrs && w(c)); }; w(s.children[0]); return !hit; }), p.pvs.map(s => s.children.length));
  }
  {
    const p = run({ config: null, itomari: false });
    await p.settle();
    t('5b 毬の部品が無くても画面が開き、見本なしで選べる', p.ids['v-admin'].hidden === false && p.pvs.every(s => s.children.length === 0), p.ids['gate-why'].textContent);
    p.pick('asanoha');
    p.ids['b-save'].click(); await p.settle();
    t('5c 毬の部品が無くても保存できる', p.db.puts.length === 1 && p.db.puts[0].ball === 'asanoha', p.db.puts);
  }

  console.log('\n— 6. 画面の決まり —');
  t('6a CSP は style を許さないまま（style-src \'self\'）', /style-src 'self';/.test(PAGE) && !/unsafe-inline/.test(PAGE), '');
  t('6b 欄の見出しと、端末の選択が優先される1行の説明', /<h2 id="ball-h">メニューの毬の柄（施設の既定）<\/h2>/.test(PAGE) && /各端末でメニューの毬を押して選んだ柄は、その端末ではこの既定より優先されます。/.test(PAGE), '');
  t('6c 2つの柄を選ぶ（name="ball"・値は kiku と asanoha）', /<input type="radio" name="ball" value="kiku">/.test(PAGE) && /<input type="radio" name="ball" value="asanoha">/.test(PAGE), '');
  t('6d 画面に style の属性・<style> を書いていない', !/\sstyle=|<style/.test(PAGE), '');
  const v = f => ((new RegExp('<script src="' + f.replace(/\./g, '\\.') + '\\?v=([^"]+)"')).exec(PAGE) || [])[1];
  const vi = f => ((new RegExp('<script src="' + f.replace(/\./g, '\\.') + '\\?v=([^"]+)"')).exec(INDEX) || [])[1];
  t('6e su-menu.js・su-itomari.js の版はメニューと同じ', !!v('su-menu.js') && v('su-menu.js') === vi('su-menu.js') && !!v('su-itomari.js') && v('su-itomari.js') === vi('su-itomari.js'), [v('su-menu.js'), vi('su-menu.js'), v('su-itomari.js'), vi('su-itomari.js')]);
  t('6f 毬の部品は menu-settings.js より前に読む', PAGE.indexOf('su-itomari.js') > 0 && PAGE.indexOf('su-itomari.js') < PAGE.indexOf('menu-settings.js?v='), '');
  t('6g 部品が読めない時の門（SUAuth・SUMenu）に毬の部品を足していない（見本なしで動く）', /if \(!window\.SUAuth \|\| !window\.SUMenu\) \{/.test(JS), '');

  console.log('\n— 7. 役割の決まりで出ないボタンの欄（2026-10-29 本人承認）—');
  {
    const p = run({ config: null });
    await p.settle();
    let grp = null, help = null, staff = null;
    p.ids.secs.walk(x => {
      const a = x.getAttribute && x.getAttribute('aria-label');
      if (a === '採用管理 を出す役割') grp = x;
      if (a === '使い方・困った時 を出す役割') help = x;
      if (a === '職員マスタ を出す役割') staff = x;
    });
    const cbs = g => g ? g.children.map(lb => lb.children.find(c => c.tagName === 'INPUT')) : [];
    const [ad, of, fi] = cbs(grp);
    t('7a 採用管理: 管理者の欄は押せる・出す', !!ad && !ad.disabled && ad.checked, [ad && ad.disabled, ad && ad.checked]);
    t('7b 採用管理: 事務所・現場の欄は外れた形で押せない・自動で出ませんの印', !!of && of.disabled && !of.checked && fi.disabled && !fi.checked
      && /自動で出ません/.test(of.getAttribute('aria-label') || '') && /自動で出ません/.test(of.parentNode.title || ''), [of && of.disabled, of && of.checked, of && of.attrs]);
    const [sa, so, sf] = cbs(staff);
    t('7c 職員マスタ（事務所専用）: 現場の欄だけ押せない', !!sa && !sa.disabled && !so.disabled && sf.disabled && !sf.checked, [sa && sa.disabled, so && so.disabled, sf && sf.disabled]);
    const hc = cbs(help);
    t('7d 使い方・困った時: 今どおり全部出す（押せない・入った形）', hc.length === 3 && hc.every(c => c.disabled && c.checked), hc.map(c => [c.disabled, c.checked]));
    t('7e 開いただけでは変更なし（自動の欄を保存する非表示に数えない）', p.ids['b-save'].disabled, p.ids.state.textContent);
    p.pick('asanoha');
    p.ids['b-save'].click(); await p.settle();
    const h = p.db.puts[0] && p.db.puts[0].hide;
    t('7f 保存しても、自動の欄は非表示として書かない', !!h && Object.keys(h).every(r => h[r].indexOf('ats.html') < 0 && h[r].indexOf('staff-master.html') < 0), h);
  }
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 試験が止まった: ' + (e && e.stack || e)); process.exit(1); });
