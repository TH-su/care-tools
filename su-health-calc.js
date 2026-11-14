/*
 * su-health-calc.js — 本番の健康（切り替え済みの正本ごとの保存の成功・失敗と、Google への写し返しの遅れ）の判定（純関数・2026-11-14 代表者の依頼）
 * ════════════════════════════════════════════════════════════════
 * 写しの見比べ（shadow-check）の「本番の健康」の表と、管理者のメニューの札（su-health-badge.js）が使う。通信も保存もしない。
 *   SUHealthCalc.judge(resp, nowMs) … データベースの save_health（統合 0088）の答えから、種類ごとの行と「知らせる種類」を作る
 *   SUHealthCalc.tileBadges(result) … 知らせる種類を、メニューのタイル（リンク先）ごとの札の文にまとめる
 *   SUHealthCalc.KINDS / LABEL / TILE / FAIL_N / LAG_MS
 * 決めごと（代表者の依頼 2026-11-14）:
 *   ・知らせるのは、切り替えた後（印が live）の種類で、直近24時間の失敗が5件以上か、写し返しが2時間以上遅れている時だけ
 *     （5件ちょうど・2時間ちょうども知らせる）
 *   ・写し返しの遅れは「まだ写し返していない保存のうち、いちばん古い保存からの時間」。残りが無い時は遅れなし（夜に保存が無いだけでは知らせない）
 *   ・体重のように写し返しをデータベースが見られない種類は「確かめられません」にし、遅れでは知らせない
 *   ・答えが読めない・形が違う時は全部「確かめられません」にし、健康とは言わない（知らせもしない）
 *   ・出すのは種類・数・時刻だけ（氏名・中身は答えにも無い）
 */
(function (root) {
  'use strict';

  var KINDS = ['res', 'tp', 'adm', 'stf', 'sup', 'sa', 'geno', 'doc_stf', 'doc_adm', 'weight'];
  var LABEL = {
    res: '入居者マスタ', tp: '個別機能訓練計画書', adm: '入居調整', stf: '職員マスタ', sup: '消耗品管理（備品）',
    sa: '過去シフト分析', geno: '家族構成図', doc_stf: '添付書類（職員マスタ）', doc_adm: '添付書類（入居調整）', weight: '体重管理'
  };
  /* メニューのタイル（リンク先）。添付書類は持ち主の画面のタイルに出す */
  var TILE = {
    res: 'resident-master.html', tp: 'training-plan.html', adm: 'admission-flow.html', stf: 'staff-master.html', sup: 'supplies.html',
    sa: 'shift-analyzer.html', geno: 'genogram.html', doc_stf: 'staff-master.html', doc_adm: 'admission-flow.html', weight: 'weight-record.html'
  };
  var REASONS = ['login', 'perm', 'timeout', 'other'];
  /* 失敗をまだ数えていない種類（シフト分析の画面は別の正本から配るので、失敗の控えの部品を読み込んでいない）。表は「数えていません」と出す */
  var NO_FAIL_COUNT = { sa: 1 };
  var FAIL_N = 5;
  var LAG_MS = 2 * 60 * 60 * 1000;

  function cnt(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1e9 && Math.floor(v) === v; }
  function when(v) {
    if (v == null) return null;
    if (typeof v !== 'string') return undefined;
    var ms = Date.parse(v);
    return isFinite(ms) ? ms : undefined;
  }
  function unknownRow(k) {
    return { kind: k, label: LABEL[k], state: 'unknown', ok: null, fails: null, failTotal: null, failKnown: false, partial: false,
             pending: null, lagMs: null, lagKnown: false, lastMirrorMs: null, lastKind: null, failAlert: false, lagAlert: false };
  }

  /* 1種類分の行。形が少しでも違えば「確かめられません」 */
  function rowOf(k, r, nowMs) {
    if (!r || typeof r !== 'object' || r.kind !== k) return unknownRow(k);
    var state = r.mode === 'live' ? 'live' : r.mode === 'shadow' ? 'shadow' : r.mode == null ? 'none' : null;
    if (!state || !cnt(r.ok) || !r.fails || typeof r.fails !== 'object' || Array.isArray(r.fails)) return unknownRow(k);
    var fails = {}, total = 0;
    for (var key in r.fails) {
      if (!Object.prototype.hasOwnProperty.call(r.fails, key)) continue;
      if (REASONS.indexOf(key) < 0 || !cnt(r.fails[key])) return unknownRow(k);
    }
    for (var i = 0; i < REASONS.length; i++) { fails[REASONS[i]] = r.fails[REASONS[i]] || 0; total += fails[REASONS[i]]; }
    var last = when(r.last_mirror_at);
    if (last === undefined) return unknownRow(k);
    var out = { kind: k, label: LABEL[k], state: state, ok: r.ok, fails: fails, failTotal: total, failKnown: !NO_FAIL_COUNT[k], partial: false,
                pending: null, lagMs: null, lagKnown: false, lastMirrorMs: last,
                lastKind: r.last_kind === 'ack' || r.last_kind === 'change' ? r.last_kind : null, failAlert: false, lagAlert: false };
    if (r.mirror_seen === true) {
      if (!cnt(r.pending)) return unknownRow(k);
      var old = when(r.oldest_pending_at);
      if (old === undefined || (r.pending > 0 && old === null)) return unknownRow(k);
      out.pending = r.pending;
      out.lagMs = r.pending > 0 ? Math.max(0, nowMs - old) : 0;
      out.lagKnown = true;
    }
    if (state === 'live') {
      out.failAlert = out.failKnown && total >= FAIL_N;
      out.lagAlert = out.lagKnown && out.pending > 0 && out.lagMs >= LAG_MS;
      // 切り替え済みなのに失敗か写し返しを確かめられない行は「問題なし」と言わない（反証レビュー指摘5）
      out.partial = !out.failKnown || !out.lagKnown;
    }
    return out;
  }

  /* resp: save_health の答え（{ok:true, now, rows:[…]}）。nowMs: 今の時刻（無ければ答えの now） */
  function judge(resp, nowMs) {
    var ok = !!(resp && typeof resp === 'object' && resp.ok === true && Array.isArray(resp.rows));
    var now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : (ok ? when(resp.now) : null);
    if (!ok || typeof now !== 'number') {
      return { ok: false, rows: KINDS.map(unknownRow), alerts: [] };
    }
    var byKind = {};
    resp.rows.forEach(function (r) { if (r && typeof r === 'object' && KINDS.indexOf(r.kind) >= 0 && !byKind[r.kind]) byKind[r.kind] = r; });
    var rows = KINDS.map(function (k) { return rowOf(k, byKind[k], now); });
    var alerts = rows.filter(function (x) { return x.failAlert || x.lagAlert; })
      .map(function (x) { return { kind: x.kind, fail: x.failAlert, lag: x.lagAlert, failTotal: x.failTotal, lagMs: x.lagAlert ? x.lagMs : 0 }; });
    return { ok: true, rows: rows, alerts: alerts };
  }

  /* 遅れの時間を「n時間」「n時間m分」で書く（分は切り捨て） */
  function lagText(ms) {
    if (!(ms >= 0)) return '';
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), r = m % 60;
    if (h <= 0) return r + '分';
    return h + '時間' + (r ? r + '分' : '');
  }

  /* 知らせる種類を、タイル（リンク先）ごとの札の文にまとめる。{ 'staff-master.html': '保存の失敗7件（24時間）・写し返しが3時間遅れ', … } */
  function tileBadges(result) {
    var out = {};
    if (!result || result.ok !== true || !Array.isArray(result.alerts)) return out;
    var agg = {};
    result.alerts.forEach(function (a) {
      var href = TILE[a && a.kind];
      if (!href) return;
      var g = agg[href] || (agg[href] = { fails: 0, lag: 0 });
      if (a.fail && cnt(a.failTotal)) g.fails += a.failTotal;
      if (a.lag && a.lagMs > g.lag) g.lag = a.lagMs;
    });
    Object.keys(agg).forEach(function (href) {
      var g = agg[href], parts = [];
      if (g.fails > 0) parts.push('保存の失敗' + g.fails + '件（24時間）');
      if (g.lag > 0) parts.push('写し返しが' + lagText(g.lag) + '遅れ');
      if (parts.length) out[href] = parts.join('・');
    });
    return out;
  }

  var api = { KINDS: KINDS, LABEL: LABEL, TILE: TILE, REASONS: REASONS, FAIL_N: FAIL_N, LAG_MS: LAG_MS, NO_FAIL_COUNT: NO_FAIL_COUNT,
              judge: judge, tileBadges: tileBadges, lagText: lagText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUHealthCalc = api;
})(typeof window !== 'undefined' ? window : this);
