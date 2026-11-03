/* su-cutover-gate.js — 正本を切り替える前の確かめの表（2026-11-03 代表者の依頼）
 *
 * 写しの見比べ（shadow-check）の5つの「切り替える／本番にする」ボタン（入居者マスタ・入居調整・訓練計画書・体重・職員マスタ）の前に出す4項目を判定する。
 * 4項目が全部そろった時だけボタンを押せる。そろわない項目には理由を出す。最後に決めるのは今までどおりデータベース（各 *_set_mode）。
 *   1 写しと正本の差が0件の日が3日以上続いている（統合 0055 の shadow_diff_days。見比べた日だけを数える。
 *     今日まだ見比べていなければ昨日までで数え、今日の見比べで差があれば0日）
 *   2 ログインしていない端末が0台（統合 0048 の device_seen_summary。この7日に開いた端末。数が分からない時は満たさない扱い＝代表者の決定 2026-11-03。
 *     この7日に1台も届いていない時も「分からない」（送るのが止まっても古い行は90日残り、7日の数が全部0になるため・反証レビュー指摘2）
 *   3 毎晩の業務の流れの通し試験（.github/workflows/flow-check.yml）の最後の回が合格で、26時間以内（公開リポジトリなので GitHub から読むだけ）
 *   4 今日（日本時間）すでに別の正本を切り替えていない（1日1つまで。操作の記録 audit_log の「本番にした」記録で数える＝entity が *_mode で値に live、
 *     または kv_families で項目に mode:live（週間計画・ワークスケジュール・勤務表）。後から足した正本（家族構成図など）も *_mode なら数える。
 *     写しの期間に戻した記録は数えない。同じ正本の切り替え直しは数えない。今日本番にしてから戻した日も数える）
 * ★純関数だけ（時計・画面・通信を使わない）。読んで渡すのは shadow-check.js の loadGate。試験: node check/unit/cutover_gate_test.js
 * ★出すのは日数・台数・試験の結果・正本の名前だけ（氏名・中身を扱わない）
 */
(function (root) {
  'use strict';

  var NEED_DAYS = 3;
  var FLOW_MAX_MS = 26 * 3600 * 1000;
  var KINDS = { res: '入居者マスタ', tp: '個別機能訓練計画書', adm: '入居調整', stf: '職員マスタ', weight: '体重' };
  /* 操作の記録（audit_log）の entity → [種類, 正本の名前]。値の配列（entity_ids）に 'live' がある行が「本番にした」記録。
   * ここに無い *_mode も「本番にした」記録として数える（名前は entity のまま。正本を足した時に数え漏れないように・反証レビュー指摘3） */
  var CUT_ENTITY = {
    res_mode: ['res', '入居者マスタ'], tp_mode: ['tp', '個別機能訓練計画書'], adm_mode: ['adm', '入居調整'], stf_mode: ['stf', '職員マスタ'],
    weight_mode: ['weight', '体重'], sup_mode: ['sup', '備品'], sa_mode: ['sa', 'シフト分析'], geno_mode: ['geno', '家族構成図']
  };
  /* 週間計画・ワークスケジュール・勤務表は entity が kv_families・entity_ids が種類・fields に 'mode:live'（統合 0007・0009） */
  var KV_FAMILY = { care: '週間計画', ws_master: 'ワークスケジュール', wsday: 'ワークスケジュール', shift: '勤務表' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* 日本時間の日付（YYYY-MM-DD）。読めない時は '' */
  function jstDay(t) {
    var ms = typeof t === 'number' ? t : Date.parse(String(t || ''));
    if (!isFinite(ms)) return '';
    return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  /* 日本時間のその日の0時（ISO 形式・UTC）。操作の記録を今日の分だけ読む時に使う */
  function jstDayStartIso(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return '';
    return new Date(Date.parse(day + 'T00:00:00Z') - 9 * 3600 * 1000).toISOString();
  }
  function prevDay(day) { return new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10); }
  /* 日本時間の「11/3 2:47」 */
  function jstShort(t) {
    var ms = Date.parse(String(t || ''));
    if (!isFinite(ms)) return '—';
    var d = new Date(ms + 9 * 3600 * 1000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + d.getUTCHours() + ':' + pad(d.getUTCMinutes());
  }

  /* 1 差が0件の連続日数。rows = shadow_diff_days の rows（{kind, day, checks, worst}）。
   * 返す: { days, todayWorst（今日の差・見比べていなければ null）, lastDay（数えた最後の日） } */
  function streak(rows, kind, today) {
    var by = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (r && r.kind === kind && /^\d{4}-\d{2}-\d{2}$/.test(String(r.day)) && Number(r.checks) > 0) by[r.day] = Number(r.worst) || 0;
    });
    var todayWorst = Object.prototype.hasOwnProperty.call(by, today) ? by[today] : null;
    if (todayWorst != null && todayWorst > 0) return { days: 0, todayWorst: todayWorst };
    var d = todayWorst != null ? today : prevDay(today), n = 0;
    while (Object.prototype.hasOwnProperty.call(by, d) && by[d] === 0 && n < 400) { n++; d = prevDay(d); }
    return { days: n, todayWorst: todayWorst };
  }

  /* 2 ログインしていない端末（この7日）。sum = device_seen_summary の data。返す: 台数 か null（分からない）。
   * この7日に1台も届いていなければ（ログイン中の端末も0台）、送るのが止まっている＝分からない */
  function unlogged(sum) {
    var rows = sum && Array.isArray(sum.rows) ? sum.rows : null;
    if (!rows || !rows.length) return null;
    var seen = rows.reduce(function (n, x) { return n + (Number(x && x.d7) || 0); }, 0);
    if (!(seen > 0)) return null;
    return rows.reduce(function (n, x) { return n + (x && x.login === false ? (Number(x.d7) || 0) : 0); }, 0);
  }

  /* 3 毎晩の通し試験。runs = GitHub の workflow_runs。毎晩の回（schedule）と手で回した回（workflow_dispatch）の、終わったうち最新 */
  function lastNightly(runs) {
    var c = (Array.isArray(runs) ? runs : []).filter(function (r) {
      return r && (r.event === 'schedule' || r.event === 'workflow_dispatch') && r.status === 'completed' && isFinite(Date.parse(r.created_at));
    });
    c.sort(function (a, b) { return Date.parse(b.created_at) - Date.parse(a.created_at); });
    return c[0] || null;
  }

  /* 4 今日すでに切り替えた別の正本の名前（重なりなし）。audit = audit_log の行（at・entity・entity_ids・fields） */
  function cutsToday(audit, today, kind) {
    var out = [];
    function add(name) { if (out.indexOf(name) < 0) out.push(name); }
    (Array.isArray(audit) ? audit : []).forEach(function (r) {
      if (!r || jstDay(r.at) !== today) return;
      var ids = Array.isArray(r.entity_ids) ? r.entity_ids : [], ent = String(r.entity || '');
      if (ent === 'kv_families') {
        if (Array.isArray(r.fields) && r.fields.indexOf('mode:live') >= 0) ids.forEach(function (f) { add(KV_FAMILY[f] || String(f)); });
        return;
      }
      if (!/^[a-z_]+_mode$/.test(ent) || ids.indexOf('live') < 0) return;
      var e = CUT_ENTITY[ent];
      if (e && e[0] === kind) return;
      add(e ? e[1] : ent);
    });
    return out;
  }

  /* 判定。o = {
   *   kind: 'res'|'tp'|'adm'|'stf'|'weight', now: ミリ秒, today?: 'YYYY-MM-DD'（データベースの日付・無ければ now から）,
   *   diff: { rows } | { error: 'missing'|'denied'|'other' },
   *   dev:  { data } | { error },
   *   flow: { runs } | { error },
   *   cut:  { audit } | { error } }
   * 返す: { ok, items: [{ key, label, ok, value, why }] }（why は満たさない時だけ） */
  function judge(o) {
    o = o || {};
    var kind = o.kind, today = /^\d{4}-\d{2}-\d{2}$/.test(String(o.today || '')) ? o.today : jstDay(o.now);
    var items = [];

    var it1 = { key: 'diff', label: '写しと正本の差が0件の連続日数（3日以上）', ok: false, value: '—', why: '' };
    var d = o.diff || {};
    if (!KINDS[kind]) it1.why = '正本の種類が分かりません。';
    else if (d.error === 'missing') it1.why = '差の記録の準備（データベース 0055）がまだです。';
    else if (d.error === 'denied') it1.why = '差の記録を見られるのは管理者（2段階認証まで済んだ状態）だけです。';
    else if (d.error || !Array.isArray(d.rows)) it1.why = '差の記録を読めませんでした（少し待って読み込み直してください）。';
    else {
      var s = streak(d.rows, kind, today);
      it1.value = s.days + '日';
      if (s.todayWorst != null && s.todayWorst > 0) it1.why = '今日の見比べで差が ' + s.todayWorst + '件 ありました。差を直してから、差が0件の日を3日続けてください。';
      else if (s.days < NEED_DAYS) it1.why = '差が0件の日が ' + s.days + '日 続いています（あと ' + (NEED_DAYS - s.days) + '日）。見比べなかった日があると、そこで数え直しになります。';
      else it1.ok = true;
    }
    items.push(it1);

    var it2 = { key: 'device', label: 'ログインしていない端末の数（0台）', ok: false, value: '—', why: '' };
    var v = o.dev || {};
    if (v.error === 'missing') it2.why = '端末の数の準備（データベース 0048）がまだです。';
    else if (v.error === 'denied') it2.why = '端末の数を見られるのは管理者（2段階認証まで済んだ状態）だけです。';
    else if (v.error) it2.why = '端末の数を読めませんでした（少し待って読み込み直してください）。';
    else {
      var n = unlogged(v.data);
      if (n == null) it2.why = 'この7日に端末の数が届いていません（端末の数を送るスイッチ device_seen が入ると、端末が画面を開いた日に届きます）。分からない時は0台とみなしません。';
      else {
        it2.value = n + '台';
        if (n > 0) it2.why = 'この7日に、ログインしていない端末が ' + n + '台 入居者マスタを読む画面を開いています。その端末でログインしてください。';
        else it2.ok = true;
      }
    }
    items.push(it2);

    var it3 = { key: 'flow', label: '今夜の業務の流れの通し試験（flow-check）が合格', ok: false, value: '—', why: '' };
    var f = o.flow || {};
    if (f.error || !Array.isArray(f.runs)) it3.why = '通し試験の結果を読めませんでした（GitHub に届きません。少し待って読み込み直してください）。';
    else {
      var r = lastNightly(f.runs);
      if (!r) it3.why = '毎晩の通し試験の結果が見つかりません。';
      else {
        var ok = r.conclusion === 'success', at = jstShort(r.created_at);
        it3.value = (ok ? '合格' : '不合格') + '（' + at + '）';
        if (!ok) it3.why = '最後の毎晩の通し試験（' + at + '）が合格していません。直して通るまで切り替えないでください。';
        else if (!(o.now - Date.parse(r.created_at) <= FLOW_MAX_MS)) it3.why = '最後に合格した毎晩の通し試験（' + at + '）が26時間より前です。今夜の回が終わってから押してください。';
        else it3.ok = true;
      }
    }
    items.push(it3);

    var it4 = { key: 'oneday', label: '今日すでに別の正本を切り替えていない（1日1つまで）', ok: false, value: '—', why: '' };
    var c = o.cut || {};
    if (c.error === 'denied') it4.why = '今日の切り替えの記録を見られるのは管理者（2段階認証まで済んだ状態）だけです。';
    else if (c.error || !Array.isArray(c.audit)) it4.why = '今日の切り替えの記録を読めませんでした（少し待って読み込み直してください）。';
    else {
      var done = cutsToday(c.audit, today, kind);
      it4.value = done.length ? done.join('・') + 'を切り替え済み' : 'なし';
      if (done.length) it4.why = '今日すでに' + done.join('・') + 'を切り替えました。正本の切り替えは1日1つです。明日以降に押してください。';
      else it4.ok = true;
    }
    items.push(it4);

    return { ok: items.every(function (x) { return x.ok; }), items: items };
  }

  var api = {
    NEED_DAYS: NEED_DAYS, FLOW_MAX_MS: FLOW_MAX_MS, KINDS: KINDS,
    judge: judge, streak: streak, unlogged: unlogged, lastNightly: lastNightly, cutsToday: cutsToday,
    jstDay: jstDay, jstDayStartIso: jstDayStartIso
  };
  root.SUCutGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
