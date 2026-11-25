/* kintai-cert.js — 勤怠の管理画面（kintai.html）の「資格」のタブとホームの「資格の期限」の箱（2026-11-25 新設・ROOT-v7-plus-parity.md の段C・care-backend 統合 0134）
 *
 * ・入り切りは設定（kintai_settings.config）の鍵 certAlert（true の時だけ入・既定は切）。切の時はタブのボタンを足さず、箱も出さず、
 *   データベースの関数も呼ばない＝今の画面のまま。この部品が読み込めない時も、勤怠の画面は今のまま動く（kintai.js は window.KintaiCert が無ければ何もしない）。
 * ・判定は kintai-cert-calc.js。読むのは kintai_certs_list、書くのは kintai_cert_put・kintai_cert_void（勤怠の管理＝kintai_can の人）。
 *   資格の種類（設定の certKinds）を足す・直す・止めるのは管理者だけ（DB の kintai_settings_put が決める）。ほかの設定の鍵を残して丸ごと送り、送る前に設定の大きさ（8KB）を確かめる。
 * ・資格証の写しの画像は持たない。記録は消さない（取り消し＝印を付けるだけ）。
 * ・読んだ記録はメモリだけに5分置く。端末に何も残さない（書きかけもメモリだけ）。中身は全部 esc を通して入れる。console を使わない。文と位置は仮置き
 * ★職員の名前は画面に出すだけ（端末に残さない）。
 */
(function () {
  'use strict';
  var K = window.KintaiCertCalc;
  if (!K) return;
  var TTL = 5 * 60 * 1000;
  var NODB = 'データベースの更新がまだです（資格の記録の仕組みが入るまで、ここは使えません）。';
  var NG = { notfound: '見つかりませんでした（ほかの人が先に取り消したか、勤怠の職員にいない人です）。読み直しました。',
    badcode: '資格の種類の形が違います。', baddate: '日付が正しくありません（取得日は今日まで・期限は取得日より後で20年先まで）。',
    badvalue: 'メモの形が違います（100字まで・改行は使えません）。', conflict: 'ほかの人が先にこの資格を直しました。読み直しました。',
    exists: 'この職員には同じ種類の資格がもうあります。一覧の「直す」から期限を書き換えてください。', toomany: '1人に入れられる資格は30件までです。' };
  var WHY = { code: '種類', acquired: '取得日（今日まで）', expires: '期限（20年先まで）', order: '期限（取得日より後）', note: 'メモ（100字まで・改行なし）', shape: '形' };
  var KWHY = { code: '印', name: '名前（1〜' + K.NAME_MAX + '字）', warn: '注意の日数（1〜' + K.WARN_MAX + '日）', urgent: '要対応の日数（0〜注意の日数）', years: '期限の目安の年数（0〜' + K.YEARS_MAX + '年）', shape: '形', dup: '印の重なり', max: '件数（' + K.MAX_KINDS + '件まで）' };
  var st = null, busy = false, gen = 0, noDb = false, wbusy = false;   /* st: { at, rows, err } */
  var selSid = '', edit = null;                                     /* edit: 直している行の { id, rev } */
  var draft = {}, kdraft = {}, kedit = null;                        /* 書きかけ（画面の中だけ） */
  var DRAFT_IDS = { 'ct-code': 1, 'ct-acq': 1, 'ct-exp': 1, 'ct-note': 1 };
  var KDRAFT_IDS = { 'ct-k-name': 1, 'ct-k-exp': 1, 'ct-k-warn': 1, 'ct-k-urgent': 1, 'ct-k-years': 1 };

  function on(cfg) { return K.on(cfg); }
  function isTab(t) { return t === 'cert'; }
  function drop() { st = null; gen++; busy = false; noDb = false; }   /* 上の「読み直す」でも、関数が入ったかをもう一度確かめる（反証レビュー 2026-11-25 軽1） */
  function dv(id) { return own(draft, id) ? draft[id] : ''; }
  function kv(id) { return own(kdraft, id) ? kdraft[id] : ''; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function keep(e) {
    var t = e && e.target, id = t && t.id;
    var v = t ? String(t.value == null ? '' : t.value).slice(0, 120) : '';
    if (DRAFT_IDS[id]) draft[id] = v;
    else if (KDRAFT_IDS[id]) kdraft[id] = v;
  }
  function dirty() { return !!(draft['ct-acq'] || draft['ct-exp'] || draft['ct-note'] || edit || Object.keys(kdraft).length); }
  function clearDraft() { draft = {}; edit = null; }
  function msg(e, ctx) {
    if (e && e.kintai && NG[e.kintai]) return NG[e.kintai];
    if (ctx.noDb(e)) return NODB;
    return ctx.msgOf(e);
  }

  /* ── 読み込み（世代で古い答えを捨てる・メモリだけ） ── */
  function load(ctx, force) {
    if (busy || noDb || (!force && st && Date.now() - st.at < TTL)) return;
    var my = ++gen; busy = true;
    ctx.rpc('kintai_certs_list', {}).then(ctx.okOr).then(function (r) {
      if (my !== gen) return;
      st = { at: Date.now(), rows: (Array.isArray(r.rows) ? r.rows : []).filter(function (x) { return x && typeof x === 'object'; }), more: r.more === true };
    })['catch'](function (e) {
      if (my !== gen) return;
      var nd = ctx.noDb(e);
      if (nd) noDb = true; else if (!(e && (e.kintai || e.code === '42501')) && !ctx.isNetErr(e)) ctx.note('資格の読み込み', e);
      st = { at: Date.now(), rows: [], err: nd ? NODB : '資格の記録を読めませんでした: ' + msg(e, ctx) };
    }).then(function () { if (my !== gen) return; busy = false; ctx.repaint(); });
  }
  function result(ctx) {
    if (!st || st.err) return null;
    return K.judge(ctx.staff(), st.rows, K.kindsOf(ctx.cfg()), ctx.today());
  }

  /* タブのボタン: 入の時だけ最後に足す（切の時は外す） */
  function syncTabs(isOn, cur, ctx) {
    var nav = document.querySelector('.tabs'); if (!nav) return;
    var b = nav.querySelector('button[data-tab="cert"]');
    if (isOn && !b) {
      b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-tab', 'cert');
      nav.appendChild(b);
    } else if (!isOn && b) { b.parentNode.removeChild(b); b = null; }
    if (!b) return;
    var res = ctx ? result(ctx) : null, n = res ? res.people.alert + res.people.warn : 0;
    b.textContent = '資格' + (n ? ' ' + n : '');
    b.setAttribute('aria-label', '資格' + (res ? '（要対応と注意 ' + n + ' 人）' : ''));
    b.setAttribute('aria-selected', cur === 'cert' ? 'true' : 'false');
  }

  /* ホームの箱（入の時だけ）。boxHtml・waitBox は kintai.js の部品をそのまま使う */
  function homeBox(ctx, boxHtml, waitBox) {
    if (!on(ctx.cfg())) return '';
    load(ctx, false);
    if (!st) return waitBox('資格の期限', '読み込み中…', false);
    if (st.err) return waitBox('資格の期限', st.err, false);
    return boxHtml(K.box(result(ctx)), 'data-tab="cert"');
  }

  var LV = { alert: ['ng', '要対応'], warn: ['rv', '注意'], ok: ['ok', 'なし'] };
  function lvTag(r, esc) {
    if (r.inactive) return '<span class="tag">止めた職員</span>';
    if (r.stopped) return '<span class="tag">' + (r.known ? '止めた種類' : '設定に無い種類') + '</span>';
    var l = LV[r.level] || LV.ok;
    return '<span class="tag ' + l[0] + '">' + esc(l[1]) + '</span>';
  }

  /* ── 資格のタブ ── */
  function paint(ctx) {
    var esc = ctx.esc, cfg = ctx.cfg(), kinds = K.kindsOf(cfg), km = K.kindMap(kinds), staff = ctx.staff();
    load(ctx, false);
    var h = '<div class="cd no-print"><h2 style="font-size:16px;margin:0 0 4px">資格の期限</h2>' +
      '<p class="help">期限のある資格（介護支援専門員証・運転免許など）を職員ごとに記録し、期限が近い・切れた資格を知らせます。知らせだけで、勤怠の計算と給与は変えません。資格証の写しは置きません。</p>' +
      '<div class="row"><button type="button" class="btn sm" data-act="ct-reload">読み直す</button></div>';
    if (!st) return h + '<p class="empty" role="status">読み込んでいます…</p></div>';
    if (st.err) return h + '<div class="band ' + (noDb ? 'warn' : 'ng') + '" role="alert">' + esc(st.err) + '</div></div>';
    var res = result(ctx), hit = res.rows.filter(function (r) { return r.counted; });
    if (st.more) h += '<div class="band warn" role="status">資格の記録が多すぎて、一部を読めていません（2000件まで）。要らない記録を取り消してください。</div>';
    h += '<h3 style="font-size:15px;margin:12px 0 4px">知らせ（要対応 ' + res.people.alert + ' 人・注意 ' + res.people.warn + ' 人）</h3>';
    h += '<div class="tw"><table class="mt-ct"><thead><tr><th>状態</th><th>氏名</th><th>資格</th><th>期限</th><th>知らせ</th><th></th></tr></thead><tbody>' +
      (hit.map(function (r) {
        return '<tr><td>' + lvTag(r, esc) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.kindName) + '</td><td>' + esc(r.expires_on || '未入力') + '</td><td>' + esc(r.text) + '</td>' +
          '<td><button type="button" class="btn sm" data-act="ct-open" data-sid="' + esc(r.staff_id) + '">この人の資格</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="empty">期限が近い・切れた資格はありません</td></tr>') + '</tbody></table></div>';

    /* 職員ごとの資格 */
    var act = staff.filter(function (s) { return s && s.active !== false; }), sids = {}, others = [], seenO = {};
    staff.forEach(function (s) { if (s) sids[s.staff_id] = s; });
    /* 止めた職員・勤怠の名簿に無い人も、記録があれば選べるようにする（見て取り消せるように・反証レビュー 2026-11-25 軽2） */
    res.rows.forEach(function (r) {
      var s0 = own(sids, r.staff_id) ? sids[r.staff_id] : null;
      if ((s0 && s0.active !== false) || own(seenO, r.staff_id)) return;
      seenO[r.staff_id] = 1; others.push({ id: r.staff_id, label: (s0 ? ctx.dispName(s0) + '（止めた職員）' : r.staff_id + '（勤怠の名簿に無い人）') });
    });
    if (selSid && !own(sids, selSid) && !own(seenO, selSid)) { selSid = ''; clearDraft(); }
    h += '<h3 style="font-size:15px;margin:16px 0 4px">職員ごとの資格</h3><div class="row"><label for="ct-sid">職員</label> <select id="ct-sid"><option value="">選んでください</option>' +
      act.map(function (s) { return '<option value="' + esc(s.staff_id) + '"' + (s.staff_id === selSid ? ' selected' : '') + '>' + esc(ctx.dispName(s)) + '</option>'; }).join('') +
      (others.length ? '<optgroup label="数えていない人">' + others.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === selSid ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</optgroup>' : '') +
      '</select></div>';
    if (selSid) {
      var mine = res.rows.filter(function (r) { return r.staff_id === selSid; });
      h += '<div class="tw"><table class="mt-ct"><thead><tr><th>資格</th><th>取得日</th><th>期限</th><th>状態</th><th>メモ</th><th></th></tr></thead><tbody>' +
        (mine.map(function (r) {
          return '<tr><td>' + esc(r.kindName) + '</td><td>' + esc(r.acquired_on || '') + '</td><td>' + esc(r.expires_on || '') + '</td><td>' + lvTag(r, esc) + (r.text ? ' ' + esc(r.text) : '') + '</td><td>' + esc(r.note) + '</td>' +
            '<td><button type="button" class="btn sm" data-act="ct-edit" data-id="' + esc(r.id) + '">直す</button> <button type="button" class="btn sm" data-act="ct-void" data-id="' + esc(r.id) + '">取り消す</button></td></tr>';
        }).join('') || '<tr><td colspan="6" class="empty">まだ資格の記録はありません</td></tr>') + '</tbody></table></div>';
      var cur = edit ? (st.rows.filter(function (x) { return x.id === edit.id; })[0] || null) : null;
      if (edit && !cur) edit = null;
      var codeV = dv('ct-code') || (cur ? cur.code : ''), opts = kinds.filter(function (k) { return k.active || k.code === codeV; });
      if (codeV && !own(km, codeV)) opts = opts.concat([{ code: codeV, name: codeV + '（設定に無い種類）' }]);
      var k0 = own(km, codeV) ? km[codeV] : null, acqV = own(draft, 'ct-acq') ? dv('ct-acq') : cur ? (cur.acquired_on || '') : '';
      var hint = k0 && k0.years ? K.suggestExpiry(acqV, k0.years) : '';
      h += '<div id="ct-form" class="kv"><span style="grid-column:1/-1"><b>' + (edit ? '資格を直す' : '資格を足す') + '</b></span>' +
        '<label for="ct-code">種類</label><span><select id="ct-code"><option value="">選んでください</option>' +
        opts.map(function (k) { return '<option value="' + esc(k.code) + '"' + (k.code === codeV ? ' selected' : '') + '>' + esc(k.name) + (k.exp ? '（期限あり）' : '') + '</option>'; }).join('') + '</select></span>' +
        '<label for="ct-acq">取得日</label><span><input type="date" id="ct-acq" value="' + esc(acqV) + '" min="1950-01-01" max="' + esc(ctx.today()) + '"> 分からない時は空のまま</span>' +
        '<label for="ct-exp">期限</label><span><input type="date" id="ct-exp" value="' + esc(own(draft, 'ct-exp') ? dv('ct-exp') : cur ? (cur.expires_on || '') : '') + '" min="1950-01-01"> 資格証に書かれた有効期間の終わりの日' +
        '<span id="ct-hint">' + (hint ? ' <button type="button" class="btn sm" data-act="ct-hint" data-v="' + esc(hint) + '">目安 ' + esc(hint) + ' を入れる</button>' : '') + '</span></span>' +
        '<label for="ct-note">メモ</label><span><input type="text" id="ct-note" value="' + esc(own(draft, 'ct-note') ? dv('ct-note') : cur ? (cur.note || '') : '') + '" maxlength="' + K.NOTE_MAX + '" placeholder="例: 更新研修の申し込み済み"> ' + K.NOTE_MAX + '字まで</span></div>' +
        '<div class="row"><button type="button" class="btn pri" data-act="ct-save">' + (edit ? '直した内容を保存する' : '資格を足す') + '</button>' + (edit ? '<button type="button" class="btn" data-act="ct-cancel">直すのをやめる</button>' : '') + '</div>';
    }

    /* 資格の種類（設定） */
    var admin = ctx.isAdmin(), cl = K.cleanKinds(cfg[K.KEY_KINDS]);
    h += '<h3 style="font-size:15px;margin:16px 0 4px">資格の種類</h3>';
    if (cl.isDefault) h += '<p class="help">今は既定の一覧です（足す・直す・止めると、この画面の一覧が設定に保存されます）。</p>';
    if (cl.bad.length) h += '<div class="band warn" role="status">設定の資格の種類に、形の違う行が ' + cl.bad.length + ' 件あります（使っていません）。この画面で足す・直す・止めると、その行は外れます。</div>';
    h += '<div class="tw"><table class="mt-ct"><thead><tr><th>名前</th><th>期限</th><th>注意</th><th>要対応</th><th>期限の目安</th><th>状態</th><th></th></tr></thead><tbody>' +
      cl.items.map(function (k, i) {
        return '<tr><td>' + esc(k.name) + '</td><td>' + (k.exp ? '要る' : '要らない') + '</td><td>' + k.warn + '日前から</td><td>' + (k.urgent ? k.urgent + '日前から' : '期限の日から') + '</td><td>' + (k.years ? '取得日から' + k.years + '年' : '—') + '</td><td>' + (k.active ? '使う' : '<span class="raw">止めた</span>') + '</td><td>' +
          (admin ? '<button type="button" class="btn sm" data-act="ct-k-edit" data-i="' + i + '">直す</button> <button type="button" class="btn sm" data-act="ct-k-toggle" data-i="' + i + '">' + (k.active ? '止める' : '使う') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (admin) {
      var ke = kedit != null ? cl.items[kedit] || null : null;
      if (kedit != null && !ke) kedit = null;
      var kvOr = function (id, d) { return own(kdraft, id) ? kv(id) : d; };
      h += '<div id="ct-kform" class="kv"><span style="grid-column:1/-1"><b>' + (ke ? '種類を直す（' + esc(ke.name) + '）' : '種類を足す') + '</b></span>' +
        '<label for="ct-k-name">名前</label><span><input type="text" id="ct-k-name" value="' + esc(kvOr('ct-k-name', ke ? ke.name : '')) + '" maxlength="' + K.NAME_MAX + '" placeholder="例: 認知症介護実践者研修"> ' + K.NAME_MAX + '字まで</span>' +
        '<label for="ct-k-exp">期限</label><span><select id="ct-k-exp">' + (function (x) { return '<option value="1"' + (x ? ' selected' : '') + '>要る</option><option value=""' + (x ? '' : ' selected') + '>要らない</option>'; })(own(kdraft, 'ct-k-exp') ? !!kv('ct-k-exp') : ke ? ke.exp : true) + '</select> 要る時は、期限が未入力でも「注意」で知らせます</span>' +
        '<label for="ct-k-warn">注意</label><span><input type="number" id="ct-k-warn" min="1" max="' + K.WARN_MAX + '" step="1" value="' + esc(kvOr('ct-k-warn', ke ? ke.warn : 90)) + '"> 日前から</span>' +
        '<label for="ct-k-urgent">要対応</label><span><input type="number" id="ct-k-urgent" min="0" max="' + K.WARN_MAX + '" step="1" value="' + esc(kvOr('ct-k-urgent', ke ? ke.urgent : 30)) + '"> 日前から（切れた後も要対応）</span>' +
        '<label for="ct-k-years">期限の目安</label><span><input type="number" id="ct-k-years" min="0" max="' + K.YEARS_MAX + '" step="1" value="' + esc(kvOr('ct-k-years', ke ? ke.years : 0)) + '"> 年（取得日から。0＝目安なし。入力の手助けだけです）</span></div>' +
        '<div class="row"><button type="button" class="btn pri" data-act="ct-k-save">' + (ke ? '種類を保存する' : '種類を足す') + '</button>' + (ke ? '<button type="button" class="btn" data-act="ct-k-cancel">直すのをやめる</button>' : '') + '</div>';
    } else h += '<p class="help">資格の種類を足す・直す・止めるのは管理者（2段階認証まで済んだ人）です。</p>';
    h += '<p class="help">期限の日はその日まで使えるものとして数えます（次の日から「期限切れ」）。止めた職員・止めた種類の資格は一覧には出しますが、知らせの数には入れません。更新した時は「直す」で期限を書き換えてください（同じ種類の資格は1人に1つです）。</p></div>';
    return h;
  }

  /* ── 押す・選ぶ ── */
  function rowOf(id) { return st && st.rows ? st.rows.filter(function (x) { return x.id === id; })[0] || null : null; }
  function write(ctx, name, args, btn, doneMsg, onOk) {
    if (wbusy) return;
    wbusy = true; var restore = ctx.pressBusy(btn, '保存しています…');
    ctx.rpc(name, args).then(ctx.okOr).then(function () { wbusy = false; if (onOk) onOk(); ctx.toast(doneMsg); drop(); load(ctx, true); ctx.repaint(); })['catch'](function (e) {
      wbusy = false; restore();
      if (!(e && e.kintai) && !ctx.noDb(e) && !ctx.isNetErr(e) && e && e.code !== '42501') ctx.note('資格の保存', e);
      if (e && (e.kintai === 'conflict' || e.kintai === 'notfound')) { clearDraft(); drop(); load(ctx, true); ctx.repaint(); }   /* 書きかけも捨てて読み直す（反証レビュー 2026-11-25 軽4） */
      alert(msg(e, ctx));
    });
  }
  /* 期限の目安のボタンをその場で差し替える（文字は textContent・属性は setAttribute で入れる） */
  function hintNow(ctx) {
    var slot = document.getElementById('ct-hint'); if (!slot) return;
    var km = K.kindMap(K.kindsOf(ctx.cfg())), k0 = own(km, val0('ct-code')) ? km[val0('ct-code')] : null;
    var hint = k0 && k0.years ? K.suggestExpiry(val0('ct-acq'), k0.years) : '';
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    if (!hint) return;
    slot.appendChild(document.createTextNode(' '));
    var bt = document.createElement('button'); bt.type = 'button'; bt.className = 'btn sm'; bt.setAttribute('data-act', 'ct-hint'); bt.setAttribute('data-v', hint); bt.textContent = '目安 ' + hint + ' を入れる';
    slot.appendChild(bt);
  }
  function val0(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function saveKinds(ctx, items, btn, doneMsg, onOk) {
    var cfg = ctx.cfg(), out = {}, k;
    for (k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k];
    out[K.KEY_KINDS] = items;
    if (!K.fitsConfig(out)) { alert('設定に入る量を超えます。使わない種類の名前を短くするか、ほかの設定（会社の休日など）を減らしてください。'); return; }
    ctx.saveConfig(out, btn, doneMsg, onOk);
  }
  function act(a, b, ctx) {
    if (a === 'ct-reload') { noDb = false; drop(); load(ctx, true); ctx.repaint(); return true; }
    if (a === 'ct-open') { var sid = b.getAttribute('data-sid') || ''; if (sid !== selSid) { if (dirty() && !confirm('書きかけの資格の入力を捨てて、ほかの職員を開きますか？')) return true; clearDraft(); } selSid = sid; ctx.repaint(); return true; }
    if (a === 'ct-edit') {
      var r = rowOf(b.getAttribute('data-id'));
      if (!r) return true;
      if (dirty() && !confirm('書きかけの資格の入力を捨てて、この資格を直しますか？')) return true;
      draft = {}; edit = { id: r.id, rev: r.rev }; ctx.repaint(); return true;
    }
    if (a === 'ct-cancel') { clearDraft(); ctx.repaint(); return true; }
    if (a === 'ct-hint') { var v = b.getAttribute('data-v') || ''; if (K.isDate(v)) { draft['ct-exp'] = v; var el = document.getElementById('ct-exp'); if (el) el.value = v; } return true; }
    if (a === 'ct-save') {
      if (!selSid) return true;
      var chk = K.checkCert({ code: val0('ct-code'), acquired_on: val0('ct-acq'), expires_on: val0('ct-exp'), note: val0('ct-note') }, ctx.today());
      if (!chk.val) { alert(chk.why === 'code' ? '資格の種類を選んでください。' : '入れ直してください: ' + WHY[chk.why]); return true; }
      var km = K.kindMap(K.kindsOf(ctx.cfg())), kd = own(km, chk.val.code) ? km[chk.val.code] : null;
      if (kd && kd.exp && !chk.val.expires_on && !confirm('「' + kd.name + '」は期限が要る資格ですが、期限が空です。このまま保存すると「期限が未入力」の注意が出ます。保存しますか？')) return true;
      var x = chk.val;
      var sid0 = selSid;
      write(ctx, 'kintai_cert_put', { p_id: edit ? edit.id : null, p_rev: edit ? edit.rev : 0, p_staff_id: selSid, p_code: x.code, p_acquired: x.acquired_on, p_expires: x.expires_on, p_note: x.note },
        b, edit ? '資格を直しました' : '資格を足しました', function () { if (selSid === sid0) clearDraft(); });   /* 待つ間にほかの職員へ移って書き始めた分は消さない */
      return true;
    }
    if (a === 'ct-void') {
      var rv = rowOf(b.getAttribute('data-id'));
      if (!rv) return true;
      var kn = K.kindMap(K.kindsOf(ctx.cfg()))[rv.code];
      if (!confirm('資格「' + (kn ? kn.name : rv.code) + '」の記録を取り消します（記録は消さずに印を付けます。一覧と知らせから外れます）。よいですか？')) return true;
      write(ctx, 'kintai_cert_void', { p_id: rv.id, p_rev: rv.rev }, b, '資格の記録を取り消しました', function () { if (edit && edit.id === rv.id) clearDraft(); });
      return true;
    }
    if (a === 'ct-k-edit') {
      if (!ctx.isAdmin()) return true;
      if (Object.keys(kdraft).length && !confirm('書きかけの種類の入力を捨てますか？')) return true;
      kdraft = {}; kedit = +b.getAttribute('data-i'); ctx.repaint(); return true;
    }
    if (a === 'ct-k-cancel') { kdraft = {}; kedit = null; ctx.repaint(); return true; }
    if (a === 'ct-k-toggle') {
      if (!ctx.isAdmin()) return true;
      var items = K.cleanKinds(ctx.cfg()[K.KEY_KINDS]).items, i = +b.getAttribute('data-i'), it = items[i];
      if (!it) return true;
      if (!confirm('資格の種類「' + it.name + '」を' + (it.active ? '止めます（記録は残り、知らせの数に入れなくなります）' : 'もう一度使います') + '。よいですか？')) return true;
      it.active = !it.active;
      saveKinds(ctx, items, b, it.active ? '資格の種類を使うようにしました' : '資格の種類を止めました');
      return true;
    }
    if (a === 'ct-k-save') {
      if (!ctx.isAdmin()) return true;
      var all = K.cleanKinds(ctx.cfg()[K.KEY_KINDS]).items, ed = kedit != null ? all[kedit] : null;
      var cand = { code: ed ? ed.code : K.newCode(all), name: val0('ct-k-name'), exp: val0('ct-k-exp') === '1', warn: +val0('ct-k-warn'), urgent: +val0('ct-k-urgent'), years: +val0('ct-k-years'), active: ed ? ed.active : true };
      var kc = K.checkKind(cand);
      if (!kc.kind) { alert('入れ直してください: ' + KWHY[kc.why]); return true; }
      if (all.some(function (k, j) { return k.name === kc.kind.name && (!ed || j !== kedit); })) { alert('同じ名前の種類がもうあります。'); return true; }
      if (!ed && all.length >= K.MAX_KINDS) { alert('資格の種類は ' + K.MAX_KINDS + ' 件までです。使わない種類を直して使ってください。'); return true; }
      var list = ed ? all.map(function (k, j) { return j === kedit ? kc.kind : k; }) : all.concat([kc.kind]);
      saveKinds(ctx, list, b, ed ? '資格の種類を直しました' : '資格の種類を足しました', function () { kdraft = {}; kedit = null; });
      return true;
    }
    return false;
  }
  function change(e, ctx) {
    var id = e.target && e.target.id;
    if (id === 'ct-sid') {
      var v = String(e.target.value || '');
      if (v !== selSid && dirty() && !confirm('書きかけの資格の入力を捨てて、ほかの職員を開きますか？')) { e.target.value = selSid; return true; }
      if (v !== selSid) clearDraft();
      selSid = v; ctx.repaint(); return true;
    }
    if (id === 'ct-code' || id === 'ct-acq') { keep(e); hintNow(ctx); return true; }   /* 期限の目安のボタンだけを差し替える（全体を描き直すと、日付を打っている途中で欄から外れる・反証レビュー 2026-11-25 中1） */
    if (DRAFT_IDS[id] || KDRAFT_IDS[id]) { keep(e); return true; }
    return false;
  }

  /* ── 設定のタブの入り切りの欄（#g-set の中・「設定を保存する」で保存） ── */
  function setHtml(cfg) {
    return '<label for="s-certAlert">資格の期限の知らせ</label><span><input type="checkbox" id="s-certAlert"' + (on(cfg) ? ' checked' : '') + '> 出す（「資格」のタブとホームの箱。知らせだけで、計算は変えません）</span>';
  }
  /* 返す: { keys:['certAlert'], vals:{} }。切のまま鍵が無ければ鍵を作らない（無い時と同じ動き） */
  function readSet(cfg) {
    var el = document.getElementById('s-certAlert');
    if (!el) return null;
    var vals = {};
    if (el.checked) vals.certAlert = true;
    else if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'certAlert')) vals.certAlert = false;
    return { keys: ['certAlert'], vals: vals };
  }

  window.KintaiCert = { on: on, isTab: isTab, syncTabs: syncTabs, homeBox: homeBox, paint: paint, act: act, change: change, keep: keep, dirty: dirty, drop: drop, setHtml: setHtml, readSet: readSet };
})();
