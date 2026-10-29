/* アプリの使える人（su-app-gate.js・2026-10-29 代表者の決定）の試験。架空のデータだけを使う。
   1. 開けるかの計算（effective）と、確かめた材料からの結論（decide）
   2. 確かめの流れ（run）: ログインの印が無い時は部品も読まない・現場は止める・関数が無い時は既定・失敗は止める・管理者は聞かない
   3. 開いた後の確かめ直し: ログインが変わったら読み込み直す・入力がある時は覆いだけ・通信の失敗では止めない
   4. 6つの画面: 確かめが端末の用途の止めの後・中身を読む前にあり、部品が無い時も開かない
   実行: node check/unit/app_gate_test.js
   ★出力に console を使わない（個人情報を出力に流さない作法をそろえる）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.APP_GATE_JS || path.join(ROOT, 'su-app-gate.js'), 'utf8');   // APP_GATE_JS: 条件を抜いた版で試験が落ちるかを見る時だけ
let ok = 0, ng = 0;
const say = (m) => process.stdout.write(m + '\n');
function group(n) { say('\n— ' + n + ' —'); }
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

/* 偽物の部品で su-app-gate.js を読み込む */
function load(opt) {
  opt = opt || {};
  const store = new Map(Object.entries(opt.storage || {}));
  const listeners = {};
  const added = [];
  const cnt = { reload: 0, rpc: 0, check: 0, scripts: 0 };
  function mkEl(tag) {
    const e = { tag, children: [], className: '', textContent: '', attrs: {}, classList: { add() {}, remove() {} },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); }, addEventListener() {}, focus() {} };
    return e;
  }
  const body = mkEl('body');
  /* 覆いの下の画面（inert を付ける相手） */
  const under = mkEl('main'); under.hasAttribute = function (k) { return k in this.attrs; }; under.removeAttribute = function (k) { delete this.attrs[k]; };
  body.children = [under];
  body.appendChild = function (c) { this.children = this.children.concat([c]); c.parentNode = this; return c; };
  body.removeChild = function (c) { this.children = this.children.filter((x) => x !== c); };
  const head = mkEl('head');
  head.appendChild = function (c) { added.push(c); if (c.tag === 'script') { cnt.scripts++; setImmediate(() => { if (opt.loadAuth) opt.loadAuth(win); c.onload && c.onload(); }); } return c; };
  const htmlCls = new Set();
  /* 開いている窓（showModal）の偽物 */
  const dlg = { open: !!opt.dialogOpen, close() { this.open = false; }, removeAttribute() { this.open = false; } };
  const win = {
    addEventListener(k, fn) { (listeners[k] = listeners[k] || []).push(fn); }
  };
  if (opt.auth) win.SUAuth = opt.auth(cnt);
  if (opt.auth) win.supabase = {};
  const ctx = {
    window: win, Promise, JSON, Object, Array, String, Date, RegExp, Error,
    setTimeout(fn, ms) { if (!(ms >= 5000)) setImmediate(fn); return 0; },
    localStorage: { get length() { return store.size; }, key(i) { return [...store.keys()][i] || null; }, getItem(k) { return store.has(k) ? store.get(k) : null; } },
    document: { body, head, documentElement: { classList: { add(c) { htmlCls.add(c); }, remove(c) { htmlCls.delete(c); } } },
      scripts: [], hidden: false, createElement: mkEl, querySelector() { return null; },
      querySelectorAll(sel) {
        if (sel === 'dialog[open]') return dlg.open ? [dlg] : [];
        return sel === '[data-sug-inert]' ? [under].filter((x) => 'data-sug-inert' in x.attrs) : [];
      },
      addEventListener(k, fn) { (listeners['doc:' + k] = listeners['doc:' + k] || []).push(fn); } },
    location: { pathname: '/resident-master.html', reload() { cnt.reload++; } }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'su-app-gate.js' });
  const text = () => JSON.stringify(body.children.filter((x) => x !== under), (k, v) => (k === 'parentNode' ? undefined : v));
  return { G: win.SUAppGate, cnt, body, under, dlg, text, listeners, htmlCls, added, boxOn: () => body.children.some((x) => x.attrs && x.attrs.role === 'dialog') };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const SESS = { 'sb-kakuu-auth-token': '{}' };
/* 偽物の SUAuth。st: check の答え、rpc: app_access_mine の答え（関数なら毎回呼ぶ） */
function fakeAuth(st, rpc) {
  return (cnt) => ({
    check() { cnt.check++; return Promise.resolve(typeof st === 'function' ? st() : st); },
    client() { return { rpc(name) { cnt.rpc++; const r = typeof rpc === 'function' ? rpc() : rpc; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); } }; }
  });
}

(async () => {
  const { G } = load();
  group('1. 開けるかの計算（effective）');
  {
    const e = G.effective;
    t('既定: 事務所は開ける・現場は開けない・管理者は常に開ける',
      e('staff-master', 'office').allow === true && e('staff-master', 'field').allow === false && e('staff-master', 'admin').allow === true &&
      e('staff-master', 'office').src === 'default' && e('staff-master', 'admin').src === 'admin');
    t('役割の決まりが既定より優先', e('staff-master', 'office', { 'staff-master': { office: false } }).allow === false && e('staff-master', 'field', { 'staff-master': { field: true } }).src === 'role');
    t('その人だけの決まりが役割の決まりより優先', e('staff-master', 'field', { 'staff-master': { field: false } }, { 'staff-master': true }).allow === true &&
      e('staff-master', 'office', null, { 'staff-master': false }).allow === false);
    t('管理者は決まりで止められない', e('staff-master', 'admin', { 'staff-master': { admin: false, office: false } }, { 'staff-master': false }).allow === true);
    t('一覧に無いアプリは開けない', e('ats', 'office').allow === false && e('ats', 'admin').allow === false && e('x', 'office').src === 'unknown');
    t('知らない役割は開けない', e('staff-master', 'boss').allow === false && e('staff-master', undefined).allow === false);
    t('真偽でない値は無視して既定（"true" の文字は開けるにしない）', e('staff-master', 'field', { 'staff-master': { field: 'true' } }, { 'staff-master': 1 }).allow === false);
    t('別のアプリの決まりは効かない', e('staff-master', 'field', { 'care-meeting': { field: true } }, { 'care-meeting': true }).allow === false);
  }
  group('1b. 結論（decide）');
  {
    const d = G.decide;
    const OK = (role) => ({ status: 'ok', role });
    t('ログインの印が無い＝ログインしてください', d('staff-master', false, OK('office'), {}).why === 'signedout');
    t('signed_out・denied・error・答え無し', d('staff-master', true, { status: 'signed_out' }).why === 'signedout' && d('staff-master', true, { status: 'denied' }).why === 'denied' &&
      d('staff-master', true, { status: 'error' }).why === 'error' && d('staff-master', true, null).why === 'error' && d('staff-master', true, { status: 'weird' }).why === 'error');
    t('管理者は本人の分を読まずに開ける', d('staff-master', true, OK('admin'), null).allow === true);
    t('事務所: 本人の分が読めない（null・error）なら開けない', d('staff-master', true, OK('office'), null).why === 'error' && d('staff-master', true, OK('office'), { error: true }).why === 'error');
    t('事務所: 関数がまだ無い時は既定で開ける', d('staff-master', true, OK('office'), { missing: true }).allow === true);
    t('現場: 関数がまだ無い時は既定で開けない', d('staff-master', true, OK('field'), { missing: true }).why === 'role');
    t('6桁の前の管理者は事務所として扱う', d('staff-master', true, { status: 'mfa_verify' }, { missing: true }).role === 'office' && d('staff-master', true, { status: 'mfa_enroll' }, { role: 'office', rules: { 'staff-master': { office: false } } }).allow === false);
    t('データベースの答えの役割が正（控えが事務所でも、今は現場なら止める）', d('staff-master', true, OK('office'), { role: 'field' }).allow === false);
    t('データベースが使える人に無いと答えたら止める', d('staff-master', true, OK('office'), { role: null }).why === 'denied');
    t('知らない役割は止める', d('staff-master', true, OK('boss'), { missing: true }).why === 'denied');
    t('本人の分の決まりで開ける', d('staff-master', true, OK('field'), { role: 'field', rules: null, mine: { 'staff-master': true } }).allow === true);
    t('一覧に無いアプリは止める', d('nope', true, OK('admin'), null).why === 'unknown');
  }

  group('2. 確かめの流れ（run）');
  {
    let L = load({ auth: fakeAuth({ status: 'ok', role: 'office' }, { data: { ok: true, role: 'office' } }) });
    let r = await L.G.run('staff-master');
    t('ログインの印が無い時は開けない・ログインの部品にも聞かない', r === false && L.cnt.check === 0 && L.cnt.rpc === 0 && /ログインしてから開きます/.test(L.text()));
    t('覆いの画面に「ログインの画面へ」（戻り先つき）と「メニューへ」', /login\.html\?next=resident-master\.html/.test(L.text()) && /index\.html/.test(L.text()));

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'field' }, { data: { ok: true, role: 'field', rules: null, mine: null } }) });
    r = await L.G.run('resident-master');
    t('開けない時は覆いの下の画面を押せない・Tab で入れない（inert）', 'inert' in L.under.attrs);
    t('現場のアカウントは開けない（代表者の文言）', r === false && /事務所・管理者のアカウントでだけ開けます。いまのアカウント（現場）では開けません。/.test(L.text()));

    L = load({ storage: SESS, dialogOpen: true, auth: fakeAuth({ status: 'mfa_verify' }, { data: { ok: true, role: 'office', rules: { 'resident-master': { office: false } } } }) });
    r = await L.G.run('resident-master');
    t('6桁の前の管理者が止められた時は「2段階認証を済ませてください」と出す', r === false && /2段階認証（認証アプリの6桁）を済ませると開けます/.test(L.text()));
    t('覆う時に開いている窓（showModal）を閉じる（覆いのボタンを押せるように）', L.dlg.open === false);

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'field' }, { data: { ok: true, role: 'field', rules: null, mine: { 'resident-master': true } } }) });
    t('この人だけ開けるにした現場の人は開ける（覆いを外し、下の画面の inert も外す）', (await L.G.run('resident-master')) === true && !L.boxOn() && !('inert' in L.under.attrs));

    L = load({ storage: SESS, auth: fakeAuth({ status: 'signed_out' }, { data: { ok: true, role: 'office' } }) });
    r = await L.G.run('staff-master');
    t('ログインの印が残るのに「ログインしていない」と答えた時は、確かめられない扱い（もう一度確かめる）', r === false && /もう一度確かめる/.test(L.text()) && L.cnt.rpc === 0);

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'office' }, { data: { ok: true, role: 'office', rules: { 'staff-master': { office: false } } } }) });
    r = await L.G.run('staff-master');
    t('役割の決まりで止めた事務所の人は開けない（役割の名前つきの文言）', r === false && /いまのアカウント（事務所）では開けません/.test(L.text()));

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'office' }, { error: { code: 'PGRST202', message: 'Could not find the function public.app_access_mine' } }) });
    t('関数がまだ無い（0033 の前）時は既定で開ける', (await L.G.run('staff-master')) === true);

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'office' }, { error: { code: '500', message: 'boom' } }) });
    r = await L.G.run('staff-master');
    t('本人の分を読めない時は開けない（もう一度確かめる）', r === false && /もう一度確かめる/.test(L.text()));

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'office' }, () => new Error('net')) });
    t('通信の失敗（例外）でも開けない', (await L.G.run('staff-master')) === false && /確かめられませんでした/.test(L.text()));

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'office' }, { error: { code: '42501', message: 'not allowed' } }) });
    t('データベースが断ったら（止めた人）開けない', (await L.G.run('staff-master')) === false && /止められています/.test(L.text()));

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'admin' }, { data: { ok: true, role: 'admin' } }) });
    t('管理者は本人の分を聞かずに開ける', (await L.G.run('staff-master')) === true && L.cnt.rpc === 0);

    L = load({ storage: SESS, auth: fakeAuth({ status: 'denied' }, { data: { ok: true, role: 'office' } }) });
    t('使える人に無いアカウントは開けない・本人の分は聞かない', (await L.G.run('staff-master')) === false && L.cnt.rpc === 0);

    L = load({ storage: SESS });
    t('ログインの部品を読めない時は開けない（読み込みを試みる）', (await L.G.run('staff-master')) === false && L.cnt.scripts >= 1 && /確かめられませんでした/.test(L.text()));

    L = load({ storage: SESS, auth: fakeAuth({ status: 'ok', role: 'office' }, { data: { ok: true, role: 'office' } }) });
    t('一覧に無いアプリの鍵は開けない', (await L.G.run('nope')) === false);
  }

  group('3. 開いた後の確かめ直し');
  {
    let role = 'office';
    const auth = fakeAuth(() => ({ status: 'ok', role }), () => ({ data: { ok: true, role } }));
    let L = load({ storage: SESS, auth });
    t('はじめは開ける', (await L.G.run('staff-master', { dirty: () => false })) === true);
    role = 'field';
    L.listeners.storage.forEach((f) => f({ key: 'sb-kakuu-auth-token' })); await settle();
    t('別のタブでアカウントが現場に替わったら、入力が無ければ読み込み直す（先に覆う＝取りやめても画面は覆われたまま）', L.cnt.reload === 1 && L.boxOn());
    L.listeners.storage.forEach((f) => f({ key: 'su_menu_v1' })); await settle();
    t('ログインに関係ない鍵では確かめ直さない', L.cnt.reload === 1);

    role = 'office';
    L = load({ storage: SESS, auth });
    await L.G.run('staff-master', { dirty: () => true });
    role = 'field';
    L.listeners.pageshow.forEach((f) => f({ persisted: true })); await settle();
    t('入力がある時は読み込み直さず覆いだけ（入力を控える案内つき）', L.cnt.reload === 0 && /保存していない入力があるため/.test(L.text()));
    role = 'office';
    L.listeners.storage.forEach((f) => f({ key: 'sb-kakuu-auth-token' })); await settle();
    t('開けるアカウントでログインし直すと覆いが消え、続きを使える', !L.boxOn() && !('inert' in L.under.attrs) && L.cnt.reload === 0);

    role = 'office';
    L = load({ storage: SESS, auth });
    await L.G.run('staff-master', { dirty: () => { throw new Error('x'); } });
    role = 'field';
    L.listeners.storage.forEach((f) => f({ key: null })); await settle();
    t('入力の有無が分からない時も読み込み直さない（黙って捨てない）', L.cnt.reload === 0 && /保存していない入力/.test(L.text()));

    let fail = false;
    const auth2 = fakeAuth(() => ({ status: 'ok', role: 'office' }), () => (fail ? new Error('net') : { data: { ok: true, role: 'office' } }));
    L = load({ storage: SESS, auth: auth2 });
    await L.G.run('staff-master', { dirty: () => false });
    fail = true;
    L.listeners.storage.forEach((f) => f({ key: 'sb-kakuu-auth-token' })); await settle();
    t('開いた後の通信の失敗では止めない', L.cnt.reload === 0 && !L.boxOn());
  }

  group('4. 6つの画面の入口');
  {
    const PAGES = [
      ['staff-master.html', 'staff-master', /\nfunction init\(\) \{/, /\nfunction start_\(\) \{/, ['restoreUi(', 'loadList(', 'refreshCaps(']],
      ['training-plan.html', 'training-plan', /\nfunction boot\(\) \{/, /\nfunction startApp_\(\) \{/, ['refreshAll(', 'renderList(', 'restoreUiState(']],
      ['admission-flow.html', 'admission-flow', /\n\(function init\(\) \{/, /\nfunction afStart_\(\) \{/, ['loadCache(', 'startupPull(', 'renderList(']],
      ['care-meeting.html', 'care-meeting', /\nfunction boot\(\)\{/, /\nfunction startApp_\(\)\{/, ['readCfg_(', 'openPerson_(', 'showPicker_(']],
      ['resident-master.html', 'resident-master', /\nfunction init\(\)\{/, /\nfunction rmStart_\(\)\{/, ['loadData(', 'readOpenId(']],
      ['connection-settings.html', 'connection-settings', /\nfunction init\(\)\{/, /\nfunction startApp_\(\)\{/, ['buildCard(', 'setupBackup(', 'wizInit(']]
    ];
    for (const [file, key, entryRe, startRe, reads] of PAGES) {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const m1 = entryRe.exec(html), m2 = startRe.exec(html);
      if (!m1 || !m2 || m2.index < m1.index) { t(file + ': 入口と続きの関数が見つかる', false); continue; }
      const entry = html.slice(m1.index, m2.index);
      const gi = entry.indexOf("SUAppGate.run('" + key + "'");
      const di = Math.max(entry.indexOf('applyDeviceGuard()'), entry.indexOf('isFieldDevice()'), entry.indexOf('isField()'), entry.indexOf("getDeviceRole()==='field'"));
      t(file + ': 端末の用途の止めの後に確かめる', gi > 0 && di >= 0 && di < gi, { gi, di });
      const leak = reads.filter((r) => entry.indexOf(r) >= 0);
      t(file + ': 確かめの前（入口）では中身を読まない（' + reads.join('・') + '）', leak.length === 0, leak);
      t(file + ': 開ける時だけ続きを呼ぶ', /\.then\(function ?\(ok\) ?\{ ?if ?\(ok\) ?[a-zA-Z_]+\(\); ?\}\)/.test(entry));
      t(file + ': 部品が無い時は開かない（案内だけ）', /if ?\(!window\.SUAppGate\)/.test(entry) && (/読み込めませんでした/.test(entry) || /appGateMissing_\(\)/.test(entry)));
      const startBody = html.slice(m2.index, m2.index + 20000);
      t(file + ': 続きの関数が中身を読む', reads.some((r) => startBody.indexOf(r) >= 0));
      const tagI = html.indexOf('<script src="su-app-gate.js?v=2026-10-29"></script>');
      t(file + ': 部品を画面のスクリプトより前に読む', tagI > 0 && tagI < m1.index);
    }
    const af = fs.readFileSync(path.join(ROOT, 'admission-flow.html'), 'utf8');
    t('入居調整: 画面に戻った時・つながった時・別タブの控えの取り込みも、確かめが通るまでしない',
      /if \(!afGateOk_ \|\| document\.hidden\) return;/.test(af) && /if \(!afGateOk_\) return;\n  if \(dirty\)/.test(af) && /if \(!afGateOk_ \|\| !ev \|\| ev\.key !== CACHE_KEY\) return;/.test(af));
    const rm = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
    const ss = rm.slice(rm.indexOf('\nfunction saveSyncCfg('), rm.indexOf('\nfunction testSync('));
    t('入居者マスタ: 現場端末の止めから事務所PCへ戻した時も、確かめを通ってから名簿を読む（反証レビューの指摘）',
      ss.indexOf('if(!rmGateOk_){ rmGate_(); return; }') > 0 && ss.indexOf('if(!rmGateOk_){ rmGate_(); return; }') < ss.lastIndexOf('loadData();'));
    t('入居者マスタ: 確かめが通った時だけ印を立てる', /function rmStart_\(\)\{\n  rmGateOk_=true;/.test(rm));
    t('入居調整: 確かめが通った時だけ印を立てる', /function afStart_\(\) \{\n  afGateOk_ = true;/.test(af));
  }

  say('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
})().catch((e) => { say('✗ 試験そのものが止まりました: ' + (e && e.stack || e)); process.exit(1); });
