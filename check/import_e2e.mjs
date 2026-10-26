/* check/import_e2e.mjs — 全データの書き出しを、手元の使い捨ての試験用 DB に「戻す」試験（2026-10-26 新設・本人指示／代表者の決定）
 *
 *   node check/import_e2e.mjs [--backend <care-backend のパス>] [--upto 0024]   （既定 ../care-backend・移行は全部）
 *   --upto は、その番号までの移行だけを流す（0025 の前の古い export_begin() でも回ることを確かめる時）
 *
 * 本番の「戻す」機能は作らない（代表者の決定）。この道具は、書き出しの中身で本当に戻せるかを試験の中だけで確かめる。
 *   1. 素の PostgreSQL（initdb・pg_ctl・psql。PGBIN か /opt/homebrew/bin か PATH）で使い捨ての DB を立てる。
 *      care-backend の supabase/tests/run.sh と同じ土台: 00_supabase_stub.sql → fixtures/care-log → migrations を順に流す。
 *      ★データの置き場は一時フォルダに作り、終わったら（失敗・Ctrl-C でも）止めて消す。TCP のポートは開けない（ソケットだけ・番号は空きを選ぶ）
 *   2. 架空の事業者 A に、tenant_id を持つ全部の表へ架空の行を入れる（各表 1〜数行・kv_entries は 4,500 行で分けて読むことも通す）
 *   3. A の管理者（2段階認証まで＝aal2 の JWT の claims）として export_begin → export_page を全部 →
 *      画面と同じ組み立て（accounts-export.js の _buildFiles・su-export.js の zip を vm で読む）で ZIP →
 *      su-export-crypt.js で暗号化 → 復号（元の ZIP と1バイトも違わないこと）→ ZIP を開いて db/*.json と manifest.json を読む
 *   4. 別の空の DB（同じ移行を流し、事業者 B を tenants に1行だけ足す）へ、superuser として db/*.json の行を入れる
 *      ・tenant_id は B に替える。列は JSON にある列だけ。identity の列は OVERRIDING SYSTEM VALUE。外部キーの順に入れる
 *      ・戻す時は表の利用者のトリガ（操作の記録・控え・更新者の印）を止める（pg_restore と同じ考え。外部キーの確かめは止めない）
 *      ・同じ DB の中で戻すと、identity の番号（記録の表など）が A の行とぶつかるため、戻し先は別の DB にした
 *   5. 表ごとに、B の件数と manifest の件数が一致することを確かめる。
 *      さらに B の各表の行を ZIP の db/<表>.json の行と、キーの列（private.export_keycols。無ければ全列）で突き合わせ、
 *      tenant_id・書き出さない列を除いた全列の値が一致することを確かめる（jsonb・text[]・改行・引用符・先頭が = の値を含む）。
 *      突き合わせが空振りしていないことを、戻し先の値をわざと変えて見つけられるかでも確かめる
 *      入れられなかった表・列は「名前と理由（SQLSTATE）」だけを出す。値は出さない。
 *      書き出さない列（export_hidden＝合言葉・鍵の類）が NOT NULL で戻せない表は「戻せない列」として出す（失敗には数えない）
 * export_begin の形: 0025 があれば export_begin(true, null)、0024 までなら古い export_begin()。どちらで回したかを出す。
 * 外への通信はしない。データはすべて架空（実名・実在の値は使わない）。
 * ★SUPABASE_DB_URL（Supabase CLI のローカル DB）での実行は、戻し先の別の DB を作れないため、この版では扱わない。
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';
import { loadCrypt } from './export-decrypt.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const backend = path.resolve(args.backend && args.backend !== 'true' ? String(args.backend) : path.join(repoDir, '..', 'care-backend'));
const SB = path.join(backend, 'supabase');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + String(typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 400))); }
}

/* ── PostgreSQL の道具 ── */
function findBin() {
  const c = [process.env.PGBIN, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
  try { c.push(fs.readdirSync('/usr/lib/postgresql').sort().reverse().map((v) => '/usr/lib/postgresql/' + v + '/bin')[0]); } catch (e) { /* 無ければ次 */ }
  for (const d of c) if (d && fs.existsSync(path.join(d, 'pg_ctl')) && fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'psql'))) return d;
  return '';
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

if (process.env.SUPABASE_DB_URL) {
  console.log('SUPABASE_DB_URL での実行はこの版では扱いません（戻し先の別の DB を作れないため）。素の PostgreSQL で回してください。');
  process.exit(2);
}
if (!fs.existsSync(path.join(SB, 'migrations')) || !fs.existsSync(path.join(SB, 'tests', '00_supabase_stub.sql'))) {
  console.log('care-backend が見つかりません: ' + backend + '（--backend で指定してください）');
  process.exit(2);
}
const BIN = findBin();
if (!BIN) { console.log('PostgreSQL（initdb・pg_ctl・psql）が見つかりません。PGBIN で bin のフォルダを指定してください。'); process.exit(2); }

const UPTO = args.upto && args.upto !== 'true' ? String(args.upto) : '';
if (UPTO && !/^\d{4}$/.test(UPTO)) { console.log('--upto は4桁の番号で指定してください（例 0024）'); process.exit(2); }
const MIGS = fs.readdirSync(path.join(SB, 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f) && (!UPTO || f.slice(0, 4) <= UPTO)).sort();
const CARELOG = fs.readdirSync(path.join(SB, 'tests', 'fixtures', 'care-log')).filter((f) => f.endsWith('.sql')).sort();
const lastMig = MIGS[MIGS.length - 1] || '';

/* データの置き場（ソケットの名前の長さの上限 約104字のため、Mac は短い /tmp の下に作る） */
const base = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
const WORK = fs.mkdtempSync(path.join(base, 'su-import-e2e-'));
const DATA = path.join(WORK, 'db');
let started = false;
function cleanup() {
  if (started) { spawnSync(path.join(BIN, 'pg_ctl'), ['-D', DATA, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: PGENV }); started = false; }
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) { /* 消せなかった時は下で知らせる */ }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

let PORT = 0;
/* Mac の PostgreSQL は、ロケールの指定が無いと起動の途中で止まる（postmaster became multithreaded）。run.sh と同じく LC_ALL を決めて渡す */
const PGENV = Object.assign({}, process.env, { LC_ALL: process.env.PG_LC_ALL || 'en_US.UTF-8', LANG: process.env.PG_LC_ALL || 'en_US.UTF-8' });
/* psql に SQL を渡して結果の文字を受け取る。失敗の時は SQLSTATE だけを返す（値の入りうる文は出さない） */
function psql(db, sql, { allowFail = false } = {}) {
  const file = path.join(WORK, 'q.sql');
  fs.writeFileSync(file, '\\set VERBOSITY sqlstate\n' + sql);
  const r = spawnSync(path.join(BIN, 'psql'), ['-h', WORK, '-p', String(PORT), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-At', '-f', file],
    { encoding: 'utf8', maxBuffer: 1 << 28, env: PGENV });
  fs.rmSync(file, { force: true });
  if (r.status !== 0) {
    const st = (/ERROR:\s+([0-9A-Z]{5})/.exec(r.stderr || '') || [])[1] || ('終了コード ' + r.status);
    if (allowFail) return { error: st };
    throw new Error('SQL が失敗しました（' + st + '）');
  }
  return allowFail ? { out: r.stdout } : r.stdout;
}
function psqlFile(db, file, transform) {
  let sql = fs.readFileSync(file, 'utf8');
  if (transform) sql = transform(sql);
  try { psql(db, sql); } catch (e) { throw new Error(path.basename(file) + ': ' + e.message); }
}
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
/* JSON を SQL の文字にする（ドル記号の囲みの印は、中身に出てこない物を選ぶ） */
function dollar(s) {
  let tag = 'j';
  while (s.includes('$' + tag + '$')) tag += 'x';
  return '$' + tag + '$' + s + '$' + tag + '$';
}

/* ── 架空のデータ ── */
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const ADMIN = 'a-admin@example.com';
const SUB = '00000000-0000-4000-8000-00000000a0a0';
const CLAIMS = JSON.stringify({
  sub: SUB, email: ADMIN, role: 'authenticated', aal: 'aal2',
  amr: [{ method: 'oauth', timestamp: 1 }, { method: 'totp', timestamp: 2 }],
  app_metadata: { provider: 'google' }
});
const SEED = `
-- run.sh と同じく、0017 の古い版の画面の書き込みの拒否は外す（この試験は日データに版の印を付けない）
update private.app_settings set value = '0' where key = 'ws_min_app_ver';
insert into public.tenants (id, name) values ('${A}', '試験用 戻す元の事業者');
insert into public.allowed_accounts (email, tenant_id, role, label, is_active) values
  ('${ADMIN}', '${A}', 'admin', '架空の管理者', true),
  ('a-office@example.com', '${A}', 'office', '架空の事務所', true),
  ('a-field@example.com', '${A}', 'field', '=架空の現場', true);
insert into public.kv_entries (tenant_id, key, rev, data)
  select '${A}', 'wsday_' || to_char(date '2000-01-01' + i, 'YYYY-MM-DD'), i, jsonb_build_object('n', i, '名前', '架空 ' || i, '改行', E'a\\nb', '並び', jsonb_build_array(i, null))
    from generate_series(0, 4496) i;
insert into public.kv_entries (tenant_id, key, data) values
  ('${A}', 'care_schedule_v2', '{"名前":"試験 太郎","値":[1,2,3],"改行":"1行目\\n2行目","引用":"\\"a\\",b"}'),
  ('${A}', 'ws_weekly_master_v1', '{"空":null,"数":1.5}'),
  ('${A}', 'wsday_2026-10-01', '{}');
insert into public.master_residents (tenant_id, source_id, name, kana, room, active, target_apps, discharge_date) values
  ('${A}', 'X001', '試験 花子', 'しけん はなこ', '101', true,  array['a','b,c'], '2026-01-02'),
  ('${A}', 'X002', '=1+1',      '',             '',    false, '{}',           null);
insert into public.staff_names (tenant_id, source_id, name) values ('${A}', 'S1', '架空 職員'), ('${A}', 'S2', '架空 職員二');
insert into public.shift_leases (tenant_id, device_id, holder_name, token, epoch) values ('${A}', 'dev1', '架空 職員', 'FAKE-LEASE-TOKEN', 3);
insert into public.audit_log (tenant_id, actor_email, action, entity, entity_ids, fields) values
  ('${A}', '${ADMIN}', 'update', 'kv_entries', array['care_schedule_v2'], array['data']);
insert into public.kv_history (tenant_id, key, rev, data) values ('${A}', 'care_schedule_v2', 1, '{"events":[{"t":"09:30"}]}'), ('${A}', 'care_schedule_v2', 2, '{"x":2.25}');
insert into public.kv_families (tenant_id, family, mode) values ('${A}', 'care', 'live');
insert into public.master_residents_care (tenant_id, source_id, visit_day, hospital) values ('${A}', 'X001', '火', '架空病院');
insert into public.master_sync_runs (tenant_id, source_count) values ('${A}', 2);
insert into public.weight_residents (tenant_id, id, data) values ('${A}', 'r1', '{"id":"r1","h":150.5}');
insert into public.weight_records (tenant_id, id, data) values ('${A}', 'w1', '{"id":"w1","kg":50.5}'), ('${A}', 'w2', '{"id":"w2","kg":49}');
insert into public.weight_thresholds (tenant_id, data) values ('${A}', '{"warn":2}');
insert into public.weight_sync_runs (tenant_id) values ('${A}');
insert into public.shift_settings (tenant_id, lock_required) values ('${A}', true);
insert into public.row_revisions (tenant_id, table_name, row_key, op, old_row) values ('${A}', 'master_residents', 'X001', 'update', '{"name":"旧"}');
insert into public.reports (tenant_id, reporter, reporter_role, kind, body) values ('${A}', gen_random_uuid(), 'office', 'manual', '架空の報告');
insert into public.patch_settings (tenant_id, resident_id, start_on, site_no, prev_no, set_by, set_at)
  values ('${A}', 'X001', '2026-09-01', 2, 1, '架空', '2026-09-01T00:00:00Z');
insert into public.patch_history (tenant_id, resident_id, start_on, site_no, prev_no, set_by, set_at, received_at, updated_at)
  values ('${A}', 'X001', '2026-08-01', 1, 0, '架空', '2026-08-01T00:00:00Z', now(), now());
insert into public.menu_settings (tenant_id, config) values ('${A}', '{"ver":1}');
`;

/* ── 画面と同じ ZIP の組み立て（su-export.js・accounts-export.js を vm で読む）── */
function loadBuilder() {
  const b = { TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, JSON, Object, Array, Math, Date, Promise, setTimeout, clearTimeout };
  b.window = b; b.globalThis = b;
  vm.createContext(b);
  vm.runInContext(fs.readFileSync(path.join(repoDir, 'su-export.js'), 'utf8'), b);
  vm.runInContext(fs.readFileSync(path.join(repoDir, 'accounts-export.js'), 'utf8'), b);
  return b;
}
/* ZIP を読む（中央ディレクトリから・stored だけ。su-export.js は圧縮しない） */
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP の終わりの印がありません');
  const n = dv.getUint16(e + 10, true), cdOff = dv.getUint32(e + 16, true);
  const out = {}; let p = cdOff;
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    if (method !== 0) throw new Error('圧縮された中身は読めません');
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true);
    out[name] = buf.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + size);
    p += 46 + nl + el + cl;
  }
  return out;
}

const TEN_TABLES_SQL = `select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
 where c.table_schema = 'public' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE' order by 1;`;

let dbLabel = '';
const report = { restored: [], notRestored: [], unrestorableCols: [], skipped: [], emptyCols: [] };
try {
  console.log('土台: 素の PostgreSQL（' + BIN + '）＋ Supabase の真似（00_supabase_stub.sql）');
  console.log('care-backend: ' + backend + '（移行 ' + MIGS.length + ' 本・最後は ' + lastMig + '）');
  const init = spawnSync(path.join(BIN, 'initdb'), ['-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C.UTF-8'], { encoding: 'utf8', env: PGENV });
  if (init.status !== 0) {
    const init2 = spawnSync(path.join(BIN, 'initdb'), ['-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale'], { encoding: 'utf8', env: PGENV });
    if (init2.status !== 0) throw new Error('initdb に失敗しました');
  }
  PORT = await freePort();
  const st = spawnSync(path.join(BIN, 'pg_ctl'), ['-D', DATA, '-o', `-p ${PORT} -k ${WORK} -c listen_addresses=''`, '-l', path.join(WORK, 'log'), '-w', 'start'], { encoding: 'utf8', env: PGENV });
  if (st.status !== 0) {
    let why = '';
    try { why = (/(FATAL|LOG):\s+(.*)/.exec(fs.readFileSync(path.join(WORK, 'log'), 'utf8').split('\n').filter((l) => /FATAL/.test(l)).pop() || '') || [])[2] || ''; } catch (e) { /* 記録が無い */ }
    throw new Error('PostgreSQL を起動できませんでした' + (why ? '（' + why.slice(0, 200) + '）' : ''));
  }
  started = true;

  /* 同じ移行を2つの DB に流す（postgres＝書き出す元・restore＝戻し先）。役割はクラスタで1つなので、2つ目は stub の create role を飛ばす */
  psql('postgres', 'create database restore;');
  for (const db of ['postgres', 'restore']) {
    psqlFile(db, path.join(SB, 'tests', '00_supabase_stub.sql'), db === 'restore' ? (s) => s.replace(/^create role .*$/gm, '') : null);
    for (const f of CARELOG) psqlFile(db, path.join(SB, 'tests', 'fixtures', 'care-log', f));
    for (const f of MIGS) psqlFile(db, path.join(SB, 'migrations', f));
  }
  const nargs = psql('postgres', "select string_agg(pronargs::text, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'export_begin';").trim();
  const v25 = nargs === '2';
  dbLabel = v25 ? '0025（export_begin(p_encrypted, p_plain_reason)）で回した' : (nargs === '0' ? '0024 まで（古い export_begin()）で回した' : '');
  if (!dbLabel) throw new Error('export_begin の形が分かりません（引数の数 ' + nargs + '）');
  console.log('DB の版: ' + dbLabel + '（移行の最後 ' + lastMig + '）');

  console.log('\n— 1. 架空の事業者 A に、tenant_id を持つ全部の表へ行を入れる —');
  psql('postgres', SEED);
  const tenTables = psql('postgres', TEN_TABLES_SQL).trim().split('\n').filter(Boolean);
  const cnt = JSON.parse(psql('postgres', 'select jsonb_object_agg(x.t, x.n) from (' + tenTables.map((n) =>
    `select ${q(n)} as t, (select count(*) from public.${'"' + n + '"'} where tenant_id = '${A}') as n`).join(' union all ') + ') x;').trim());
  const empty = tenTables.filter((n) => n !== 'export_runs' && !(cnt[n] > 0));
  t('tenant_id を持つ ' + tenTables.length + ' 表すべてに A の架空の行がある（export_runs は書き出しが自分で書く）', empty.length === 0,
    '架空の行を用意していない表: ' + empty.join('、'));
  t('kv_entries は 4,500 行（2000 行ずつ3回に分けて読む）', cnt.kv_entries === 4500, cnt.kv_entries);

  console.log('\n— 2. A の管理者（aal2）として書き出す —');
  const asAdmin = (sql) => psql('postgres', `select set_config('request.jwt.claims', ${q(CLAIMS)}, false);\nset role authenticated;\n` + sql).trim().split('\n').pop();
  const b = JSON.parse(asAdmin(v25 ? 'select public.export_begin(true, null)::text;' : 'select public.export_begin()::text;'));
  t('export_begin が書き出しの番号と表の一覧を返す', b && b.run_id && Array.isArray(b.tables) && b.tables.length > 0 && b.tenant_id === A, b && Object.keys(b));
  if (v25) {
    const rec = psql('postgres', `select encrypted::text || '|' || coalesce(plain_reason, '(null)') from public.export_runs where id = ${Number(b.run_id)};`).trim();
    t('記録: 暗号化する（encrypted = true・理由は null）', rec === 'true|(null)', rec);
  }
  const data = {}, pagesOf = {};
  for (const tb of b.tables) {
    const rows = []; let after = null; let n = 0;
    for (;;) {
      const r = JSON.parse(asAdmin(`select public.export_page(${Number(b.run_id)}, ${q(tb.name)}, ${after == null ? 'null' : q(JSON.stringify(after)) + '::jsonb'}, 2000)::text;`));
      for (const x of r.rows) rows.push(x);
      n++;
      after = r.next;
      if (after == null) break;
      if (n > 1000) throw new Error('読み終わりません: ' + tb.name);
    }
    data[tb.name] = rows; pagesOf[tb.name] = n;
  }
  t('kv_entries は 3 回に分けて読んだ', pagesOf.kv_entries === 3, pagesOf.kv_entries);
  const shared = b.tables.filter((x) => x.scope === 'shared').map((x) => x.name);
  t('表ごとの件数: export_page で受け取った数 = export_begin が数えた数', b.tables.every((x) => data[x.name].length === x.count),
    b.tables.filter((x) => data[x.name].length !== x.count).map((x) => x.name));

  console.log('\n— 3. 画面と同じ形の ZIP → 暗号化 → 復号 → 開く —');
  const W = loadBuilder();
  const files = W.SUAccountsExport._buildFiles(b, data, [], false);
  const zip = W.SUExport.zip(files, new Date(b.started_at));
  const X = loadCrypt();
  const PASS = 'kakuu-import-0001';   // 架空
  /* 画面と同じく、ZIP の部品の並び（zipParts）をそのまま区切りごとに暗号にする。区切りは小さくして（64KiB）区切りの多いファイルにする */
  const sealed = Buffer.concat((await X.encrypt(W.SUExport.zipParts(files, new Date(b.started_at)), PASS, { chunkSize: 64 * 1024 })).map((c) => Buffer.from(c)));
  const opened = new Uint8Array(Buffer.concat((await X.decrypt(sealed, PASS)).map((c) => Buffer.from(c))));
  t('暗号化して戻した ZIP は、元の ZIP と1バイトも違わない（' + Math.round(zip.length / 1024) + ' KB）', Buffer.from(opened).equals(Buffer.from(zip)), opened.length);
  const z = unzip(opened);
  const man = JSON.parse(new TextDecoder().decode(z['manifest.json']));
  const json = {};
  for (const name of Object.keys(z)) {
    const m = /^db\/([A-Za-z0-9_]+)\.json$/.exec(name);
    if (m) json[m[1]] = JSON.parse(new TextDecoder().decode(z[name]));
  }
  t('ZIP の db/*.json は目録（manifest）の表と同じ数・同じ名前', Object.keys(json).sort().join(',') === man.db.map((d) => d.table).sort().join(','), Object.keys(json).length);

  console.log('\n— 4. 空の事業者 B（別の DB）へ戻す —');
  psql('restore', `insert into public.tenants (id, name) values ('${B}', '試験用 戻し先の事業者');`);
  /* 列の情報（戻し先の DB）: identity・生成列・NOT NULL で既定値なし */
  const colInfo = JSON.parse(psql('restore', `select coalesce(jsonb_object_agg(table_name, cols), '{}') from (
     select c.table_name, jsonb_agg(jsonb_build_object('name', c.column_name, 'identity', c.is_identity = 'YES', 'generated', c.is_generated = 'ALWAYS',
              'required', c.is_nullable = 'NO' and c.column_default is null and c.is_identity = 'NO' and c.is_generated = 'NEVER')) cols
       from information_schema.columns c where c.table_schema = 'public' group by c.table_name) x;`).trim());
  /* 外部キーの順（参照される表を先に） */
  const fk = psql('restore', `select distinct c.conrelid::regclass::text || '>' || c.confrelid::regclass::text from pg_constraint c
     join pg_namespace n on n.oid = c.connamespace where c.contype = 'f' and n.nspname = 'public' and c.conrelid <> c.confrelid;`)
    .trim().split('\n').filter(Boolean).map((l) => l.split('>').map((x) => x.replace(/^public\./, '').replace(/"/g, '')));
  const names = man.db.map((d) => d.table);
  const order = [], seen = new Set(), visiting = new Set();
  function visit(n) {
    if (seen.has(n) || visiting.has(n)) return;
    visiting.add(n);
    for (const [from, to] of fk) if (from === n && names.includes(to)) visit(to);
    visiting.delete(n); seen.add(n); order.push(n);
  }
  names.slice().sort().forEach(visit);

  for (const name of order) {
    const d = man.db.find((x) => x.table === name);
    const rows = json[name] || [];
    if (d.scope === 'self') { report.skipped.push(name + '（事業者の表。戻し先の B の1行をそのまま使う）'); continue; }
    if (d.scope === 'shared') { report.skipped.push(name + '（ケアログの表。テナントの印が無いため事業者を替えて戻せない）'); continue; }
    const info = colInfo[name] || [];
    const hidden = (d.hidden || []);
    const reqHidden = info.filter((c) => c.required && hidden.includes(c.name)).map((c) => c.name);
    hidden.filter((c) => !reqHidden.includes(c)).forEach((c) => report.emptyCols.push(name + '.' + c));
    if (reqHidden.length) report.unrestorableCols.push(name + '.' + reqHidden.join('・') + '（書き出さない列で、NOT NULL・既定値なし）');
    if (!rows.length) { report.restored.push(name); continue; }
    const present = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => present.add(k)));
    const gen = info.filter((c) => c.generated).map((c) => c.name);
    const cols = info.map((c) => c.name).filter((c) => present.has(c) && !gen.includes(c));
    const unknown = [...present].filter((c) => !info.some((x) => x.name === c));
    if (unknown.length) report.notRestored.push(name + ': 戻し先に無い列 ' + unknown.join('・'));
    const ident = info.some((c) => c.identity && cols.includes(c.name));
    const body = JSON.stringify(rows.map((r) => (Object.prototype.hasOwnProperty.call(r, 'tenant_id') ? Object.assign({}, r, { tenant_id: B }) : r)));
    const cl = cols.map((c) => '"' + c.replace(/"/g, '""') + '"').join(', ');
    const r = psql('restore', `begin;
alter table public."${name}" disable trigger user;
insert into public."${name}" (${cl}) ${ident ? 'overriding system value ' : ''}select ${cl} from jsonb_populate_recordset(null::public."${name}", ${dollar(body)}::jsonb);
alter table public."${name}" enable trigger user;
commit;`, { allowFail: true });
    if (r.error) report.notRestored.push(name + ': 入れられなかった（SQLSTATE ' + r.error + (r.error === '23502' && reqHidden.length ? '＝書き出さない必須の列 ' + reqHidden.join('・') : '') + '）');
    else report.restored.push(name);
  }

  console.log('\n— 5. 表ごとの件数（目録 = 戻し先の B）—');
  const bcnt = JSON.parse(psql('restore', 'select jsonb_object_agg(x.t, x.n) from (' + names.map((n) => {
    const d = man.db.find((x) => x.table === n);
    const w = d.scope === 'self' ? `id = '${B}'` : (d.scope === 'tenant' ? `tenant_id = '${B}'` : 'true');
    return `select ${q(n)} as t, (select count(*) from public."${n}" where ${w}) as n`;
  }).join(' union all ') + ') x;').trim());
  const bad = [];
  for (const d of man.db) {
    const ok = bcnt[d.table] === d.count;
    if (!ok && d.scope !== 'shared') bad.push(d.table);
    console.log('    ' + (ok ? '一致  ' : '不一致') + ' ' + d.table.padEnd(24) + ' 目録 ' + String(d.count).padStart(5) + ' / 戻し先 ' + String(bcnt[d.table]).padStart(5));
  }
  /* 「戻せない列」がある表も除かない（件数も残りの列の値も確かめる） */
  t('入れられなかった表・列が無い', report.notRestored.length === 0, report.notRestored.join('、'));
  t('表ごとの件数が目録と一致する（' + man.db.length + ' 表）', bad.length === 0, bad.join('、'));
  console.log('    合計: 目録 ' + man.db.reduce((s, d) => s + d.count, 0) + ' 行 / 戻し先 ' + man.db.reduce((s, d) => s + (bcnt[d.table] || 0), 0) + ' 行');

  console.log('\n— 6. 値の突き合わせ（キーの列で行を合わせ、tenant_id・書き出さない列を除いた全列を比べる）—');
  /* 試験の行に、戻しで崩れやすい値が入っていることを先に確かめる（入っていなければ突き合わせが素通りになる） */
  const zj = (n) => JSON.stringify(json[n] || []);
  t('突き合わせる行に jsonb・text[]・改行・引用符・先頭が = の値が入っている',
    /"data":\{/.test(zj('kv_entries')) && /\\n/.test(zj('kv_entries')) && /\\"a\\"/.test(zj('kv_entries')) &&
    (json.master_residents || []).some((r) => Array.isArray(r.target_apps) && r.target_apps.includes('b,c')) &&
    (json.master_residents || []).some((r) => r.name === '=1+1') && (json.allowed_accounts || []).some((r) => /^=/.test(r.label || '')), '');
  /* キーを並べ替えた JSON の文字（jsonb の並びの違いで食い違いにしない） */
  const canon = (v) => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' :
    (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
  function compareAll() {
  const valBad = [];
  let compared = 0;
  for (const d of man.db) {
    if (d.scope !== 'tenant') continue;   // tenants（self）は戻し先の B の行そのもの・ケアログ（shared）は戻さない
    const drop = ['tenant_id'].concat(d.hidden || []);
    const strip = (r) => { const o = {}; Object.keys(r).forEach((k) => { if (!drop.includes(k)) o[k] = r[k]; }); return o; };
    let keys = JSON.parse(psql('restore', `select coalesce(to_jsonb(private.export_keycols(${q(d.table)})), 'null'::jsonb)::text;`).trim());
    keys = Array.isArray(keys) ? keys.filter((k) => k !== 'tenant_id') : null;
    if (keys && !keys.length) keys = null;   // キーが tenant_id だけの表（事業者ごとに1行）は全列で合わせる
    const arr = 'array[' + drop.map(q).join(',') + ']::text[]';
    const bRows = JSON.parse(psql('restore', `select coalesce(jsonb_agg(to_jsonb(t) - ${arr}), '[]'::jsonb)::text from public."${d.table}" t where tenant_id = '${B}';`).trim());
    const zRows = (json[d.table] || []).map(strip);
    const keyOf = (r) => keys ? canon(keys.map((k) => r[k])) : canon(r);
    const bm = new Map();
    for (const r of bRows) { const k = keyOf(r); (bm.get(k) || bm.set(k, []).get(k)).push(r); }
    let missing = 0, diffRows = 0;
    const diffCols = new Set();
    for (const r of zRows) {
      const list = bm.get(keyOf(r));
      if (!list || !list.length) { missing++; continue; }
      const b2 = list.shift();
      let rowDiff = false;
      for (const c of new Set([...Object.keys(r), ...Object.keys(b2)])) {
        if (canon(r[c]) !== canon(b2[c])) { diffCols.add(c); rowDiff = true; }
      }
      if (rowDiff) diffRows++;
      compared++;
    }
    const extra = [...bm.values()].reduce((s2, l) => s2 + l.length, 0);
    if (missing || extra || diffRows) {
      /* 値は出さない。表・列の名前と件数だけ */
      valBad.push(d.table + '（' + [missing ? 'B に無い行 ' + missing : '', extra ? 'ZIP に無い行 ' + extra : '',
        diffRows ? '値が違う行 ' + diffRows + '・列 ' + [...diffCols].join('・') : ''].filter(Boolean).join('／') + '）');
    }
  }
  return { valBad, compared };
  }
  const cmp = compareAll();
  t('戻し先 B の行の値が、ZIP の db/<表>.json の行と全列一致する（' + cmp.compared + ' 行・キーの列で突き合わせ）', cmp.valBad.length === 0, cmp.valBad.join('、'));
  /* 突き合わせが空振りしていないことの確かめ: 戻し先の1行の1列・配列の1つを、わざと変えて見つけられるか */
  psql('restore', `alter table public.master_residents disable trigger user;
update public.master_residents set kana = kana || 'x', target_apps = array['a'] where tenant_id = '${B}' and source_id = 'X001';
alter table public.master_residents enable trigger user;`);
  const cmp2 = compareAll();
  t('わざと変えた値（master_residents の2列）を、表と列の名前で見つける', cmp2.valBad.length === 1 && /^master_residents（値が違う行 1・列 /.test(cmp2.valBad[0]) &&
    /kana/.test(cmp2.valBad[0]) && /target_apps/.test(cmp2.valBad[0]), cmp2.valBad.join('、'));
  t('戻し先の B には A の tenant_id の行が1行も無い（別の DB に戻すため参考）', JSON.parse(psql('restore', 'select coalesce(sum(n), 0) from (' + tenTables.map((n) =>
    `select count(*) n from public."${n}" where tenant_id = '${A}'`).join(' union all ') + ') x;').trim()) === 0, '');

  console.log('\n結果:');
  console.log('  DB の版: ' + dbLabel);
  console.log('  戻せた表: ' + report.restored.length + ' 表');
  console.log('  戻していない表: ' + (report.skipped.length ? report.skipped.join('、') : 'なし'));
  console.log('  入れられなかった表・列: ' + (report.notRestored.length ? report.notRestored.join('、') : 'なし'));
  console.log('  戻せない列: ' + (report.unrestorableCols.length ? report.unrestorableCols.join('、') : 'なし'));
  console.log('  空で戻った列（書き出さない合言葉・鍵の類。NOT NULL ではないので行は戻る）: ' + (report.emptyCols.length ? report.emptyCols.join('、') : 'なし'));
  if (shared.length) console.log('  ケアログの表（書き出しに入った・戻さない）: ' + shared.join('、'));
} catch (e) {
  t('例外なし', false, String(e && e.message || e));
} finally {
  cleanup();
  t('使い捨ての DB を止めて消した', !fs.existsSync(WORK), WORK);
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格' + (dbLabel ? '（' + dbLabel + '）' : ''));
process.exit(fail ? 1 : 0);
