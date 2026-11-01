/* check/fail-inject/observe.mjs — 失敗を起こして、画面がどう見せたかを数える（2026-10-31 新設）
 *
 *   node check/fail-inject/observe.mjs --ls-keys check/fail-inject/ls-keys.sample.json [--sb http://127.0.0.1:55421]
 *        [--sb-accounts <試験用アカウントのファイル>] [--only ws-gas,ws-sb,sb-rls,rm-gas,wt-gas,spl-gas,sh-gas] [--measure <measure.json>] [--run 1|2] [--item <番号>]
 *     試験用 Supabase の公開鍵は環境変数 SU_FI_SB_KEY で渡す（表示しない・ファイルに書かない）。
 *     試験用アカウントのファイルは「メール 空白 パスワード」の行（中身は表示しない・記録に書かない）。役割はログインして確かめる。
 *
 * 何をするか:
 *   ・serve.mjs を1つ立て、使い捨てのプロファイル（~/.claude/scripts/lib/chrome-temp.mjs の makeTempProfile）で
 *     ヘッドレス Chrome の文脈を2つ（A・B）作る。ポートは固定しない。終わった時・止められた時にプロファイルを消す。
 *   ・画面の接続先は、画面が受け付ける Google の形の架空の住所にし、その住所への通信を同じ serve.mjs の /__fake-gas/ へ回す
 *     （画面のコードは変えない。CSP の connect-src も変えない）。接続先の localStorage の鍵は --ls-keys で受ける（推測しない）。
 *   ・架空データ（check/fixtures の見本）で画面を開き、台本の回だけ失敗を起こしながら保存の操作をして、次の4つを数える:
 *       (i)   保存の失敗が画面に出た回数（同期の表示・知らせ・確かめの窓）
 *       (ii)  偽って「保存しました」と出た回数（保存の操作の後、サーバーに1件も書けていないのに成功の表示が出た）
 *       (iii) 送信待ちが残り、台本の失敗が終わった後に届いた回数
 *       (iv)  もう一方の文脈を読み込み直した時に古い値へ巻き戻った回数（B の表示がサーバーより少ない・サーバーの中身が減った・古い版の上書きが通った）
 *     要求ごとの「HTTP の成否」と「アプリの ok:false」は別の列で数える。
 *   ・対象（使用頻度の順）: ワークスケジュール（GAS の道＝統合KV）→ ワークスケジュール（Supabase の道＝試験用 Supabase）
 *     → 試験用 Supabase の RLS の断り（現場アカウント×事務所専用の書き込み kv_put）→ 入居者マスタ（GAS の道）
 *     ＝--only を付けない時の4場面（item 1 の計測の条件）。次の3場面は --only で名前を挙げた時だけ回す（2026-11-01 追加）:
 *     wt-gas 体重管理（GAS の道）・spl-gas 消耗品管理（GAS の道）・sh-gas シフト作成（GAS の道＝統合KV・編集リースつき）
 *   ・(ii) の数え方（全場面共通・2026-11-01）: 注入した失敗の後、どの書き込みも届いていない間に新しく出た成功の表示で、
 *     その後3秒以内に失敗の表示が出なかったもの。保存の操作の直後・通信の前に出る「端末に保存した」表示
 *     （体重管理の「…保存しました」）は、失敗を起こす前なので数えない。同じ文の出し直し・消えるだけの変化は新しい表示に数えない。
 *   ・記録: check/out/fail-inject/<日時>.json。--measure を渡すと、その measure.json の item 1 の行を書き足す・直す。
 *     --item <番号> を付けた時は item 1 ではなく、その番号の行を「アプリ名」ごとに書く（before[--run の位置]＝直す前の値。after は [null,null]）。
 *     --item の時は --only で場面を絞ってよい（その場面のアプリの行だけ書く）。
 * ★ワークスケジュールの競合の決まりは「未送信あり＝端末の方を優先」。巻き戻りはその決まりを前提に数え、直さない。
 * ★コンソールへの書き出しは使わない（進み具合は process.stdout・記録はファイル）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright, parseArgs, ensureDir, writeJson } from '../lib.mjs';
import { startFailInjectServer } from './serve.mjs';
import { createKvBackend, createMasterBackend, createWeightBackend, createSuppliesBackend, FAILURE_KINDS } from './gas-script.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const args = parseArgs(process.argv.slice(2));
const say = (s) => process.stdout.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 画面が受け付ける形の架空の接続先（ここへの通信は全部 serve.mjs の /__fake-gas/ へ回す＝外へ出ない） */
const GAS_URL = { kv: 'https://script.google.com/macros/s/FAIL-INJECT-KV/exec', master: 'https://script.google.com/macros/s/FAIL-INJECT-MASTER/exec',
  wt: 'https://script.google.com/macros/s/FAIL-INJECT-WT/exec', spl: 'https://script.google.com/macros/s/FAIL-INJECT-SPL/exec' };
const OBS_POINTS = ['failureShown', 'falseSaved', 'deliveredLater', 'rollback'];
/* item 1 の計測の4場面（--only を付けない時に回す・measure の item 1 はこの4つがそろった時だけ書く）と、名前を挙げた時だけ回す場面 */
const ITEM1_SCENARIOS = ['ws-gas', 'ws-sb', 'sb-rls', 'rm-gas'];
const SCENARIOS = ITEM1_SCENARIOS.concat(['wt-gas', 'spl-gas', 'sh-gas']);
let fiSeq = 0;
const FAIL_RE = /⚠|失敗|できません|競合|確認できず|止めました|オフライン|保存されていません|未送信/;
/* ✓ と「同期」の間の空白は画面ごとに違う（シフト作成は「✓ 同期済み」）。消耗品管理の成功は「記録しました」 */
const OK_RE = /✓\s*同期|送信完了|保存しました|保存OK|届いていました|記録しました/;

/* 外へ出てよい要求の判定（純関数・試験は check/unit/fail_inject_script_test.js が印の間を切り出して確かめる）。
   通すのは手元（127.0.0.1・localhost）と偽の GAS の住所（fakeGas の前方一致）と、ネットへ出ない形（about:・blob:・data:）だけ。
   名前は完全一致で見る（127.0.0.1.example のような住所を通さない）。本番の Supabase・Google などはここで止める */
/* EGRESS-BEGIN */
function isAllowedEgress(url, fakeGas) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return false; }
  if (u.protocol === 'about:' || u.protocol === 'blob:' || u.protocol === 'data:') return true;
  if (!/^(https?|wss?):$/.test(u.protocol)) return false;
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return true;
  const s = u.href;
  return (fakeGas || []).some((g) => { const base = String(g).replace(/\/exec$/, '/'); return s === g || s.startsWith(base); });
}
/* EGRESS-END */

/* --item の measure の行を作る・書き足す（純関数・試験は check/unit/fail_inject_script_test.js が印の間を切り出して確かめる）。
   行は { item, app, metric, unit, before:[1回目,2回目], after:[null,null], how }。この道具の計測は直す前の値なので before に書く。
   アプリごとに、数の入った（null でない）場面だけを足す。waitedWithoutNotice（失敗の表示なしに待った秒数）は足さずに最大を取る。
   どの場面にも数の無い観測点は行を作らない。 */
/* MEASURE-ITEM-BEGIN */
const ITEM_METRICS = [
  ['failureShown', '保存の失敗が画面に出た回数', '回'],
  ['falseSaved', '偽って保存しましたと出た回数', '回'],
  ['deliveredLater', '送信待ちが残って後で届いた回数', '回'],
  ['rollback', '別の文脈に巻き戻りが出た回数', '回'],
  ['httpFail', 'HTTP の失敗の回数', '回'],
  ['appFail', 'アプリの ok:false の回数', '回'],
  ['waitedWithoutNotice', '時間切れの間、失敗の表示なしに待った秒数（最大・道具が待たせた時間で頭打ち＝下限）', '秒'],
  ['duplicateLanded', '押し直しで同じ記録が二重に届いた件数', '件'],
];
function itemRowsFor(scenarios) {
  const apps = [];
  for (const sc of scenarios) if (sc && sc.valid !== false && !apps.includes(sc.app)) apps.push(sc.app);
  const rows = [];
  for (const app of apps) {
    const list = scenarios.filter((sc) => sc && sc.valid !== false && sc.app === app);
    for (const [k, metric, unit] of ITEM_METRICS) {
      const nums = list.map((sc) => sc[k]).filter((v) => typeof v === 'number');
      if (!nums.length) continue;
      rows.push({ app, metric, unit, value: k === 'waitedWithoutNotice' ? Math.max(...nums) : nums.reduce((a, b) => a + b, 0) });
    }
  }
  return rows;
}
/* m（measure.json の配列）へ書き足す・直す。もう一方の回が書いてあるのに条件（how）が違う行があれば何も書かずに clash を返す */
function upsertItemRows(m, item, idx, how, rows) {
  const other = 1 - idx;
  const find = (r) => m.find((x) => x && x.item === item && x.app === r.app && x.metric === r.metric);
  for (const r of rows) {
    const cur = find(r);
    if (cur && Array.isArray(cur.before) && typeof cur.before[other] === 'number' && typeof cur.how === 'string' && cur.how !== how) return { ok: false, clash: r.app + '／' + r.metric };
  }
  for (const r of rows) {
    let cur = find(r);
    if (!cur) { cur = { item, app: r.app, metric: r.metric, unit: r.unit, before: [null, null], after: [null, null], how: '' }; m.push(cur); }
    if (!Array.isArray(cur.before) || cur.before.length !== 2) cur.before = [null, null];
    cur.before[idx] = r.value;
    cur.how = how;
  }
  return { ok: true, written: rows.length };
}
/* MEASURE-ITEM-END */

/* 使い捨てのプロファイル。~/.claude の部品があればそれを使い、無い環境（CI など）では同じ決まりの控えで作って消す */
async function tempProfileMaker() {
  const lib = path.join(os.homedir(), '.claude', 'scripts', 'lib', 'chrome-temp.mjs');
  if (fs.existsSync(lib)) return (await import(pathToFileURL(lib).href)).makeTempProfile;
  return (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 消せなければ残る */ } };
    process.once('exit', cleanup);
    return { dir, cleanup, args: [`--user-data-dir=${dir}`, '--no-first-run', '--disk-cache-size=1'] };
  };
}

const lsKeysFile = args['ls-keys'];
if (!lsKeysFile || lsKeysFile === 'true') { say('使い方: --ls-keys <画面ごとの接続先の localStorage の鍵の JSON> が要ります（例: check/fail-inject/ls-keys.sample.json）'); process.exit(2); }
/* 何回目か（--run）は 1 か 2 だけ。ほかの値で measure の別の回を上書きしないよう、何も書かずに止める */
if (args.run !== undefined && args.run !== '1' && args.run !== '2') { say(`--run は 1 か 2 にしてください（渡された値: ${String(args.run).slice(0, 20)}）。何も書かずに止めます`); process.exit(1); }
if (args.measure === 'true') { say('--measure に measure.json の場所が要ります'); process.exit(2); }
/* --item（measure の行の番号）。付けた時は値が要る。数字だけなら数として書く */
if (args.item === 'true') { say('--item に番号が要ります（例: --item 3）'); process.exit(2); }
if (args.item !== undefined && !/^[0-9A-Za-z_.-]{1,20}$/.test(String(args.item))) { say(`--item は英数字の番号にしてください（渡された値: ${String(args.item).slice(0, 20)}）。何も書かずに止めます`); process.exit(1); }
const itemNo = args.item === undefined ? null : (/^\d+$/.test(String(args.item)) ? Number(args.item) : String(args.item));
const LS_KEYS = JSON.parse(fs.readFileSync(lsKeysFile, 'utf8'));
const only = args.only && args.only !== 'true' ? String(args.only).split(',') : ITEM1_SCENARIOS.slice();
const unknownOnly = only.filter((k) => !SCENARIOS.includes(k));
if (unknownOnly.length) { say(`--only に知らない場面があります: ${unknownOnly.join(',')}（使える場面: ${SCENARIOS.join(',')}）`); process.exit(2); }
const sbTarget = args.sb && args.sb !== 'true' ? args.sb : null;
const sbKey = process.env.SU_FI_SB_KEY || '';

function storageFor(page, extra) {
  const tpl = LS_KEYS[page];
  if (!tpl) throw new Error(`--ls-keys に ${page} がありません`);
  const out = {};
  for (const [k, v] of Object.entries(tpl)) out[k] = (typeof v === 'string' ? v : JSON.stringify(v)).replaceAll('{{GAS_KV}}', GAS_URL.kv).replaceAll('{{GAS_MASTER}}', GAS_URL.master)
    .replaceAll('{{GAS_WT}}', GAS_URL.wt).replaceAll('{{GAS_SPL}}', GAS_URL.spl);
  return Object.assign(out, extra || {});
}

const pw = loadPlaywright();
const baseTempProfile = await tempProfileMaker();
/* ~/.claude の部品は作るたびに SIGINT・SIGTERM・SIGHUP で「すぐ終える（＝終了時にフォルダを消す）」を足す。
   そのままだと Chrome が動いている間にフォルダを消すので、作るたびにそれを外し、こちらの止める処理（閉じてから消して終える）だけにする。
   終了時に消す処理（exit）はそのまま残す（閉じた後に走る） */
const STOP_SIGNALS = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]];
function makeTempProfile(prefix) {
  const p = baseTempProfile(prefix);
  installStop();
  return p;
}
const opened = [];   // {ctx, prof}
const consoleLog = [];   // 文脈ごとのコンソールのエラーの数（閉じる時に控える）
async function closeAll() {
  for (const o of opened.splice(0)) {
    if (o.page) consoleLog.push({ context: o.label, consoleErrors: o.page.__console.length, pageErrors: o.page.__errors, first: o.page.__console.slice(0, 10), all: o.page.__console.slice() });
    try { await o.ctx.close(); } catch (e) { /* 閉じている */ } try { o.prof.cleanup(); } catch (e) { /* 消せない */ } }
}
let stopping = false;
function installStop() {
  for (const [sig, code] of STOP_SIGNALS) {
    process.removeAllListeners(sig);
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      /* 閉じるのが止まっても終えられるよう、10秒で打ち切る（その時は終了時の処理が消す） */
      setTimeout(() => process.exit(code), 10000).unref();
      try { await closeAll(); } catch (e) { /* 閉じられない */ }
      process.exit(code);
    });
  }
}
installStop();
/* 手元・偽 GAS 以外へ出ようとして止めた要求（住所の名前と道だけ控える・?以降は控えない） */
const egressBlocked = [];

/* 文脈を1つ作る（使い捨てのプロファイル・ポート固定なし）。fakeGas: {Google の形の住所 → 偽 GAS の名前} */
/* opts.watchExtra … この場面だけ足して控える表示の部品（シフト作成の知らせ #appToast・確かめの窓 #dlgConfirmMsg） */
async function openContext(label, server, storage, extraRoutes, opts) {
  const prof = makeTempProfile('fail-inject-' + label + '-');
  const ctx = await pw.chromium.launchPersistentContext(prof.dir, {
    headless: true, args: prof.args.filter((a) => !a.startsWith('--user-data-dir')),
    viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block',
    /* Playwright 自身の止める処理（ブラウザを止めてすぐ終える）も入れない。止める処理は installStop の1か所だけ */
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  });
  opened.push({ ctx, prof });
  /* 外へ出る要求を止める経路。後から足した route が先に効くので、いちばん最初に足す＝ほかの経路（偽 GAS・材料の横取り）が
     受けなかった要求だけがここへ来る。手元・偽 GAS は素通し（fallback）、それ以外は止めて数える */
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (isAllowedEgress(url, Object.values(GAS_URL))) return route.fallback();
    let where = '';
    try { const u = new URL(url); where = u.host + u.pathname; } catch (e) { where = String(url).slice(0, 80); }
    egressBlocked.push({ context: label, where: where.slice(0, 160) });
    return route.abort('blockedbyclient');
  });
  /* 画面の要求ごとに通し番号（x-fi-id）を中継の側だけで付け、画面が先に諦めた（requestfailed）要求に serve.mjs で印を付ける。
     画面が送る要求の形（text/plain の POST・本文）は変えない。印は「画面から見た HTTP の成否」の列（httpSeen）にだけ効く */
  const fiIds = new WeakMap();
  ctx.on('requestfailed', (rq) => { const id = fiIds.get(rq); if (id) server.markClientGone(id); });
  for (const [name, url] of Object.entries(GAS_URL)) {
    await ctx.route(url.replace('/exec', '/**'), async (route) => {
      const id = label + '-' + (++fiSeq);
      fiIds.set(route.request(), id);
      try {
        const qs = new URL(route.request().url()).search;   // GET の ?action=stateRev はそのまま渡す（POST には付かない）
        const resp = await route.fetch({ url: server.url + '/__fake-gas/' + name + qs, timeout: 0, maxRedirects: 0, headers: Object.assign({}, route.request().headers(), { 'x-fi-id': id }) });
        await route.fulfill({ response: resp });
      } catch (e) { try { await route.abort('connectionreset'); } catch (e2) { /* 画面が先に諦めた */ } }
    });
  }
  for (const rt of (extraRoutes || [])) await ctx.route(rt.match, rt.handle);
  /* 端末の設定は「まだ無い時だけ」入れる（読み込み直しで端末の控えを上書きしない）。表示の変化を時刻つきで控える */
  await ctx.addInitScript((cfg) => {
    try { for (const k of Object.keys(cfg.storage)) if (localStorage.getItem(k) === null) localStorage.setItem(k, cfg.storage[k]); } catch (e) { /* 保存領域が使えない */ }
    window.__fi = { ev: [] };
    const rec = (sel, el) => { try { window.__fi.ev.push({ t: Date.now(), sel, text: String(el.textContent || '').slice(0, 160), cls: String(el.className || '') }); } catch (e) { /* 控えられない */ } };
    const arm = () => {
      for (const sel of cfg.watch) {
        const el = document.querySelector(sel);
        if (el && !el.__fiArmed) { el.__fiArmed = true; new MutationObserver(() => rec(sel, el)).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] }); }
      }
    };
    document.addEventListener('DOMContentLoaded', arm);
    setInterval(arm, 300);
  }, { storage, watch: ['#saveState', '#badgeSync', '#toast', '#stResult', '#syncStatus', '#apiBd', '#apiStatus', '#syncBadge', '#mvState'].concat((opts && opts.watchExtra) || []) });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.__dialogs = [];
  /* 名前を聞く窓（prompt）に入れる値。null の時は今までどおり空で受ける（場面ごとに page.__promptValue で決める） */
  page.__promptValue = null;
  page.on('dialog', async (d) => {
    page.__dialogs.push({ t: Date.now(), text: d.message().slice(0, 160), type: d.type() });
    try { if (d.type() === 'prompt' && page.__promptValue != null) await d.accept(page.__promptValue); else await d.accept(); } catch (e) { /* 閉じた */ }
  });
  page.__errors = 0;
  page.on('pageerror', () => { page.__errors++; });
  /* コンソールのエラー（読み込みの失敗も含む）も数える。文は先頭だけ控える（架空データだけの画面） */
  page.__console = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    let where = '';
    try { const u = new URL((m.location() || {}).url || ''); where = ' @' + (u.origin === new URL(server.url).origin ? '' : u.host) + u.pathname; } catch (e) { where = ''; }
    page.__console.push(String(m.text()).slice(0, 120) + where + ' +' + Math.round((Date.now() - server.t0) / 1000) + 's');
  });
  opened[opened.length - 1].page = page; opened[opened.length - 1].label = label;
  return { ctx, page, label };
}

/* 通信が静かになるまで待つ（最後の要求から quiet ミリ秒） */
async function waitQuiet(server, quiet = 3000, max = 60000) {
  const st = Date.now();
  while (Date.now() - st < max) {
    const last = server.log.length ? server.log[server.log.length - 1].t : 0;
    if (Date.now() - last >= quiet) return true;
    await sleep(250);
  }
  return false;
}
async function events(page, since) {
  const ev = await page.evaluate(() => (window.__fi && window.__fi.ev) || []).catch(() => []);
  return ev.concat(page.__dialogs.map((d) => ({ t: d.t, sel: 'dialog', text: d.text, cls: '' }))).filter((e) => e.t >= since);
}
const isFail = (e) => FAIL_RE.test(e.text) || (e.sel === '#toast' && /\bng\b/.test(e.cls)) || (e.sel === '#syncStatus' && /\berr\b/.test(e.cls))
  || (e.sel === '#mvState' && /\berr\b/.test(e.cls)) || (e.sel === '#apiBd' && /\bapi-er\b/.test(e.cls))
  || (e.sel === '#syncBadge' && /\b(conflict|storeerror|offline)\b/.test(e.cls));
const isOk = (e) => !isFail(e) && OK_RE.test(e.text);
/* 新しく出た表示か（同じ部品の直前の控えと文が違う・窓）。同じ文の出し直しや、知らせが消えるだけ（class の変化）は数えない */
function isNewDisplay(e, evs) {
  if (e.sel === 'dialog') return true;
  let prev = null;
  for (const x of evs) { if (x === e) break; if (x.sel === e.sel) prev = x; }
  return !prev || prev.text !== e.text;
}

/* 1つの場面の数え方。writes＝その場面で数える書き込みの記録（log の行）、tClick＝保存の操作をした時刻 */
function countScenario(server, fromIdx, tClick, evA, writeEntry, toIdx) {
  const rows = server.log.slice(fromIdx, toIdx === undefined ? server.log.length : toIdx);
  const writes = rows.filter((e) => writeEntry(e));
  const injected = rows.filter((e) => e.injected);
  /* HTTP の成否は画面から見た値（httpSeen）で数える。画面が先に諦めた時間切れ（'client-gone'）は、サーバーが後で 200 を返しても失敗 */
  const seen = (e) => (e.httpSeen != null ? e.httpSeen : e.http);
  const http2xx = (e) => typeof seen(e) === 'number' && seen(e) >= 200 && seen(e) < 300;
  const httpFail = writes.filter((e) => !http2xx(e)).length;
  const appFail = writes.filter((e) => http2xx(e) && e.bodyOk === false).length;
  const landed = writes.filter((e) => e.landed);
  /* (i) 失敗の後に失敗の表示が出た、または失敗から3秒たっても失敗の表示（未送信あり等）が残っている */
  const firstInj = injected.length ? Math.min(...injected.map((e) => e.t)) : tClick;
  const stateAt = (t) => { const last = {}; for (const e of evA) if (e.t <= t && e.sel !== 'dialog') last[e.sel] = e; return Object.values(last).some(isFail); };
  const failureShown = (evA.some((e) => isFail(e) && e.t >= firstInj) || stateAt(firstInj + 3000)) ? 1 : 0;
  /* (ii) 注入した失敗の後（起こしていなければ保存の操作の後）、どの書き込みも届いていない間に新しく出た成功の表示で、
     その後3秒以内に失敗の表示が出なかったもの（2026-11-01 から全場面この数え方。成功の文の判定は `✓\s*同期` に広げたので、ワークスケジュールの #badgeSync「✓ 同期済み」も成功に数えるようになった。広げた後も ws-gas・rm-gas の数は前便の2回と同じ＝実測で確かめた。体重管理の通信より前に出る端末の保存の知らせは、失敗を起こす前なので数えない） */
  let falseSaved = 0;
  for (const e of evA.filter(isOk)) {
    if (e.t < firstInj || !isNewDisplay(e, evA)) continue;
    if (landed.some((w) => w.landedAt && w.landedAt >= tClick && w.landedAt <= e.t)) continue;
    if (evA.some((x) => isFail(x) && x.t > e.t && x.t <= e.t + 3000)) continue;
    falseSaved++;
  }
  const lastInj = injected.length ? Math.max(...injected.map((e) => e.t)) : 0;
  const lost = injected.some((e) => !e.landed);
  const deliveredLater = (lost && landed.some((w) => w.landedAt > lastInj)) ? 1 : 0;
  return { requests: rows.length, writes: writes.length, injected: injected.length, httpFail, appFail, landed: landed.length,
    failureShown, falseSaved, deliveredLater, injectedKinds: [...new Set(injected.map((e) => (e.via === 'sb' ? 'sb:' : 'gas:') + e.injected))] };
}

const outDir = ensureDir(path.join(REPO, 'check', 'out', 'fail-inject'));
const result = { startedAt: new Date().toISOString(), run: args.run || '1', scenarios: [], kindsFired: [], notes: [] };

async function wsNotes(page) { return page.evaluate(() => document.querySelectorAll('#noteLayer .b-note').length).catch(() => -1); }
function serverNotes(be, key) { const e = be.kv.get(key); return e && e.data && e.data.meta && Array.isArray(e.data.meta.notes) ? e.data.meta.notes.length : 0; }
function serverNoteIds(be, key) { const e = be.kv.get(key); return new Set(e && e.data && e.data.meta && Array.isArray(e.data.meta.notes) ? e.data.meta.notes.map((n) => n.id) : []); }

/* ── ワークスケジュール（GAS の道・統合KV）── */
async function runWsGas(server) {
  const ws = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'work-schedule.mjs')).href);
  const cs = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'care-schedule.mjs')).href);
  const be = createKvBackend(ws.seed());
  server.setBackend('kv', be);
  server.setFlags(cs.FLAGS_OFF);
  server.setScript([]);
  const st = storageFor('work-schedule.html');
  const A = await openContext('ws-a', server, st);
  const B = await openContext('ws-b', server, st);
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/work-schedule.html', { waitUntil: 'domcontentloaded' });
    await X.page.waitForSelector('#btnAddNote', { state: 'visible', timeout: 60000 });
    await waitQuiet(server, 4000, 90000);
  }
  const plan = [
    { kind: 'deny', times: 2, wait: 60000 },
    { kind: 'conflict', times: 1, wait: 60000 },
    { kind: 'nores', times: 2, wait: 120000 },
    /* 時間切れは画面の1試行（put 45秒）＋再試行の待ち（1.5秒）より長く待たせる＝画面が送り直した時に前の要求がまだ返っていない
       （ワークスケジュールは通信を止めずに時計で打ち切るので、送り直しで「画面が諦めた」を観る。work-schedule.html の ATTEMPT_TIMEOUT_WRITE_MS・retryDelayMs） */
    { kind: 'timeout', times: 1, ms: 50000, wait: 150000 },
  ];
  for (const p of plan) {
    say(`  ワークスケジュール（GAS）: ${p.kind} を ${p.times} 回`);
    const putKeyBefore = [...be.kv.keys()].filter((k) => /^wsday_/.test(k));
    /* その日の盤面（wsday_）の保存だけに当てる（読み込み直しなどで走る週間計画の put を数えない） */
    server.setScript([{ entry: 'put', key: '^wsday_', nth: 1, kind: p.kind, times: p.times, ms: p.ms }]);
    const fromIdx = server.log.length;
    const tClick = Date.now();
    await A.page.click('#btnAddNote');
    await A.page.keyboard.type('見本の印 ' + p.kind).catch(() => {});
    await A.page.mouse.click(5, 5).catch(() => {});
    /* 台本の失敗が全部起きて、その後に書けるか、待ちの上限まで */
    const st0 = Date.now();
    while (Date.now() - st0 < p.wait) {
      const rep = server.engine().report()[0];
      const rows = server.log.slice(fromIdx);
      const lastInj = Math.max(0, ...rows.filter((e) => e.injected).map((e) => e.t));
      if (rep.fired >= rep.times && rows.some((e) => e.entry === 'put' && e.landed && e.landedAt > lastInj)) break;
      await sleep(500);
    }
    await waitQuiet(server, 4000, 30000);
    const evA = await events(A.page, tClick);
    const c = countScenario(server, fromIdx, tClick, evA, (e) => e.via === 'gas' && e.app === 'kv' && e.entry === 'put');
    const key = (server.log.slice(fromIdx).find((e) => e.entry === 'put' && /^wsday_/.test(e.key || '')) || {}).key || putKeyBefore[0];
    /* (iii) の確かめ: 届いた後、A の表示の印の数がサーバーにも載っている */
    const aNotes = await wsNotes(A.page), sNotesA = serverNotes(be, key);
    if (c.deliveredLater && sNotesA < aNotes) c.deliveredLater = 0;
    /* (iv) B を読み込み直す。B に未送信は無い＝サーバーの盤面を採るのが正しい */
    const idsBefore = serverNoteIds(be, key);
    await B.page.reload({ waitUntil: 'domcontentloaded' });
    await B.page.waitForSelector('#btnAddNote', { state: 'visible', timeout: 60000 }).catch(() => {});
    await waitQuiet(server, 5000, 60000);
    const bNotes = await wsNotes(B.page), sNotes = serverNotes(be, key);
    const idsAfter = serverNoteIds(be, key);
    const lostIds = [...idsBefore].filter((id) => !idsAfter.has(id)).length;
    c.rollback = (bNotes >= 0 && bNotes < sNotes) || lostIds > 0 ? 1 : 0;
    const rep = server.engine().report()[0];
    result.scenarios.push(Object.assign({ atSec: Math.round((tClick - server.t0) / 1000), app: 'ワークスケジュール', path: 'GAS（統合KV）', kind: 'gas:' + p.kind, scriptTimes: rep.times, fired: rep.fired,
      notes: { a: aNotes, b: bNotes, server: sNotes, lostIds }, pageErrors: A.page.__errors + B.page.__errors }, c));
  }
  await closeAll();
}

/* 試験用 Supabase へログインして、supabase-js が端末に置く形の控えを作る（資格は表示しない・記録しない） */
async function sbSessions(server) {
  const file = args['sb-accounts'];
  if (!file || file === 'true' || !fs.existsSync(file)) throw new Error('--sb-accounts が要ります');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^\S+@\S+\s+\S+$/.test(l.trim()));
  const out = {};
  for (const l of lines) {
    const [email, password] = l.trim().split(/\s+/);
    const r = await fetch(server.url + '/__sb/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: sbKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!r.ok) continue;
    const s = await r.json();
    const me = await (await fetch(server.url + '/__sb/rest/v1/rpc/my_account', { method: 'POST', headers: { apikey: sbKey, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: '{}' })).json().catch(() => null);
    const role = me && me.role;
    if (role && !out[role]) out[role] = s;
  }
  return out;
}
const SB_STORAGE_KEY = 'sb-127-auth-token';   // supabase-js の既定の鍵（接続先の名前の最初の区切り＝127.0.0.1 の 127）

/* ── ワークスケジュール（Supabase の道・試験用 Supabase）── */
async function runWsSb(server, sessions) {
  const ws = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'work-schedule.mjs')).href);
  server.setBackend('kv', createKvBackend(ws.seed()));
  const FLAGS_ON = { supabase: { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true, shift: false, patch_push: false, master_roster_read: false } };
  server.setFlags(FLAGS_ON);
  server.setScript([]);
  if (!sessions.office) { result.notes.push('Supabase の道: 事務所の試験アカウントでログインできず、省きました'); return; }
  const st = storageFor('work-schedule.html', { [SB_STORAGE_KEY]: JSON.stringify(sessions.office), su_backend_flags: JSON.stringify(FLAGS_ON) });
  const A = await openContext('wssb-a', server, st);
  const B = await openContext('wssb-b', server, st);
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/work-schedule.html', { waitUntil: 'domcontentloaded' });
    await X.page.waitForSelector('#btnAddNote', { state: 'visible', timeout: 60000 }).catch(() => {});
    await waitQuiet(server, 4000, 90000);
  }
  /* 下地の確かめ: 失敗を起こさない保存が1回届くこと（landed）。届かない時（例: 試験用 Supabase の wsday の種類が写しの期間で
     kv_put が ok:false 'shadow' を返す）は、比べる基準が無いので、この道の場面は「無効」にして観測点を null・合計から外す */
  const baseIdx = server.log.length;
  await A.page.click('#btnAddNote').catch(() => {});
  await A.page.keyboard.type('見本の印 下地').catch(() => {});
  await A.page.mouse.click(5, 5).catch(() => {});
  await sleep(3000);
  await waitQuiet(server, 4000, 60000);
  const baseRows = server.log.slice(baseIdx).filter((e) => e.via === 'sb' && /rpc\/kv_put/.test(e.entry));
  const baseValid = baseRows.some((e) => e.landed);
  const baseNames = [...new Set(baseRows.filter((e) => e.name).map((e) => e.name))];
  if (!baseValid) result.notes.push(`Supabase の道: 失敗を起こさない保存が届かない（kv_put ${baseRows.length} 回・landed 0・応答の名前 ${JSON.stringify(baseNames)}）ため、この道の場面は無効（下地が断られている）。観測点は null にし、起きた種類・合計・台本の一致から外しました`);
  const plan = [{ kind: 'unreachable', times: 2, wait: 90000 }, { kind: 'slow', times: 1, ms: 3000, wait: 60000 }];
  for (const p of plan) {
    say(`  ワークスケジュール（Supabase）: ${p.kind} を ${p.times} 回`);
    server.setScript([{ entry: 'sb:rpc/kv_put', nth: 1, kind: p.kind, times: p.times, ms: p.ms }]);
    const fromIdx = server.log.length;
    const tClick = Date.now();
    await A.page.click('#btnAddNote').catch(() => {});
    await A.page.keyboard.type('見本の印 ' + p.kind).catch(() => {});
    await A.page.mouse.click(5, 5).catch(() => {});
    const st0 = Date.now();
    while (Date.now() - st0 < p.wait) {
      const rep = server.engine().report()[0];
      if (rep.fired >= rep.times && Date.now() - st0 > 20000) break;
      await sleep(500);
    }
    await waitQuiet(server, 4000, 30000);
    const evA = await events(A.page, tClick);
    const c = countScenario(server, fromIdx, tClick, evA, (e) => e.via === 'sb' && /rpc\/kv_put/.test(e.entry));
    await B.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitQuiet(server, 5000, 60000);
    const aNotes = await wsNotes(A.page), bNotes = await wsNotes(B.page);
    /* サーバー（試験用 Supabase）の中身は読まない（共用のため）。A と B の表示の差を巻き戻りの候補として残し、
       この場面で書き込みが届いた（landed）のに B の表示が A より少ない時だけ巻き戻りと数える */
    const rollbackCandidate = aNotes >= 0 && bNotes >= 0 ? aNotes - bNotes : null;
    c.rollback = rollbackCandidate === null ? null : (c.landed > 0 && rollbackCandidate > 0 ? 1 : 0);
    if (!baseValid) { for (const k of OBS_POINTS) c[k] = null; }
    const rep = server.engine().report()[0];
    const names = [...new Set(server.log.slice(fromIdx).filter((e) => /rpc\/kv_put/.test(e.entry) && e.name).map((e) => e.name))];
    result.scenarios.push(Object.assign({ atSec: Math.round((tClick - server.t0) / 1000), app: 'ワークスケジュール', path: 'Supabase（試験用）', kind: 'sb:' + p.kind, scriptTimes: rep.times, fired: rep.fired,
      notes: { a: aNotes, b: bNotes }, rollbackCandidate, appNames: names, valid: baseValid, pageErrors: A.page.__errors + B.page.__errors }, c));
  }
  await closeAll();
}

/* ── 試験用 Supabase の RLS の断り（現場アカウント×事務所専用の書き込み kv_put）──
   画面は現場アカウントでは kv_put を呼ばない（su-kv.js が印だけの kv_put_marks に回す・事務所以外は送る前に断る）ので、
   中継を通して直接1回呼び、既存のポリシーで断られることを確かめる。データは書かれない（断りは入口の役割の照合） */
async function runSbRls(server, sessions) {
  server.setScript([]);
  if (!sessions.field) { result.notes.push('RLS の断り: 現場の試験アカウントでログインできず、省きました'); return; }
  say('  試験用 Supabase: 現場アカウントで kv_put（RLS の断り）を 1 回');
  const fromIdx = server.log.length;
  const r = await fetch(server.url + '/__sb/rest/v1/rpc/kv_put', { method: 'POST', headers: { apikey: sbKey, Authorization: 'Bearer ' + sessions.field.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: 'wsday_2026-01-14', p_rev: 0, p_data: { meta: { date: '2026-01-14' }, staff: [] } }) });
  await r.text();
  const rows = server.log.slice(fromIdx).filter((e) => /rpc\/kv_put/.test(e.entry));
  const denied = rows.filter((e) => e.http === 403 && e.name === '42501').length;
  result.scenarios.push({ app: '試験用 Supabase', path: 'Supabase（試験用）', kind: 'sb:deny', scriptTimes: 1, fired: denied, requests: rows.length, writes: rows.length, injected: 0,
    httpFail: rows.filter((e) => e.http !== 200).length, appFail: 0, landed: rows.filter((e) => e.landed).length, failureShown: null, falseSaved: null, deliveredLater: null, rollback: null,
    injectedKinds: denied ? ['sb:deny'] : [], realPolicy: true });
}

/* ── 入居者マスタ（GAS の道）── */
async function runRmGas(server) {
  const rm = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'resident-master.mjs')).href);
  const cs = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'care-schedule.mjs')).href);
  const be = createMasterBackend(rm.respond, rm.respond({ action: 'getBulk' }).rows || []);
  server.setBackend('master', be);
  server.setAuthRewrite(false);   // ログインの確かめは材料の架空の応答（本物の接続先の形の住所を横取り）で答える
  server.setBackend('kv', createKvBackend({}));
  server.setFlags(Object.assign({}, cs.FLAGS_OFF, { supabase: Object.assign({}, cs.FLAGS_OFF.supabase, { master_live: false }) }));
  server.setScript([]);
  const st = storageFor('resident-master.html', { 'sb-jhbernqawjrzqwrmqrih-auth-token': rm.storage['sb-jhbernqawjrzqwrmqrih-auth-token'] });
  /* ログインの確かめは材料（fixtures/resident-master.mjs）の架空の応答で答える（本物の Supabase へは出ない）。
     基本項目の写し（master_residents・master_residents_care）と写しの記録（master_sync_runs）の読み書きは材料では 404 になり、起こしていないエラーとして数に混ざるので、
     この場面だけ空の応答（読む＝200・[]／書く＝201・空）で答える（後から足した route が先に効く。材料は変えない） */
  const rmShadow = { match: /\/rest\/v1\/master_(residents(_care)?|sync_runs)(\?|$)/, handle(route) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    const m = route.request().method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (m === 'GET' || m === 'HEAD') return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '[]' });
    return route.fulfill({ status: 201, headers: cors, body: '' });
  } };
  const A = await openContext('rm-a', server, st, rm.routes.concat([rmShadow]));
  const B = await openContext('rm-b', server, st, rm.routes.concat([rmShadow]));
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/resident-master.html', { waitUntil: 'domcontentloaded' });
    await X.page.waitForFunction(() => typeof roster !== 'undefined' && roster.length > 0, null, { timeout: 60000 });
    await waitQuiet(server, 3000, 60000);
  }
  const plan = [{ kind: 'deny', times: 1 }, { kind: 'conflict', times: 1 }, { kind: 'nores', times: 1 }, { kind: 'timeout', times: 1, ms: 40000 }];
  let i = 0;
  for (const p of plan) {
    say(`  入居者マスタ（GAS）: ${p.kind} を ${p.times} 回`);
    const id = (await A.page.evaluate((k) => roster[k % roster.length].id, i++));
    /* B が先に同じ方の編集画面を開いておく（古い版を持ったまま） */
    await B.page.evaluate((rid) => { openEdit(roster.find((r) => r.id === rid)); }, id);
    await A.page.evaluate((rid) => { openEdit(roster.find((r) => r.id === rid)); }, id);
    server.setScript([{ entry: 'saveResident', nth: 1, kind: p.kind, times: p.times, ms: p.ms }]);
    const fromIdx = server.log.length;
    const tClick = Date.now();
    await A.page.click('#saveBtn');
    const st0 = Date.now();
    while (Date.now() - st0 < 70000) {
      const disabled = await A.page.evaluate(() => document.getElementById('saveBtn').disabled).catch(() => false);
      if (!disabled && Date.now() - st0 > 1500) break;
      await sleep(500);
    }
    await waitQuiet(server, 3000, 60000);
    /* 失敗した時は、職員と同じく開き直さずにもう一度保存する（送信待ちを持たない画面で、後から届くかを見る） */
    server.setScript([]);
    const retryIdx = server.log.length;   // ここから先は道具が押した保存（画面の仕組みで届いた分と分ける）
    await A.page.click('#saveBtn').catch(() => {});
    await sleep(2000);
    await waitQuiet(server, 3000, 60000);
    const evA = await events(A.page, tClick);
    const isRmWrite = (e) => e.via === 'gas' && e.app === 'master' && e.entry === 'saveResident';
    const c = countScenario(server, fromIdx, tClick, evA, isRmWrite);
    /* (iii) は画面が自分で送り直して届いた分だけ（道具の再保存より前の記録で数える）。道具の再保存が届いた分は別の列 */
    c.deliveredLater = countScenario(server, fromIdx, tClick, evA, isRmWrite, retryIdx).deliveredLater;
    c.manualRetryLanded = server.log.slice(retryIdx).filter((e) => isRmWrite(e) && e.landed).length;
    /* (iv) B は古い版のまま保存する。通ってしまえば A の保存を巻き戻した */
    const fromB = server.log.length;
    await B.page.click('#saveBtn').catch(() => {});
    await sleep(2000);
    await waitQuiet(server, 3000, 60000);
    const bRows = server.log.slice(fromB).filter((e) => e.entry === 'saveResident');
    const aLanded = server.log.slice(fromIdx, fromB).some((e) => e.entry === 'saveResident' && e.landed);
    c.rollback = aLanded && bRows.some((e) => e.landed) ? 1 : 0;
    const rep = server.engine().report();
    result.scenarios.push(Object.assign({ atSec: Math.round((tClick - server.t0) / 1000), app: '入居者マスタ', path: 'GAS（入居者マスタ）', kind: 'gas:' + p.kind, scriptTimes: p.times,
      fired: server.log.slice(fromIdx).filter((e) => e.injected === p.kind).length, bSave: bRows.map((e) => e.name || (e.landed ? 'saved' : null)), pageErrors: A.page.__errors + B.page.__errors }, c));
    void rep;
    /* 編集画面は閉じない（次の場面の openEdit が開き直す。入居者マスタに closeEdit は無い） */
  }
  await closeAll();
}

/* 台本の失敗が全部起きて、その後に書き込みが届くか、待ちの上限まで待つ（ワークスケジュールの待ち方と同じ） */
async function waitInjectedThenLanded(server, fromIdx, isWrite, maxMs) {
  const st0 = Date.now();
  while (Date.now() - st0 < maxMs) {
    const rep = server.engine().report()[0];
    const rows = server.log.slice(fromIdx);
    const lastInj = Math.max(0, ...rows.filter((e) => e.injected).map((e) => e.t));
    if (rep && rep.fired >= rep.times && rows.some((e) => isWrite(e) && e.landed && e.landedAt > lastInj)) return true;
    await sleep(500);
  }
  return false;
}

/* ── 体重管理（GAS の道）──
   保存（#inSave）は端末に保存して「…保存しました」を出してから送る（送信の前に出る＝端末に保存した表示）。
   送れなかった分は端末の送信待ち（wtmgr_pq_v1）に入り、送信の列が空いた時にすぐ1回送り直す。
   起こすのは saveRecord に1回ずつ（断り・応答なし・時間切れ）。1回なら送り直しで届くので「後から届いた」を観る */
async function runWtGas(server) {
  const wf = await import(pathToFileURL(path.join(HERE, 'fixtures', 'weight-record.mjs')).href);
  const be = createWeightBackend(wf.seed());
  server.setBackend('wt', be);
  server.setFlags(wf.FLAGS);
  server.setScript([]);
  const st = storageFor('weight-record.html');
  const A = await openContext('wt-a', server, st);
  const B = await openContext('wt-b', server, st);
  /* 同期が終わり（書き込みのボタンが止まっていない）、入居者の選択肢が出るまで */
  const ready = async (X) => {
    await X.page.waitForFunction((n) => !document.body.classList.contains('wr-sync-busy') && document.querySelectorAll('#inResident option[value]:not([value=""])').length >= n, wf.RESIDENTS.length, { timeout: 60000 });
  };
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/weight-record.html', { waitUntil: 'domcontentloaded' });
    await ready(X);
    await waitQuiet(server, 3000, 60000);
  }
  /* 時間切れは画面の1回の待ち（fetchTO 12秒）より長く待たせる＝画面は諦めて送信待ちに入れ、サーバーには後から届く */
  const plan = [{ kind: 'deny', times: 1, wait: 40000 }, { kind: 'nores', times: 1, wait: 40000 }, { kind: 'timeout', times: 1, ms: 15000, wait: 60000 }];
  const isWrite = (e) => e.via === 'gas' && e.app === 'wt' && e.entry === 'saveRecord';
  let i = 0;
  for (const p of plan) {
    say(`  体重管理（GAS）: ${p.kind} を ${p.times} 回`);
    const rid = wf.RESIDENTS[i++ % wf.RESIDENTS.length].id;
    await A.page.click('[data-go="input"]');
    await ready(A);
    await A.page.selectOption('#inResident', rid);
    await A.page.fill('#inWeight', '50.0');
    server.setScript([{ entry: 'saveRecord', nth: 1, kind: p.kind, times: p.times, ms: p.ms }]);
    const fromIdx = server.log.length;
    const tClick = Date.now();
    await A.page.click('#inSave');
    await waitInjectedThenLanded(server, fromIdx, isWrite, p.wait);
    await waitQuiet(server, 4000, 30000);
    const evA = await events(A.page, tClick);
    const c = countScenario(server, fromIdx, tClick, evA, isWrite);
    const recId = (server.log.slice(fromIdx).find((e) => isWrite(e) && e.key) || {}).key || null;
    /* (iii) の確かめ: 届いたと数えた記録が、見本に本当にある */
    if (c.deliveredLater && !(recId && be.records.has(recId))) c.deliveredLater = 0;
    const pendingA = await A.page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('wtmgr_pq_v1') || '[]') || []).length; } catch (e) { return -1; } }).catch(() => -1);
    /* (iv) B を読み込み直す。B の端末の記録（DB.records）に、偽 GAS の記録が全部あるか・偽 GAS の記録が減っていないか */
    const srvBefore = new Set(be.records.keys());
    const bIdx = server.log.length;
    await B.page.reload({ waitUntil: 'domcontentloaded' });
    /* 読み込み直しの後の B 自身の取得（getAll）が返り、同期が終わるまで待つ（同期の前に数えると、まだ取っていないだけの差を巻き戻りと数える） */
    const stB = Date.now();
    while (Date.now() - stB < 30000 && !server.log.slice(bIdx).some((e) => e.entry === 'getAll' && e.fiId && e.fiId.startsWith(B.label + '-') && e.httpSeen === 200)) await sleep(250);
    await sleep(500);
    await ready(B).catch(() => {});
    await waitQuiet(server, 4000, 60000);
    const bIds = await B.page.evaluate(() => (typeof DB !== 'undefined' && Array.isArray(DB.records) ? DB.records.map((r) => String(r && r.id)) : null)).catch(() => null);
    const srvAfter = new Set(be.records.keys());
    const lostOnServer = [...srvBefore].filter((id) => !srvAfter.has(id)).length;
    const missingInB = bIds ? [...srvAfter].filter((id) => !bIds.includes(id)).length : null;
    /* B の記録を読めなかった時は測れていない（null）。サーバーで減った時だけは B を読めなくても巻き戻り */
    c.rollback = lostOnServer > 0 ? 1 : (missingInB === null ? null : (missingInB > 0 ? 1 : 0));
    const rep = server.engine().report()[0];
    result.scenarios.push(Object.assign({ atSec: Math.round((tClick - server.t0) / 1000), app: '体重管理', path: 'GAS（体重管理）', kind: 'gas:' + p.kind, scriptTimes: rep.times, fired: rep.fired,
      records: { server: srvAfter.size, b: bIds ? bIds.length : null, missingInB, lostOnServer }, pendingA, pageErrors: A.page.__errors + B.page.__errors }, c));
  }
  await closeAll();
}

/* ── 消耗品管理（GAS の道）──
   入庫（種類の既定）を1件記録する。応答を待ち、成功なら #mvState に「記録しました」、失敗なら「記録できませんでした（…）」。
   送信待ちと自動の送り直しは無い（出庫だけ控える）ので、失敗した時は職員と同じく画面を開き直さずにもう一度押す（入居者マスタと同じ）。
   もう一度押すと新しい番号（mv_）で送る＝時間切れの後でサーバーに先の1件が届いていると、2件になる（duplicateLanded に残す） */
async function runSplGas(server) {
  const sf = await import(pathToFileURL(path.join(HERE, 'fixtures', 'supplies.mjs')).href);
  const be = createSuppliesBackend(sf.seed());
  server.setBackend('spl', be);
  server.setFlags(null);   // 消耗品管理は su-backend.json・su-kv.js を読まない（切り替えスイッチの道が無い）
  server.setScript([]);
  const st = storageFor('supplies.html');
  const A = await openContext('spl-a', server, st);
  const B = await openContext('spl-b', server, st);
  const ready = (X) => X.page.waitForFunction(() => typeof ST !== 'undefined' && ST.loaded === true && !ST.loading, null, { timeout: 60000 });
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/supplies.html', { waitUntil: 'domcontentloaded' });
    await ready(X);
    await waitQuiet(server, 3000, 60000);
  }
  const itemId = 'it_fi1';
  const qtyOf = async (X) => X.page.evaluate((id) => (typeof ST !== 'undefined' && ST.stock && ST.stock[id] && typeof ST.stock[id].qty === 'number' ? ST.stock[id].qty : null), itemId).catch(() => null);
  /* 時間切れは画面の打ち切り（AbortController 45秒）より長く待たせる */
  const plan = [{ kind: 'deny', times: 1 }, { kind: 'nores', times: 1 }, { kind: 'timeout', times: 1, ms: 50000 }];
  const isWrite = (e) => e.via === 'gas' && e.app === 'spl' && e.entry === 'addMoves';
  const submitAndWait = async (maxMs) => {
    await A.page.click('#mvSubmit');
    const st0 = Date.now();
    while (Date.now() - st0 < maxMs) {
      const busy = await A.page.evaluate(() => (typeof ST !== 'undefined' ? !!ST.busy : false)).catch(() => false);
      if (!busy && Date.now() - st0 > 1500) break;
      await sleep(500);
    }
  };
  for (const p of plan) {
    say(`  消耗品管理（GAS）: ${p.kind} を ${p.times} 回`);
    await A.page.click('#navStock');
    await A.page.selectOption('#mvItem', itemId);
    await A.page.check('#mt_in');
    await A.page.fill('#mvQty', '2');
    await A.page.selectOption('#mvUnit', '0');
    server.setScript([{ entry: 'addMoves', nth: 1, kind: p.kind, times: p.times, ms: p.ms }]);
    const fromIdx = server.log.length;
    const srvQtyBefore = be.stock[itemId].qty;
    const tClick = Date.now();
    await submitAndWait(70000);
    await waitQuiet(server, 3000, 60000);
    /* 時間切れ: 画面が諦めた後、サーバーに先の1件が届くまで待つ（届いた後に押し直す＝二重になるかを観る） */
    if (p.kind === 'timeout') {
      const st1 = Date.now();
      while (Date.now() - st1 < 15000 && !server.log.slice(fromIdx).some((e) => isWrite(e) && e.injected && e.landed)) await sleep(500);
    }
    /* 失敗した時は、職員と同じく開き直さずにもう一度押す（数量の欄は失敗の時は残っている） */
    server.setScript([]);
    const retryIdx = server.log.length;
    const qtyLeft = await A.page.inputValue('#mvQty').catch(() => '');
    if (qtyLeft) await submitAndWait(30000);
    await waitQuiet(server, 3000, 60000);
    const evA = await events(A.page, tClick);
    const c = countScenario(server, fromIdx, tClick, evA, isWrite);
    /* (iii) は画面が自分で送り直して届いた分だけ（道具の押し直しより前の記録で数える）。押し直しが届いた分は別の列 */
    c.deliveredLater = countScenario(server, fromIdx, tClick, evA, isWrite, retryIdx).deliveredLater;
    c.manualRetryLanded = server.log.slice(retryIdx).filter((e) => isWrite(e) && e.landed).length;
    const landedIds = new Set(server.log.slice(fromIdx).filter((e) => isWrite(e) && e.landed).map((e) => e.key));
    const duplicateLanded = Math.max(0, landedIds.size - 1);
    /* (iv) B を読み込み直す。B の在庫がサーバーより少ない・サーバーの在庫が減った＝巻き戻り */
    await B.page.reload({ waitUntil: 'domcontentloaded' });
    await ready(B).catch(() => {});
    await waitQuiet(server, 3000, 60000);
    const bQty = await qtyOf(B), aQty = await qtyOf(A), srvQty = be.stock[itemId].qty;
    c.rollback = (bQty !== null && bQty < srvQty) || srvQty < srvQtyBefore ? 1 : 0;
    const rep = server.engine().report();
    result.scenarios.push(Object.assign({ atSec: Math.round((tClick - server.t0) / 1000), app: '消耗品管理', path: 'GAS（消耗品管理）', kind: 'gas:' + p.kind, scriptTimes: p.times,
      fired: server.log.slice(fromIdx).filter((e) => e.injected === p.kind).length, stock: { before: srvQtyBefore, server: srvQty, a: aQty, b: bQty }, duplicateLanded,
      pageErrors: A.page.__errors + B.page.__errors }, c));
    void rep;
  }
  await closeAll();
}

/* ── シフト作成（GAS の道＝統合KV・編集リースつき）──
   A は ✎ 編集（#togEdit）でリースを取り、勤務表のセルを押して入力パレットの記号を押す（職員の操作と同じ）。
   書くのは push（sched:YYYY-MM:plan・券 editToken つき）。B は閲覧のまま、場面の後に読み込み直してセルの値を見る。
   push は画面に時間切れが無い＝時間切れは台本で 60秒待たせ、その間に失敗の表示が出るまでの秒数を waitedWithoutNotice に残す（観測の事実） */
async function runShGas(server) {
  const ws = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'work-schedule.mjs')).href);
  const cs = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'care-schedule.mjs')).href);
  const be = createKvBackend(ws.seed());
  server.setBackend('kv', be);
  server.setFlags(cs.FLAGS_OFF);
  server.setScript([]);
  const st = storageFor('shift-app.html');
  const watch = { watchExtra: ['#appToast', '#dlgConfirmMsg'] };
  const A = await openContext('sh-a', server, st, [], watch);
  const B = await openContext('sh-b', server, st, [], watch);
  const ready = (X) => X.page.waitForFunction(() => document.querySelectorAll('#gridWrap td.daycell').length > 0, null, { timeout: 60000 });
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/shift-app.html', { waitUntil: 'domcontentloaded' });
    await ready(X);
    await waitQuiet(server, 3000, 60000);
  }
  /* 編集モード。端末の名前を聞かれたら見本の名前で答える。リースが取れるまで待つ */
  A.page.__promptValue = '見本端末';
  await A.page.click('#togEdit');
  const stL = Date.now();
  while (Date.now() - stL < 30000 && !(be.lease().holder && be.lease().token)) await sleep(300);
  await waitQuiet(server, 3000, 30000);
  if (!be.lease().token) throw new Error('シフト作成: 編集モードのリースが取れませんでした');
  const plan = [
    { kind: 'deny', times: 1, wait: 90000 },
    { kind: 'conflict', times: 1, wait: 90000 },
    { kind: 'nores', times: 1, wait: 90000 },
    { kind: 'timeout', times: 1, ms: 60000, wait: 100000 },
  ];
  const isWrite = (e) => e.via === 'gas' && e.app === 'kv' && e.entry === 'push';
  const SYMS = ['早', '日1', '日2', '日3', '遅'];
  let i = 0;
  for (const p of plan) {
    say(`  シフト作成（GAS）: ${p.kind} を ${p.times} 回`);
    /* 場面ごとに別の日のセル（1人目の職員の主の行）を直す */
    const day = String(5 + i * 3);
    const sel = '#gridWrap td.daycell[data-sid="st01"][data-main="1"][data-day="' + day + '"]';
    const td = A.page.locator(sel).first();
    const cur = String(await td.textContent().catch(() => '')).trim();
    const pick = SYMS.filter((x) => x !== cur)[i % (SYMS.length - 1)];
    i++;
    await td.click();
    await A.page.waitForSelector('#palette .symbtn[data-v="' + pick + '"]', { state: 'visible', timeout: 10000 });
    server.setScript([{ entry: 'push', key: '^sched:', nth: 1, kind: p.kind, times: p.times, ms: p.ms }]);
    const fromIdx = server.log.length;
    const tClick = Date.now();
    await A.page.click('#palette .symbtn[data-v="' + pick + '"]');
    await waitInjectedThenLanded(server, fromIdx, isWrite, p.wait);
    await waitQuiet(server, 4000, 30000);
    const evA = await events(A.page, tClick);
    const c = countScenario(server, fromIdx, tClick, evA, isWrite);
    const key = (server.log.slice(fromIdx).find((e) => isWrite(e) && e.key) || {}).key || null;
    const cellOf = (data) => (data && data.cells && data.cells.st01 ? data.cells.st01[day] : undefined);
    /* 時間切れの間、失敗の表示なしに待った秒数（失敗の表示が出た時はそこまで・出なければ待たせた時間） */
    const inj = server.log.slice(fromIdx).find((e) => e.injected === 'timeout');
    if (p.kind === 'timeout' && inj) {
      const firstFail = evA.filter((e) => isFail(e) && e.t >= inj.t).map((e) => e.t).sort((a, b) => a - b)[0];
      const end = inj.landedAt || (inj.t + p.ms);
      c.waitedWithoutNotice = Math.round(((firstFail && firstFail < end ? firstFail : end) - inj.t) / 1000);
    }
    /* (iv) B を読み込み直し、B のセルの表示とサーバー（偽 KV）のセルの値を比べる。サーバーで A の値が届いた後に別の値へ戻った時も巻き戻り */
    const srvVal = key && be.kv.has(key) ? cellOf(be.kv.get(key).data) : undefined;
    await B.page.reload({ waitUntil: 'domcontentloaded' });
    await ready(B).catch(() => {});
    await waitQuiet(server, 4000, 60000);
    const bVal = String(await B.page.locator(sel).first().textContent().catch(() => '')).trim();
    const seq = key ? be.history.filter((h) => h.key === key).map((h) => cellOf(h.data)) : [];
    const pickAt = seq.indexOf(pick);
    const revertedOnServer = pickAt >= 0 && seq.slice(pickAt + 1).some((v) => v !== pick);
    c.rollback = (srvVal !== undefined && bVal !== String(srvVal)) || revertedOnServer ? 1 : 0;
    const badgeA = String(await A.page.textContent('#syncBadge').catch(() => '')).trim();
    const rep = server.engine().report()[0];
    result.scenarios.push(Object.assign({ atSec: Math.round((tClick - server.t0) / 1000), app: 'シフト作成', path: 'GAS（統合KV・編集リース）', kind: 'gas:' + p.kind, scriptTimes: rep.times, fired: rep.fired,
      cell: { day, pick, server: srvVal === undefined ? null : srvVal, b: bVal }, badgeA, pageErrors: A.page.__errors + B.page.__errors }, c));
  }
  await closeAll();
}

const server = await startFailInjectServer({ root: REPO, script: [], sb: sbTarget ? { target: sbTarget, key: sbKey } : null, backends: {} });
let exitCode = 0;
try {
  let sessions = {};
  if (sbTarget && (only.includes('ws-sb') || only.includes('sb-rls'))) sessions = await sbSessions(server);
  if (only.includes('ws-gas')) await runWsGas(server);
  if (only.includes('ws-sb')) { if (sbTarget) await runWsSb(server, sessions); else result.notes.push('Supabase の道: --sb が無いので省きました'); }
  if (only.includes('sb-rls')) { if (sbTarget) await runSbRls(server, sessions); else result.notes.push('RLS の断り: --sb が無いので省きました'); }
  if (only.includes('rm-gas')) await runRmGas(server);
  if (only.includes('wt-gas')) await runWtGas(server);
  if (only.includes('spl-gas')) await runSplGas(server);
  if (only.includes('sh-gas')) await runShGas(server);
} catch (e) {
  exitCode = 1;
  result.notes.push('途中で止まりました: ' + String(e && e.message || e).slice(0, 300));
} finally {
  await closeAll();
  await server.close();
}

/* まとめ（観測点ごとの合計・起きた失敗の種類） */
/* 無効の場面（valid:false＝下地の保存が届かない）は、起きた種類・合計・台本の一致から外す。null（測れず）は 0 として足さない */
const validScenarios = result.scenarios.filter((s) => s.valid !== false);
result.egressBlocked = { count: egressBlocked.length, where: [...new Set(egressBlocked.map((b) => b.context + ' ' + b.where))].slice(0, 20) };
const fired = new Set();
for (const s of validScenarios) for (const k of s.injectedKinds || []) fired.add(k);
result.kindsFired = FAILURE_KINDS.filter((k) => fired.has(k));
const sum = (k) => validScenarios.reduce((a, s) => a + (typeof s[k] === 'number' ? s[k] : 0), 0);
/* 観測点の数は、実際に数の入った（null でない）観測点の数 */
const observed = OBS_POINTS.filter((k) => validScenarios.some((s) => typeof s[k] === 'number'));
result.totals = { failureKinds: result.kindsFired.length, observationPoints: observed.length, observedPoints: observed, failureShown: sum('failureShown'), falseSaved: sum('falseSaved'),
  deliveredLater: sum('deliveredLater'), rollback: sum('rollback'), httpFail: sum('httpFail'), appFail: sum('appFail'), manualRetryLanded: sum('manualRetryLanded'), duplicateLanded: sum('duplicateLanded'),
  invalidScenarios: result.scenarios.length - validScenarios.length,
  consoleErrors: consoleLog.reduce((a, c) => a + c.consoleErrors, 0), pageErrors: consoleLog.reduce((a, c) => a + c.pageErrors, 0),
  /* 道具が起こした接続切れ（応答なし・届かない）でブラウザが出す読み込みの失敗を除いた数（材料が答えない読み取りの 404 など） */
  consoleErrorsNotInjected: consoleLog.reduce((a, c) => a + c.all.filter((x) => !/ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/.test(x)).length, 0),
  scriptMatched: validScenarios.every((s) => s.fired === s.scriptTimes) };
/* 測れなかった場面（無効＝下地の保存が届かない・観測点が全部 null）を黙って落とさず、名前と理由を残す（measure の how にも書く） */
const unmeasured = result.scenarios.filter((s) => s.valid === false || OBS_POINTS.every((k) => s[k] === null))
  .map((s) => `${s.kind}（${s.valid === false ? '下地の保存が断られ無効' + (s.appNames && s.appNames.length ? '・応答 ' + s.appNames.join('/') : '') : '画面を通さず観測点なし'}・起こした ${s.fired}/${s.scriptTimes} 回）`);
result.totals.unmeasured = unmeasured;
result.contexts = consoleLog;
result.finishedAt = new Date().toISOString();
const stamp = result.startedAt.replace(/[:.]/g, '-');
const outFile = path.join(outDir, stamp + '.json');
writeJson(outFile, result);
say(`記録: ${path.relative(REPO, outFile)}`);
say(`起きた失敗の種類 ${result.totals.failureKinds}／観測点 ${result.totals.observationPoints}／失敗の表示 ${result.totals.failureShown}／偽の保存しました ${result.totals.falseSaved}／後から届いた ${result.totals.deliveredLater}／巻き戻り ${result.totals.rollback}／HTTP の失敗 ${result.totals.httpFail}／ok:false ${result.totals.appFail}／道具の再保存が届いた ${result.totals.manualRetryLanded}／二重に届いた ${result.totals.duplicateLanded}／無効の場面 ${result.totals.invalidScenarios}／コンソールのエラー ${result.totals.consoleErrors}（起こした接続切れを除くと ${result.totals.consoleErrorsNotInjected}）／台本の回数と一致 ${result.totals.scriptMatched ? 'はい' : 'いいえ'}／外へ出ようとして止めた要求 ${egressBlocked.length}`);
if (unmeasured.length) say(`未測定（数に入れていない場面）: ${unmeasured.join('、')}`);

/* measure.json（item 1）へ書き足す。run は 1 か 2（同じ条件で2回測る） */
const skipped = result.notes.filter((n) => n.includes('省きました'));
/* --only で場面を絞った時は、一部の場面だけの合計で measure を上書きしないよう書かない（item 1 の時だけ。--item の時はアプリごとの行なので絞ってよい） */
if (itemNo === null && !(ITEM1_SCENARIOS.every((k) => only.includes(k)) && only.every((k) => ITEM1_SCENARIOS.includes(k)))) skipped.push('--only で場面を絞りました（' + only.join(',') + '）');
/* 台本の回数と起きた回数が合わない回（保存の操作の空振りで起きていない等）は、良く見える値を measure へ入れないよう書かず、失敗で終える */
if (!result.totals.scriptMatched) { exitCode = 1; say('台本の回数と起きた回数が一致しないので、失敗として終えます'); }
/* 手元・偽 GAS 以外（本番など）へ出ようとした回は、測定値にしない */
if (egressBlocked.length) { exitCode = 1; say(`手元・偽 GAS 以外へ出ようとした要求を ${egressBlocked.length} 件止めたので、失敗として終えます（${result.egressBlocked.where.join('、')}）`); }
/* --item だけで --measure が無い時は書く先が無い。書く予定だった行の数だけ知らせる */
if (itemNo !== null && !(args.measure && args.measure !== 'true')) say(`--item ${itemNo}: --measure が無いので書きません（書く予定の行 ${itemRowsFor(result.scenarios).length} 行）`);
if (args.measure && args.measure !== 'true' && (exitCode !== 0 || skipped.length)) {
  say(`measure: 途中で止まった・省いた場面がある・台本と不一致・外へ出ようとしたので書きません（${egressBlocked.length ? '外へ出ようとした要求 ' + egressBlocked.length + ' 件' : !result.totals.scriptMatched ? '台本の回数と不一致' : exitCode !== 0 ? '途中で止まりました' : skipped.length + ' 件を省きました'}）`);
} else if (args.measure && args.measure !== 'true' && itemNo !== null) {
  /* --item: アプリごとの観測点を before の --run の位置へ書く（item 1 の行には触らない） */
  const mf = args.measure;
  let m = [];
  if (fs.existsSync(mf)) {
    try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { m = null; }
    if (!Array.isArray(m)) { say(`measure: ${mf} が読めない（JSON の配列でない）ので書きません`); process.exit(1); }
  }
  const idx = Math.max(0, Math.min(1, Number(args.run || 1) - 1));
  const how0 = args.how && args.how !== 'true' ? String(args.how) : 'node check/fail-inject/observe.mjs ' + process.argv.slice(2).join(' ').replace(/--run \S+/, '--run 1|2');
  const how = unmeasured.length ? `${how0}／未測定（数に入れていない場面 ${unmeasured.length} 件）: ${unmeasured.join('、')}` : how0;
  const rows = itemRowsFor(result.scenarios);
  const up = upsertItemRows(m, itemNo, idx, how, rows);
  if (!up.ok) { say(`measure: もう一方の回（${2 - idx} 回目）と実行の条件か未測定の場面が違う行があるので書きません（${up.clash}）`); process.exit(1); }
  if (fs.existsSync(mf)) fs.copyFileSync(mf, mf + '.bak');
  const tmp = mf + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n');
  fs.renameSync(tmp, mf);
  say(`measure: ${mf} の item ${itemNo} を書きました（${idx + 1} 回目・${rows.length} 行・アプリ ${[...new Set(rows.map((r) => r.app))].join('・')}）`);
} else if (args.measure && args.measure !== 'true') {
  const mf = args.measure;
  /* ファイルがあるのに読めない（壊れている・書きかけ）時は、ほかの件の行を消さないよう書かずに止める */
  let m = [];
  if (fs.existsSync(mf)) {
    try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { m = null; }
    if (!Array.isArray(m)) { say(`measure: ${mf} が読めない（JSON の配列でない）ので書きません`); process.exit(1); }
  }
  const idx = Math.max(0, Math.min(1, Number(args.run || 1) - 1));
  const how0 = args.how && args.how !== 'true' ? String(args.how) : 'node check/fail-inject/observe.mjs ' + process.argv.slice(2).join(' ').replace(/--run \S+/, '--run 1|2');
  const how = unmeasured.length ? `${how0}／未測定（数に入れていない場面 ${unmeasured.length} 件）: ${unmeasured.join('、')}` : how0;
  /* もう一方の回が書いてあるのに条件（how の実行の部分・未測定の場面）が違う時は、条件の違う2回を1行に混ぜないよう書かずに止める
     （how は丸ごと上書きするので、未測定の注記が違うまま書くと、もう一方の回を数えた条件が記録から消える） */
  const other = 1 - idx;
  const clash = m.find((r) => r.item === 1 && Array.isArray(r.after) && typeof r.after[other] === 'number' && typeof r.how === 'string' && r.how !== how);
  if (clash) { say(`measure: もう一方の回（${other + 1} 回目）と実行の条件か未測定の場面が違うので書きません（同じ条件で測り直すか、行を消してから測ってください）`); process.exit(1); }
  const upsert = (metric, unit, before, val) => {
    let row = m.find((r) => r.item === 1 && r.metric === metric);
    if (!row) { row = { item: 1, app: '共通の道具（check/fail-inject・失敗を起こして数える）', metric, unit, before, after: [null, null], how: '' }; m.push(row); }
    row.after[idx] = val;
    row.how = how;
  };
  upsert('起こせる失敗の種類数', '種類', [0, 0], result.totals.failureKinds);
  upsert('観測点の数', '点', [0, 0], result.totals.observationPoints);
  upsert('偽って保存しましたと出た回数', '回', ['未測定', '未測定'], result.totals.falseSaved);
  upsert('保存の失敗が画面に出た回数', '回', ['未測定', '未測定'], result.totals.failureShown);
  upsert('送信待ちが残って後で届いた回数', '回', ['未測定', '未測定'], result.totals.deliveredLater);
  upsert('別の文脈に巻き戻りが出た回数', '回', ['未測定', '未測定'], result.totals.rollback);
  upsert('HTTP の失敗の回数', '回', ['未測定', '未測定'], result.totals.httpFail);
  upsert('アプリの ok:false の回数', '回', ['未測定', '未測定'], result.totals.appFail);
  upsert('道具がもう一度押した保存が届いた回数', '回', ['未測定', '未測定'], result.totals.manualRetryLanded);
  /* 書く前に控え（.bak）を取り、一時ファイルに書いてから置き換える */
  if (fs.existsSync(mf)) fs.copyFileSync(mf, mf + '.bak');
  const tmp = mf + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n');
  fs.renameSync(tmp, mf);
  say(`measure: ${mf} の item 1 を書きました（${idx + 1} 回目）`);
}
process.exit(exitCode);
