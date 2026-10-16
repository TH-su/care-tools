/* 写しの見比べ（shadow-check.js）の勤務表まわりの純粋な部分の試験（2026-10-16 新設）。
   守りたいこと:
     A 作りかけの案の点検: drafts:YYYY-MM の一覧から案の本体のキー（sched:YYYY-MM:draft:<id>）を正しく並べる
       （形の違う id・一覧でない中身は数えない・重複は1つ）。案ごとの見比べの判定（一致・写しに無い・Google に無い・
       写しの版が古い／新しい・版は同じで中身が違う）
     B 勤務表を Google へ写し返す（戻し用・2026-10-16）: 押せる条件（写しの期間の時だけ）・写すキーの選び方（勤務表のキーで
       中身が違うものだけ・同じは飛ばす）・Google の編集の権利に止められた時の案内（成功扱いにしない）・
       戻す順番の前提条件（写しの期間に戻すのはスイッチが入ったままでよい＝スイッチを切るのは最後）
     C Supabase 側の厳格モードの入口: 操作記録から今の状態を出す・記録が無ければ既定（通常モード）
     D 写し返しの流れを砂場で動かす（Google・データベースの応答だけ偽物）: 本番のままなら書かない・確認を断れば書かない・
       厳格モードに止められたら件数と案内を出して止まる（成功の文言を出さない）・書けたら件数を出す
   ★画面の本物の関数を切り出して動かす（DOM・通信には触れない）。
   実行: node check/unit/shadow_check_shift_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

/* 文字列・コメント・正規表現の中のかっこを数えない切り出し（sukv_routed_test.js と同じ） */
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && /[=(,:!&|?{};\n]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && n !== '/' && n !== '*') {
      let j = i + 1, cls = false;
      for (; j < src.length; j++) { const d = src[j]; if (d === '\\') { j++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; }
      if (src[j] === '/') { i = j; continue; }
    }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grab(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('見つかりません: ' + header.trim());
  const end = scanBlock(src, start);
  if (end < 0) throw new Error('終わりが見つかりません: ' + header.trim());
  return src.slice(start, end + 1);
}
function line(src, re) { const m = src.match(re); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }

const SRC = read('shadow-check.js');
const box = { JSON, Object, Array, Number, String, Error };
vm.createContext(box);
vm.runInContext([
  line(SRC, /var DRAFTS_RE = .*;/),
  line(SRC, /var DRAFT_ID_RE = .*;/),
  // canon は2つ宣言されていて後の方（文字列を返す方）が効いている＝後の方を切り出す
  grab(SRC, 'function canon(v) {\n    if (v === null'),
  grab(SRC, 'function sameData('),
  grab(SRC, 'function draftKeysOf('),
  grab(SRC, 'function draftCompare('),
  line(SRC, /var SHIFT_WB_RE = .*;/),
  grab(SRC, 'function shiftModeBlock('),
  grab(SRC, 'function shiftWbBlock('),
  grab(SRC, 'function shiftWbPlan('),
  grab(SRC, 'function shiftWbRefusal('),
  grab(SRC, 'function shiftWbGuide('),
  grab(SRC, 'function lockStateFromAudit('),
  grab(SRC, 'function lockLabel(')
].join('\n'), box, { filename: 'shadow-check.js（切り出し）' });

console.log('\n— A. 作りかけの案の点検 —');
{
  const keys = box.draftKeysOf({
    'drafts:2026-10': [{ id: 'dabc1' }, { id: 'dxyz2', label: '案2' }, { id: 'dabc1' }, { id: '../x' }, { id: '' }, null, { label: 'id なし' }, { id: 12345 }],
    'drafts:2026-11': [{ id: 'd_q.r-s' }],
    'drafts:2026-12': { id: 'not-array' },
    'drafts:26-10': [{ id: 'dbad' }],
    'sched:2026-10:plan': [{ id: 'dplan' }]
  });
  t('★案の本体のキーを並べる（重複は1つ・数の id も文字にする・並びは決まった順）',
    JSON.stringify(keys) === JSON.stringify(['sched:2026-10:draft:12345', 'sched:2026-10:draft:dabc1', 'sched:2026-10:draft:dxyz2', 'sched:2026-11:draft:d_q.r-s']), keys);
  t('★形の違う id（../x・空・id 無し）・一覧でない中身・drafts:YYYY-MM でないキーは数えない',
    !keys.some(k => /\.\.\/|draft:$|dbad|dplan|not-array/.test(k)), keys);
  t('一覧が空・無しなら何も並べない', JSON.stringify(box.draftKeysOf({})) === '[]' && JSON.stringify(box.draftKeysOf(null)) === '[]');
  t('並べたキーはデータベースの勤務表の種類（0007 の kv_family）に収まる',
    keys.every(k => /^sched:\d{4}-\d{2}:[A-Za-z0-9_.:-]{1,80}$/.test(k)), keys);

  const C = box.draftCompare;
  const d1 = { cells: { a: { 1: 'A' } }, meta: { x: 1, y: 2 } }, d1r = { meta: { y: 2, x: 1 }, cells: { a: { 1: 'A' } } }, d2 = { cells: { a: { 1: 'B' } } };
  t('★版も中身も同じ（キーの並びは問わない）→ 一致', C({ rev: 3, data: d1 }, { rev: 3, data: d1r }) === 'same');
  t('★写しに無い → missing（写せる）', C({ rev: 3, data: d1 }, null) === 'missing' && C({ rev: 3, data: d1 }, { rev: 0, data: null }) === 'missing');
  t('Google に無い → gasonly', C(null, { rev: 2, data: d1 }) === 'gasonly');
  t('★写しの版が古い → older（写せる）', C({ rev: 5, data: d1 }, { rev: 3, data: d1 }) === 'older');
  t('写しの版が新しい → newer', C({ rev: 3, data: d1 }, { rev: 5, data: d1 }) === 'newer');
  t('★版は同じで中身が違う → content（写せる）', C({ rev: 3, data: d1 }, { rev: 3, data: d2 }) === 'content');
  t('どちらにも無い → 一致（数えない）', C(null, null) === 'same' && C({ rev: 0, data: null }, { rev: 0 }) === 'same');
  t('版が数でない値は 0（無い）として扱う', C({ rev: 'x', data: d1 }, { rev: 3, data: d1 }) === 'gasonly');
}

console.log('\n— B. 勤務表を Google へ写し返す —');
{
  /* 押せる条件 */
  t('★写しの期間（shadow）で Google の接続先があれば押せる', box.shiftWbBlock('shadow', true) === '');
  t('★本番（live）のままでは押せない（先に写しの期間に戻すよう案内）', /先に「勤務表を写しの期間に戻す」を押してください/.test(box.shiftWbBlock('live', true)));
  t('状態が分からない値（空・知らない値）でも押せない', box.shiftWbBlock('', true) !== '' && box.shiftWbBlock(undefined, true) !== '' && box.shiftWbBlock('Shadow', true) !== '');
  t('Google の接続先が無ければ押せない（接続先の案内）', /Google の同期先/.test(box.shiftWbBlock('shadow', false)));

  /* 戻す順番の前提条件 */
  t('★写しの期間に戻すのは、スイッチが入ったままでも押せる（スイッチを切るのは最後）', box.shiftModeBlock('shadow', true, false) === '');
  t('写しの期間に戻すのは、スイッチが切でも押せる（止めるのを遅らせない）', box.shiftModeBlock('shadow', false, false) === '');
  t('（従来どおり）本番にするのはスイッチが入でないと押せない', /スイッチ（shift）がまだ「入」/.test(box.shiftModeBlock('live', false, true)));
  t('（従来どおり）本番にするのは点検がそろっていないと押せない', /切り替え前の点検をする/.test(box.shiftModeBlock('live', true, false)) && box.shiftModeBlock('live', true, true) === '');
  t('★「スイッチがまだ「切」になっていません」の前提条件は勤務表から外した（週間計画・ワークスケジュールの分は残す）',
    (SRC.match(/切り替えスイッチ（shift）がまだ「切」/g) || []).length === 0 && /切り替えスイッチがまだ「切」になっていません/.test(SRC));

  /* 写すキーの選び方 */
  const sb = {
    'staff': { rev: 9, data: [{ id: 's1', name: '架空 職員' }] },
    'symbols': { rev: 3, data: { A: { label: '日' } } },
    'sched:2026-10:plan': { rev: 12, data: { cells: { s1: { 1: 'A' } } } },
    'sched:2026-10:draft:dabc1': { rev: 2, data: { cells: {} } },
    'req:2026-10': { rev: 1, data: { s1: [3] } },
    'drafts:2026-10': { rev: 4, data: [{ id: 'dabc1' }] },
    'freee': { rev: 2, data: null },
    'settings': { rev: 2, data: 'text' },
    'care_schedule_v2': { rev: 5, data: { residents: [] } },
    '_shift_editlock': { rev: 1, data: { token: 'x' } }
  };
  const gas = {
    'staff': { rev: 7, data: [{ name: '架空 職員', id: 's1' }] },                  // 中身は同じ（キーの並びだけ違う）
    'symbols': { rev: 3, data: { A: { label: '夜' } } },                          // 中身が違う
    'sched:2026-10:plan': { rev: 20, data: { cells: { s1: { 1: 'B' } } } },     // Google の版の方が大きくても Supabase を正とする
    'req:2026-10': { rev: 1, data: null }                                         // Google 側の中身が無い
  };
  const pl = box.shiftWbPlan(sb, gas);
  t('★中身が違う勤務表・Google に無い勤務表を写す（決まった順）',
    JSON.stringify(pl.write) === JSON.stringify(['drafts:2026-10', 'req:2026-10', 'sched:2026-10:draft:dabc1', 'sched:2026-10:plan', 'symbols']), pl);
  t('★中身が同じ勤務表は飛ばす（キーの並びは問わない・版の違いは見ない）', pl.same === 1 && pl.write.indexOf('staff') < 0, pl);
  t('★勤務表でないキー（週間計画・内部の _shift_editlock）・中身の無いもの・形の違う中身は写さない',
    !pl.write.some(k => /care_schedule_v2|_shift_editlock|freee|settings/.test(k)), pl.write);
  t('全部同じなら写すものは無い', box.shiftWbPlan({ staff: sb.staff }, { staff: gas.staff }).write.length === 0);
  t('空なら何もしない', JSON.stringify(box.shiftWbPlan({}, {})) === '{"write":[],"same":0}' && JSON.stringify(box.shiftWbPlan(null, null)) === '{"write":[],"same":0}');

  /* 止められた時の判定と案内 */
  t('★厳格モードの断り（editlock-required）を見分ける', box.shiftWbRefusal(new Error('Google が断りました（editlock-required）')) === 'editlock-required');
  t('★編集中の断り（editlock）を見分ける', box.shiftWbRefusal(new Error('Google が断りました（editlock）')) === 'editlock');
  t('それ以外の断り・時間切れ・空は編集の権利の断りとみなさない',
    box.shiftWbRefusal(new Error('Google が断りました（schedwipe）')) === '' && box.shiftWbRefusal(new Error('Google の応答がありません（時間切れ）')) === '' &&
    box.shiftWbRefusal(null) === '' && box.shiftWbRefusal(new Error('editlock')) === '');
  const gReq = box.shiftWbGuide('editlock-required', 5, 2, 7), gLock = box.shiftWbGuide('editlock', 3, 0, 1);
  t('★厳格モードの案内: 件数・SHIFT_LOCK_REQUIRED=1 が本番の値・一時的に外す・終わったら戻す',
    /5件を写せませんでした（写した 2件・同じ 7件）/.test(gReq) && /SHIFT_LOCK_REQUIRED=1 が本番の値/.test(gReq) && /一時的に外して/.test(gReq) && /1 に戻して/.test(gReq), gReq);
  t('★編集中の案内: 件数・編集中の端末を閉じる', /3件を写せませんでした/.test(gLock) && /編集中の端末の勤務表を閉じてから/.test(gLock), gLock);
  t('★どちらの案内も成功扱いにしない（スイッチを切る PR を取り込まないよう添える）', [gReq, gLock].every(g => /スイッチを切る PR は取り込まないでください/.test(g) && !/かまいません/.test(g)));

  /* 流れの形（本物の関数の中身を読む） */
  const wb = grab(SRC, 'async function writeBackShift(');
  t('★写し返しは 版0・force で push し、券（editToken）を付けない',
    /\{ action: 'push', key: k, baseRev: 0, data: sbEnts\[k\]\.data, force: true \}/.test(wb) && !/editToken/.test(wb));
  t('★写す前に勤務表の種類の状態を確かめ、写しの期間でなければ止める', wb.indexOf('shiftWbBlock(await shiftFamMode(sb), true)') >= 0 &&
    wb.indexOf('shiftWbBlock(await shiftFamMode(sb), true)') < wb.indexOf("action: 'push'"));
  t('★何件を写すか見せてから確認をとる（確認は push より前）', /confirm\('勤務表の ' \+ todo\.length \+ '件を/.test(wb) && wb.indexOf('confirm(') < wb.indexOf("action: 'push'"));
  t('★止められたら案内を出してそこで止める（成功の文言に進まない）', /if \(kind\) \{ shbMsg\(shiftWbGuide\(kind, [^)]*\), 'ng'\); return; \}/.test(wb));
  t('管理者（二段階認証済み）でないと進まない', /me\.role === 'admin' && me\.status === SUAuth\.STATUS\.OK/.test(wb));
}

console.log('\n— C. Supabase 側の厳格モードの入口 —');
{
  const L = box.lockStateFromAudit;
  t('★操作記録の最新行が lock_required:true なら厳格', L([{ fields: ['lock_required:true'] }, { fields: ['lock_required:false'] }]) === true);
  t('★最新行が lock_required:false なら通常', L([{ fields: ['lock_required:false'] }, { fields: ['lock_required:true'] }]) === false);
  t('★記録が無ければ null（既定＝通常モード）', L([]) === null && L(null) === null && box.lockLabel(null) === '既定（通常モード）');
  t('関係の無い行・形の違う行は読み飛ばす', L([{ fields: ['data'] }, { fields: null }, null, { fields: ['lock_required:true'] }]) === true);
  t('表示の言葉: 入（厳格モード）／切（通常モード）', box.lockLabel(true) === '入（厳格モード）' && box.lockLabel(false) === '切（通常モード）');
  const sl = grab(SRC, 'async function setLock(');
  t('★入れる／外すは shift_set_lock_required を呼び、応答の値で表示を更新する',
    /rpc\('shift_set_lock_required', \{ p_on: !!on \}\)/.test(sl) && /showLock\(r\.data\.lockRequired === true/.test(sl));
  t('★押す前に確認の段がある・管理者（二段階認証済み）だけ', (sl.match(/confirm\(/g) || []).length === 2 && /me\.role === 'admin' && me\.status === SUAuth\.STATUS\.OK/.test(sl) &&
    sl.indexOf('confirm(') < sl.indexOf('shift_set_lock_required'));
  const HTML = read('shadow-check.html');
  const adm = HTML.slice(HTML.indexOf('<div id="kv-admin" hidden>'));
  t('★新しいボタンと表示は管理者の欄の中にある', ['id="b-shift-back"', 'id="b-lock-on"', 'id="b-lock-off"', 'id="lk-state"', 'id="shb-verdict"'].every(x => adm.indexOf(x) > 0 && HTML.indexOf(x) === HTML.indexOf(x, HTML.indexOf('<div id="kv-admin" hidden>'))));
  t('★状態の横に「SQL エディタで直接変えた分はここに出ません」と添える', /SQL エディタで直接変えた分はここに出ません/.test(HTML));
}

console.log('\n— D. 写し返しの流れ（砂場） —');
(async () => {
  const BODY = [grab(SRC, 'function shbMsg('), grab(SRC, 'function shbBusy('), grab(SRC, 'async function shiftFamMode('),
    grab(SRC, 'async function gasPullAll('), grab(SRC, 'async function sbShiftPull('), grab(SRC, 'async function writeBackShift(')].join('\n');
  async function run(o) {
    const els = {}, pushes = [], asks = [];
    const $ = id => (els[id] = els[id] || { id, className: '', textContent: '', disabled: false });
    const sbEnts = { 'staff': { key: 'staff', rev: 9, data: [{ id: 's1' }] }, 'sched:2026-10:plan': { key: 'sched:2026-10:plan', rev: 3, data: { cells: { s1: { 1: 'A' } } } }, 'req:2026-10': { key: 'req:2026-10', rev: 1, data: { s1: [1] } } };
    const gasEnts = { 'staff': { rev: 4, data: [{ id: 's1' }] }, 'sched:2026-10:plan': { rev: 3, data: { cells: { s1: { 1: 'B' } } } } };
    const sb = {
      from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [{ family: 'shift', mode: o.mode }] }) }) }),
      rpc: (name, args) => Promise.resolve(name === 'shift_pull' && args.p_keys === null ? { data: { ok: true, entries: sbEnts } } : { data: null })
    };
    const env = Object.assign(Object.create(box), {
      $, me: { role: o.role || 'admin', status: 'ok' }, SUAuth: { STATUS: { OK: 'ok' }, client: () => sb }, FILL_BATCH: 8, Promise, Error,
      gasTarget: () => ({ url: 'u', token: 't' }),
      confirm: (q) => { asks.push(q); return o.confirm !== false; },
      gasPostRetry: (tgt, body) => {
        if (body.action === 'pull') { const e = {}; body.keys.forEach(k => { if (gasEnts[k]) e[k] = gasEnts[k]; }); return Promise.resolve({ ok: true, entries: e }); }
        pushes.push(body);
        if (o.refuse && pushes.length >= (o.refuseAt || 1)) return Promise.reject(new Error('Google が断りました（' + o.refuse + '）'));
        return Promise.resolve({ ok: true, rev: 1 });
      }
    });
    vm.createContext(env);
    vm.runInContext(BODY + '\nthis.__wb = writeBackShift;', env);
    await env.__wb();
    return { v: $('shb-verdict'), pushes, asks, busy: $('b-shift-back').disabled };
  }
  let r = await run({ mode: 'live' });
  t('★D 本番（live）のままなら比べも書きもせず、写しの期間に戻すよう案内', r.pushes.length === 0 && /先に「勤務表を写しの期間に戻す」/.test(r.v.textContent), r.v.textContent);
  r = await run({ mode: 'shadow', role: 'office' });
  t('D 事務所のアカウントでは進まない', r.pushes.length === 0 && /管理者/.test(r.v.textContent));
  r = await run({ mode: 'shadow', confirm: false });
  t('★D 何件を写すかを見せ（違う2件・同じ1件）、確認を断れば書かない', r.pushes.length === 0 && /2件を/.test(r.asks[0] || '') && /同じ 1件/.test(r.asks[0] || ''), r.asks);
  r = await run({ mode: 'shadow', refuse: 'editlock-required' });
  t('★D 厳格モードに止められたら、そこで止めて件数（2件）と案内を出す（成功の文言を出さない）',
    r.pushes.length === 1 && r.v.className === 'msg ng' && /2件を写せませんでした（写した 0件・同じ 1件）/.test(r.v.textContent) && /SHIFT_LOCK_REQUIRED=1/.test(r.v.textContent) && !/そろいました/.test(r.v.textContent), r.v.textContent);
  r = await run({ mode: 'shadow', refuse: 'editlock', refuseAt: 2 });
  t('★D 編集中に止められたら、写せた分と写せなかった件数（1件）を出す', r.pushes.length === 2 && /1件を写せませんでした（写した 1件・同じ 1件）/.test(r.v.textContent) && /編集中の端末/.test(r.v.textContent), r.v.textContent);
  r = await run({ mode: 'shadow' });
  t('★D 全部書けたら件数を出す（中身が違う2件だけを版0・force・券なしで）',
    r.pushes.length === 2 && r.pushes.every(p => p.action === 'push' && p.baseRev === 0 && p.force === true && !('editToken' in p)) &&
    JSON.stringify(r.pushes.map(p => p.key)) === '["req:2026-10","sched:2026-10:plan"]' && r.v.className === 'msg ok' && /同じ 1件・写した 2件/.test(r.v.textContent), r.v.textContent);
  t('D 終わったらボタンを押せる状態に戻す', r.busy === false);
  {
    const i = SRC.indexOf('async function runCheck()'), seg = SRC.slice(i, i + 400);
    t('E 点検を始める時に、前回の「勤務表はそろっている」を消す（途中で失敗しても本番にするボタンを押せない）', i >= 0 && /shiftReady = false;/.test(seg) && seg.indexOf('shiftReady = false;') < seg.indexOf('gasTarget()'), seg.slice(0, 200));
  }
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
