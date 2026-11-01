/* check/fail-inject/gas-script.mjs — 失敗を起こす台本のエンジンと、偽の GAS の応答の形（2026-10-31 新設）
 *
 * 純関数だけ（通信・ファイル・時計に触れない）。配信サーバー serve.mjs と道具の試験（check/unit/fail_inject_*_test.js）が読む。
 *
 * 台本（JSON の配列）の1行: { entry, nth, kind, times, ms }
 *   entry … 入口の名前。偽 GAS は本文の action（'put'・'get'・'saveResident' など）、
 *           試験用 Supabase の中継は 'sb:' ＋ /rest/v1/ や /auth/v1/ の後ろ（例 'sb:rpc/kv_put'）
 *   nth   … その入口の何回目から起こすか（1 から数える）
 *   kind  … 'timeout' | 'deny' | 'conflict' | 'nores'（偽 GAS）／ 'unreachable' | 'slow' | 'deny'（Supabase の中継）
 *   times … 何回続けて起こすか（既定 1）
 *   ms    … 'timeout'・'slow' の遅らせる時間（既定 timeout 46000＝画面の put の1試行45秒より長い・slow 3000）
 *   key   … （任意）キーの正規表現。書いた時は、その入口のうちキーが合う要求だけを数える（例 '^wsday_'。
 *           画面の読み込みの時の care_schedule_v2 の put を数えずに、その日の盤面の保存だけに当てる）
 * 台本に無い要求・回数の外の要求は「素通し」（step が null）。起きた回数は台本の行ごとに数え、指定の回数と突き合わせられる。
 *
 * 起こし方（失敗の種類ごと）:
 *   timeout     … ms だけ待たせてから見本へ通す＝画面は時間切れにするが、サーバーには後から届く（本物の GAS の遅れと同じ）
 *   nores       … 応答を返さずに接続を切る＝サーバーには届かない
 *   deny        … 権限の断り。偽 GAS は HTTP 200 と本物の .gs の断りの形、Supabase は本物の 403 と 42501 の本文
 *   conflict    … 版の競合。本物の .gs の形に、見本の今の版を入れて返す（見本は書かない）
 *   unreachable … （Supabase）接続を切る
 *   slow        … （Supabase）ms だけ遅らせてから本物へ通す
 *
 * ★応答の形は本物の .gs から1回ずつ写した。写した行は SHAPES の src に「ファイル名:行」と行の文字列で残す
 *   （check/unit/fail_inject_shapes_test.js が、.gs の場所を環境変数で渡された時だけ行の文字列が今もあるか確かめる）。
 *   行番号は 2026-10-31 時点（体重・消耗品・編集リースは 2026-11-01 時点）。統合KV＝ワークスケジュールアプリの gas/Code.gs、
 *   入居者マスタ＝テーマの gas/master.gs、体重管理＝care-backend の gas/bound/weight-api/weight-api.gs、
 *   消耗品管理＝care-backend の gas/bound/supplies-api/supplies-api.gs。
 * ★確かめていない形（例: 入居者マスタの push・統合KV の saveResident の競合）は作らない＝無い組み合わせは例外にする。
 *   体重管理（wt）・消耗品管理（spl）の .gs には版の競合の応答が無いので、conflict は作らない（例外）。
 * ★見本（create*Backend）は writeActions（書く action の一覧＝serve.mjs が「届いた」を数える入口）と、
 *   keyOf（要求の本文から台本の key に当てる値を取り出す）を持つ。
 */

export const KINDS_GAS = ['timeout', 'deny', 'conflict', 'nores'];
export const KINDS_SB = ['unreachable', 'slow', 'deny'];
/* 起こせる失敗の種類（重ねない）: GAS の4種類と Supabase の3種類 */
export const FAILURE_KINDS = ['gas:timeout', 'gas:deny', 'gas:conflict', 'gas:nores', 'sb:unreachable', 'sb:slow', 'sb:deny'];

export const DEFAULT_MS = { timeout: 46000, slow: 3000 };

/* 本物の .gs から写した応答の形。src の line の行に text の文字列がある（2026-10-31 時点） */
export const SHAPES = {
  kv: {
    /* Code.gs:405・408 doPost の合言葉の照合（閲覧専用の合言葉で書いた時も同じ） */
    deny: { body: () => ({ ok: false, error: 'unauthorized' }), src: [{ file: 'Code.gs', line: 405, text: "out = { ok: false, error: 'unauthorized' };" }, { file: 'Code.gs', line: 408, text: "out = { ok: false, error: 'unauthorized' };" }] },
    /* Code.gs:1006 wsPut の版の照合（put） */
    conflictPut: { body: (rev) => ({ ok: false, conflict: true, rev: rev }), src: [{ file: 'Code.gs', line: 1006, text: 'return { ok: false, conflict: true, rev: curRev };' }] },
    /* Code.gs:1101 actionPush の版の照合（push・ok の鍵が無い形） */
    conflictPush: { body: (rev) => ({ conflict: true, serverRev: rev }), src: [{ file: 'Code.gs', line: 1101, text: 'return { conflict: true, serverRev: serverRev };' }] },
    /* Code.gs:1017 wsPut の中身が同じ時（noopput） */
    unchanged: { body: (rev) => ({ ok: true, rev: rev, unchanged: true }), src: [{ file: 'Code.gs', line: 1017, text: 'return { ok: true, rev: curRev, unchanged: true };' }] },
    /* Code.gs:1121 actionPush の保存できた時（wsPut も同じ形） */
    saved: { body: (rev) => ({ ok: true, rev: rev }), src: [{ file: 'Code.gs', line: 1121, text: 'return { ok: true, rev: newRev };' }] },
    /* ── 編集リース（シフト作成が使う・2026-11-01 に写した）── */
    /* Code.gs:1340 actionLockStatus（lock は publicLease_＝{name, acquiredAt, expiresAt} か null） */
    lockStatus: { body: (lock) => ({ ok: true, lock: lock || null }), src: [{ file: 'Code.gs', line: 1340, text: 'return { ok: true, lock: publicLease_(readLease_(getFolder_())) };' }] },
    /* Code.gs:1348 actionLockAcquire の端末ID なし */
    nodevice: { body: () => ({ ok: false, error: 'nodevice' }), src: [{ file: 'Code.gs', line: 1348, text: "if (!deviceId) return { ok: false, error: 'nodevice' };" }] },
    /* Code.gs:1358 actionLockAcquire の他端末が保持中 */
    lockheld: { body: (name, expiresAt) => ({ ok: false, error: 'lockheld', name: name, expiresAt: expiresAt }), src: [{ file: 'Code.gs', line: 1358, text: "return { ok: false, error: 'lockheld', name: lease.holder.name, expiresAt: lease.expiresAt };" }] },
    /* Code.gs:1369 actionLockAcquire の付与 */
    leaseGranted: { body: (token, epoch, expiresAt) => ({ ok: true, lease: { token: token, epoch: epoch, expiresAt: expiresAt } }), src: [{ file: 'Code.gs', line: 1369, text: 'return { ok: true, lease: { token: granted.token, epoch: granted.epoch, expiresAt: granted.expiresAt } };' }] },
    /* Code.gs:1388 actionLockRenew の券の不一致・失効（保持者名だけ添える） */
    locklostRenew: { body: (name) => ({ ok: false, error: 'locklost', name: name || '' }), src: [{ file: 'Code.gs', line: 1388, text: "return { ok: false, error: 'locklost', name: active ? lease.holder.name : '' };" }] },
    /* Code.gs:1392 actionLockRenew の延長（token・epoch は返さない） */
    leaseRenewed: { body: (expiresAt) => ({ ok: true, lease: { expiresAt: expiresAt } }), src: [{ file: 'Code.gs', line: 1392, text: 'return { ok: true, lease: { expiresAt: lease.expiresAt } };' }] },
    /* Code.gs:1407・1414 actionLockRelease（不在・失効でも ok＝冪等） */
    released: { body: () => ({ ok: true }), src: [{ file: 'Code.gs', line: 1407, text: 'if (!leaseActive_(lease)) return { ok: true };' }, { file: 'Code.gs', line: 1414, text: 'return { ok: true };' }] },
    /* Code.gs:1411 actionLockRelease の他端末の券 */
    locklostRelease: { body: () => ({ ok: false, error: 'locklost' }), src: [{ file: 'Code.gs', line: 1411, text: "return { ok: false, error: 'locklost' };" }] },
    /* Code.gs:1434 actionShiftStatus（シフト系のキーの版と保持者） */
    shiftStatus: { body: (revs, lock) => ({ ok: true, revs: revs, lock: lock || null }), src: [{ file: 'Code.gs', line: 1434, text: 'return { ok: true, revs: revs, lock: publicLease_(readLease_(folder)) };' }] },
    /* Code.gs:1282 shiftEditlockReject_ の通常モード（誰かが編集中に、券の無い・違う端末がシフト系のキーへ書いた） */
    editlock: { body: (name, expiresAt) => ({ ok: false, error: 'editlock', name: name, expiresAt: expiresAt }), src: [{ file: 'Code.gs', line: 1282, text: "return { ok: false, error: 'editlock', name: lease.holder.name, expiresAt: lease.expiresAt };" }] },
  },
  master: {
    /* master.gs:465 doPost の書き込みの合言葉の照合（現場用・閲覧用の合言葉）。_err は master.gs:174 の {error:m} */
    deny: { body: () => ({ error: 'この合言葉では保存できません（参照専用の合言葉です）' }), src: [{ file: 'master.gs', line: 465, text: "}else if(role!=='full') return _err('この合言葉では保存できません（参照専用の合言葉です）');" }, { file: 'master.gs', line: 174, text: 'function _err(m){ return _json({error:m}); }' }] },
    /* master.gs:861 saveResident の版の照合 → master.gs:488 doPost の catch が String(err)（"Error: conflict"）で返す */
    conflict: { body: () => ({ error: 'Error: conflict' }), src: [{ file: 'master.gs', line: 861, text: "throw safeError_('conflict');" }, { file: 'master.gs', line: 488, text: "}catch(err){ return _err(errText_(err, 'doPost error')); }" }] },
    /* master.gs:345 doGet の版数だけの照会（合言葉なし・GET の ?action=stateRev。購読側が数十秒おきに叩く） */
    stateRev: { body: (rev) => ({ ok: true, rev: rev, srev: rev }), src: [{ file: 'master.gs', line: 345, text: "if(a0==='stateRev') return _json({ok:true, rev:_stateRev(), srev:_metaSrev()});" }] },
    /* master.gs:354 doGet の stateRev 以外（合言葉の要る読み取りは GET では受けない） */
    getRefused: { body: () => ({ error: 'この読み取りは POST でだけ受け付けます。もう一度お試しください（何度も出る時は画面を再読み込みしてください）' }), src: [{ file: 'master.gs', line: 354, text: "return _err('この読み取りは POST でだけ受け付けます。もう一度お試しください（何度も出る時は画面を再読み込みしてください）');" }] },
    /* master.gs:460 合言葉の無い・違う書き込み */
    authError: { body: () => ({ error: '認証エラー' }), src: [{ file: 'master.gs', line: 460, text: "if(!role) return _err('認証エラー');" }] },
  },
  /* 体重管理（weight-api.gs・2026-11-01 に写した）。断りは safeError_ の例外を doPost の catch が errText_ で String(err)＝"Error: …" にして返す */
  wt: {
    /* weight-api.gs:102 roleOf_ の合言葉の不一致 → :232 doPost の catch → :68 errText_ の String(err) */
    deny: { body: () => ({ ok: false, error: 'Error: unauthorized' }), src: [{ file: 'weight-api.gs', line: 102, text: "throw safeError_('unauthorized');" }, { file: 'weight-api.gs', line: 232, text: "return jsonOut(flushBeforeRelease_({ ok: false, error: errText_(err, 'doPost error') }));" }, { file: 'weight-api.gs', line: 68, text: 'return (err && err.safeMsg === true) ? String(err) : SERVER_ERR_MSG;' }] },
    /* weight-api.gs:202 読むだけの合言葉で書いた */
    readOnly: { body: () => ({ ok: false, error: 'Error: read_only' }), src: [{ file: 'weight-api.gs', line: 202, text: "if (role !== 'full') throw safeError_('read_only');" }] },
    /* weight-api.gs:60 目印の無い例外（シートの読み書きの失敗など）の定型文 */
    serverErr: { body: () => ({ ok: false, error: 'サーバーで処理できませんでした。時間をおいてもう一度お試しください' }), src: [{ file: 'weight-api.gs', line: 60, text: "const SERVER_ERR_MSG = 'サーバーで処理できませんでした。時間をおいてもう一度お試しください';" }] },
    /* weight-api.gs:188 書き込みを確定できなかった */
    flushFail: { body: () => ({ ok: false, error: 'flush_fail' }), src: [{ file: 'weight-api.gs', line: 188, text: "try { SpreadsheetApp.flush(); } catch (err) { return { ok: false, error: 'flush_fail' }; }" }] },
    /* weight-api.gs:229 書けた（記録・入居者・しきい値のどれも同じ形） */
    saved: { body: () => ({ ok: true, ver: 2 }), src: [{ file: 'weight-api.gs', line: 229, text: 'return jsonOut(flushBeforeRelease_({ ok: true, ver: API_VER }));' }] },
    /* weight-api.gs:207 POST の getAll（residents・records・thresholds を足して返す） */
    getAll: { body: (residents, records, thresholds) => ({ ok: true, ver: 2, residents: residents, records: records, thresholds: thresholds }), src: [{ file: 'weight-api.gs', line: 207, text: 'ok: true, ver: API_VER,' }] },
    /* weight-api.gs:166 GET の疎通確認（action なし。版と対応機能は :32・:33） */
    probe: { body: () => ({ ok: true, msg: 'API ready', ver: 2, caps: ['fieldMerge', 'lock', 'auth', 'postGetAll', 'readRole'], authRequired: true }), src: [{ file: 'weight-api.gs', line: 166, text: "return jsonOut({ ok: true, msg: 'API ready', ver: API_VER, caps: API_CAPS, authRequired: authRequired_() });" }, { file: 'weight-api.gs', line: 32, text: 'const API_VER  = 2;' }, { file: 'weight-api.gs', line: 33, text: "const API_CAPS = ['fieldMerge', 'lock', 'auth', 'postGetAll', 'readRole'];" }] },
    /* weight-api.gs:162 GET の getAll は受けない */
    getRefused: { body: () => ({ error: 'この読み取りは POST でだけ受け付けます。もう一度お試しください（何度も出る時は画面を再読み込みしてください）' }), src: [{ file: 'weight-api.gs', line: 162, text: "return jsonOut({ error: 'この読み取りは POST でだけ受け付けます。もう一度お試しください（何度も出る時は画面を再読み込みしてください）' });" }] },
  },
  /* 消耗品管理（supplies-api.gs・2026-11-01 に写した）。断りは HTTP 200 の {ok:false, error, hint} */
  spl: {
    /* supplies-api.gs:1064-1066 合言葉の不一致（サーバーに合言葉がある時の hint） */
    deny: { body: () => ({ ok: false, error: 'unauthorized', hint: '合言葉が違います' }), src: [{ file: 'supplies-api.gs', line: 1064, text: "return jsonOut({ ok: false, error: 'unauthorized'," }, { file: 'supplies-api.gs', line: 1065, text: "hint: _adminToken_() ? '合言葉が違います'" }] },
    /* supplies-api.gs:1071 職員の合言葉で管理者だけの操作 */
    forbidden: { body: () => ({ ok: false, error: 'forbidden', hint: 'この操作には管理者の合言葉が必要です' }), src: [{ file: 'supplies-api.gs', line: 1071, text: "return jsonOut({ ok: false, error: 'forbidden', hint: 'この操作には管理者の合言葉が必要です' });" }] },
    /* supplies-api.gs:1005 書き込みの順番待ちに入れなかった */
    busy: { body: () => ({ ok: false, error: 'busy', hint: '混み合っています。もう一度お試しください' }), src: [{ file: 'supplies-api.gs', line: 1005, text: "return { ok: false, error: 'busy', hint: '混み合っています。もう一度お試しください' };" }] },
    /* supplies-api.gs:1013-1014 書いたのに確定を確かめられなかった */
    flushFail: { body: () => ({ ok: false, error: 'flush_fail', hint: '一覧を取り直して、入っているか確かめてから操作してください（新しい品目は、もう一度登録する前に一覧で確かめる）。' }), src: [{ file: 'supplies-api.gs', line: 1013, text: "return { ok: false, error: 'flush_fail'," }, { file: 'supplies-api.gs', line: 1014, text: "hint: '一覧を取り直して、入っているか確かめてから操作してください（新しい品目は、もう一度登録する前に一覧で確かめる）。' };" }] },
    /* supplies-api.gs:1906 addMoves の答え（1件ずつ applied・existing・rejected。全件 rejected でも ok:true） */
    moves: { body: (results, stock) => ({ ok: true, results: results, stock: stock }), src: [{ file: 'supplies-api.gs', line: 1906, text: 'return { ok: true, results: results, stock: stock };' }, { file: 'supplies-api.gs', line: 1754, text: "e.status = cur.voided ? 'existing_voided' : 'existing';" }, { file: 'supplies-api.gs', line: 1671, text: "const rej = function (e, reason) { e.status = 'rejected'; e.reason = reason; };" }] },
    /* supplies-api.gs:1161-1163 list（読む） */
    list: { body: (o) => ({ ok: true, role: o.role, items: o.items, prices: o.prices, profiles: o.profiles, categories: o.categories, defaults: o.defaults, closedMonths: o.closedMonths, stock: o.stock, settingsAt: o.settingsAt }), src: [{ file: 'supplies-api.gs', line: 1161, text: 'ok: true, role: role, items: items.list, prices: priceOutMap, profiles: profileList,' }, { file: 'supplies-api.gs', line: 1163, text: "stock: stock, settingsAt: metaStr_(meta, 'settingsAt')" }] },
    /* supplies-api.gs:1036-1037 GET の疎通確認（版は :26・機能は :29） */
    ping: { body: () => ({ ok: true, app: 'supplies', build: '2026-10-15.1', schemaVer: 1, caps: ['rev', 'auth', 'roles', 'stock', 'reprice', 'closed', 'notes', 'editorverify'], authRequired: true }), src: [{ file: 'supplies-api.gs', line: 1036, text: "ok: true, app: 'supplies', build: SUPPLIES_BUILD, schemaVer: SCHEMA_VER," }, { file: 'supplies-api.gs', line: 26, text: "const SUPPLIES_BUILD = '2026-10-15.1';" }, { file: 'supplies-api.gs', line: 29, text: "const API_CAPS       = ['rev', 'auth', 'roles', 'stock', 'reprice', 'closed', 'notes', 'editorverify'];" }] },
    /* supplies-api.gs:1046 GET の ping 以外 */
    postOnly: { body: () => ({ ok: false, error: 'post_only', hint: 'POST を使ってください' }), src: [{ file: 'supplies-api.gs', line: 1046, text: "return jsonOut({ ok: false, error: 'post_only', hint: 'POST を使ってください' });" }] },
  },
  /* 試験用 Supabase の kv_put を現場アカウントで呼んだ時の本物の応答（2026-10-31 に手元の試験用 Supabase で1回採った）。
     kv_put の入口の has_role('office','admin') の断り（raise exception 'not allowed' using errcode = '42501'） */
  sb: {
    deny: { status: 403, body: () => ({ code: '42501', details: null, hint: null, message: 'not allowed' }) },
  },
};

/* 台本を確かめて正規化する（壊れた台本で黙って素通しにしない） */
export function normalizeScript(script) {
  if (!Array.isArray(script)) throw new Error('台本は配列にしてください');
  return script.map((s, i) => {
    if (!s || typeof s.entry !== 'string' || !s.entry) throw new Error(`台本の${i + 1}行目: entry がありません`);
    const kinds = s.entry.startsWith('sb:') ? KINDS_SB : KINDS_GAS;
    if (!kinds.includes(s.kind)) throw new Error(`台本の${i + 1}行目: kind「${s.kind}」は ${s.entry} では起こせません（${kinds.join('・')}）`);
    const nth = s.nth == null ? 1 : Number(s.nth);
    const times = s.times == null ? 1 : Number(s.times);
    if (!Number.isInteger(nth) || nth < 1) throw new Error(`台本の${i + 1}行目: nth は1以上の整数`);
    if (!Number.isInteger(times) || times < 1) throw new Error(`台本の${i + 1}行目: times は1以上の整数`);
    const ms = s.ms == null ? (DEFAULT_MS[s.kind] || 0) : Number(s.ms);
    let key = null;
    if (s.key != null) {
      if (typeof s.key !== 'string' || !s.key) throw new Error(`台本の${i + 1}行目: key は空でない文字列（正規表現）`);
      try { key = new RegExp(s.key); } catch (e) { throw new Error(`台本の${i + 1}行目: key「${s.key}」は正規表現として読めません`); }
    }
    return key ? { entry: s.entry, nth, kind: s.kind, times, ms, key } : { entry: s.entry, nth, kind: s.kind, times, ms };
  });
}

/* 台本のエンジン。decide(entry, key) を要求ごとに1回呼ぶ。起こす時は step（kind・ms）、素通しは step が null。
   何回目かは台本の行ごとに数える（key の無い行は入口の通し番号と同じ・key のある行はキーが合う要求だけの番号） */
export function createEngine(script) {
  const steps = normalizeScript(script || []);
  const seen = new Map();       // entry → 何回目まで来たか
  const cnt = steps.map(() => 0);
  const fired = steps.map(() => 0);
  return {
    steps,
    decide(entry, key) {
      const n = (seen.get(entry) || 0) + 1;
      seen.set(entry, n);
      let hit = -1;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (s.entry !== entry || (s.key && !s.key.test(key == null ? '' : String(key)))) continue;
        cnt[i]++;
        if (hit < 0 && cnt[i] >= s.nth && cnt[i] < s.nth + s.times) hit = i;
      }
      if (hit >= 0) { fired[hit]++; return { n, step: steps[hit], index: hit }; }
      return { n, step: null, index: -1 };
    },
    /* 台本の行ごとに「指定の回数」と「起きた回数」 */
    report() { return steps.map((s, i) => Object.assign({ entry: s.entry, kind: s.kind, nth: s.nth, times: s.times, fired: fired[i] }, s.key ? { key: s.key.source } : {})); },
    calls(entry) { return seen.get(entry) || 0; },
  };
}

/* 偽 GAS の応答（起こす時）。app は 'kv'（統合KV）か 'master'（入居者マスタ）。cur は見本の今の版（conflict に入れる）。
   戻り値: {act:'json', status, body} | {act:'hold', ms}（待たせてから素通し）| {act:'destroy'} */
export function gasFailure(app, kind, action, cur, step) {
  if (kind === 'timeout') return { act: 'hold', ms: step && step.ms != null ? step.ms : DEFAULT_MS.timeout };
  if (kind === 'nores') return { act: 'destroy' };
  const sh = SHAPES[app];
  if (!sh || app === 'sb') throw new Error(`偽 GAS「${app}」の形はありません`);
  if (kind === 'deny') return { act: 'json', status: 200, body: sh.deny.body() };
  if (kind === 'conflict') {
    if (app === 'kv' && action === 'put') return { act: 'json', status: 200, body: SHAPES.kv.conflictPut.body(cur || 0) };
    if (app === 'kv' && action === 'push') return { act: 'json', status: 200, body: SHAPES.kv.conflictPush.body(cur || 0) };
    if (app === 'master' && action === 'saveResident') return { act: 'json', status: 200, body: SHAPES.master.conflict.body() };
    /* 体重管理・消耗品管理の .gs に版の競合の応答は無い（作らない） */
    throw new Error(`競合の形は ${app} の ${action} では確かめていません（作らない）`);
  }
  throw new Error(`偽 GAS では kind「${kind}」は起こせません`);
}

/* 試験用 Supabase の中継の失敗（起こす時） */
export function sbFailure(kind, step) {
  if (kind === 'unreachable') return { act: 'destroy' };
  if (kind === 'slow') return { act: 'hold', ms: step && step.ms != null ? step.ms : DEFAULT_MS.slow };
  if (kind === 'deny') return { act: 'json', status: SHAPES.sb.deny.status, body: SHAPES.sb.deny.body() };
  throw new Error(`Supabase の中継では kind「${kind}」は起こせません`);
}

/* 応答の本文から「アプリの成否」を取り出す（HTTP の成否とは別に数える）。
   ok:true＝成功、ok:false・error・conflict・code＝断り、それ以外（本文なし・形が違う）＝null */
export function bodyVerdict(body) {
  if (body == null || typeof body !== 'object') return { ok: null, name: null };
  /* ok:true でも、1件ずつの結果に断り（消耗品の addMoves の rejected）や競合の一覧（conflicts）がある時は失敗と数える。
     ok:true の判定より前に見る（後ろに置くと {ok:true, results:[rejected]} が成功になる） */
  if (Array.isArray(body.results) && body.results.some((r) => r && r.status === 'rejected')) return { ok: false, name: 'rejected' };
  if (Array.isArray(body.conflicts) && body.conflicts.length) return { ok: false, name: 'conflict' };
  if (body.ok === true) return { ok: true, name: body.unchanged ? 'unchanged' : null };
  if (body.conflict) return { ok: false, name: 'conflict' };
  if (body.ok === false || body.error != null) return { ok: false, name: body.error != null ? String(body.error).slice(0, 40) : 'ok:false' };
  if (body.code) return { ok: false, name: String(body.code) };
  if (body.record) return { ok: true, name: null };   // 入居者マスタの saveResident の成功（{record}）
  return { ok: null, name: null };
}

/* ── 見本の統合KV（台本で起こさない時に答える）──
   本物の Code.gs の wsPut と同じ順で答える: 版の照合（:1005-1007）→ 中身が同じなら unchanged（:1016-1018）→ 書いて版を1つ進める。
   get・head・pull は check/fixtures/care-schedule.mjs の見本と同じ形。版の印・空の上書きの守りは持たない（計測用）。
   編集リース（シフト作成の lockStatus・lockAcquire・lockRenew・lockRelease・shiftStatus）は本物の Code.gs:1335-1435 と同じ順で答え、
   push はリースが有効な間だけ、シフト系のキーで券（editToken）が違えば断る（Code.gs:1281-1283 の通常モード）。
   リースは誰かが取るまで空＝ワークスケジュール・週間計画の put・push の答えは今までと同じ */
const SHIFT_LOCK_KEY_RE = /^(staff|symbols|settings|freee|sched:.+|req:.+|drafts:.+)$/;   // Code.gs の SHIFT_LOCK_KEY_RE と同じ
const LOCK_TTL_MS = 30 * 60 * 1000;   // Code.gs の LOCK_TTL_MS と同じ（30分）
export function createKvBackend(seed, opts) {
  const kv = new Map();
  for (const [k, v] of Object.entries(seed || {})) kv.set(k, { data: v, rev: 1 });
  const history = [];   // 書けた版の記録 {key, rev, data}
  const now = (opts && typeof opts.now === 'function') ? opts.now : () => Date.now();
  let lease = { holder: null, token: '', epoch: 0, acquiredAt: 0, expiresAt: 0 };
  let tokSeq = 0;
  const leaseActive = () => !!(lease.holder && lease.holder.deviceId && lease.token && lease.expiresAt > now());
  const publicLease = () => (leaseActive() ? { name: lease.holder.name, acquiredAt: lease.acquiredAt, expiresAt: lease.expiresAt } : null);
  const clamp = (v, n) => String(v == null ? '' : v).slice(0, n);
  function respondLock(a, body) {
    if (a === 'lockStatus') return SHAPES.kv.lockStatus.body(publicLease());
    if (a === 'shiftStatus') {
      const revs = {};
      for (const k0 of (Array.isArray(body.keys) ? body.keys : [])) {
        const k = String(k0 == null ? '' : k0);
        if (k.charAt(0) === '_' || !SHIFT_LOCK_KEY_RE.test(k)) continue;
        revs[k] = kv.has(k) ? kv.get(k).rev : 0;
      }
      return SHAPES.kv.shiftStatus.body(revs, publicLease());
    }
    const deviceId = clamp(body.deviceId, 64);
    if (a === 'lockAcquire') {
      if (!deviceId) return SHAPES.kv.nodevice.body();
      if (leaseActive() && lease.holder.deviceId !== deviceId && !body.takeover) return SHAPES.kv.lockheld.body(lease.holder.name, lease.expiresAt);
      const t = now();
      lease = { holder: { deviceId, name: clamp(body.name, 40) }, token: 'fi-lease-' + (++tokSeq), epoch: lease.epoch + 1, acquiredAt: t, expiresAt: t + LOCK_TTL_MS };
      return SHAPES.kv.leaseGranted.body(lease.token, lease.epoch, lease.expiresAt);
    }
    if (a === 'lockRenew') {
      const active = leaseActive();
      if (!active || !deviceId || lease.holder.deviceId !== deviceId || body.editToken !== lease.token) return SHAPES.kv.locklostRenew.body(active ? lease.holder.name : '');
      lease.expiresAt = now() + LOCK_TTL_MS;
      return SHAPES.kv.leaseRenewed.body(lease.expiresAt);
    }
    if (a === 'lockRelease') {
      if (!leaseActive()) return SHAPES.kv.released.body();
      if (!deviceId || lease.holder.deviceId !== deviceId || body.editToken !== lease.token) return SHAPES.kv.locklostRelease.body();
      lease = { holder: null, token: '', epoch: lease.epoch, acquiredAt: 0, expiresAt: 0 };
      return SHAPES.kv.released.body();
    }
    return null;
  }
  function respond(body) {
    const a = body && body.action;
    const lk = respondLock(a, body || {});
    if (lk) return lk;
    if (a === 'ping') return { ok: true, server: 'silverunix-sync' };
    if (a === 'get') { const e = kv.get(body.key); return { ok: true, data: e ? e.data : null, rev: e ? e.rev : 0 }; }
    if (a === 'head') {
      if (Array.isArray(body.keys)) { const revs = {}; for (const k of body.keys) revs[k] = kv.has(k) ? kv.get(k).rev : 0; return { ok: true, revs }; }
      const e = kv.get(body.key); return { ok: true, rev: e ? e.rev : 0 };
    }
    if (a === 'pull') {
      const entries = {};
      for (const k of body.keys || []) if (kv.has(k)) entries[k] = { data: kv.get(k).data, rev: kv.get(k).rev };
      return { ok: true, entries };
    }
    if (a === 'put' || a === 'push') {
      /* 編集リースの照合は版の照合より前（Code.gs の actionPush と同じ順）。リースが空・失効中は通す */
      if (a === 'push' && SHIFT_LOCK_KEY_RE.test(String(body.key == null ? '' : body.key)) && leaseActive() && body.editToken !== lease.token) return SHAPES.kv.editlock.body(lease.holder.name, lease.expiresAt);
      const e = kv.get(body.key); const cur = e ? e.rev : 0;
      const sent = a === 'put' ? (typeof body.rev === 'number' ? body.rev : 0) : (typeof body.baseRev === 'number' ? body.baseRev : 0);
      if (sent !== cur && !body.force) return a === 'put' ? SHAPES.kv.conflictPut.body(cur) : SHAPES.kv.conflictPush.body(cur);
      if (a === 'put' && e && JSON.stringify(e.data) === JSON.stringify(body.data)) return SHAPES.kv.unchanged.body(cur);
      kv.set(body.key, { data: body.data, rev: cur + 1 });
      history.push({ key: body.key, rev: cur + 1, data: body.data });
      return SHAPES.kv.saved.body(cur + 1);
    }
    if (a === 'history') return { ok: true, items: [] };
    return { ok: true };
  }
  return { kv, history, respond, rev: (k) => (kv.has(k) ? kv.get(k).rev : 0), lease: () => Object.assign({}, lease),
    writeActions: ['put', 'push'], keyOf: (b) => (b && b.key != null ? String(b.key) : null) };
}

/* ── 見本の入居者マスタ（台本で起こさない時に答える）──
   読み取りは材料（check/fixtures/resident-master.mjs の respond）に任せ、saveResident と1名の読み取りだけここで持つ。
   版の照合は本物の master.gs:858-862 と同じく baseUpdatedAt と今の updatedAt の差が1秒以上で conflict */
export function createMasterBackend(readRespond, residents) {
  const rows = new Map((residents || []).map((r) => [String(r.id), { ...r }]));
  const history = [];
  function respond(body) {
    const a = body && body.action;
    if (a === 'saveResident') {
      const rec = body.record || {};
      const id = String(rec.id == null ? '' : rec.id);
      const cur = rows.get(id);
      if (cur && body.baseUpdatedAt != null && String(body.baseUpdatedAt) !== '') {
        const pb = new Date(String(body.baseUpdatedAt)).getTime(), pu = new Date(String(cur.updatedAt || '')).getTime();
        if (isFinite(pb) && isFinite(pu) && Math.abs(pu - pb) >= 1000) return SHAPES.master.conflict.body();
      }
      const next = { ...(cur || {}), ...rec };
      rows.set(id, next);
      history.push({ key: id, rev: history.length + 1, data: next });
      return { record: next };
    }
    if (a === 'get' || a === 'getResident') { const r = rows.get(String(body.id)); return { ok: true, record: r || null }; }
    return readRespond ? readRespond(body) : { ok: true };
  }
  /* GET（doGet）は版数の照会だけ答え、ほかは本物と同じく断る。版数は保存できた回数で進める（本物は保存のたびに _bumpStateRev） */
  function respondGet(action) { return action === 'stateRev' ? SHAPES.master.stateRev.body(history.length) : SHAPES.master.getRefused.body(); }
  return { rows, history, respond, respondGet, rev: () => 0, writeActions: ['saveResident'],
    keyOf: (b) => (b && b.key != null ? String(b.key) : (b && b.record && b.record.id != null ? String(b.record.id) : null)) };
}

/* ── 見本の体重管理（台本で起こさない時に答える）──
   本物の weight-api.gs の doPost と同じく、getAll は全件、saveRecord・saveResident は id で上書き（無ければ足す）、
   delRecord・delResident は id で消す、saveThr はしきい値を置き換える。合言葉・ロック・確定（flush）の失敗は持たない（計測用）。
   GET は疎通確認（action なし）に版と対応機能、getAll は「POST でだけ」の断り（weight-api.gs:153-170）。 */
export function createWeightBackend(seed) {
  const residents = new Map(((seed && seed.residents) || []).map((r) => [String(r.id), { ...r }]));
  const records = new Map(((seed && seed.records) || []).map((r) => [String(r.id), { ...r }]));
  let thresholds = seed && seed.thresholds !== undefined ? seed.thresholds : null;
  const history = [];   // 書けた記録 {key, rev, action}
  const wrote = (action, key) => { history.push({ key, rev: history.length + 1, action }); return SHAPES.wt.saved.body(); };
  function respond(body) {
    const a = body && body.action;
    if (a === 'getAll') return SHAPES.wt.getAll.body([...residents.values()].map((r) => ({ ...r })), [...records.values()].map((r) => ({ ...r })), thresholds);
    if (a === 'saveRecord') { const r = body.record || {}; const id = String(r.id == null ? '' : r.id); records.set(id, { ...(records.get(id) || {}), ...r }); return wrote(a, id); }
    if (a === 'delRecord') { const id = String(body.id == null ? '' : body.id); records.delete(id); return wrote(a, id); }
    if (a === 'saveResident') { const r = body.resident || {}; const id = String(r.id == null ? '' : r.id); residents.set(id, { ...(residents.get(id) || {}), ...r }); return wrote(a, id); }
    if (a === 'delResident') { const id = String(body.id == null ? '' : body.id); residents.delete(id); return wrote(a, id); }
    if (a === 'saveThr') { thresholds = body.thresholds || null; return wrote(a, 'thr'); }
    return { ok: false, error: 'Error: unknown action: ' + a };
  }
  function respondGet(action) { return action === 'getAll' ? SHAPES.wt.getRefused.body() : SHAPES.wt.probe.body(); }
  return { residents, records, history, respond, respondGet, rev: () => 0,
    writeActions: ['saveRecord', 'delRecord', 'saveResident', 'delResident', 'saveThr'],
    keyOf: (b) => {
      if (!b) return null;
      if (b.record && b.record.id != null) return String(b.record.id);
      if (b.resident && b.resident.id != null) return String(b.resident.id);
      return b.id != null ? String(b.id) : null;
    } };
}

/* ── 見本の消耗品管理（台本で起こさない時に答える）──
   list は品目・価格・在庫をそのまま返し、addMoves は本物の handleAddMoves_ と同じく id で冪等に受ける
   （同じ id がもうあれば existing・形の合わない記録は rejected・それ以外は applied で在庫を動かす）。
   在庫の数え方は入庫・出庫・調整の最小単位の数の足し算だけ（棚卸・締め・価格・権限は持たない＝計測用）。
   単位の段（units）は [{name},{name,per}] の形で、入れた段から最小単位までの per を掛けて最小単位の数にする。 */
const MOVE_ID_RE = /^mv_[0-9A-Za-z_-]{1,40}$/;
function minUnitFactor(units, idx) {
  let f = 1;
  for (let i = Number(idx) + 1; i < (units || []).length; i++) f *= Number(units[i] && units[i].per) || 1;
  return f;
}
export function createSuppliesBackend(seed) {
  const sd = seed || {};
  const items = (sd.items || []).map((it) => ({ ...it }));
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const moves = new Map();   // id → 記録
  const stock = {};
  for (const it of items) stock[it.id] = { qty: (sd.stock && sd.stock[it.id] && typeof sd.stock[it.id].qty === 'number') ? sd.stock[it.id].qty : 0, asOf: '', lastCount: null };
  const history = [];
  function respond(body) {
    const a = body && body.action;
    if (a === 'list') {
      return SHAPES.spl.list.body({ role: sd.role || 'staff', items: items.map((it) => ({ ...it })), prices: sd.prices || {}, profiles: sd.profiles || [],
        categories: sd.categories || [], defaults: sd.defaults || {}, closedMonths: sd.closedMonths || [], stock: JSON.parse(JSON.stringify(stock)), settingsAt: sd.settingsAt || '' });
    }
    if (a === 'addMoves') {
      const list = Array.isArray(body.moves) ? body.moves : [];
      const results = [], touched = {};
      for (const src of list) {
        const id = String(src && src.id != null ? src.id : '').trim();
        const it = byId.get(String(src && src.itemId));
        if (!MOVE_ID_RE.test(id)) { results.push({ id, status: 'rejected', reason: 'bad_id' }); continue; }
        if (moves.has(id)) { results.push({ id, status: 'existing', move: moves.get(id) }); continue; }
        if (!it) { results.push({ id, status: 'rejected', reason: 'no_item' }); continue; }
        const q = Number(src.qtyEntered);
        if (!Number.isInteger(q) || (src.type !== 'adj' && q < 0)) { results.push({ id, status: 'rejected', reason: 'bad_qty' }); continue; }
        const qty = q * minUnitFactor(it.units, src.unitIdx) * (src.type === 'out' ? -1 : 1);
        const mv = { id, date: src.date, itemId: it.id, type: src.type, qtyEntered: q, unitIdx: src.unitIdx, qty };
        moves.set(id, mv);
        stock[it.id].qty += qty;
        touched[it.id] = true;
        history.push({ key: id, rev: history.length + 1, data: mv });
        results.push({ id, status: 'applied', move: mv });
      }
      const st = {};
      for (const k of Object.keys(touched)) st[k] = { ...stock[k] };
      return SHAPES.spl.moves.body(results, st);
    }
    if (a === 'listMoves') return { ok: true, moves: [...moves.values()] };
    return { ok: false, error: 'unknown_action' };
  }
  function respondGet(action) { return (!action || action === 'ping') ? SHAPES.spl.ping.body() : SHAPES.spl.postOnly.body(); }
  return { items, moves, stock, history, respond, respondGet, rev: () => 0,
    /* 書く action（supplies.html の SPL_WRITE_ACTIONS と同じ11個） */
    writeActions: ['saveItem', 'addPrice', 'voidPrice', 'setProfiles', 'addMoves', 'voidMove', 'repriceMoves', 'setNote', 'setCategories', 'setDefaults', 'setClosedMonths'],
    keyOf: (b) => (b && Array.isArray(b.moves) && b.moves[0] && b.moves[0].id != null ? String(b.moves[0].id) : (b && b.key != null ? String(b.key) : null)) };
}
