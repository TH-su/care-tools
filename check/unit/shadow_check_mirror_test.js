/* 写しの見比べ（shadow-check）の「本番の中身を Google と比べる」（2026-10-16 新設）。
   守りたいこと:
     A 日ごとは今日の30日前〜60日先だけを比べる（範囲の外・形の違うキーは数えない）
     B 中身の比べ方: 同じ（キーの順番が違っても同じ）・Google が古い・Google に無い・Supabase から読めない を分ける
     C 砂場で動かす（Google・データベースの応答だけ偽物）: 本番の種類だけ比べる・写しの期間の種類は比べない・
       Google が古い時は件数と「古い中身が出ているおそれ」を出す・全部同じなら「届いています」・比べる時はどちらにも書かない
     D 違う分を Google へ写す（2026-10-16 代表者の決定）: 違いがある時だけボタンを出す・管理者だけ・確認を断れば書かない・
       写す直前にまだ本番かを確かめ直す（本番でなくなった種類は写さない）・Supabase の最新を force で Google へ・Supabase には書かない・写した後に比べ直す
   ★画面の本物の関数を切り出して動かす。
   実行: node check/unit/shadow_check_mirror_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'shadow-check.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'shadow-check.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
/* 同じ名前の関数が2つある時は、実行時に効く後の方（関数の宣言は後が勝つ）を切り出す（canon の重複は 2026-10-17 に片付けた） */
function fn(name) {
  const i = SRC.lastIndexOf('function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  const st = SRC.lastIndexOf('\n', i) + 1;
  let d = 0, seen = false, q = null;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    const c = SRC[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{') { d++; seen = true; } else if (c === '}') { d--; if (seen && !d) return SRC.slice(st, k + 1); }
  }
  throw new Error('unterminated ' + name);
}
const PURE = ['var MC_FAMS = ' + /var MC_FAMS = (\[[^;]*\]);/.exec(SRC)[1] + ';', 'var MC_BACK = 30, MC_AHEAD = 60;',
  fn('canon'), fn('sameData'), fn('mcDayKeys'), fn('mcCompare')].join('\n');
const env = {}; vm.createContext(env); vm.runInContext(PURE, env);

t('比べ方（canon）の定義は1つだけ（同じ名前が2つあると後の方だけが効き、読み違える・2026-10-17）', (SRC.match(/function canon\(/g) || []).length === 1);
console.log('— A 日ごとの範囲 —');
{
  const k = env.mcDayKeys(['wsday_2026-09-15', 'wsday_2026-09-16', 'wsday_2026-10-16', 'wsday_2026-12-15', 'wsday_2026-12-16', 'care_schedule_v2', 'wsday_bad'], '2026-10-16');
  t('★A 30日前（9/16）〜60日先（12/15）だけ・範囲外と形の違うキーは数えない', JSON.stringify(k) === JSON.stringify(['wsday_2026-09-16', 'wsday_2026-10-16', 'wsday_2026-12-15']), k);
  t('A 画面の設定が30日前〜60日先', /var MC_BACK = 30, MC_AHEAD = 60;/.test(SRC));
}
console.log('\n— B 中身の比べ方 —');
{
  const c = env.mcCompare(['a', 'b', 'c', 'd'], { a: { x: 1, y: [1, 2] }, b: { x: 2 }, c: { x: 3 }, d: null },
    { a: { rev: 5, data: { y: [1, 2], x: 1 } }, b: { rev: 9, data: { x: 1 } } });
  t('★B キーの順番が違っても同じ中身は「同じ」（版の番号は見ない）', c.same === 1, c);
  t('★B 中身が違えば「Google が古い」', JSON.stringify(c.stale) === '["b"]', c.stale);
  t('B Google に無ければ「無い」', JSON.stringify(c.missing) === '["c"]', c.missing);
  t('B Supabase から読めなければ「読めない」（同じとも古いとも数えない）', JSON.stringify(c.unread) === '["d"]', c.unread);
}
console.log('\n— C 砂場で動かす —');
async function sandbox(o) {
  const els = {}, writes = [], rpcs = [];
  function E(id) { return els[id] || (els[id] = { id, className: '', textContent: '', disabled: false, children: [], replaceChildren() { this.children = []; }, appendChild(x) { this.children.push(x); } }); }
  const gasPuts = [];
  const sb = {
    from: () => ({ select: () => Promise.resolve({ data: (o.famsSeq && o.famsSeq.length ? o.famsSeq.shift() : o.fams), error: null }) }),
    rpc: (name, args) => {
      rpcs.push(name);
      if (name === 'kv_index') return Promise.resolve({ data: { revs: o.sbIndex }, error: null });
      if (name === 'kv_get') return Promise.resolve({ data: { data: o.sb[args.p_key] }, error: null });
      writes.push(name); return Promise.resolve({ data: { ok: true }, error: null });
    }
  };
  const box = Object.assign({}, {
    $: E, SUAuth: { client: () => sb }, gasTarget: () => ({ url: 'x', token: 'y' }), Date, Promise, String, Object, Number, JSON,
    gasPullAll: (tgt, keys) => { const out = {}; keys.forEach(k => { if (o.gas[k] !== undefined) out[k] = { rev: 1, data: o.gas[k] }; }); return Promise.resolve(out); },
    preItem: (title, note, bad) => ({ title, note, bad }), kpi: (l, v) => ({ l, v }),
    famOf: k => (k === 'care_schedule_v2' ? 'care' : k === 'ws_weekly_master_v1' ? 'ws_master' : /^wsday_/.test(k) ? 'wsday' : 'shift'),
    gasPostRetry: (tgt, body) => { gasPuts.push(body); if (body.action === 'put') o.gas[body.key] = body.data; return Promise.resolve({ ok: true }); },
    confirm: () => o.confirm !== false,
    me: o.me === undefined ? { role: 'admin', status: 'ok' } : o.me,
    mcToday: () => '2026-10-16'
  });
  box.SUAuth.STATUS = { OK: 'ok' };
  vm.createContext(box);
  vm.runInContext(PURE + '\nvar mcOn = false, mcFix = [];\n' + fn('mcShowFix') + '\n' + fn('runMirrorCheck') + '\n' + fn('runMirrorFix')
    + '\nthis.__run = runMirrorCheck; this.__fix = runMirrorFix; this.__fixList = function () { return mcFix; };', box);
  await box.__run();
  const R = { v: E('mc-verdict'), list: E('mc-list').children, kpis: E('mc-kpis').children, writes, rpcs, btn: E('b-mirror-check'), fixBtn: E('b-mirror-fix'), gasPuts, box, o };
  if (o.doFix) { await box.__fix(); R.after = { v: E('mc-verdict').textContent, fix: box.__fixList().slice() }; }
  return R;
}
(async () => {
  const live = [{ family: 'care', mode: 'live' }, { family: 'ws_master', mode: 'live' }, { family: 'wsday', mode: 'live' }, { family: 'shift', mode: 'live' }];
  let r = await sandbox({ fams: live, sbIndex: { 'wsday_2026-10-15': 3, 'wsday_2026-10-16': 8, 'wsday_2025-01-01': 1 },
    sb: { care_schedule_v2: { p: [1] }, ws_weekly_master_v1: { w: 1 }, 'wsday_2026-10-15': { d: 1 }, 'wsday_2026-10-16': { d: 2 } },
    gas: { care_schedule_v2: { p: [1] }, ws_weekly_master_v1: { w: 1 }, 'wsday_2026-10-15': { d: 1 }, 'wsday_2026-10-16': { d: 2 } } });
  t('★C 全部同じなら「届いています」（ok）', r.v.className === 'msg ok' && /全部届いています/.test(r.v.textContent), r.v.textContent);
  t('C 範囲外の日（2025-01-01）は比べない（日ごと 2件）', r.kpis.some(k => k.l === 'ワークスケジュール（日ごと）' && k.v === '2／2'), r.kpis);
  t('★C どちらにも書かない（呼ぶのは kv_index と kv_get だけ）', r.writes.length === 0 && r.rpcs.every(n => n === 'kv_index' || n === 'kv_get'), r.rpcs);
  t('C 勤務表は比べない（本番でも）', !r.kpis.some(k => /勤務表/.test(k.l)) && !r.list.some(x => /勤務表/.test(x.title)));
  t('C 終わったらボタンを押せる状態に戻す', r.btn.disabled === false);
  r = await sandbox({ fams: live, sbIndex: { 'wsday_2026-10-16': 8, 'wsday_2026-10-17': 2 },
    sb: { care_schedule_v2: { p: [2] }, ws_weekly_master_v1: { w: 1 }, 'wsday_2026-10-16': { d: 2 }, 'wsday_2026-10-17': { d: 9 } },
    gas: { care_schedule_v2: { p: [1] }, ws_weekly_master_v1: { w: 1 }, 'wsday_2026-10-16': { d: 2 } } });
  t('★C Google が古い・無い件数を合わせて出し、古い中身のおそれを知らせる（warn）', r.v.className === 'msg warn' && /2件あります/.test(r.v.textContent) && /古い中身が出ているおそれ/.test(r.v.textContent), r.v.textContent);
  t('C 週間計画は「Google が古い 1件」・日ごとは「Google に無い 1件」', r.list.some(x => x.title === '週間計画' && /Google が古い 1件/.test(x.note) && x.bad) && r.list.some(x => /日ごと/.test(x.title) && /Google に無い 1件/.test(x.note)), r.list);
  r = await sandbox({ fams: [{ family: 'care', mode: 'shadow' }], sbIndex: {}, sb: {}, gas: {} });
  t('C 写しの期間の種類は比べず、本番が無いと知らせる', /本番になっている種類がありません/.test(r.v.textContent) && r.list.every(x => /まだ本番ではありません/.test(x.note)) && r.rpcs.length === 0, r.v.textContent);
  console.log('\n— D 違う分を Google へ写す —');
  const staleCase = () => ({ fams: live, sbIndex: { 'wsday_2026-10-16': 8, 'wsday_2026-10-19': 2 },
    sb: { care_schedule_v2: { p: [1] }, ws_weekly_master_v1: { w: 2 }, 'wsday_2026-10-16': { d: 2 }, 'wsday_2026-10-19': { d: 9 } },
    gas: { care_schedule_v2: { p: [1] }, ws_weekly_master_v1: { w: 1 }, 'wsday_2026-10-16': { d: 2 }, 'wsday_2026-10-19': { d: 1 } } });
  r = await sandbox(staleCase());
  t('★D 違いがある時だけボタンを出し、件数を書く', r.fixBtn.hidden === false && /（2件）/.test(r.fixBtn.textContent), r.fixBtn);
  r = await sandbox(Object.assign(staleCase(), { doFix: true }));
  t('★D 写すのは違う2件だけ・Supabase の最新を force・版0 で Google へ', JSON.stringify(r.gasPuts.map(p => [p.key, p.force, p.rev, JSON.stringify(p.data)])) === JSON.stringify([['ws_weekly_master_v1', true, 0, '{"w":2}'], ['wsday_2026-10-19', true, 0, '{"d":9}']]), r.gasPuts);
  t('★D Supabase には書かない（kv_index・kv_get だけ）', r.writes.length === 0, r.rpcs);
  t('★D 写した後に比べ直し、全部そろったと出す・ボタンを隠す', /写した 2件/.test(r.after.v) && /全部届いています/.test(r.after.v) && r.after.fix.length === 0 && r.fixBtn.hidden === true, r.after);
  r = await sandbox(Object.assign(staleCase(), { doFix: true, confirm: false }));
  t('D 確認を断れば Google へ書かない', r.gasPuts.length === 0);
  r = await sandbox(Object.assign(staleCase(), { doFix: true, me: { role: 'office', status: 'ok' } }));
  t('★D 管理者でなければ書かない', r.gasPuts.length === 0 && /管理者/.test(r.after.v), r.after.v);
  const c2 = staleCase(); c2.famsSeq = [live, [{ family: 'care', mode: 'live' }, { family: 'ws_master', mode: 'shadow' }, { family: 'wsday', mode: 'live' }]]; c2.doFix = true;
  r = await sandbox(c2);
  t('★D 写す直前に本番でなくなった種類（週の型）は写さず、写せなかったと出す', r.gasPuts.length === 1 && r.gasPuts[0].key === 'wsday_2026-10-19' && /写せなかった 1件/.test(r.after.v) && /本番ではない/.test(r.after.v), r.after.v);
  t('C 画面に見比べの欄とボタンがある', /id="mc-verdict"/.test(HTML) && /id="b-mirror-check"[^>]*>本番の中身を Google と比べる</.test(HTML) && /\$\('b-mirror-check'\)\.addEventListener\('click'/.test(SRC)
    && /id="b-mirror-fix" hidden>/.test(HTML) && /\$\('b-mirror-fix'\)\.addEventListener\('click'/.test(SRC));
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
