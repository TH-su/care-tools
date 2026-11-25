/* kintai-self-board.js — 自分の勤怠（kintai-self.html）の段B（2026-11-25・ROOT-v7-plus-parity.md「段B」・care-backend 統合 0130）
 *   1. 管理者からのお知らせ（自由な文・期間と事業所で選ばれた分）を、開いた時に1回読み、上に帯で出す（受け口の op announces）
 *   2. 補助項目の申請（申請のタブの下・項目は事務所の設定の「補助項目」で使っているもの・承認されると事務所の記録に入る）
 *      （op extra_info・extra_add・extra_withdraw）
 * 事務所の設定の鍵が切（on:false）・古い受け口（形の違いで断る）・つながらない時は、何も出さない（今の画面のまま）。
 * kintai-self.js からは「呼ぶ道」（鍵と開いている印を中で足す）と「鍵の断りを扱う道」だけを受け取り、鍵・開いている印は持たない。
 * 中身（お知らせ・項目・申請）はメモリだけで、閉じる・2分さわらない・登録を外す時に kintai-self.js の lock から reset で捨てる。
 * 画面に入れる文は全部 textContent（HTML の代入を使わない）。端末に何も残さない。console を使わない。文と位置は仮置き */
(function () {
  'use strict';
  var B = window.KintaiBoardCalc, S = window.KintaiSelfCalc;
  var $ = function (id) { return document.getElementById(id); };
  if (!B || !S || !window.KintaiExtras) return;

  var callFn = null, authFn = null, gen = 0, busy = false, items = [], rows = null, lastReq = null;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function today() { return S.todayOf(Date.now()); }
  function hideXr() { var x = $('xr-sec'); if (x) { clear(x); x.hidden = true; } }
  function hide() { var a = $('an-box'); if (a) { clear(a); a.hidden = true; } hideXr(); }

  function reset() { gen++; callFn = null; authFn = null; busy = false; items = []; rows = null; lastReq = null; hide(); }
  /* 開いた時に呼ばれる。call(op, 項目) は鍵と開いている印を足して受け口へ送る。auth(r) は鍵の断り（nokey・closed・inactive）を扱えば true */
  function start(call, auth) {
    reset();
    callFn = call; authFn = auth;
    var my = gen;
    loadAnnounces(my);
    loadExtras(my);
  }
  /* 受け口の答えが使えるか。鍵の断りは kintai-self.js へ回す。ほか（古い受け口の format・server・net・off）は黙って出さない */
  function usable(r, my) {
    if (my !== gen) return false;
    if (r && r.ok === true) return true;
    if (authFn && authFn(r)) return false;
    return false;
  }

  // ── 1. お知らせ ──
  async function loadAnnounces(my) {
    var r = await callFn('announces', {});
    if (!usable(r, my) || r.on !== true) return;
    var list = B.announceRows(r.rows), box = $('an-box');
    if (!box || !list.length) return;
    clear(box);
    box.appendChild(el('h2', null, '事務所からのお知らせ'));
    list.forEach(function (x) {
      box.appendChild(el('p', 'an', x.body));
      box.appendChild(el('p', 'an-d', B.periodText(x.date_from, x.date_to) + (x.date_from === x.date_to ? '' : ' の間')));
    });
    box.hidden = false;
  }

  // ── 2. 補助項目の申請 ──
  async function loadExtras(my) {
    var r = await callFn('extra_info', {});
    if (!usable(r, my) || r.on !== true) return;
    items = B.itemsOf(r.items);
    rows = Array.isArray(r.rows) ? r.rows.filter(function (x) { return x && typeof x === 'object'; }) : [];
    paint();
  }
  function itemLabel(it) { return it.name + (it.kind === 'count' ? '（回数）' : it.kind === 'time' ? '（時間）' : it.unit ? '（' + it.unit + '）' : ''); }
  function paint() {
    var sec = $('xr-sec'); if (!sec) return;
    var keep = formValues();
    clear(sec);
    sec.appendChild(el('h2', 'sh', '補助項目の申請'));
    var top = el('div', 'msg'); top.id = 'xr-msg2'; top.setAttribute('role', 'status'); top.hidden = true; sec.appendChild(top);
    if (!items.length && !(rows && rows.length)) { sec.appendChild(el('p', 'muted', '申請できる補助項目は、いまはありません。')); sec.hidden = false; return; }
    if (items.length) sec.appendChild(formEl(keep));
    var list = el('div', 'list'); list.id = 'xr-list';
    if (!rows || !rows.length) list.appendChild(el('p', 'muted', 'まだ補助項目の申請はありません。'));
    else rows.forEach(function (r) { list.appendChild(rowEl(r)); });
    sec.appendChild(list);
    sec.hidden = false;
  }
  function fld(labelText, id, input) {
    var f = el('div', 'fld'), l = el('label', null, labelText); l.htmlFor = id; input.id = id;
    f.appendChild(l); f.appendChild(input); return f;
  }
  function formValues() {
    var g = function (id) { var e = $(id); return e ? e.value : null; };
    return { code: g('xr-code'), date: g('xr-date'), value: g('xr-val'), hours: g('xr-h'), mins: g('xr-m'), note: g('xr-note') };
  }
  function formEl(keep) {
    var f = el('form', 'cd'); f.id = 'f-xr'; f.noValidate = true;
    f.appendChild(el('h2', null, '補助項目を申請する'));
    f.appendChild(el('p', 'help', '移動距離・健診・会議など、事務所が決めた項目を日ごとに申請します。事務所が承認すると記録に入ります。'));
    var sel = el('select');
    items.forEach(function (it) { var o = el('option', null, itemLabel(it)); o.value = it.code; sel.appendChild(o); });
    if (keep && keep.code && B.itemOf(items, keep.code)) sel.value = keep.code;
    f.appendChild(fld('項目', 'xr-code', sel));
    var d = el('input'); d.type = 'date'; d.max = today(); d.value = keep && keep.date ? keep.date : today();
    f.appendChild(fld('日付', 'xr-date', d));
    var vWrap = el('div'); vWrap.id = 'xr-vwrap'; f.appendChild(vWrap);
    var nt = el('textarea'); nt.rows = 2; nt.maxLength = B.NOTE_MAX; nt.value = keep && keep.note ? keep.note : '';
    f.appendChild(fld('理由・メモ（任意・' + B.NOTE_MAX + '字まで）', 'xr-note', nt));
    var m = el('div', 'msg'); m.id = 'xr-msg'; m.setAttribute('role', 'status'); m.hidden = true; f.appendChild(m);
    var a = el('div', 'acts'), btn = el('button', 'btn pri wide', '補助項目を申請する'); btn.type = 'submit'; btn.id = 'b-xr'; a.appendChild(btn); f.appendChild(a);
    sel.addEventListener('change', function () { valueEl(vWrap, sel.value, null); });
    valueEl(vWrap, sel.value, keep);
    f.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    return f;
  }
  /* 値の欄（回数・数値は1つ・時間は時間と分の2つ） */
  function valueEl(wrap, code, keep) {
    clear(wrap);
    var it = B.itemOf(items, code); if (!it) return;
    if (it.kind === 'time') {
      var h = el('input'); h.type = 'text'; h.inputMode = 'numeric'; h.maxLength = 2; h.autocomplete = 'off'; h.value = keep && keep.hours ? keep.hours : '';
      var mi = el('input'); mi.type = 'text'; mi.inputMode = 'numeric'; mi.maxLength = 2; mi.autocomplete = 'off'; mi.value = keep && keep.mins ? keep.mins : '';
      wrap.appendChild(fld('時間', 'xr-h', h)); wrap.appendChild(fld('分（0〜59）', 'xr-m', mi));
    } else {
      var v = el('input'); v.type = 'text'; v.inputMode = it.kind === 'number' && it.decimals ? 'decimal' : 'numeric'; v.autocomplete = 'off'; v.maxLength = 9;
      v.value = keep && keep.value ? keep.value : '';
      wrap.appendChild(fld(it.kind === 'count' ? '回数' : '値' + (it.unit ? '（' + it.unit + '）' : '') + (it.decimals ? '（小数' + it.decimals + '桁まで）' : ''), 'xr-val', v));
    }
  }
  function say(text, kind) { var m = $('xr-msg') || $('xr-msg2'); if (!m) return; m.textContent = text || ''; m.hidden = !text; m.className = 'msg' + (kind ? ' ' + kind : ''); }
  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 古い端末は下で作る */ }
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function errText(code) { return B.xrErr(code) || S.errorText(code); }
  async function send() {
    if (busy || !callFn) return;
    var v = formValues(), b = B.buildExtra({ date: v.date, code: v.code, value: v.value, hours: v.hours, mins: v.mins, note: v.note, today: today() }, items);
    if (!b.ok) { say(b.msg, 'ng'); return; }
    var j = JSON.stringify(b.body);
    if (!lastReq || lastReq.json !== j) lastReq = { json: j, cid: newId() };
    var my = gen, q = {}, k;
    for (k in b.body) q[k] = b.body[k];
    q.client_id = lastReq.cid;
    busy = true; var btn = $('b-xr'); if (btn) btn.disabled = true; say('送っています…', 'warn');
    var r = await callFn('extra_add', q);
    busy = false; if (btn) btn.disabled = false;
    if (my !== gen) return;
    if (r.ok !== true) {
      if (authFn && authFn(r)) return;
      say(errText(r.error), 'ng');
      if (r.error !== 'net' && r.error !== 'server') lastReq = null;
      return;
    }
    lastReq = null;
    var keepCode = v.code;
    await reload(my);
    if (my !== gen) return;
    var sel = $('xr-code'); if (sel && B.itemOf(items, keepCode)) { sel.value = keepCode; valueEl($('xr-vwrap'), keepCode, null); }
    var nt = $('xr-note'); if (nt) nt.value = '';
    say('申請しました。事務所が承認するまで「承認待ち」と出ます。', 'ok');
  }
  async function reload(my) {
    var r = await callFn('extra_info', {});
    if (!usable(r, my)) return;
    if (r.on !== true) { hideXr(); return; }   /* 補助項目の鍵だけを切った時はお知らせの帯を残す（反証レビュー 2026-11-25 の 3） */
    items = B.itemsOf(r.items);
    rows = Array.isArray(r.rows) ? r.rows.filter(function (x) { return x && typeof x === 'object'; }) : [];
    var keep = formValues(); keep.value = ''; keep.hours = ''; keep.mins = '';
    paint();
    if ($('xr-code') && keep.code && B.itemOf(items, keep.code)) $('xr-code').value = keep.code;
  }
  function rowEl(r) {
    var c = el('div', 'day'), top = el('div', 'd'), st = B.XR_ST[r.status] || String(r.status || '');
    top.appendChild(el('span', null, B.valueText(r, items) + '　' + (B.isDate(r.work_date) ? S.dayLabel(r.work_date) : '')));
    top.appendChild(el('span', 'pill st-' + (B.XR_ST[r.status] ? r.status : 'pending'), st));
    c.appendChild(top);
    if (r.note) c.appendChild(el('p', 'muted', '理由: ' + r.note));
    if (r.decide_note) c.appendChild(el('p', r.status === 'rejected' ? 'msg ng' : 'muted', (r.status === 'rejected' ? '差し戻しの理由: ' : '事務所から: ') + r.decide_note));
    if (r.status === 'pending') {
      var b = el('button', 'btn sm', '取り下げる'); b.type = 'button';
      b.addEventListener('click', function () { withdraw(String(r.id), +r.rev, b); });
      var a = el('div', 'acts'); a.appendChild(b); c.appendChild(a);
    }
    return c;
  }
  async function withdraw(id, rev, btn) {
    if (busy || !callFn) return;
    if (!window.confirm('この補助項目の申請を取り下げますか？')) return;
    btn.disabled = true; busy = true;
    var my = gen, r = await callFn('extra_withdraw', { id: id, rev: rev });
    busy = false;
    if (my !== gen) return;
    if (r.ok !== true && authFn && authFn(r)) return;
    await reload(my);
    if (my !== gen) return;
    btn.disabled = false;   /* 読み直せずに描き直さなかった時も押せる形に戻す（反証レビュー 2026-11-25 の 4） */
    say(r.ok === true ? '取り下げました。' : errText(r.error), r.ok === true ? 'ok' : 'ng');
  }

  window.KintaiSelfBoard = { start: start, reset: reset };
})();
