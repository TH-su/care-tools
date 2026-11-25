/* kintai-board.js — 勤怠の管理画面（kintai.html）の段B（2026-11-25・ROOT-v7-plus-parity.md「段B」・care-backend 統合 0130）
 *   1. 職員のスマホへのお知らせ（管理者が文を書き、出す期間と事業所を選ぶ。本人の「自分の勤怠」の画面に帯で出る。メール・通知は送らない）
 *   2. 本人の画面からの補助項目の申請（承認すると、日の行で入れた時と同じ kintai_extras の行になる・1段の承認）
 * どちらも「申請」のタブの下に出す（画面だけ・印刷しない）。設定の鍵 selfAnnounce・selfExtraReq が入の時だけ出し、切の時は何も描かない（今の画面のまま）。
 * 設定のタブには2つの入り切りの欄を足す（保存は今の「設定を保存する」・kintai.js の saveSettings がこの部品の readSettings を呼ぶ）。
 * 読むのは kintai_announces_list・kintai_extra_reqs_list、書くのは kintai_announce_add・kintai_announce_void・kintai_extra_req_decide。
 * 誰が何をできるかはデータベースが決める（勤怠の管理＝kintai_can）。中身は全部 esc を通して入れる。端末に何も残さない（下書きはメモリだけ）。
 * kintai.js からは KintaiBoardHost（rpc・esc・描き直しなど）だけを受け取る。console を使わない。文と位置は仮置き */
(function () {
  'use strict';
  var B = window.KintaiBoardCalc, X = window.KintaiExtras;
  var H = function () { return window.KintaiBoardHost || null; };
  if (!B || !X) return;

  var NODB = 'データベースの更新がまだです（お知らせと補助項目の申請の仕組みが入るまで、ここは使えません）。';
  var NG = { badvalue: 'お知らせの文か事業所の形が違います（400字まで・タブなどの文字は使えません）。', baddate: '出す期間が正しくありません（終わりが今日より前・始めより前・1年を超える）。',
    toomany: '出しているお知らせが多すぎます（30件まで）。終わったものや要らないものを取り消してから出してください。',
    reason: '理由を書いてください。', notfound: '見つかりませんでした。読み直してください。', already: 'もう取り消してあります。読み直してください。',
    conflict: 'この申請は、ほかの人が先に承認・差し戻ししたか、本人が取り下げました。読み直しました。',
    badcode: 'この項目は設定で止めたか消したため承認できません。差し戻すか、設定の「補助項目」で使うようにしてから承認してください。',
    locked: 'この申請の日は締めた月分に入っているため承認できません。差し戻すか、管理者が締めを解除してから承認してください。',
    badym: '月の形が違います。読み直してください。' };
  var ann = null, annBusy = false, annGen = 0;            /* お知らせの一覧 { at, rows, err } */
  var xr = null, xrBusy = false, xrGen = 0, xrF = 'pending'; /* 補助項目の申請の一覧 { key, rows, pending, err } */
  var noDb = false, busy = false;
  var draft = null;                                        /* お知らせの下書き（メモリだけ・描き直しで消さない） */

  function esc(s) { var h = H(); return h ? h.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cfg() { var h = H(); try { return (h && h.cfg()) || {}; } catch (e) { return {}; } }
  function annOn() { return B.on(cfg(), B.KEY_ANN); }
  function xrOn() { return B.on(cfg(), B.KEY_XR); }
  function today() { var h = H(); return h ? h.today() : ''; }
  function officeName(o) { var h = H(); try { return (h && h.officeName(o)) || ''; } catch (e) { return ''; } }
  function msg(e) {
    var h = H();
    if (e && e.kintai && NG[e.kintai]) return NG[e.kintai];
    if (h && h.noDb(e)) return NODB;
    return h ? h.msgOf(e) : 'うまくいきませんでした。';
  }
  function known(e) { var h = H(); return !!(e && e.kintai) || (h && (h.isNetErr(e) || h.noDb(e))) || (!!e && e.code === '42501'); }
  function repaint() { var h = H(); if (h) h.repaint(); }
  function dtTxt(v) { var t = Date.parse(v); return isNaN(t) ? '' : new Date(t).toLocaleString('ja-JP'); }
  function items() { try { return X.itemsOf(cfg()) || []; } catch (e) { return []; } }
  function ask(kind, text, def) {
    var D = window.SUDialog;
    if (D && D[kind]) return D[kind](text, def);
    return Promise.resolve(kind === 'confirm' ? window.confirm(text) : kind === 'prompt' ? window.prompt(text, def || '') : window.alert(text));
  }
  function freshDraft() { var t = today(); return { body: '', offs: { facility: true, visit: true, day: true }, from: t, to: B.isDate(t) ? B.addDays(t, 6) : '' }; }

  /* ── 読み込み（世代で古い答えを捨てる） ── */
  function loadAnn() {
    var h = H(); if (!h || annBusy || noDb) return;
    var my = ++annGen; annBusy = true;
    h.rpc('kintai_announces_list', {}).then(h.okOr).then(function (r) {
      if (my !== annGen) return;
      ann = { at: Date.now(), rows: (Array.isArray(r.rows) ? r.rows : []).filter(function (x) { return x && typeof x === 'object'; }) };
    })['catch'](function (e) {
      if (my !== annGen) return;
      if (h.noDb(e)) noDb = true; else if (!known(e)) h.note('お知らせの読み込み', e);
      ann = { at: Date.now(), rows: [], err: h.noDb(e) ? NODB : 'お知らせを読めませんでした: ' + msg(e) };
    }).then(function () { if (my !== annGen) return; annBusy = false; repaint(); });
  }
  function loadXr() {
    var h = H(); if (!h || xrBusy || noDb) return;
    var key = xrF || 'all', my = ++xrGen; xrBusy = true;
    h.rpc('kintai_extra_reqs_list', { p_ym: null, p_status: xrF || null }).then(h.okOr).then(function (r) {
      if (my !== xrGen) return;
      var n = +r.pending;
      xr = { key: key, rows: (Array.isArray(r.rows) ? r.rows : []).filter(function (x) { return x && typeof x === 'object'; }), pending: isFinite(n) && n >= 0 ? Math.floor(n) : 0 };
    })['catch'](function (e) {
      if (my !== xrGen) return;
      if (h.noDb(e)) noDb = true; else if (!known(e)) h.note('補助項目の申請の読み込み', e);
      xr = { key: key, rows: [], pending: 0, err: h.noDb(e) ? NODB : '補助項目の申請を読めませんでした: ' + msg(e) };
    }).then(function () { if (my !== xrGen) return; xrBusy = false; repaint(); });
  }
  function reset() { ann = null; annBusy = false; annGen++; xr = null; xrBusy = false; xrGen++; }

  /* ── 描く（申請のタブの下に足す HTML） ── */
  function annHtml() {
    if (!annOn()) return '';
    if (!ann && !annBusy) loadAnn();
    if (!draft) draft = freshDraft();
    var d = draft, td = today();
    var h = '<div class="cd no-print kb-ann"><h2 style="font-size:16px;margin:0 0 8px">職員のスマホへのお知らせ</h2>' +
      '<p class="help">書いた文を、選んだ期間・事業所の職員の「自分の勤怠」の画面の上に帯で出します（メールや通知は送りません。職員が画面を開いた時に見えます）。名前・病名など、職員みんなに見せない方がよいことは書かないでください。</p>';
    if (noDb) return h + '<div class="band warn" role="status">' + esc(NODB) + '</div></div>';
    h += '<div class="row"><label style="flex:1;min-width:14em">お知らせの文（' + B.BODY_MAX + '字まで・改行できます）<textarea id="kb-a-body" class="k5" rows="3" maxlength="' + B.BODY_MAX + '" style="width:100%;font:inherit">' + esc(d.body) + '</textarea></label></div>' +
      '<div class="row" role="group" aria-label="出す事業所"><span>出す事業所</span>' +
      B.OFFICES.map(function (o) { return '<label><input type="checkbox" id="kb-a-o-' + o + '" data-kb-off="' + o + '"' + (d.offs[o] ? ' checked' : '') + '> ' + esc(officeName(o) || o) + '</label>'; }).join('') +
      '<span class="help">3つとも選ぶと全員（主な事業所を決めていない人も）に出します</span></div>' +
      '<div class="row"><label>始めの日 <input type="date" id="kb-a-from" class="k5" value="' + esc(d.from) + '"></label><label>終わりの日 <input type="date" id="kb-a-to" class="k5" value="' + esc(d.to) + '"></label>' +
      '<button type="button" class="btn pri sm k5" data-act="kb-a-add">お知らせを出す</button></div><p class="help" id="kb-a-msg" role="alert"></p>';
    if (!ann) return h + '<p class="empty">読み込んでいます…</p></div>';
    if (ann.err) return h + '<div class="band warn" role="status">' + esc(ann.err) + '</div></div>';
    var rows = ann.rows.map(function (r) {
      var st = B.announceState(r, td), stCls = st === 'now' ? 'ok' : st === 'future' ? 'rv' : '';
      var done = st === 'void' ? '<br><span class="raw">取り消し: ' + esc(dtTxt(r.voided_at)) + (r.voided_by ? '（' + esc(r.voided_by) + '）' : '') + (r.void_reason ? '・' + esc(r.void_reason) : '') + '</span>' : '';
      var act = st === 'void' ? '' : '<button type="button" class="btn sm ng k5" data-act="kb-a-void" data-id="' + esc(r.id) + '">取り消す</button>';
      return '<tr><td data-l="状態"><span class="tag ' + stCls + '">' + esc(B.ANN_ST[st]) + '</span>' + done + '</td><td data-l="期間">' + esc(B.periodText(r.date_from, r.date_to)) + '</td>' +
        '<td data-l="出す事業所">' + esc(B.officesText(r.offices, officeName)) + '</td><td data-l="文" style="white-space:pre-wrap">' + esc(r.body) + '</td>' +
        '<td data-l="出した人">' + esc(dtTxt(r.created_at)) + (r.created_by ? '<br><span class="raw">' + esc(r.created_by) + '</span>' : '') + '</td><td class="rq-btns">' + act + '</td></tr>';
    }).join('');
    return h + '<div class="tw"><table class="rq-t"><thead><tr><th>状態</th><th>期間</th><th>出す事業所</th><th>文</th><th>出した人</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="empty">まだお知らせはありません</td></tr>') + '</tbody></table></div>' +
      (ann.rows.length >= 100 ? '<p class="help">新しい順に100件までを出しています。</p>' : '') + '</div>';
  }
  var XR_OPT = [['pending', '承認待ち'], ['approved', '承認済み'], ['rejected', '差し戻し'], ['withdrawn', '取り下げ'], ['', 'すべての状態']];
  function xrRow(id) { return (xr && Array.isArray(xr.rows) ? xr.rows : []).filter(function (r) { return String(r.id) === String(id); })[0] || null; }
  function xrDate(d) { return B.isDate(d) ? B.md(d) : ''; }
  function xrHtml() {
    if (!xrOn()) return '';
    if ((!xr || xr.key !== (xrF || 'all')) && !xrBusy) loadXr();
    var its = items();
    var h = '<div class="cd no-print kb-xr"><h2 style="font-size:16px;margin:0 0 8px">補助項目の申請' + (xr && !xr.err && xr.pending ? ' <span class="tag rv">承認待ち ' + esc(String(xr.pending)) + ' 件</span>' : '') + '</h2>' +
      '<p class="help">職員が自分のスマホから出した、日ごとの補助項目（設定の「補助項目」）の申請です。承認すると、個人の月の補助項目に入ります（同じ日・同じ項目に入れてあった値は、申請の値に入れ直します。前の値は取り消しの印を付けて残します）。差し戻しは理由が必ず要ります。</p>';
    if (noDb) return h + '<div class="band warn" role="status">' + esc(NODB) + '</div></div>';
    h += '<div class="row"><label>状態 <select id="kb-x-st" class="k5">' + XR_OPT.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === xrF ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="btn sm k5" data-act="kb-x-reload">読み直す</button></div>';
    var st = xr && xr.key === (xrF || 'all') ? xr : null;
    if (!st) return h + '<p class="empty">読み込んでいます…</p></div>';
    if (st.err) return h + '<div class="band warn" role="status">' + esc(st.err) + '</div></div>';
    var RS = { pending: 'rv', approved: 'ok', rejected: 'ng', withdrawn: '' };
    var rows = st.rows.map(function (r) {
      var dec = r.status === 'approved' || r.status === 'rejected' ? '<br><span class="raw">' + esc(dtTxt(r.decided_at)) + (r.decided_by ? '（' + esc(r.decided_by) + '）' : '') + '</span>' +
        (r.decide_note ? '<br><span class="raw">' + (r.status === 'rejected' ? '差し戻しの理由: ' : 'メモ: ') + esc(r.decide_note) + '</span>' : '') : '';
      var act = r.status === 'pending' ? '<button type="button" class="btn sm pri k5" data-act="kb-x-ok" data-id="' + esc(r.id) + '">承認</button> <button type="button" class="btn sm ng k5" data-act="kb-x-ng" data-id="' + esc(r.id) + '">差し戻し</button>' : '';
      return '<tr><td class="rq-nm">' + esc(String(r.name || r.staff_id || '')) + (r.staff_active === false ? ' <span class="tag">休止中</span>' : '') + '</td><td data-l="日付">' + esc(xrDate(r.work_date)) + '</td>' +
        '<td data-l="項目と値">' + esc(B.valueText(r, its)) + '</td><td data-l="本人の理由">' + esc(r.note || '') + '</td><td data-l="出した時刻">' + esc(dtTxt(r.created_at)) + '</td>' +
        '<td data-l="状態"><span class="tag ' + esc(RS[r.status] || '') + '">' + esc(B.XR_ST[r.status] || String(r.status || '')) + '</span>' + dec + '</td><td class="rq-btns">' + act + '</td></tr>';
    }).join('');
    return h + '<div class="tw"><table class="rq-t"><thead><tr><th>職員</th><th>日付</th><th>項目と値</th><th>本人の理由</th><th>出した時刻</th><th>状態</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="empty">この条件の申請はありません</td></tr>') + '</tbody></table></div>' +
      (st.rows.length >= 500 ? '<p class="help">新しい順に500件までを出しています。</p>' : '') + '</div>';
  }
  function html() { try { return annHtml() + xrHtml(); } catch (e) { var h = H(); if (h) h.note('お知らせの描画', e); return ''; } }

  /* 設定のタブの欄（#g-set の中＝保存していない変更の確かめが同じ道で数える） */
  function settingsHtml(c, admin) {
    c = c || {};
    var dis = admin ? '' : ' disabled', h = H(), ex = true;
    try { ex = !h || !h.exOn || h.exOn(); } catch (e) { ex = false; }   /* 段A1 の補助項目の関数がまだ無い（0127 の前）時は、補助項目の申請の欄を出さない（補助項目の欄と同じ） */
    return '<div style="grid-column:1/-1"><h2 style="font-size:16px;margin:14px 0 8px">職員のスマホの画面</h2><div class="kv">' +
      '<label for="kb-s-ann">お知らせ</label><span><input type="checkbox" id="kb-s-ann"' + (B.on(c, B.KEY_ANN) ? ' checked' : '') + dis + '> 使う（「申請」のタブで書いたお知らせを、職員の「自分の勤怠」の画面に帯で出します）</span>' +
      (ex ? '<label for="kb-s-xr">補助項目の申請</label><span><input type="checkbox" id="kb-s-xr"' + (B.on(c, B.KEY_XR) ? ' checked' : '') + dis + '> 使う（職員が自分の画面から日ごとの補助項目を申請でき、「申請」のタブで承認します）</span>' : '') +
      '</div></div>';
  }
  /* 保存の時に、欄の値を送る設定に入れる（欄が無い画面では何もしない＝今の設定のまま） */
  function readSettings(out) {
    var a = document.getElementById('kb-s-ann'), x = document.getElementById('kb-s-xr');
    if (a) { if (a.checked) out[B.KEY_ANN] = true; else delete out[B.KEY_ANN]; }
    if (x) { if (x.checked) out[B.KEY_XR] = true; else delete out[B.KEY_XR]; }
    reset();
  }

  /* ── 操作 ── */
  function readDraft() {
    if (!draft) draft = freshDraft();
    var g = function (id) { return document.getElementById(id); };
    if (g('kb-a-body')) draft.body = g('kb-a-body').value;
    if (g('kb-a-from')) draft.from = g('kb-a-from').value;
    if (g('kb-a-to')) draft.to = g('kb-a-to').value;
    B.OFFICES.forEach(function (o) { var c = g('kb-a-o-' + o); if (c) draft.offs[o] = c.checked; });
  }
  function annAdd(btn) {
    var h = H(); if (!h || busy) return;
    readDraft();
    var m = document.getElementById('kb-a-msg'), offs = B.OFFICES.filter(function (o) { return draft.offs[o]; });
    if (!offs.length) { if (m) m.textContent = '出す事業所を1つ以上選んでください。'; return; }
    var c = B.checkAnnounce({ body: draft.body, offices: offs, from: draft.from, to: draft.to }, today());
    if (!c.ok) { if (m) m.textContent = c.msg; return; }
    busy = true; var restore = h.pressBusy(btn, '出しています…');
    h.rpc('kintai_announce_add', c.args).then(h.okOr).then(function () {
      busy = false; draft = freshDraft(); h.toast('お知らせを出しました'); reset(); repaint();
    })['catch'](function (e) {
      busy = false; restore();
      if (h.noDb(e)) noDb = true; else if (!known(e)) h.note('お知らせを出す', e);
      var t = msg(e), m2 = document.getElementById('kb-a-msg');
      if (m2) m2.textContent = t; else h.toast(t);
    });
  }
  function annVoid(id, btn) {
    var h = H(); if (!h || busy) return;
    ask('prompt', 'このお知らせを取り消します（職員の画面から消えます。記録は残ります）。取り消す理由を書いてください（200字まで）。', '').then(function (v) {
      if (v == null) return;
      var r = String(v).trim();
      if (!r) { h.toast(NG.reason); return; }
      if (r.length > 200) { h.toast('理由は200字までです。'); return; }
      busy = true; var restore = h.pressBusy(btn, '取り消しています…');
      return h.rpc('kintai_announce_void', { p_id: id, p_reason: r }).then(h.okOr).then(function () {
        busy = false; h.toast('お知らせを取り消しました'); reset(); repaint();
      })['catch'](function (e) {
        busy = false; restore();
        if (!known(e)) h.note('お知らせの取り消し', e);
        h.toast(msg(e));
        if (e && (e.kintai === 'already' || e.kintai === 'notfound')) { reset(); repaint(); }
      });
    });
  }
  function xrDecide(id, approve, btn) {
    var h = H(); if (!h || busy) return;
    var r = xrRow(id); if (!r || r.status !== 'pending') return;
    var what = String(r.name || r.staff_id || '') + '　' + xrDate(r.work_date) + '　' + B.valueText(r, items());
    var p = approve
      ? ask('confirm', 'この申請を承認します。\n' + what + '\n個人の月の補助項目に入ります（同じ日・同じ項目に入れてあった値は、申請の値に入れ直します）。よろしいですか？').then(function (ok) { return ok ? '' : null; })
      : ask('prompt', 'この申請を差し戻します。\n' + what + '\n本人のスマホに理由が出ます。差し戻しの理由を書いてください（200字まで）。', '');
    p.then(function (v) {
      if (v == null) return;
      var note = String(v).trim();
      if (!approve && !note) { h.toast(NG.reason); return; }
      if (note.length > 200) { h.toast('理由は200字までです。'); return; }
      busy = true; var restore = h.pressBusy(btn, approve ? '承認しています…' : '差し戻しています…');
      return h.rpc('kintai_extra_req_decide', { p_id: r.id, p_rev: +r.rev, p_approve: approve, p_note: note || null }).then(h.okOr).then(function () {
        busy = false; h.toast(approve ? '承認しました' : '差し戻しました'); reset();
        if (approve && h.reloadMonth) h.reloadMonth(); else repaint();   /* 承認は補助項目の行を足したので月を読み直す */
      })['catch'](function (e) {
        busy = false; restore();
        if (!known(e)) h.note(approve ? '補助項目の申請の承認' : '補助項目の申請の差し戻し', e);
        h.toast(msg(e));
        if (e && (e.kintai === 'conflict' || e.kintai === 'notfound')) { reset(); repaint(); }
      });
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    var a = b.getAttribute('data-act');
    if (a === 'rq-reload' || a === 'kb-x-reload') { reset(); if (a === 'kb-x-reload') repaint(); return; }
    if (a === 'kb-a-add') annAdd(b);
    else if (a === 'kb-a-void') annVoid(b.getAttribute('data-id'), b);
    else if (a === 'kb-x-ok' || a === 'kb-x-ng') xrDecide(b.getAttribute('data-id'), a === 'kb-x-ok', b);
  });
  document.addEventListener('input', function (e) { var t = e.target; if (t && t.id && t.id.indexOf('kb-a-') === 0) readDraft(); });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.id) return;
    if (t.id.indexOf('kb-a-') === 0) readDraft();
    if (t.id === 'kb-x-st') { xrF = t.value; repaint(); }
  });

  window.KintaiBoard = { html: html, settingsHtml: settingsHtml, readSettings: readSettings, reset: reset };
})();
