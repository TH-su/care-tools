/* kintai-board-calc.js — 勤怠の段B（2026-11-25・ROOT-v7-plus-parity.md「段B」・care-backend 統合 0130）の純関数
 *   1. 管理者の自由な文のお知らせ（期間と事業所を選ぶ・本人のスマホの画面に帯で出す）: 入力の確かめ・言い方
 *   2. 本人の画面からの補助項目の申請（承認すると kintai_extras に入る）: 選択肢の読み方・送る形・言い方・断りの文
 * 設定の鍵は selfAnnounce・selfExtraReq（JSON の true の時だけ入・既定は切）。DB も同じ鍵で確かめる（画面は見せ方だけ）。
 * 値の確かめは段A1 の kintai-extras.js（parseValue・minutesOf・fmtValue）を使い、決まりを二つに分けない。
 * 画面に入れる文は呼ぶ側が textContent か esc で入れる（ここは素の文を返すだけ）。端末に何も残さない。console を使わない */
(function (root) {
  'use strict';
  var X = (typeof module !== 'undefined' && module.exports) ? require('./kintai-extras.js') : root.KintaiExtras;

  var KEY_ANN = 'selfAnnounce', KEY_XR = 'selfExtraReq';
  var OFFICES = ['facility', 'visit', 'day'];
  var BODY_MAX = 400, SPAN_MAX = 366, NOTE_MAX = 194;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isDate(d) { if (typeof d !== 'string' || !DATE_RE.test(d)) return false; var t = Date.parse(d + 'T00:00:00Z'); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d; }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  function md(d) { return isDate(d) ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
  function on(cfg, key) { return !!(cfg && typeof cfg === 'object' && cfg[key] === true); }

  /* 文のそろえ方（DB の kintai_announce_add と同じ: CRLF は LF・前後の空白（全角も）を除く） */
  function cleanBody(s) { return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/^[ \t\n\r　]+|[ \t\n\r　]+$/g, ''); }
  /* 改行のほかの制御文字があるか */
  function hasCtl(s) { return /[\u0000-\u0009\u000b-\u001f\u007f]/.test(s); }

  /* お知らせの入力を確かめる。{ ok, msg, args }（args は kintai_announce_add に渡す形） */
  function checkAnnounce(o, today) {
    o = o || {};
    var body = cleanBody(o.body), offs = Array.isArray(o.offices) ? o.offices.filter(function (x) { return OFFICES.indexOf(x) >= 0; }) : [];
    if (!body) return { ok: false, msg: 'お知らせの文を書いてください。' };
    if (body.length > BODY_MAX) return { ok: false, msg: 'お知らせの文は' + BODY_MAX + '字までです（いま ' + body.length + ' 字）。' };
    if (hasCtl(body)) return { ok: false, msg: 'お知らせの文に使えない文字（タブなど）が入っています。消してから出してください。' };
    if (!isDate(o.from) || !isDate(o.to)) return { ok: false, msg: '出す期間（始めの日と終わりの日）を入れてください。' };
    if (o.to < o.from) return { ok: false, msg: '終わりの日が始めの日より前です。' };
    if (days(o.from, o.to) > SPAN_MAX) return { ok: false, msg: '出す期間は1年（' + SPAN_MAX + '日）までです。' };
    if (isDate(today) && o.to < today) return { ok: false, msg: '終わりの日が今日より前です（出す前に終わってしまいます）。' };
    var uniq = OFFICES.filter(function (x) { return offs.indexOf(x) >= 0; });
    return { ok: true, args: { p_body: body, p_offices: uniq.length === OFFICES.length ? [] : uniq, p_from: o.from, p_to: o.to } };
  }
  /* 事業所の言い方（空＝全員）。nameOf は事業所の名前（SUFacility） */
  function officesText(offs, nameOf) {
    var a = Array.isArray(offs) ? offs.filter(function (x) { return OFFICES.indexOf(x) >= 0; }) : [];
    if (!a.length) return '全員';
    return a.map(function (x) { var n = ''; try { n = nameOf ? nameOf(x) : ''; } catch (e) { n = ''; } return n || x; }).join('・');
  }
  function periodText(from, to) { return from === to ? md(from) : md(from) + '〜' + md(to); }
  /* お知らせの状態: void（取り消し）・ended（終わった）・future（これから）・now（出している） */
  function announceState(r, today) {
    if (!r) return 'void';
    if (r.voided_at) return 'void';
    if (isDate(today) && isDate(r.date_to) && r.date_to < today) return 'ended';
    if (isDate(today) && isDate(r.date_from) && r.date_from > today) return 'future';
    return 'now';
  }
  var ANN_ST = { now: '出しています', future: 'これから', ended: '終わりました', void: '取り消し' };
  /* 受け口の答えのお知らせの行を確かめる（文が文字でない・日付が違う行は捨てる・10件まで） */
  function announceRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && typeof r === 'object' && typeof r.body === 'string' && r.body && isDate(r.date_from) && isDate(r.date_to);
    }).slice(0, 10).map(function (r) { return { id: String(r.id || ''), body: r.body, date_from: r.date_from, date_to: r.date_to }; });
  }

  /* ── 補助項目の申請 ── */
  /* 受け口の選択肢（DB が確かめた使っている項目）を kintai-extras.js の項目の形にそろえる */
  function itemsOf(raw) {
    var seen = Object.create(null), out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (x) {
      if (!x || typeof x !== 'object' || typeof x.code !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(x.code) || seen[x.code]) return;
      if (['count', 'number', 'time'].indexOf(x.kind) < 0) return;
      seen[x.code] = 1;
      var dec = x.kind === 'number' && (x.decimals === 1 || x.decimals === 2) ? x.decimals : 0;
      out.push({ code: x.code, name: typeof x.name === 'string' && x.name ? x.name.slice(0, 20) : x.code, kind: x.kind,
                 unit: typeof x.unit === 'string' ? x.unit.slice(0, 10) : '', decimals: dec, active: true });
    });
    return out.slice(0, 20);
  }
  function itemOf(items, code) { return (items || []).filter(function (x) { return x.code === code; })[0] || null; }
  /* 入力から送る形を作る。o = { date, code, value, hours, mins, note, today }。{ ok, msg, body }（body は受け口 extra_add の項目） */
  function buildExtra(o, items) {
    o = o || {};
    var it = itemOf(items, o.code);
    if (!it) return { ok: false, msg: '項目を選んでください。' };
    if (!isDate(o.date)) return { ok: false, msg: '日付を入れてください。' };
    if (isDate(o.today) && o.date > o.today) return { ok: false, msg: '今日より先の日は申請できません。済んだ日を選んでください。' };
    var v;
    if (it.kind === 'time') {
      var m = X.minutesOf(o.hours, o.mins);
      if (m == null) return { ok: false, msg: '時間を入れてください（時間と分）。' };
      if (!(m >= 1 && m <= 1440)) return { ok: false, msg: '時間は1分〜24時間で入れてください（分は0〜59）。' };
      v = { ok: true, qty: null, minutes: m };
    } else {
      v = X.parseValue(it, o.value);
      if (!v.ok) {
        if (v.why === 'empty') return { ok: false, msg: '値を入れてください。' };
        if (v.why === 'decimals') return { ok: false, msg: it.kind === 'count' ? '回数は整数で入れてください。' : '小数は' + it.decimals + '桁までです。' };
        if (v.why === 'neg') return { ok: false, msg: '0 より小さい値は入れられません。' };
        return { ok: false, msg: '値の形か大きさが合いません（0〜99999）。' };
      }
    }
    var note = String(o.note == null ? '' : o.note).trim();
    if (note.length > NOTE_MAX) return { ok: false, msg: '理由は' + NOTE_MAX + '字までです。' };
    var body = { work_date: o.date, code: it.code };
    if (v.minutes != null) body.minutes = v.minutes; else body.qty = v.qty;
    if (note) body.note = note;
    return { ok: true, body: body };
  }
  /* 値の言い方（項目が設定から消えている時は印と数のまま） */
  function valueText(r, items) {
    var it = itemOf(items, r && r.code);
    var v = { qty: r && r.qty != null ? +r.qty : null, minutes: r && r.minutes != null ? +r.minutes : null };
    if (it) return X.label(it, it.kind === 'time' ? v.minutes : v.qty);
    return String((r && r.code) || '') + ' ' + (v.minutes != null ? v.minutes + '分' : v.qty != null ? String(v.qty) : '');
  }
  var XR_ST = { pending: '承認待ち', approved: '承認済み', rejected: '差し戻し', withdrawn: '取り下げ' };
  /* 本人の画面の断りの文（DB と受け口の語） */
  var XR_ERR = {
    off: '補助項目の申請は、いまは使えません（事務所が止めています）。',
    baddate: 'その日は申請できません（今日より先の日・来月分の期間の終わりより先の日）。',
    badcode: 'この項目はいまは使えません（事務所が止めたか、名前を変えました）。画面を閉じて開き直してください。',
    badvalue: '値を受け付けられませんでした（回数は整数・数値は決まった小数の桁まで・時間は1分〜24時間）。',
    locked: 'その日は締めた月分に入っているため申請できません。事務所に伝えてください。',
    toomany: '承認待ちの補助項目の申請が多すぎます（20件まで）。承認されるのを待ってから出してください。',
    exists: '同じ日・同じ項目の承認待ちの申請がもうあります。直す時は、前の申請を取り下げてから出してください。',
    reason: '理由は194字までです。', conflict: 'この申請は、もう承認・差し戻しされたか取り下げてあります。一覧を読み直しました。',
    notfound: '申請が見つかりませんでした。一覧を読み直しました。'
  };
  function xrErr(code) { return XR_ERR[code] || null; }

  var api = {
    KEY_ANN: KEY_ANN, KEY_XR: KEY_XR, OFFICES: OFFICES, BODY_MAX: BODY_MAX, SPAN_MAX: SPAN_MAX, NOTE_MAX: NOTE_MAX, ANN_ST: ANN_ST, XR_ST: XR_ST,
    isDate: isDate, addDays: addDays, md: md, on: on, cleanBody: cleanBody, checkAnnounce: checkAnnounce, officesText: officesText, periodText: periodText,
    announceState: announceState, announceRows: announceRows, itemsOf: itemsOf, itemOf: itemOf, buildExtra: buildExtra, valueText: valueText, xrErr: xrErr, own: own
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KintaiBoardCalc = api;
})(typeof window !== 'undefined' ? window : this);
