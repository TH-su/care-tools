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
 *   行番号は 2026-10-31 時点。統合KV＝ワークスケジュールアプリの gas/Code.gs、入居者マスタ＝テーマの gas/master.gs。
 * ★確かめていない形（例: 入居者マスタの push・統合KV の saveResident の競合）は作らない＝無い組み合わせは例外にする。
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
  if (body.ok === true) return { ok: true, name: body.unchanged ? 'unchanged' : null };
  if (body.conflict) return { ok: false, name: 'conflict' };
  if (body.ok === false || body.error != null) return { ok: false, name: body.error != null ? String(body.error).slice(0, 40) : 'ok:false' };
  if (body.code) return { ok: false, name: String(body.code) };
  if (body.record) return { ok: true, name: null };   // 入居者マスタの saveResident の成功（{record}）
  return { ok: null, name: null };
}

/* ── 見本の統合KV（台本で起こさない時に答える）──
   本物の Code.gs の wsPut と同じ順で答える: 版の照合（:1005-1007）→ 中身が同じなら unchanged（:1016-1018）→ 書いて版を1つ進める。
   get・head・pull は check/fixtures/care-schedule.mjs の見本と同じ形。版の印・ロック・空の上書きの守りは持たない（計測用） */
export function createKvBackend(seed) {
  const kv = new Map();
  for (const [k, v] of Object.entries(seed || {})) kv.set(k, { data: v, rev: 1 });
  const history = [];   // 書けた版の記録 {key, rev, data}
  function respond(body) {
    const a = body && body.action;
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
  return { kv, history, respond, rev: (k) => (kv.has(k) ? kv.get(k).rev : 0) };
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
  return { rows, history, respond, respondGet, rev: () => 0 };
}
