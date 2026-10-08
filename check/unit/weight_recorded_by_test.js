/* weight-record.html の「記録した人」（2026-10-08・監査10月版 #7・本人決定 1a 2b 3a）の検証。
   HTML から対象関数だけを切り出して vm で動かす（写経しない＝実物を試す）。

   守りたいこと:
   1. 誰が＝ログイン中なら「表示名（メールの @ より前）」、表示名が無ければ @ より前だけ。
      未ログイン・確かめられない時は端末の役割（事務所PC／現場端末）。端末ごとの呼び名は作らない
   2. 削除（delRecord・delResident）は送る時に by を添える。保存（saveRecord 等）には添えない。渡された data は書き換えない
   3. 新しく作る記録には recordedBy、直す記録には updatedBy を入れる（作る3か所・直す6か所）。取込・見本データには入れない
   4. ログインの控えが無い端末では部品を読み込まない。ログイン中なら起動後に1回だけ確かめる

   対象HTMLは環境変数 WEIGHT_HTML で差し替えられる（worktree で検証するため）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.WEIGHT_HTML || path.join(__dirname, '..', '..', 'weight-record.html');
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}
function cut(name) {
  const head = src.indexOf('function ' + name + '(');
  if (head < 0) throw new Error('関数が見つからない: ' + name);
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  throw new Error('関数の終端が見つからない: ' + name);
}
function lineOf(re) { const m = src.match(re); if (!m) throw new Error('行が見つからない: ' + re); return m[0]; }

function makeCtx(opt) {
  opt = opt || {};
  const store = Object.assign({}, opt.ls || {});
  const loaded = [];
  const ctx = {
    console,
    setTimeout,
    Promise,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: {
      scripts: [],
      createElement: () => ({}),
      head: { appendChild: s => { loaded.push(s.src); if (s.onerror) setTimeout(() => s.onerror(), 0); } }
    },
    _writeQ: [],
    _writeDrain: () => {},
    apiUrl: 'https://script.google.com/macros/s/TEST/exec',
    SU_DEVICE_KEY: 'su_device_role'
  };
  ctx.window = ctx;
  if (opt.SUAuth) ctx.SUAuth = opt.SUAuth;
  vm.createContext(ctx);
  vm.runInContext([
    lineOf(/var WR_SESSION_KEY = [^\n]*/),
    lineOf(/var wrWhoAcct_ = [^\n]*/),
    cut('suGetDeviceRole'), cut('wrIsField'), cut('wrWho_'), cut('wrWhoLabel_'),
    cut('wrAuthLoad_'), cut('wrResolveWho_'), cut('apiPush')
  ].join('\n'), ctx, { filename: 'weight-record.html' });
  ctx._loaded = loaded;
  return ctx;
}
const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
  console.log('\n— 1. 誰が の書き方（ログインの確認結果から）—');
  {
    const c = makeCtx();
    const L = st => c.wrWhoLabel_(st);
    t('表示名とメール → 「表示名（@ より前）」', L({ status: 'ok', email: 'staff1@example.jp', label: '事務 太郎' }) === '事務 太郎（staff1）', L({ status: 'ok', email: 'staff1@example.jp', label: '事務 太郎' }));
    t('表示名が無い → @ より前だけ', L({ status: 'ok', email: 'staff1@example.jp', label: '' }) === 'staff1' && L({ status: 'ok', email: 'staff1@example.jp' }) === 'staff1', '');
    t('表示名が @ より前と同じ → 重ねない', L({ status: 'ok', email: 'staff1@example.jp', label: 'staff1' }) === 'staff1', '');
    t('表示名の前後の空白は落とす', L({ status: 'ok', email: 'a@b.jp', label: '  事務  ' }) === '事務（a）', L({ status: 'ok', email: 'a@b.jp', label: '  事務  ' }));
    t('ログインしていない・許可外・エラー → 空（役割の名前に落ちる）',
      ['signed_out', 'denied', 'error'].every(s => L({ status: s, email: 'a@b.jp', label: 'x' }) === ''), '');
    t('2段階の6桁がまだの管理者（mfa_verify・mfa_enroll）は、Google で本人と分かるのでアカウントで残す',
      ['mfa_verify', 'mfa_enroll'].every(s => L({ status: s, email: 'adm@b.jp', label: '管理' }) === '管理（adm）'), '');
    t('メールが無い・結果が無い → 空', L({ status: 'ok', email: '' }) === '' && L(null) === '' && L(undefined) === '', '');
    const long = L({ status: 'ok', email: 'a'.repeat(60) + '@b.jp', label: 'あ'.repeat(60) });
    t('長すぎる値は 40 文字ずつに切る', long === 'あ'.repeat(40) + '（' + 'a'.repeat(40) + '）', long.length);
  }

  console.log('\n— 2. ログインしていない時は端末の役割（本人決定 2b）—');
  {
    t('役割が未設定 → 事務所PC', makeCtx().wrWho_() === '事務所PC', makeCtx().wrWho_());
    t('事務所PC → 事務所PC', makeCtx({ ls: { su_device_role: 'office' } }).wrWho_() === '事務所PC', '');
    t('現場端末 → 現場端末', makeCtx({ ls: { su_device_role: 'field' } }).wrWho_() === '現場端末', '');
    const c = makeCtx({ ls: { su_device_role: 'field' } });
    c.wrWhoAcct_ = 'staff1';
    t('ログインが確かめられた後は、現場端末でもアカウント', c.wrWho_() === 'staff1', c.wrWho_());
    t('端末ごとの呼び名のキー（su_device_name 等）は作らない', !/su_device_name|deviceName/.test(cut('wrWho_') + cut('wrResolveWho_')), '');
  }

  console.log('\n— 3. 削除には by を添える・保存には添えない —');
  {
    const c = makeCtx({ ls: { su_device_role: 'field' } });
    const d1 = { id: 'w1' };
    c.apiPush('delRecord', d1);
    c.apiPush('delResident', { id: 'r1' });
    c.apiPush('delRecord', { id: 'w2', by: '先に決めた人' });
    c.apiPush('saveRecord', { record: { id: 'w3' } });
    const q = c._writeQ;
    t('delRecord に by（この端末の役割）', q[0].action === 'delRecord' && q[0].data.id === 'w1' && q[0].data.by === '現場端末', q[0]);
    t('delResident にも by', q[1].data.by === '現場端末', q[1]);
    t('既に by があれば上書きしない', q[2].data.by === '先に決めた人', q[2]);
    t('saveRecord には by を足さない', !('by' in q[3].data), q[3]);
    t('渡した data そのものは書き換えない（呼び出し元の控えを汚さない）', !('by' in d1), d1);
    const c2 = makeCtx(); c2.apiUrl = '';
    c2.apiPush('delRecord', { id: 'w1' });
    t('接続先が無ければ積まない（従来どおり）', c2._writeQ.length === 0, c2._writeQ);
  }

  console.log('\n— 3b. サーバーへ送る本文に by が載る（送る項目を決め打ちで並べているので、足し忘れると届かない）—');
  {
    const sent = [];
    const ctx = { apiUrl: 'https://script.google.com/macros/s/TEST/exec', apiToken: 'tok',
      fetchTO: (u, o) => { sent.push(JSON.parse(o.body)); return Promise.resolve({}); },
      _parseApiResponse: () => Promise.resolve({ ok: true }), JSON, Promise };
    vm.createContext(ctx);
    vm.runInContext('async ' + cut('apiPost'), ctx);   // 本体は async function（cut は async を含まない）
    await ctx.apiPost('delRecord', { id: 'w1', by: '事務 太郎（staff1）' });
    await ctx.apiPost('saveRecord', { record: { id: 'w2', recordedBy: '現場端末' } });
    t('delRecord の本文に by と id', sent[0].action === 'delRecord' && sent[0].id === 'w1' && sent[0].by === '事務 太郎（staff1）', sent[0]);
    t('saveRecord の本文の記録に recordedBy がそのまま載り、by は載らない', sent[1].record.recordedBy === '現場端末' && !('by' in sent[1]), sent[1]);
    t('同期の後始末が自動で消す入居者は「自動（同期の後始末）」で残す（その端末の人の名前にしない）',
      /apiPush\('delResident', \{ id, by: '自動（同期の後始末）' \}\)/.test(src), '');
  }

  console.log('\n— 4. ログインの確認は、控えがある端末でだけ・結果を覚える —');
  {
    const c = makeCtx();
    c.wrResolveWho_(); await tick();
    t('ログインの控えが無い → 部品を読み込まない', c._loaded.length === 0, c._loaded);
    let n = 0;
    const SUAuth = { check: () => { n++; return Promise.resolve({ status: 'ok', email: 'staff2@example.jp', label: '介護 花子' }); } };
    const c2 = makeCtx({ ls: { 'sb-jhbernqawjrzqwrmqrih-auth-token': '{}' }, SUAuth });
    c2.supabase = {};
    c2.wrResolveWho_(); await tick();
    t('控えがある → 確かめて「表示名（@ より前）」を覚える', c2.wrWho_() === '介護 花子（staff2）' && n === 1, [c2.wrWho_(), n]);
    const c3 = makeCtx({ ls: { 'sb-jhbernqawjrzqwrmqrih-auth-token': '{}' }, SUAuth: { check: () => Promise.resolve({ status: 'signed_out' }) } });
    c3.supabase = {};
    c3.wrResolveWho_(); await tick();
    t('確かめた結果が未ログイン → 役割の名前のまま', c3.wrWho_() === '事務所PC', c3.wrWho_());
    const c4 = makeCtx({ ls: { 'sb-jhbernqawjrzqwrmqrih-auth-token': '{}' } });
    let threw = false;
    try { c4.wrResolveWho_(); await tick(); await tick(); } catch (e) { threw = true; }
    t('部品が読めない → 例外を出さず役割の名前のまま', !threw && c4.wrWho_() === '事務所PC' && c4._loaded[0] === 'supabase-js-2.112.4.js', [threw, c4._loaded]);
    t('起動時に1回呼ぶ（端末ガードの直後・失敗しても止めない）', /\napplyWeightDeviceGuard\(\);\ntry\{ wrResolveWho_\(\); \}catch\(e\)\{/.test(src), '');
  }

  console.log('\n— 5. 記録を作る所・直す所に入っている —');
  {
    const created = (src.match(/recordedBy: wrWho_\(\),/g) || []).length;
    t('新しい記録を作る3か所（入力・一括・1行ずつ）に recordedBy', created === 3, created);
    const edited = (src.match(/\.updatedBy\s*=\s*wrWho_\(\);/g) || []).length;
    t('記録を直す6か所（入力・一括・1行ずつ・車椅子の再計算・まとめ・付け替え）に updatedBy', edited === 6, edited);
    const recUpd = (src.match(/(existing|editing|x|rec)\.updatedAt\s*=\s*(nowIso|now|new Date\(\)\.toISOString\(\));/g) || []).length;
    t('記録の updatedAt を入れる所の数と updatedBy の数が同じ（入れ忘れが無い）', recUpd === edited, [recUpd, edited]);
    const h = src.indexOf("$('#cfgSample').addEventListener");
    const sample = h < 0 ? '' : src.slice(h, src.indexOf("\n$('#", h + 10));
    t('見本データ（設定の「見本を入れる」）には入れない', sample.length > 200 && /見本/.test(sample) && !/recordedBy|updatedBy/.test(sample), sample.length);
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
