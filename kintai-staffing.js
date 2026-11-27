/* kintai-staffing.js — 勤怠管理のホームの「今日の人員配置」と、設定のタブの決まりの欄（2026-11-28 新設・代表者の決定 2026-11-28「推奨どおり」・文と位置は仮置き）
 * ════════════════════════════════════════════════════════════════
 * ・数え方は kintai-staffing-calc.js（純関数）。ここは描くのと、シフトの職員（資格・サ責の印・職種（様式1））を読むことだけ
 * ・入り切りは設定の鍵 staffCheck（既定は切）。切の時はホームに何も足さず、シフトの職員も読まない
 * ・知らせだけ。勤怠の計算・給与・打刻は変えない。画面だけで印刷しない（no-print）
 * ・シフトの職員はメモリにだけ持ち、端末に残さない（読み直すのは画面の「読み直す」と、開いてから10分たった時）
 * ・決まりの保存は設定のタブの「設定を保存する」（kintai.js の保存が readSet を呼ぶ・ほかの設定の鍵は残して丸ごと送る）
 */
(function () {
  'use strict';
  var K = window.KintaiStaffing;
  if (!K) return;
  var STALE_MS = 10 * 60000, BLANK_ROWS = 2;
  var st = null, busy = false, gen = 0;   /* st: { at, staff（配列）| null, err（文） } */
  var WHY_JA = { shape: '形', office: '事業所', label: '表示名', from: '始まりの時刻', to: '終わりの時刻', same: '始まりと終わりが同じ', need: '必要な人数（1〜20）', who: '数える人', word: '職種の語' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function on(cfg) { return K.on(cfg); }
  function drop() { st = null; gen++; busy = false; }
  function hmText(ms) {
    var d = new Date(ms + 9 * 3600000);
    return d.getUTCHours() + ':' + ('0' + d.getUTCMinutes()).slice(-2);
  }
  function hm0(s) { return String(s).replace(/^0(?=\d:)/, ''); }

  /* シフトの職員を読む（シフトの読み口だけ・書かない）。読めない時は理由の文を持つ（0人と言わない） */
  function load(ctx, force) {
    if (busy) return;
    if (st && !force && Date.now() - st.at < STALE_MS) return;
    if (!window.SUKv || !window.SUKv.callShift) { st = { at: Date.now(), staff: null, err: 'シフトの読み口が読み込めませんでした。' }; return; }
    busy = true; var my = ++gen;
    Promise.resolve().then(function () {
      return window.SUKv.callShift({ action: 'pull', keys: ['staff'] }, function () { return Promise.resolve({ ok: false, error: 'google' }); });
    }).then(function (r) {
      if (my !== gen) return;
      var d = r && r.ok === true && r.entries && r.entries.staff ? r.entries.staff.data : null;
      if (Array.isArray(d)) st = { at: Date.now(), staff: d.filter(function (x) { return x && typeof x === 'object'; }), err: '' };
      else st = { at: Date.now(), staff: null, err: r && r.error === 'login' ? 'ログインが切れたため、シフトの職員を読めませんでした。' : r && r.error === 'google' ? 'シフトが新しい保存先に移っていないため、職員の資格を読めません。' : 'シフトの職員を読めませんでした。' };
    })['catch'](function (e) {
      if (my !== gen) return;
      if (ctx.note) ctx.note('人員配置のシフトの職員', e);
      st = { at: Date.now(), staff: null, err: 'シフトの職員を読めませんでした（通信）。' };
    }).then(function () { if (my !== gen) return; busy = false; ctx.repaint(); });
  }

  /* ── ホーム（今日の出勤状況のすぐ下） ── */
  function homeHtml(ctx) {
    var cfg = ctx.cfg();
    if (!on(cfg)) return '';
    load(ctx, false);
    var td = ctx.today(), res = K.evaluate({ month: ctx.month(), today: td, nowMs: Date.now(), cfg: cfg, staff: st ? st.staff : null, period: ctx.period(), office: ctx.officeFilter() });
    var hd = '<div class="tdb-hd"><h3 id="sfb-h">今日の人員配置</h3>' + (res.short ? '<span class="tag ng">足りない ' + res.short + '</span>' : '') + '</div>';
    var help = '<p class="tdb-help">勤怠の予定と打刻を、シフトの職員の資格・サ責の印・職種（様式1）で数えます。利用者の数・訪問の件数は数えません（必要な人数は「設定」で決めます）。</p>';
    var body = '';
    if (!res.rules.length && !res.bad.length) body = '<p class="tdb-none">決まりがまだありません。「設定」のタブの「人員配置の決まり」に、時間帯と必要な人数を入れます。</p>';
    else if (!st || (busy && !st.staff)) body = '<p class="tdb-none">シフトの職員を読んでいます…</p>';
    else {
      if (st.err) body += '<p class="sfb-why">' + esc(st.err) + ' <button type="button" class="btn sm" data-act="sf-reload">読み直す</button></p>';
      if (res.rows.length) {
        body += '<div class="sfr sfh" aria-hidden="true"><span class="sfn">時間帯</span><span class="sfp">時刻</span><span class="sfq">必要</span><span class="sfq">予定</span><span class="sfq">いま</span><span class="sft">状態</span></div><ul class="tdl sfl">' +
          res.rows.map(function (r) { return rowHtml(ctx, r); }).join('') + '</ul>';
      } else if (ctx.officeFilter()) body += '<p class="tdb-none">この事業所の決まりはありません。</p>';
    }
    if (res.bad.length) body += '<p class="sfb-why">設定の決まりに読めない行があります（' + esc(res.bad.map(function (b) { return b.i ? b.i + '行目' : '全部'; }).join('・')) + '）。その行は数えていません。「設定」で直してください。</p>';
    return '<section class="tdb sfb no-print" aria-labelledby="sfb-h">' + hd + help + body + '</section>';
  }
  function rowHtml(ctx, r) {
    var tm = (r.date !== ctx.today() ? '前の日 ' : '') + hm0(r.from) + '〜' + (r.overnight ? '翌' : '') + hm0(r.to);
    var name = '<span class="sfn">' + esc(ctx.officeName(r.office) || r.office) + ' <b>' + esc(r.label) + '</b></span>';
    var stt, plan, now;
    if (r.level === 'unknown') {
      plan = '—'; now = '—';
      stt = '<span class="tds dn">' + (r.why === 'period' ? 'この月分の外の日のため確かめられません' : '確かめられません') + '</span>';
    } else {
      plan = r.plan + '<small>名</small>';   /* 必要な人数は左の列だけに出す（同じ数を2か所に出さない） */
      now = r.now == null ? '—' : r.now + '<small>名</small>';
      if (r.level === 'alert') stt = '<span class="tag ng">いま足りない</span>';
      else if (r.level === 'warn') stt = '<span class="tag rv">予定で足りない</span><small class="sfat">' + esc(hmText(r.planAt)) + ' に ' + r.plan + '名</small>';
      else stt = '<span class="tds">足りている</span>';
      if (r.missing) stt += '<small class="sfat">シフトにいない ' + r.missing + '名は数えていません</small>';
      if (r.partial) stt += '<small class="sfat">月分の外の日の予定は数えていません</small>';
    }
    var lv = r.level === 'alert' ? ' sfx sfa' : r.level === 'warn' ? ' sfx' : '';
    return '<li><div class="sfr' + lv + '">' + name + '<span class="sfp">' + esc(tm) + (r.phase === 'now' ? '<small>いま</small>' : r.phase === 'past' ? '<small>終わり</small>' : '') + '</span>' +
      '<span class="sfq"><small class="sfk">必要 </small>' + r.need + '<small>名</small></span><span class="sfq"><small class="sfk">予定 </small>' + plan + '</span><span class="sfq"><small class="sfk">いま </small>' + now + '</span><span class="sft">' + stt + '</span></div></li>';
  }

  /* ── 設定のタブ（#g-set の中・「設定を保存する」で保存） ── */
  function setHtml(cfg, admin, nameOf) {
    var ru = K.rulesOf(cfg), raw = cfg && Array.isArray(cfg[K.KEY_RULES]) ? cfg[K.KEY_RULES] : [];
    var rows = raw.slice(0, K.MAX_RULES), n = Math.min(K.MAX_RULES, rows.length + BLANK_ROWS), h = '';
    h += '<label for="s-staffCheck">今日の人員配置の知らせ</label><span><input type="checkbox" id="s-staffCheck"' + (on(cfg) ? ' checked' : '') + '> 出す（ホームの今日の出勤状況の下。知らせだけで、勤怠の計算・給与は変えません）</span>';
    h += '<span class="sfs-lb">人員配置の決まり</span><div class="sfs"><p class="help">時間帯を通して、その事業所の予定に入っている人が必要な人数より少ない時刻があれば「予定で足りない」、時間帯の途中で打刻のある人が少なければ「いま足りない」と出します。終わりが始まり以前なら翌日の時刻です（例 21:00〜7:00）。表示名を空にした行は保存しません。' +
      '数える人: 全員／介護職員＝看護師・准看護師でない人（シフトのデイの人数確認欄と同じ分け方）／看護職員＝看護師・准看護師／介護の資格＝介護福祉士・実務者研修・初任者研修のどれか／サ責＝シフトの職員のサービス提供責任者の印／職種の語＝シフトの職員の「職種（様式1）」にその語を含む人（生活相談員・機能訓練指導員など）。' +
      '介護職員の数（利用者の数で決まる）などは、ここに必要な人数そのものを入れます。一人が二つの決まりに当たる時（看護師を看護職員と機能訓練指導員の両方など）は両方に数え、兼務の可否や加算の専従の要件は判定しません。</p>' +
      (ru.bad.length && !(ru.bad[0].i === 0) ? '<p class="sfb-why">読めない行: ' + esc(ru.bad.map(function (b) { return b.i + '行目（' + (WHY_JA[b.why] || b.why) + '）'; }).join('・')) + '</p>' : '') +
      '<div class="sfs-t" role="group" aria-label="人員配置の決まり">';
    for (var i = 0; i < n; i++) h += ruleRow(i, rows[i] || null, admin, nameOf);
    h += '</div>' + (n >= K.MAX_RULES ? '<p class="help">決まりは ' + K.MAX_RULES + ' 行までです。</p>' : '<p class="help">行が足りない時は、保存すると空の行が2つ足されます。</p>') + '</div>';
    return h;
  }
  function ruleRow(i, x, admin, nameOf) {
    var o = x && typeof x === 'object' ? x : {}, dis = admin ? '' : ' disabled', no = i + 1;
    var sel = function (id, list, cur, ja) { return '<select id="' + id + '" aria-label="' + no + '行目の' + ja.title + '"' + dis + '>' + list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(ja.map[v] || v) + '</option>'; }).join('') + '</select>'; };
    var offJa = {}; K.OFFICES.forEach(function (c) { offJa[c] = (nameOf && nameOf(c)) || { facility: '施設', visit: '訪問', day: '通所' }[c]; });   /* 名前は施設情報から（画面の officeName） */
    return '<div class="sfs-r"><span class="sfs-no">' + no + '</span>' +
      sel('sf-o-' + i, K.OFFICES, o.office || 'facility', { title: '事業所', map: offJa }) +
      '<input type="text" id="sf-l-' + i + '" maxlength="' + K.LABEL_MAX + '" value="' + esc(typeof o.label === 'string' ? o.label : '') + '" placeholder="例: 夜間 職員" aria-label="' + no + '行目の表示名"' + dis + '>' +
      '<input type="time" id="sf-f-' + i + '" value="' + esc(typeof o.from === 'string' ? o.from : '') + '" aria-label="' + no + '行目の始まり"' + dis + '><span aria-hidden="true">〜</span>' +
      '<input type="time" id="sf-t-' + i + '" value="' + esc(typeof o.to === 'string' ? o.to : '') + '" aria-label="' + no + '行目の終わり"' + dis + '>' +
      '<input type="number" id="sf-n-' + i + '" min="1" max="' + K.NEED_MAX + '" step="1" inputmode="numeric" value="' + esc(typeof o.need === 'number' ? o.need : '') + '" aria-label="' + no + '行目の必要な人数"' + dis + '><span>名</span>' +
      sel('sf-w-' + i, K.WHO, o.who || 'all', { title: '数える人', map: K.WHO_JA }) +
      '<input type="text" id="sf-k-' + i + '" maxlength="' + K.WORD_MAX + '" value="' + esc(typeof o.word === 'string' ? o.word : '') + '" placeholder="職種の語" aria-label="' + no + '行目の職種の語（数える人が職種の時）"' + dis + '></div>';
  }
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  /* 返す: { keys, vals, bad: [文] }。欄が無い時は null（今の設定のまま）。切のまま鍵が無く決まりも空なら鍵を作らない */
  function readSet(cfg) {
    var cb = document.getElementById('s-staffCheck');
    if (!cb) return null;
    var vals = {}, bad = [], items = [], had = cfg && Object.prototype.hasOwnProperty.call(cfg, K.KEY_RULES);
    for (var i = 0; i < K.MAX_RULES; i++) {
      if (!document.getElementById('sf-l-' + i)) break;
      var label = val('sf-l-' + i);
      if (!label) continue;
      var x = { office: val('sf-o-' + i), label: label, from: val('sf-f-' + i), to: val('sf-t-' + i), need: val('sf-n-' + i) === '' ? NaN : +val('sf-n-' + i), who: val('sf-w-' + i) };
      if (x.who === 'job') x.word = val('sf-k-' + i);
      var c = K.checkRule(x);
      if (c.rule) items.push(c.rule); else bad.push((i + 1) + '行目（' + (WHY_JA[c.why] || c.why) + '）');
    }
    if (cb.checked) vals[K.KEY_ON] = true;
    else if (cfg && Object.prototype.hasOwnProperty.call(cfg, K.KEY_ON)) vals[K.KEY_ON] = false;
    if (items.length || had) vals[K.KEY_RULES] = items;
    return { keys: [K.KEY_ON, K.KEY_RULES], vals: vals, bad: bad };
  }
  function act(a, b, ctx) {
    if (a === 'sf-reload') { drop(); load(ctx, true); ctx.repaint(); return true; }
    return false;
  }

  window.KintaiStaffingUI = { on: on, homeHtml: homeHtml, setHtml: setHtml, readSet: readSet, act: act, drop: drop };
})();
