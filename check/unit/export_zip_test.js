/* 全データの書き出し（su-export.js・accounts-export.js）の試験（2026-10-26 新設）
   実行: node check/unit/export_zip_test.js
   守ること:
     ①作った ZIP を、ほかの道具（Python の zipfile・unzip）がそのまま開ける（壊れていない・名前が化けない）
     ②架空の事業者の書き出しを ZIP にして読み戻すと、JSON は元のデータと1文字も違わない（件数・目録・説明書きも合う）
     ③CSV: BOM・CRLF・引用符と改行の包み方・先頭が = + - @ の値に ' を付ける（表計算ソフトで式にしない）
     ④ZIP の名前は英数字と / . _ - だけ（よその階層へ展開させない）・同じ名前を2つ入れない
     ⑤GAS の読み方: su-data-gas.js の post と同じ形（text/plain・redirect follow・合言葉は本文だけ・URL に載せない）・
       接続設定が無い系統は読まない・断られた系統は「入っていない」にして、断りの文を記録に写さない
   データはすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SRC_X = fs.readFileSync(path.join(ROOT, 'su-export.js'), 'utf8');
const SRC_A = fs.readFileSync(path.join(ROOT, 'accounts-export.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

function box(extra) {
  const b = Object.assign({ TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, JSON, Object, Array, Math, Date, Promise,
                            setTimeout, clearTimeout, console }, extra || {});
  b.window = b; b.globalThis = b;
  vm.createContext(b);
  vm.runInContext(SRC_X, b);
  vm.runInContext(SRC_A, b);
  return b;
}

/* ZIP を自前で読む（中央ディレクトリから）。stored だけ */
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  const n = dv.getUint16(e + 10, true), cdOff = dv.getUint32(e + 16, true);
  const out = {}; let p = cdOff;
  for (let i = 0; i < n; i++) {
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true);
    out[name] = { flags, method, data: buf.slice(lo + 30 + lnl + lel, lo + 30 + lnl + lel + size) };
    p += 46 + nl + el + cl;
  }
  return out;
}
const txt = u8 => new TextDecoder().decode(u8);

/* CSV を読む（試験用・RFC 4180） */
function parseCsv(s) {
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r' && s[i + 1] === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'export-zip-'));
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
process.on('exit', cleanup);

/* ── 架空の事業者の書き出し（データベースの export_begin・export_page の返す形と同じ）── */
const B = {
  run_id: 7, started_at: '2026-10-26T01:23:45.678+00:00', tenant_id: '00000000-0000-4000-8000-00000000000c',
  tenant_name: '試験用 書き出し事業者', actor_email: 'c-admin@example.com', total: 6,
  tables: [
    { name: 'kv_entries', scope: 'tenant', count: 2, comment: '同期データの本体', columns: [
      { name: 'tenant_id', type: 'uuid' }, { name: 'key', type: 'text' }, { name: 'rev', type: 'integer' }, { name: 'data', type: 'jsonb', comment: '' }] },
    { name: 'master_residents', scope: 'tenant', count: 3, comment: '入居者マスタの写し', columns: [
      { name: 'tenant_id', type: 'uuid' }, { name: 'source_id', type: 'text' }, { name: 'name', type: 'text' }, { name: 'target_apps', type: 'ARRAY' }, { name: 'active', type: 'boolean' }] },
    { name: 'tenants', scope: 'self', count: 1, comment: '', columns: [{ name: 'id', type: 'uuid' }, { name: 'name', type: 'text' }] },
    { name: 'audit_log', scope: 'tenant', count: 0, comment: '操作の記録', columns: [{ name: 'id', type: 'bigint' }] }
  ]
};
const DATA = {
  kv_entries: [
    { tenant_id: B.tenant_id, key: 'care_schedule_v2', rev: 3, data: { '名前': '試験 太郎', '改行': '1行目\n2行目', '引用': '"a",b', '数': 1.5, '空': null, '並び': [1, 2, 3] } },
    { tenant_id: B.tenant_id, key: 'wsday_2026-10-01', rev: 1, data: {} }
  ],
  master_residents: [
    { tenant_id: B.tenant_id, source_id: 'X001', name: '試験 花子', target_apps: ['a', 'b,c'], active: true },
    { tenant_id: B.tenant_id, source_id: 'X002', name: '=1+1', target_apps: [], active: false },
    { tenant_id: B.tenant_id, source_id: 'X003', name: '-架空 𠮷野', target_apps: null, active: null }
  ],
  tenants: [{ id: B.tenant_id, name: B.tenant_name }],
  audit_log: []
};
const GASR = [
  { id: 'weight', title: '体重管理', ok: true, count: 2, unit: '記録', note: '',
    parts: { residents: [{ id: 'r1', name: '架空 一郎' }], records: [{ id: 'w1', kg: 50.5 }, { id: 'w2', kg: '+3' }], thresholds: { warn: 2 } } },
  { id: 'ws', title: '統合同期', ok: true, count: 1, unit: 'キー', parts: { entries: { 'care_schedule_v2': { key: 'care_schedule_v2', rev: 2, data: { events: [] } } } } },
  { id: 'geno', title: 'ジェノグラム', ok: false, count: 0, note: 'この端末の接続設定に無い' }
];

console.log('\n— 1・2. 架空の事業者を ZIP にして読み戻す —');
{
  const b = box();
  const files = b.SUAccountsExport._buildFiles(B, DATA, GASR);
  const when = new Date(2026, 9, 26, 10, 23, 46);
  const bytes = b.SUExport.zip(files, when);
  const zpath = path.join(TMP, 'export.zip');
  fs.writeFileSync(zpath, Buffer.from(bytes));

  const z = unzip(Buffer.from(bytes));
  const names = Object.keys(z).sort();
  t('ZIP の中身の一覧（説明書き・目録・表ごとの JSON と CSV・GAS の読めた系統だけ）',
    JSON.stringify(names) === JSON.stringify([
      'README.txt', 'db/audit_log.csv', 'db/audit_log.json', 'db/kv_entries.csv', 'db/kv_entries.json',
      'db/master_residents.csv', 'db/master_residents.json', 'db/tenants.csv', 'db/tenants.json',
      'gas/weight.json', 'gas/weight__records.csv', 'gas/weight__residents.csv', 'gas/weight__thresholds.csv',
      'gas/ws.json', 'gas/ws__entries.csv', 'manifest.json'].sort()), names);
  t('全部のファイルが「圧縮なし・名前は UTF-8」の印', Object.values(z).every(f => f.method === 0 && f.flags === 0x0800), '');
  const back = {};
  B.tables.forEach(tb => { back[tb.name] = JSON.parse(txt(z['db/' + tb.name + '.json'].data)); });
  t('読み戻し: データベースの全部の表の JSON が元のデータと同じ（日本語・改行・引用符・小数・null・配列・外字）',
    JSON.stringify(back) === JSON.stringify(DATA), '');
  t('読み戻し: GAS の分も応答のまま戻る', JSON.stringify(JSON.parse(txt(z['gas/weight.json'].data))) === JSON.stringify(GASR[0].parts), '');
  const man = JSON.parse(txt(z['manifest.json'].data));
  t('目録: 書き出しの番号・人・事業者・表ごとの件数・GAS の系統の可否が入る',
    man.run_id === 7 && man.actor_email === 'c-admin@example.com' && man.tenant_id === B.tenant_id &&
    man.db.map(d => d.table + ':' + d.count).join(',') === 'kv_entries:2,master_residents:3,tenants:1,audit_log:0' &&
    man.gas.map(g => g.id + ':' + g.ok + ':' + g.count).join(',') === 'weight:true:2,ws:true:1,geno:false:0', man);
  t('目録に合言葉・接続先の URL は入らない', !/token|script\.google|exec/i.test(txt(z['manifest.json'].data)), '');
  const rd = txt(z['README.txt'].data);   // TextDecoder は先頭の BOM を外して読む（BOM は下で生のバイトで確かめる）
  const rdBom = z['README.txt'].data[0] === 0xEF && z['README.txt'].data[1] === 0xBB && z['README.txt'].data[2] === 0xBF;
  t('説明書き: 事業者・人・番号・件数・表の説明・列・個人情報の注意・入っていないもの',
    rdBom && rd.includes('試験用 書き出し事業者') && rd.includes('c-admin@example.com') && rd.includes('書き出しの番号: 7') &&
    rd.includes('合計 6 行') && rd.includes('【kv_entries】 2 行（この事業者の行だけ）') && rd.includes('同期データの本体') &&
    rd.includes('data（jsonb）') && rd.includes('【tenants】 1 行（この事業者の1行だけ）') && rd.includes('（説明なし）') &&
    rd.includes('個人情報がそのまま入っています') && rd.includes('ジェノグラム') && rd.includes('入っていません: この端末の接続設定に無い') &&
    rd.includes('申送ビューア') && rd.includes('token'), rd.slice(0, 400));
  const mr = parseCsv(txt(z['db/master_residents.csv'].data));
  t('CSV: 見出しは表の列の順', mr[0].join('|') === 'tenant_id|source_id|name|target_apps|active', mr[0]);
  t('CSV: 行の数は表の行の数＋見出し', mr.length === 4, mr.length);
  t('CSV: 配列は JSON の文字・カンマを含む値も1つのセル', mr[1][3] === '["a","b,c"]', mr[1]);
  t("CSV: 先頭が = や - の値は ' を付けて式にしない", mr[2][2] === "'=1+1" && mr[3][2] === "'-架空 𠮷野", [mr[2][2], mr[3][2]]);
  t('CSV: null は空のセル・真偽は true/false', mr[3][3] === '' && mr[3][4] === '' && mr[1][4] === 'true' && mr[2][4] === 'false', mr[3]);
  const kv = parseCsv(txt(z['db/kv_entries.csv'].data));
  t('CSV: JSON の値（改行・引用符入り）は1つのセルで、JSON として読み戻せる', JSON.stringify(JSON.parse(kv[1][3])) === JSON.stringify(DATA.kv_entries[0].data), kv[1][3]);
  const wr = parseCsv(txt(z['gas/weight__records.csv'].data));
  t("CSV: GAS の記録も表になり、先頭が + の値には ' が付く", wr[0].join('|') === 'id|kg' && wr[2][1] === "'+3", wr);
  const we = parseCsv(txt(z['gas/ws__entries.csv'].data));
  t('CSV: キー→中身の形は「キー」の列と、中身の1段目の列になる', we[0][0] === 'キー' && we[1][0] === 'care_schedule_v2' && we[0].includes('rev'), we);
  const audit = parseCsv(txt(z['db/audit_log.csv'].data));
  t('CSV: 行の無い表も見出しだけは入る', audit.length === 1 && audit[0][0] === 'id', audit);

  /* ほかの道具で開けるか */
  try {
    const py = execFileSync('python3', ['-I', '-c',
      'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nbad=z.testzip()\n' +
      'print(json.dumps({"bad":bad,"names":sorted(z.namelist()),"kv":json.loads(z.read("db/kv_entries.json").decode("utf-8"))},ensure_ascii=False))', zpath]).toString();
    const r = JSON.parse(py);
    t('Python の zipfile: 壊れたファイル無し（CRC が合う）・名前が同じ', r.bad === null && JSON.stringify(r.names) === JSON.stringify(names), r.bad);
    t('Python の zipfile: 中身を読み戻すと元のデータと同じ', JSON.stringify(r.kv) === JSON.stringify(DATA.kv_entries), '');
  } catch (e) { t('Python の zipfile で開ける', false, String(e.message).slice(0, 200)); }
  try {
    const out = execFileSync('unzip', ['-t', zpath]).toString();
    t('unzip -t: 全部 OK', /No errors detected/.test(out) && (out.match(/  OK/g) || []).length === names.length, out.slice(-120));
  } catch (e) { t('unzip -t で確かめられる', false, String(e.message).slice(0, 200)); }
}

console.log('\n— 3. CSV —');
{
  const b = box();
  const c = b.SUExport.csv([{ a: 'x', b: 'y"z' }, { a: '@SUM(1)', c: '\t1' }]);
  t('BOM 付き・CRLF・最後も改行', c.startsWith('﻿a,b,c\r\n') && c.endsWith('\r\n'), c);
  t('引用符は2つに重ねて包む', c.includes('x,"y""z",'), c);
  t("@ とタブで始まる値に ' が付く", c.includes("'@SUM(1),,'\t1"), c);
  t('列は出てきた順にそろう（後から出た列は後ろ）', JSON.stringify(b.SUExport.columnsOf([{ a: 1 }, { b: 2, a: 3 }])) === '["a","b"]', '');
  t('tableOf: オブジェクトの配列・値の配列・キーと中身・それ以外', JSON.stringify(b.SUExport.tableOf([1, 'x'])) === '[{"値":1},{"値":"x"}]' &&
    JSON.stringify(b.SUExport.tableOf({ k: 1 })) === '[{"キー":"k","中身":1}]' && b.SUExport.tableOf('x') === null && b.SUExport.tableOf(null) === null, '');
  const long = b.SUExport.csv([{ a: 'x'.repeat(40000) }]);
  t('Excel のセルに入らない長さ（32,000 字超）は「JSON を見て」と書く（切れた値を見せない）', long.includes('（長すぎるため JSON の方を見てください：40000 字）') && long.length < 200, long.length);
  const zp = b.SUExport.zipParts([{ name: 'a.txt', data: 'abc' }], new Date(2026, 0, 1));
  const z1 = b.SUExport.zip([{ name: 'a.txt', data: 'abc' }], new Date(2026, 0, 1));
  t('部分の並び（画面が Blob にする形）をつなぐと、1つの ZIP と同じバイト列', Buffer.concat(zp.map(x => Buffer.from(x))).equals(Buffer.from(z1)), '');
  t('数え方: 配列の長さ（配列でないものは0）', JSON.stringify(b.SUExport.counts({ a: [1, 2], b: [], c: null })) === '{"a":2,"b":0,"c":0}', '');
}

console.log('\n— 4. ZIP の名前 —');
{
  const b = box();
  const bad = ['../x.json', '/x.json', 'a/../b.json', 'x', 'db/表.json', 'a\\b.json', 'a//b.json', 'db/.json', ''];
  const leaked = bad.filter(n => { try { b.SUExport.zip([{ name: n, data: '1' }]); return true; } catch (e) { return false; } });
  t('よその階層・日本語・区切りの崩れた名前は ZIP にしない（' + bad.length + '通り）', leaked.length === 0, leaked);
  let dup = false; try { b.SUExport.zip([{ name: 'a.txt', data: '1' }, { name: 'a.txt', data: '2' }]); } catch (e) { dup = true; }
  t('同じ名前を2つ入れない', dup, '');
  t('CRC-32 が決まりどおり（"123456789" → cbf43926）', b.SUExport.crc32(new TextEncoder().encode('123456789')).toString(16) === 'cbf43926', '');
  t('表の名前は ZIP の名前の規則に入る（データベースの表の名前は英小文字・数字・_ だけ）',
    ['kv_entries', 'master_residents_care', 'export_runs'].every(n => b.SUExport.NAME_RE.test('db/' + n + '.json')), '');
}

console.log('\n— 5. GAS の読み方 —');
(async () => {
  const calls = [];
  const store = {
    su_sync_common: JSON.stringify({ endpoint: 'https://script.google.com/macros/s/WS/exec', token: 'tok-ws' }),
    wtmgr_api_url: 'https://script.google.com/macros/s/WT/exec', wtmgr_api_token: '',
    'genogram:cloudCfg': JSON.stringify({ gasUrl: 'https://script.google.com/macros/s/GE/exec', gasToken: 'tok-ge' }),
    rmaster_cfg: JSON.stringify({ url: 'https://script.google.com/macros/s/MA/exec', token: 'tok-ma' }),
    adm_cfg: JSON.stringify({ url: 'https://evil.example/exec', token: 'tok-adm' })
  };
  const fetch = (url, opt) => {
    calls.push({ url, opt });
    const body = JSON.parse(opt.body);
    let res;
    if (url.includes('/WS/')) res = { ok: true, entries: { care_schedule_v2: { key: 'care_schedule_v2', rev: 1 } } };
    else if (url.includes('/WT/')) res = { ok: true, residents: [{ id: 'r1' }], records: [{ id: 'w1' }, { id: 'w2' }], thresholds: {} };
    else if (url.includes('/GE/')) res = { ok: false, error: 'この図は権限がありません（架空の断りの文・氏名入り）' };
    else if (url.includes('/MA/')) res = body.action === 'getRoster' ? { roster: [{ id: 'X1' }, { id: 'X2' }, { id: 'X3' }] }
      : (body.id === 'X2' ? { error: '認証エラー' } : { record: { id: body.id, name: '架空' } });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(res) });
  };
  const b = box({ fetch, AbortController, localStorage: { getItem: k => (k in store ? store[k] : null) } });
  /* readGas は外に出していないので、同じ関数を _GAS と _cfg から回す（画面の run と同じ順番・同じ判定） */
  const src = SRC_A.slice(SRC_A.indexOf('async function readGas'), SRC_A.indexOf('function stamp('));
  vm.runInContext('var GAS = SUAccountsExport._GAS, cfg = SUAccountsExport._cfg, RE_GAS = /^https:\\/\\/script\\.google\\.com\\/.*\\/exec(\\?|#|$)/;' + src + ';this.readGas = readGas;', b);
  const steps = [];
  const out = await b.readGas((n, all, title) => steps.push(n + '/' + all));
  const by = {}; out.forEach(g => { by[g.id] = g; });
  t('8つの系統を順に読む', steps.join(',') === '1/8,2/8,3/8,4/8,5/8,6/8,7/8,8/8' && out.length === 8, steps);
  t('統合同期: pull でキーの数を数える', by.ws.ok && by.ws.count === 1 && by.ws.parts.entries.care_schedule_v2.rev === 1, by.ws);
  t('体重管理: 合言葉なし（サーバー側で未設定の運用）でも読む・記録の数を数える', by.weight.ok && by.weight.count === 2, by.weight);
  t('入居者マスタ: 名簿のあと1人ずつ読む・1人読めなくても残りは残し、読めなかった数を書く', by.master.ok && by.master.count === 2 &&
    by.master.parts.residents.length === 2 && by.master.parts.roster.length === 3 && /1 件は読めなかった/.test(by.master.note) &&
    calls.filter(c => c.url.includes('/MA/')).length === 4, by.master);
  t('ジェノグラム: 断られたら「入っていない」・断りの文（氏名が混ざりうる）は記録に写さない',
    !by.geno.ok && by.geno.count === 0 && !/権限がありません/.test(by.geno.note) && !by.geno.parts, by.geno);
  t('入居調整: 接続先が Google の /exec でなければ送らない', !by.adm.ok && !calls.some(c => c.url.includes('evil')), by.adm);
  t('接続設定に無い系統（訓練計画・排泄・過去シフト）は送らない', ['tp', 'haiben', 'analyzer'].every(k => !by[k].ok && /接続設定に無い/.test(by[k].note)), '');
  t('送り方は su-data-gas.js と同じ（POST・text/plain・redirect follow）',
    calls.every(c => c.opt.method === 'POST' && c.opt.headers['Content-Type'] === 'text/plain;charset=utf-8' && c.opt.redirect === 'follow'), '');
  t('合言葉は本文の token だけ（URL に載せない）',
    calls.every(c => !/tok-/.test(c.url)) && JSON.parse(calls[0].opt.body).token === 'tok-ws', calls.map(c => c.url));
  const SRC_GAS = fs.readFileSync(path.join(ROOT, 'su-data-gas.js'), 'utf8');
  t('su-data-gas.js の post の形（ヘッダー・redirect）がこのファイルと同じ文',
    SRC_GAS.includes("headers: { 'Content-Type': 'text/plain;charset=utf-8' }") && SRC_A.includes("headers: { 'Content-Type': 'text/plain;charset=utf-8' }") &&
    SRC_GAS.includes("redirect: 'follow'") && SRC_A.includes("redirect: 'follow'"), '');

  console.log('\n— 6. 画面の守り —');
  const HTML = fs.readFileSync(path.join(ROOT, 'accounts.html'), 'utf8');
  t('画面のコードに innerHTML を使わない', !/innerHTML|outerHTML|insertAdjacentHTML/.test(SRC_A + SRC_X), '');
  t('console.log を足していない', !/console\.log/.test(SRC_A + SRC_X), '');
  t('CSP: GAS の2つの宛先だけ足した（ほかは今までどおり self と Supabase）',
    /connect-src https:\/\/jhbernqawjrzqwrmqrih\.supabase\.co wss:\/\/jhbernqawjrzqwrmqrih\.supabase\.co https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com;/.test(HTML) &&
    /script-src 'self';/.test(HTML), '');
  t('部品の読み込みは accounts.js より前', HTML.indexOf('su-export.js?v=') < HTML.indexOf('accounts-export.js?v=') && HTML.indexOf('accounts-export.js?v=') < HTML.indexOf('accounts.js?v='), '');
  t('書き出しの枠は最初は隠れている（管理者と分かってから出す）', /<section class="cd" id="sec-export" hidden>/.test(HTML), '');
  /* 2026-10-26: export_begin は暗号化の有無と理由を渡す形（0025）になったので、呼び出しの目印は「c.rpc('export_begin',」 */
  const BEGIN = SRC_A.indexOf("c.rpc('export_begin',");
  t('現場の端末では書き出さない（su_device_role が field なら止める）', BEGIN > 0 && /role === 'field'/.test(SRC_A) && SRC_A.indexOf("role === 'field'") < BEGIN &&
    SRC_A.indexOf('if (isField())') > 0 && SRC_A.indexOf('if (isField())') < BEGIN, BEGIN);
  t('始める前に個人情報の注意で確かめる', BEGIN > 0 && SRC_A.indexOf('confirm(') < BEGIN, BEGIN);

  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外 ' + e.stack); process.exit(1); });
