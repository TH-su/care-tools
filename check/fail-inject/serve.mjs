/* check/fail-inject/serve.mjs — 失敗を起こす配信サーバー（2026-10-31 新設）
 *
 *   node check/fail-inject/serve.mjs --script 台本.json [--sb http://127.0.0.1:55421] [--flags 旗.json] [--dir .]
 *     （試験用 Supabase の公開鍵は環境変数 SU_FI_SB_KEY で渡す。表示しない）
 *
 * 画面と同じオリジン（127.0.0.1・空いているポート）で次を配る。画面のコード・ディスク上のファイルは1バイトも変えない。
 *   ・配布物そのもの（check/lib.mjs の startServer と同じ「あれば返す・無ければ 404」）
 *   ・POST /__fake-gas/<名前> … 偽の GAS（名前は kv＝統合KV・master＝入居者マスタ・wt＝体重管理・spl＝消耗品管理）。台本の回だけ失敗を起こし、ほかは見本が答える
 *     「届いた（landed）」は見本の writeActions（書く action の一覧）にある action が ok で返った時。key は見本の keyOf で取り出す
 *   ・/__sb/… … 試験用 Supabase（127.0.0.1 か localhost だけ。本番には一切つながない）への中継。台本の回だけ届かない・遅いを起こす
 *   ・su-backend.json … 旗（--flags）を渡した時だけ、メモリの中の旗で返す
 *   ・su-auth.js … --sb を渡した時だけ、メモリの中で接続先（URL_）を同じオリジンの /__sb に、公開鍵（KEY）を試験用の鍵に差し替えて返す
 *   ・ws-master.json … 公開リポジトリに無い（実名を含むため配信の時だけ置く）。無い時は {} を返す。
 *     ワークスケジュールは「ファイルが無い（404）」と「中身に weekdays が無い」を同じ分岐（work-schedule.html:13370-13373 の
 *     r.ok ? r.json() : null → !p || !p.weekdays → syncCareFromMaster）に落とすので、画面の動きは同じで、読み込みのたびに出る 404 のエラーだけが消える
 *   ・favicon.ico … 配布物に無い時は 204（中身なし）を返す（ブラウザが自分で取りに来る 404 をコンソールのエラーに数えない）
 *   ・POST /__fail-inject/script … 本文の台本に差し替え、回数を 0 から数え直す（画面を開いて同期が静かになってから入れると、
 *     読み込みの時の自動の保存を数えずに、保存の操作の要求から数えられる）。GET /__fail-inject/report … 台本の一致と記録の末尾
 * 要求ごとに「HTTP の成否」と「本文のアプリの成否（ok・応答の名前）」を別々に記録する（log）。
 *
 * ★通信の形は変えない: 偽 GAS は画面が送った本文（text/plain の POST）をそのまま読み、JSON で答える。
 * ★GAS が無い・.gs が無い環境でも動く（応答の形は gas-script.mjs に写したものだけを使う）。
 * ★コンソールへの書き出しは使わない（記録はファイルと process.stdout）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, ensureDir, writeJson } from '../lib.mjs';
import { createEngine, gasFailure, sbFailure, bodyVerdict, createKvBackend, createMasterBackend } from './gas-script.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

/* 本番の Supabase へ出ないための守り: 中継先は手元（127.0.0.1・localhost）だけ */
export function assertLocalTarget(target) {
  const u = new URL(target);
  if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) || u.protocol !== 'http:') throw new Error('中継先は手元の試験用 Supabase（http://127.0.0.1:…）だけにしてください');
  return u.origin;
}

/* su-auth.js をメモリの中で差し替える。行が見つからない時は配らない（黙って本番の接続先で配らない） */
export function rewriteAuth(src, key) {
  const reUrl = /var URL_ = '[^']*';/;
  const reKey = /var KEY = '[^']*';/;
  if (!reUrl.test(src) || !reKey.test(src)) throw new Error('su-auth.js の接続先の行が見つかりません（差し替えられないので配りません）');
  return src.replace(reUrl, "var URL_ = location.origin + '/__sb';").replace(reKey, 'var KEY = ' + JSON.stringify(String(key || '')) + ';');
}

function readBody(req) {
  return new Promise((ok) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', () => ok(Buffer.alloc(0))); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 「届いた」と数える書く action。見本が writeActions を持てばそれ、持たなければ今までの固定の一覧（put・push・saveResident） */
const WRITE_ACTIONS_DEFAULT = ['put', 'push', 'saveResident'];
export function isWriteAction(be, action) {
  const list = be && Array.isArray(be.writeActions) ? be.writeActions : WRITE_ACTIONS_DEFAULT;
  return list.includes(String(action == null ? '' : action));
}
/* 台本の key に当てる値。見本が keyOf を持てばそれ、持たなければ今までどおり body.key か body.record.id */
export function keyOfBody(be, body) {
  if (be && typeof be.keyOf === 'function') { try { return be.keyOf(body || {}); } catch (e) { return null; } }
  return body && body.key != null ? String(body.key) : (body && body.record && body.record.id != null ? String(body.record.id) : null);
}

/* opts: { root, script, flags, sb:{target,key}, backends:{kv,master} } */
export function startFailInjectServer(opts) {
  const root = path.resolve(opts.root || '.');
  const sbOrigin = opts.sb && opts.sb.target ? assertLocalTarget(opts.sb.target) : null;
  let engine = createEngine(opts.script || []);
  let backends = Object.assign({}, opts.backends || {});
  let flags = opts.flags || null;
  let authRewrite = true;   // su-auth.js を試験用 Supabase へ向けるか（入居者マスタの場面では材料の架空のログインを使うので止める）
  const log = [];
  const t0 = Date.now();

  function record(e) { e.t = Date.now(); log.push(e); return e; }
  /* 中継（observe.mjs の route）が付けた通し番号。画面が先に諦めた要求に印を付けるのに使う（画面の要求そのものには付かない） */
  const fiIdOf = (req) => (req.headers['x-fi-id'] ? String(req.headers['x-fi-id']).slice(0, 40) : null);

  async function fakeGas(req, res, name) {
    const raw = (await readBody(req)).toString('utf8');
    let body = null;
    try { body = JSON.parse(raw); } catch (e) { body = null; }
    const action = body && typeof body.action === 'string' ? body.action : '';
    const be = backends[name];
    const key = keyOfBody(be, body);
    const d = engine.decide(action, key);
    const fiId = fiIdOf(req);
    /* 同じ文脈が、同じ入口・同じキーの返事を待っている間に送り直してきたら、画面はその前の要求を諦めた（自前の時計で時間切れにした）。
       ワークスケジュールは通信を止めずに時計だけで打ち切るので requestfailed が出ない。その前の要求に画面から見た失敗の印を付ける */
    if (fiId) {
      const ctxOf = (id) => String(id).slice(0, String(id).lastIndexOf('-'));
      for (const x of log) if (x.via === 'gas' && x.fiId && x.httpSeen == null && x.app === name && x.entry === action && x.key === key && ctxOf(x.fiId) === ctxOf(fiId)) x.httpSeen = 'client-gone';
    }
    const e = record({ via: 'gas', app: name, entry: action, n: d.n, key, fiId,
      injected: d.step ? d.step.kind : null, http: null, httpSeen: null, bodyOk: null, name: null, landed: false, landedAt: null });
    const pass = () => {
      if (!be) return { status: 404, body: { error: 'no backend' } };
      const out = be.respond(body || {});
      const v = bodyVerdict(out);
      if (v.ok === true && isWriteAction(be, action)) { e.landed = true; e.landedAt = Date.now(); }
      return { status: 200, body: out };
    };
    const send = (st, obj) => {
      e.http = st; const v = bodyVerdict(obj); e.bodyOk = v.ok; e.name = v.name;
      if (res.destroyed || res.writableEnded) { e.http = 'client-gone'; e.httpSeen = 'client-gone'; return; }
      if (e.httpSeen == null) e.httpSeen = st;
      res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    if (!d.step) { const p = pass(); send(p.status, p.body); return; }
    const f = gasFailure(name, d.step.kind, action, be && be.rev ? be.rev(body && body.key) : 0, d.step);
    if (f.act === 'destroy') { e.http = 0; e.httpSeen = 0; e.name = 'destroyed'; req.socket.destroy(); return; }
    if (f.act === 'hold') { await sleep(f.ms); const p = pass(); send(p.status, p.body); return; }
    send(f.status, f.body);
  }

  /* GET の偽 GAS（入居者マスタの ?action=stateRev の版数の照会だけ。本物の master.gs:337-356 の doGet と同じ答え）。
     統合KV の Code.gs には doGet が無いので、kv への GET は今までどおり 404 にする（無い形を作らない） */
  async function fakeGasGet(req, res, name) {
    const be = backends[name];
    const q = new URL(req.url || '/', 'http://x').searchParams;
    const action = q.get('action') || '';
    const d = engine.decide(action, null);
    const e = record({ via: 'gas', app: name, entry: action, n: d.n, key: null, fiId: fiIdOf(req), method: 'GET',
      injected: d.step ? d.step.kind : null, http: null, httpSeen: null, bodyOk: null, name: null, landed: false, landedAt: null });
    const out = (st, obj) => { e.http = st; e.httpSeen = st; const v = bodyVerdict(obj); e.bodyOk = v.ok; e.name = v.name;
      res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (d.step && d.step.kind === 'nores') { e.http = 0; e.httpSeen = 0; e.name = 'destroyed'; req.socket.destroy(); return Promise.resolve(); }
    const reply = () => out(200, be.respondGet(action));
    if (d.step && d.step.kind === 'timeout') return sleep(d.step.ms).then(reply);
    /* 版数の照会は合言葉を見ない（master.gs:345）＝断り・競合の形は本物に無いので作らない */
    if (d.step) throw new Error(`GET の ${action} では kind「${d.step.kind}」は起こせません`);
    reply(); return Promise.resolve();
  }

  /* 画面が先に諦めた（時間切れで通信をやめた）要求に印を付ける。サーバーの記録（http）はそのまま残し、
     画面から見た HTTP の成否（httpSeen）だけを 'client-gone' にする＝HTTP の失敗として数える */
  function markClientGone(fiId) {
    if (!fiId) return false;
    const e = log.find((x) => x.fiId === String(fiId));
    if (!e) return false;
    /* 接続を切った（0）などの失敗はそのまま。成功に見える・まだ返していない要求だけ印を付ける */
    if (!(e.httpSeen == null || (typeof e.httpSeen === 'number' && e.httpSeen >= 200 && e.httpSeen < 300))) return false;
    e.httpSeen = 'client-gone';
    return true;
  }

  async function control(req, res, p) {
    const json = (st, obj) => { res.writeHead(st, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (p === '/__fail-inject/report' && req.method === 'GET') { json(200, { ok: true, script: engine.report(), log: log.slice(-50) }); return; }
    if (p === '/__fail-inject/script' && req.method === 'POST') {
      let s2 = null;
      try { s2 = JSON.parse((await readBody(req)).toString('utf8') || '[]'); engine = createEngine(s2); }
      catch (er) { json(400, { ok: false, error: String(er && er.message || er).slice(0, 200) }); return; }
      json(200, { ok: true, script: engine.report() }); return;
    }
    json(404, { ok: false, error: 'not found' });
  }

  async function relaySb(req, res, p) {
    if (!sbOrigin) { res.writeHead(404); res.end('no sb'); return; }
    const sub = p.slice('/__sb/'.length);
    const entry = 'sb:' + sub.replace(/^rest\/v1\//, '');
    const raw = await readBody(req);
    const isPre = req.method === 'OPTIONS';
    let sbKey = null;
    try { const j = raw.length ? JSON.parse(raw.toString('utf8')) : null; sbKey = j && j.p_key != null ? String(j.p_key) : null; } catch (er) { sbKey = null; }
    const d = isPre ? { n: 0, step: null } : engine.decide(entry, sbKey);
    const e = record({ via: 'sb', app: 'sb', entry, n: d.n, key: sbKey, fiId: fiIdOf(req), method: req.method, injected: d.step ? d.step.kind : null, http: null, httpSeen: null, bodyOk: null, name: null, landed: false });
    if (d.step) {
      const f = sbFailure(d.step.kind, d.step);
      if (f.act === 'destroy') { e.http = 0; e.httpSeen = 0; e.name = 'destroyed'; req.socket.destroy(); return; }
      if (f.act === 'json') {
        e.http = f.status; e.httpSeen = f.status; const v = bodyVerdict(f.body); e.bodyOk = v.ok; e.name = v.name;
        res.writeHead(f.status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(f.body)); return;
      }
      if (f.act === 'hold') await sleep(f.ms);
    }
    const qs = (req.url || '').includes('?') ? (req.url || '').slice((req.url || '').indexOf('?')) : '';
    const headers = Object.assign({}, req.headers); delete headers.host; delete headers['content-length']; delete headers['accept-encoding'];
    const up = http.request(sbOrigin + '/' + sub + qs, { method: req.method, headers: Object.assign(headers, raw.length ? { 'content-length': raw.length } : {}) }, (ur) => {
      const ch = []; ur.on('data', (c) => ch.push(c));
      ur.on('end', () => {
        const buf = Buffer.concat(ch);
        e.http = ur.statusCode; e.httpSeen = ur.statusCode;
        let j = null; try { j = buf.length < 4e6 ? JSON.parse(buf.toString('utf8')) : null; } catch (er) { j = null; }
        const v = bodyVerdict(Array.isArray(j) ? {} : j); e.bodyOk = v.ok; e.name = v.name;
        if (ur.statusCode >= 200 && ur.statusCode < 300 && v.ok === true && /kv_put/.test(entry)) { e.landed = true; e.landedAt = Date.now(); }
        if (res.destroyed) { e.http = 'client-gone'; e.httpSeen = 'client-gone'; return; }
        const h = Object.assign({}, ur.headers); delete h['content-length']; delete h['transfer-encoding']; delete h['content-encoding'];
        res.writeHead(ur.statusCode, h); res.end(buf);
      });
    });
    up.on('error', () => { e.http = 0; e.httpSeen = 0; e.name = 'upstream-error'; try { res.writeHead(502); res.end(); } catch (er) { /* 閉じている */ } });
    up.end(raw);
  }

  function serveStatic(req, res, p) {
    if (p.endsWith('/')) p += 'index.html';
    if (p === '/su-backend.json' && flags) {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(flags)); return;
    }
    let file = path.normalize(path.join(root, p));
    if (p === '/facility-profile.json' && !fs.existsSync(file)) file = path.join(root, 'facility-profile.sample.json');
    /* ブラウザが自分で取りに来る /favicon.ico は配布物に無い。404 だとコンソールのエラーに数えられるので、中身なし（204）で答える */
    if (p === '/favicon.ico' && !fs.existsSync(file)) { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); return; }
    if (p === '/ws-master.json' && !fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end('{}'); return; }
    if (!(file === root || file.startsWith(root + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    if (p === '/su-auth.js' && sbOrigin && authRewrite) {
      const src = rewriteAuth(fs.readFileSync(file, 'utf8'), opts.sb.key);
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' }); res.end(src); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    let p = '/';
    try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { p = '/'; }
    const m = p.match(/^\/__fake-gas\/([a-z]+)$/);
    const run = m && req.method === 'POST' ? fakeGas(req, res, m[1])
      : (m && req.method === 'GET' && backends[m[1]] && typeof backends[m[1]].respondGet === 'function') ? fakeGasGet(req, res, m[1])
      : (p.startsWith('/__sb/') ? relaySb(req, res, p)
      : (p.startsWith('/__fail-inject/') ? control(req, res, p) : Promise.resolve(serveStatic(req, res, p))));
    run.catch(() => { try { res.writeHead(500); res.end('error'); } catch (e) { /* 閉じている */ } });
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + server.address().port;
      ok({
        url, log, t0,
        setScript(s) { engine = createEngine(s || []); },
        engine() { return engine; },
        setBackend(name, be) { backends[name] = be; },
        backend(name) { return backends[name]; },
        setFlags(f) { flags = f; },
        markClientGone,
        setAuthRewrite(v) { authRewrite = !!v; },
        close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); }),
      });
    });
  });
}

/* 道具として単独で起動する時（台本を読み、URL を1行出して待つ。止めると記録を check/out/fail-inject/ に書く） */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(args.dir || path.join(here, '..', '..'));
  const script = args.script ? JSON.parse(fs.readFileSync(args.script, 'utf8')) : [];
  const flags = args.flags ? JSON.parse(fs.readFileSync(args.flags, 'utf8')) : null;
  const ws = await import(pathToFileURL(path.join(repo, 'check', 'fixtures', 'work-schedule.mjs')).href);
  const rm = await import(pathToFileURL(path.join(repo, 'check', 'fixtures', 'resident-master.mjs')).href);
  const kv = createKvBackend(ws.seed());
  const master = createMasterBackend(rm.respond, (rm.respond({ action: 'getBulk' }).rows || []));
  const sb = args.sb && args.sb !== 'true' ? { target: args.sb, key: process.env.SU_FI_SB_KEY || '' } : null;
  const s = await startFailInjectServer({ root: repo, script, flags, sb, backends: { kv, master } });
  process.stdout.write(s.url + '\n');
  process.stdout.write('台本の差し替え（回数を0から数え直す）: POST ' + s.url + '/__fail-inject/script ／ 一致の確かめ: GET ' + s.url + '/__fail-inject/report\n');
  const done = async () => {
    const out = ensureDir(path.join(repo, 'check', 'out', 'fail-inject'));
    writeJson(path.join(out, 'serve-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'), { script: s.engine().report(), log: s.log });
    await s.close(); process.exit(0);
  };
  process.once('SIGINT', done); process.once('SIGTERM', done);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
