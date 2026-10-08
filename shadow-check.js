/*
 * shadow-check.js — 写しの見比べ（shadow-check.html）の動き。
 * 入居者マスタ: 正本＝この端末の共有名簿（localStorage su_residents_common。入居者マスタが一覧を読むたびに書く）。
 *               写し＝Supabase の master_residents。読むだけで、どちらにも書かない。
 * 切り替え前の点検（統合 0007）: ボタンを押した時だけ、Google（統合同期バックエンド）の全キーの版（list）と写しの版（kv_index）を見比べる。
 *   「足りない分を写す」は Google から中身を取り（pull・8件ずつ）、そのまま写す（kv_import＝古い版では上書きしない）。
 *   Google への合言葉は Google へだけ送る。画面に出すのはキー名（日付・月）と版と件数だけで、中身・氏名は出さない。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var COMMON_KEY = 'su_residents_common';
  // 共有名簿に載っている項目だけを見比べる（生年月日・更新日時は共有名簿に無いので対象外）
  var CMP = [
    ['name', '氏名'], ['kana', 'かな'], ['room', '居室'], ['gender', '性別'], ['care_level', '介護度'],
    ['active', '在籍'], ['hospitalized', '入院中'], ['discharge_date', '退居日'], ['height', '身長'],
    ['target_apps', '対象アプリ']
  ];

  function msg(text, kind) { var m = $('msg'); m.className = 'msg ' + (kind || 'ng'); m.textContent = text || ''; }
  function view(name) {
    $('v-loading').hidden = name !== 'loading';
    $('v-gate').hidden = name !== 'gate';
    $('v-main').hidden = name !== 'main';
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ymd(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? '' : v)) ? String(v) : null; }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 共有名簿の1人 → 見比べ用の形（写しと同じ決まり: 入院中は配られた時だけ・退居日は退居者だけ） */
  function fromCommon(r) {
    return {
      source_id: String(r.masterId == null ? '' : r.masterId).trim(),
      name: String(r.name || ''), kana: String(r.kana || ''), room: String(r.room || ''),
      gender: String(r.gender || ''), care_level: String(r.careLevel || ''),
      active: r.active !== false,
      hospitalized: Object.prototype.hasOwnProperty.call(r, 'hospitalized') ? !!r.hospitalized : null,
      discharge_date: r.active === false ? ymd(r.dischargeDate) : null,
      height: String(r.height || ''),
      target_apps: Array.isArray(r.targetApps) ? r.targetApps.map(String) : null
    };
  }
  function eq(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || null) === JSON.stringify(b || null);
    return (a == null ? null : a) === (b == null ? null : b);
  }

  function readCommon() {
    try {
      var o = JSON.parse(localStorage.getItem(COMMON_KEY) || 'null');
      return o && Array.isArray(o.residents) ? o : null;
    } catch (e) { return null; }
  }

  function kpi(label, value, unit) {
    var d = el('div', 'kpi');
    d.appendChild(el('div', 'lb', label));
    var v = el('div', 'v', String(value));
    if (unit) v.appendChild(el('span', 'u', unit));
    d.appendChild(v);
    return d;
  }

  function renderCompare(copy) {
    var common = readCommon();
    var list = $('cmp-list'), kpis = $('cmp-kpis'), verdict = $('cmp-verdict');
    list.replaceChildren(); kpis.replaceChildren();
    if (!common) {
      $('cmp-src').textContent = 'この端末には入居者マスタの一覧がまだありません。この端末で入居者マスタを開くと見比べられます。';
      kpis.appendChild(kpi('写しの人数', copy.length, '人'));
      verdict.className = 'msg warn';
      verdict.textContent = '見比べる正本がこの端末にありません。';
      return;
    }
    $('cmp-src').textContent = '正本＝この端末の入居者マスタが ' + fmtTime(common.updatedAt) + ' に読んだ一覧';
    var byId = {};
    copy.forEach(function (c) { byId[c.source_id] = c; });
    var same = 0, diff = [], notInCopy = [], seen = {};
    common.residents.forEach(function (r) {
      var s = fromCommon(r);
      if (!s.source_id) return;
      seen[s.source_id] = true;
      var c = byId[s.source_id];
      if (!c) { notInCopy.push(s); return; }
      var fields = CMP.filter(function (f) { return !eq(s[f[0]], c[f[0]]); }).map(function (f) { return f[1]; });
      if (fields.length) diff.push({ s: s, fields: fields }); else same++;
    });
    var notInSource = copy.filter(function (c) { return !seen[c.source_id]; });

    kpis.appendChild(kpi('一致', same, '人'));
    kpis.appendChild(kpi('違いあり', diff.length, '人'));
    kpis.appendChild(kpi('写しに無い', notInCopy.length, '人'));
    kpis.appendChild(kpi('正本に無い', notInSource.length, '人'));

    var bad = diff.length + notInCopy.length + notInSource.length;
    verdict.className = 'msg ' + (bad ? 'warn' : 'ok');
    verdict.textContent = bad
      ? '違いがあります。入居者マスタを開き直すと写しが最新になります。開き直しても残る違いは、下の一覧を確かめてください。'
      : '正本と写しは一致しています。';

    diff.forEach(function (d) { list.appendChild(item(d.s, '違う項目: ' + d.fields.join('・'))); });
    notInCopy.forEach(function (s) { list.appendChild(item(s, '写しにまだありません')); });
    notInSource.forEach(function (c) { list.appendChild(item(c, '正本（この端末の一覧）にいません')); });
  }
  /* 氏名は伏せて出す（2026-10-09・監査10月版 #16）。見分けるのは居室と利用者No で足り、移行の点検の画面に氏名を出す理由が無い。
     姓の1字目だけを残し、残りを ○ にする（空白は詰める）。例「架空 太郎」→「架○○○」 */
  function maskName(n) {
    var t = String(n || '').replace(/[\s　]+/g, '');
    if (!t) return '（氏名なし）';
    return t.charAt(0) + new Array(Math.min(t.length, 6)).join('○');
  }
  function item(r, note) {
    var li = el('li');
    var left = el('div');
    left.appendChild(el('div', 'nm', (r.room ? r.room + '　' : '') + maskName(r.name)));
    left.appendChild(el('div', 'em', '利用者No ' + r.source_id + '　' + note));
    li.appendChild(left);
    return li;
  }

  function renderRuns(runs) {
    var ul = $('runs');
    ul.replaceChildren();
    if (!runs.length) { ul.appendChild(el('li', 'muted', 'まだ記録がありません。事務所・管理者として入居者マスタを開くと記録されます。')); return; }
    runs.forEach(function (r) {
      var li = el('li');
      var left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(r.at) + (r.device_label ? '　' + r.device_label : '')));
      left.appendChild(el('div', 'em', '正本 ' + r.source_count + '人／新規 ' + r.inserted + '・更新 ' + r.updated +
        '・変化なし ' + r.unchanged + '・正本に無い ' + r.missing + (r.failed ? '・失敗 ' + r.failed : '')));
      li.appendChild(left);
      if (r.failed) { var t = el('div', 'ops'); t.appendChild(el('span', 'tag', '要確認')); li.appendChild(t); }
      ul.appendChild(li);
    });
  }

  /* 並びに左右されない比べ方（オブジェクトのキーを並べ替えてから文字列にする） */
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); });
      return o;
    }
    return v;
  }
  function countEvents(d) {
    var n = 0;
    ((d && d.residents) || []).forEach(function (r) { n += (r && Array.isArray(r.events)) ? r.events.length : 0; });
    return n;
  }
  async function loadKv(sb) {
    var kk = $('kv-kpis'), kv = $('kv-verdict');
    kk.replaceChildren();
    var t0 = performance.now();
    var r = await sb.rpc('kv_get', { p_key: 'care_schedule_v2' });
    var ms = Math.round(performance.now() - t0);
    if (r.error) throw r.error;
    var remote = r.data || {};
    var local = null, localRev = 0, dirty = false;
    try { local = JSON.parse(localStorage.getItem('care_schedule_v2') || 'null'); } catch (e) { local = null; }
    try { localRev = (JSON.parse(localStorage.getItem('ws_sync_revs') || '{}').care) || 0; } catch (e) { localRev = 0; }
    try { dirty = !!localStorage.getItem('care_schedule_dirty_v1'); } catch (e) { dirty = false; }
    var rd = remote.data;
    kk.appendChild(kpi('写しの版', remote.rev || 0));
    kk.appendChild(kpi('この端末の版', localRev));
    kk.appendChild(kpi('写しの人数・予定', (rd && rd.residents ? rd.residents.length : 0) + '人・' + countEvents(rd), '件'));
    kk.appendChild(kpi('写しを読む時間', ms, 'ミリ秒'));
    kk.appendChild(kpi('いまの状態', remote.mode === 'live' ? '本番（Supabase）' : (rd ? '写しの期間' : '—')));
    kk.appendChild(kpi('切り替えスイッチ', switchLabel()));
    if (!rd) {
      kv.className = 'msg warn';
      kv.textContent = 'まだ写しがありません。事務所・管理者として週間計画を開くと、数秒後に写されます。';
    } else if (!local) {
      kv.className = 'msg warn';
      kv.textContent = 'この端末には週間計画のデータがありません。この端末で週間計画を開くと見比べられます。';
    } else if (dirty) {
      kv.className = 'msg warn';
      kv.textContent = 'この端末の週間計画に未送信の変更があるため、正しく見比べられません。週間計画で保存してから見比べ直してください。';
    } else if (localRev === remote.rev && JSON.stringify(canon(local)) === JSON.stringify(canon(rd))) {
      kv.className = 'msg ok';
      kv.textContent = '週間計画の写しは、この端末の最新の版と一致しています。';
    } else if (localRev === remote.rev) {
      kv.className = 'msg warn';
      kv.textContent = '版は同じですが中身に違いがあります（この端末だけの表示用の値の可能性があります）。続く場合は管理者に知らせてください。';
    } else {
      kv.className = 'msg warn';
      kv.textContent = '版が違います（写し ' + (remote.rev || 0) + '／この端末 ' + localRev + '）。週間計画を開き直すと、数秒後に写しが最新になります。';
    }
  }

  /* ── 切り替えスイッチ（su-backend.json）の読み取り。週間計画とワークスケジュールの3つ ── */
  var FLAGS = ['care_schedule_v2', 'ws_weekly_master_v1', 'wsday'];
  function switchState() {
    var sw = window.SUKv ? SUKv._flags() : null;
    var on = FLAGS.filter(function (f) { return !!(sw && sw.supabase && sw.supabase[f] === true); }).length;
    return on === FLAGS.length ? 'on' : on === 0 ? 'off' : 'mixed';
  }
  function switchLabel() {
    var s = switchState();
    return s === 'on' ? '入（3つとも）' : s === 'off' ? '切' : 'そろっていない';
  }

  /* 管理者だけ: 保存先の切り替え・戻し（週間計画とワークスケジュールをまとめて・kv_set_family_mode）。確認を2回とる */
  var CUT_FAMS = ['care', 'ws_master', 'wsday'];
  async function setMode(mode) {
    var need = mode === 'live' ? 'on' : 'off';
    if (switchState() !== need) {
      msg(mode === 'live'
        ? '切り替えスイッチがまだ「入（3つとも）」になっていません。先にスイッチを入れる PR を取り込み、1分ほど待ってから画面を開き直してください。'
        : '切り替えスイッチがまだ「切」になっていません。先にスイッチを切る PR を取り込み、1分ほど待ってから画面を開き直してください。', 'warn');
      return;
    }
    var q = mode === 'live'
      ? '週間計画とワークスケジュールの保存先を Supabase（本番）に切り替えますか？\n\n「切り替え前の点検」がそろっていることを確かめてから進めてください。'
      : '週間計画とワークスケジュールを「写しの期間」に戻しますか？';
    if (!confirm(q)) return;
    if (!confirm('本当に実行しますか？（操作は記録に残ります）')) return;
    var r = await SUAuth.client().rpc('kv_set_family_mode', { p_families: CUT_FAMS, p_mode: mode });
    if (r.error || !r.data || !r.data.ok) {
      var why = String((r.error && (r.error.code || r.error.message)) || (r.data && r.data.error) || '');
      msg('変更できませんでした: ' + (/PGRST202|42883/.test(why) ? 'データベースの準備（0007）がまだです。' : why));
      return;
    }
    msg(mode === 'live' ? '週間計画とワークスケジュールの保存先を Supabase（本番）にしました。明日の朝、全部のパソコンで3つの画面を開き直してください。'
                        : '週間計画とワークスケジュールを写しの期間に戻しました。', 'ok');
    await loadKv(SUAuth.client());
  }

  /* 管理者だけ: 勤務表の保存先の切り替え・戻し（統合 0009）。週間計画・ワークスケジュールとは別の夜に行う。
   * 切り替えは、この画面で点検して勤務表がそろっている時だけ（shiftReady）。戻すのはいつでも（スイッチを切ってから）。 */
  var shiftReady = false;
  function shiftSwitch() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.shift === true); }
  async function setShiftMode(mode) {
    if (mode === 'live' && !shiftSwitch()) {
      msg('勤務表の切り替えスイッチ（shift）がまだ「入」になっていません。先にスイッチを入れる PR を取り込み、1分ほど待ってから画面を開き直してください。', 'warn');
      return;
    }
    if (mode === 'shadow' && shiftSwitch()) {
      msg('勤務表の切り替えスイッチ（shift）がまだ「切」になっていません。先にスイッチを切る PR を取り込み、1分ほど待ってから画面を開き直してください。', 'warn');
      return;
    }
    if (mode === 'live' && !shiftReady) {
      msg('先に「切り替え前の点検をする」を押して、勤務表がそろっていることを確かめてください。', 'warn');
      return;
    }
    var q = mode === 'live'
      ? '勤務表の保存先を Supabase（本番）に切り替えますか？\n\n編集中の端末は、いったん閲覧モードに戻ります（入力は端末に退避されます）。'
      : '勤務表を「写しの期間」に戻しますか？';
    if (!confirm(q)) return;
    if (!confirm('本当に実行しますか？（操作は記録に残ります）')) return;
    var r = await SUAuth.client().rpc('kv_set_family_mode', { p_families: ['shift'], p_mode: mode });
    if (r.error || !r.data || !r.data.ok) {
      var why = String((r.error && (r.error.code || r.error.message)) || (r.data && r.data.error) || '');
      msg('変更できませんでした: ' + (why === 'notready' ? 'データベースの準備（0009）がまだです。' : /PGRST202|42883/.test(why) ? 'データベースの準備（0007）がまだです。' : why));
      return;
    }
    msg(mode === 'live' ? '勤務表の保存先を Supabase（本番）にしました。明日の朝、勤務表を使う全部の端末で画面を開き直してください。'
                        : '勤務表を写しの期間に戻しました。', 'ok');
  }

  /* ── 切り替え前の点検（統合 0007）── */
  var GAS_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var FAMS = [['care', '週間計画'], ['ws_master', 'ワークスケジュール（週の型）'], ['wsday', 'ワークスケジュール（日ごと）'], ['shift', '勤務表']];
  // 各画面に「切り替えの部品」が入っているか（Mac 側の公開で消えていないか）。印の文字列が画面のファイルに在るかだけを見る
  var HOOKS = [
    ['care-schedule.html', '週間計画', ['SUKv.handles(', 'SUKvShadow.fromGas(']],
    ['work-schedule.html', 'ワークスケジュール', ['SUKv.handles(', 'SUKvShadow.fromSync(']],
    ['daycare-roster.html', 'デイ利用表', ['SUKv.handles(']],
    ['shift-app.html', '勤務表', ['SUKvShadow.fromSync(']],
    // 勤務表の切り替えの部品（統合 0009）。勤務表を切り替える時だけ必要＝週間計画・ワークスケジュールの切り替えは止めない
    ['shift-app.html', '勤務表（切り替えの部品）', ['SUKv.handlesShift(', 'SUKv.callShift('], 'shift']
  ];
  var FILL_BATCH = 8;
  // Google の版の数え方（2026-09-27 改: 全ファイルを開く list は同期フォルダが大きく90秒で終わらなかった）。
  // ワースケの日データは「1年前〜2か月先」の日付だけを25件ずつ head で問い合わせる（ファイルが無い日は版 0＝数えない）。
  // 勤務表は Google 側の版の索引（_shift_revindex）を1回読む shiftStatus で、名簿・記号・設定と前後の月（12か月前〜3か月先）を問う。
  // 勤務表の作りかけの案（sched:YYYY-MM:draft:*）は名前が決まっていないので数えない（確定すると plan に入る）。
  var WSDAY_BACK = 365, WSDAY_AHEAD = 60, HEAD_BATCH = 15, SHIFT_BACK = 12, SHIFT_AHEAD = 3;
  // 自動やり直し（2026-09-27 代表者の指示）: Google はしばらく使われていないと最初の読み出しが遅く、1回目が時間切れになりやすい。
  // 1回の問い合わせが失敗したら、少し待って同じ問い合わせを最大2回までやり直す（読むだけ・写すだけなので何度やっても害はない）。
  // 断り（合言葉の違い等）はやり直さない。1回に問い合わせる件数も 25→15 に減らした。
  var RETRY_WAITS = [3000, 8000];
  function isRefusal(e) { return /Google が断りました/.test(String(e && e.message || '')); }
  async function gasPostRetry(tgt, body, ms, onRetry) {
    for (var n = 0; ; n++) {
      try { return await gasPost(tgt, body, ms); }
      catch (e) {
        if (isRefusal(e) || n >= RETRY_WAITS.length) throw e;
        if (onRetry) onRetry(n + 1);
        await new Promise(function (ok) { setTimeout(ok, RETRY_WAITS[n]); });
      }
    }
  }
  function dayStr(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function candidateKeys() {
    var t = new Date(); t.setHours(12, 0, 0, 0);
    var ws = ['care_schedule_v2', 'ws_weekly_master_v1'], sh = ['staff', 'symbols', 'settings', 'freee'], i, d, ym;
    for (i = -WSDAY_BACK; i <= WSDAY_AHEAD; i++) { d = new Date(t); d.setDate(t.getDate() + i); ws.push('wsday_' + dayStr(d)); }
    for (i = -SHIFT_BACK; i <= SHIFT_AHEAD; i++) {
      d = new Date(t.getFullYear(), t.getMonth() + i, 1);
      ym = dayStr(d).slice(0, 7);
      sh.push('sched:' + ym + ':plan', 'sched:' + ym + ':actual', 'sched:' + ym + ':official', 'req:' + ym, 'drafts:' + ym);
    }
    return { ws: ws, sh: sh };
  }
  /* Google の版を集める。返すのは {revs: キー→版（1以上だけ）, asked: 問い合わせたキー} */
  async function collectGasIndex(tgt, progress) {
    var c = candidateKeys(), revs = {}, asked = {}, i, j, part;
    var total = c.ws.length + c.sh.length, done = 0;
    var retrying = function (n) { progress(done, total, n); };
    for (i = 0; i < c.ws.length; i += HEAD_BATCH) {
      part = c.ws.slice(i, i + HEAD_BATCH);
      j = await gasPostRetry(tgt, { action: 'head', keys: part }, 60000, retrying);
      part.forEach(function (k) { asked[k] = true; var r = Number(j.revs && j.revs[k]) || 0; if (r > 0) revs[k] = r; });
      done += part.length; progress(done, total);
    }
    j = await gasPostRetry(tgt, { action: 'shiftStatus', keys: c.sh }, 60000, retrying);
    c.sh.forEach(function (k) { asked[k] = true; var r = Number(j.revs && j.revs[k]) || 0; if (r > 0) revs[k] = r; });
    progress(total, total);
    return { revs: revs, asked: asked };
  }
  var plan = [];      // 足りない分のキー

  function famOf(k) { return window.SUKvShadow ? SUKvShadow.family(k) : ''; }
  function gasTarget() {
    try {
      var c = JSON.parse(localStorage.getItem('su_sync_common') || '{}');
      var u = String(c.endpoint || '').trim(), t = String(c.token || '').trim();
      return GAS_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  function gasPost(tgt, body, ms) {
    var ctl = new AbortController();
    var tm = setTimeout(function () { ctl.abort(); }, ms || 90000);
    var req = Object.assign({}, body, { token: tgt.token });
    return fetch(tgt.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                            body: JSON.stringify(req), redirect: 'follow', signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('Google の応答 ' + r.status); return r.json(); })
      .then(function (j) {
        clearTimeout(tm);
        if (!j || j.ok !== true) throw new Error('Google が断りました（' + String(j && j.error || '') + '）');
        return j;
      }, function (e) { clearTimeout(tm); throw (e && e.name === 'AbortError') ? new Error('Google の応答がありません（時間切れ）') : e; });
  }
  function checkHooks() {
    return Promise.all(HOOKS.map(function (h) {
      return fetch(h[0] + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (tx) { return { name: h[1], only: h[3] || '', ok: !!tx && h[2].every(function (m) { return tx.indexOf(m) >= 0; }) }; },
              function () { return { name: h[1], only: h[3] || '', ok: false }; });
    }));
  }
  function preItem(title, note, bad) {
    var li = el('li');
    var left = el('div');
    left.appendChild(el('div', 'nm', title));
    if (note) left.appendChild(el('div', 'em', note));
    li.appendChild(left);
    if (bad) { var t = el('div', 'ops'); t.appendChild(el('span', 'tag', '要確認')); li.appendChild(t); }
    return li;
  }
  function busy(on, text) {
    $('b-check').disabled = on; $('b-fill').disabled = on;
    if (text != null) { $('pre-verdict').className = 'msg warn'; $('pre-verdict').textContent = text; }
  }

  async function runCheck() {
    var kpis = $('pre-kpis'), list = $('pre-list'), verdict = $('pre-verdict');
    kpis.replaceChildren(); list.replaceChildren(); $('b-fill').hidden = true; plan = [];
    var tgt = gasTarget();
    if (!tgt) {
      verdict.className = 'msg warn';
      verdict.textContent = 'この端末には週間計画・ワークスケジュールの接続先（Google）がありません。この端末で週間計画かワークスケジュールを一度開いてから、点検し直してください。';
      return;
    }
    busy(true, '確かめています…（Google に少しずつ問い合わせるため、2〜3分かかることがあります）');
    try {
      var sb = SUAuth.client();
      var res = await Promise.all([
        collectGasIndex(tgt, function (n, all, retry) {
          busy(true, '確かめています… Google の版 ' + n + '／' + all + '件' + (retry ? '（Google の応答が遅いため、やり直しています ' + retry + '回目）' : ''));
        }),
        Promise.all(FAMS.map(function (f) { return sb.rpc('kv_index', { p_family: f[0] }); })),
        checkHooks()
      ]);
      var gasRevs = res[0].revs, asked = res[0].asked, idx = res[1], hooks = res[2];
      var idxErr = idx.filter(function (r) { return r.error; })[0];
      if (idxErr) throw new Error(/PGRST202|42883/.test(String(idxErr.error.code || idxErr.error.message)) ? 'データベースの準備（0007）がまだです。' : String(idxErr.error.message || idxErr.error.code));
      var ready = true, reasons = [], shiftBad = 0;
      FAMS.forEach(function (f, i) {
        var copy = (idx[i].data && idx[i].data.revs) || {};
        var same = 0, missing = [], diff = [], extra = 0;
        Object.keys(gasRevs).forEach(function (k) {
          if (famOf(k) !== f[0]) return;
          var g = gasRevs[k];
          if (!Object.prototype.hasOwnProperty.call(copy, k)) { missing.push(k); plan.push(k); }
          else if (Number(copy[k]) === g) same++;
          else { diff.push(k + '（Google ' + g + '／写し ' + copy[k] + '）'); if (Number(copy[k]) < g) plan.push(k); }
        });
        // 問い合わせた範囲で Google に無いのに写しにある（範囲の外のキーは数えない）
        Object.keys(copy).forEach(function (k) { if (asked[k] && !Object.prototype.hasOwnProperty.call(gasRevs, k)) extra++; });
        kpis.appendChild(kpi(f[1], same + '／' + (same + missing.length + diff.length), '一致'));
        var bad = missing.length + diff.length;
        if (bad && CUT_FAMS.indexOf(f[0]) >= 0) { ready = false; reasons.push(f[1] + 'の写しが足りない・違う'); }
        if (f[0] === 'shift') shiftBad = bad;
        if (bad || extra) {
          var note = (missing.length ? '写しに無い ' + missing.length + '件' : '') +
                     (diff.length ? (missing.length ? '・' : '') + '版が違う ' + diff.length + '件' : '') +
                     (extra ? ((bad ? '・' : '') + 'Google に無い ' + extra + '件') : '');
          var ex = missing.concat(diff).slice(0, 6).join('、');
          list.appendChild(preItem(f[1] + (CUT_FAMS.indexOf(f[0]) < 0 ? '（切り替えは別の夜・写しの確認）' : ''), note + (ex ? '　例: ' + ex : ''), bad > 0));
        }
      });
      var shiftHooks = true;
      hooks.forEach(function (h) {
        if (h.only === 'shift' || h.name === '勤務表') shiftHooks = shiftHooks && h.ok;
        if (!h.ok && h.only !== 'shift') { ready = false; reasons.push(h.name + 'の画面に切り替えの部品が無い'); }
        list.appendChild(preItem(h.name + 'の画面', h.ok ? '切り替えの部品が入っています' : '切り替えの部品が見つかりません（Mac 側の公開で消えた可能性。切り替えの前に直す必要があります）', !h.ok));
      });
      kpis.appendChild(kpi('切り替えスイッチ', switchLabel()));
      shiftReady = shiftBad === 0 && shiftHooks;
      $('sh-verdict').className = 'msg ' + (shiftReady ? 'ok' : 'warn');
      $('sh-verdict').textContent = shiftReady
        ? '勤務表も、Google と写しが全部そろっていて、勤務表の画面に切り替えの部品が入っています（勤務表を切り替えてよい状態です）。'
        : '勤務表はまだ切り替えられません: ' + (shiftBad ? '勤務表の写しが足りない・違う' : '') + (shiftBad && !shiftHooks ? '／' : '') + (shiftHooks ? '' : '勤務表の画面に切り替えの部品が無い') + '。';
      $('b-fill').hidden = plan.length === 0;
      if (plan.length) $('b-fill').textContent = '足りない分を写す（' + plan.length + '件）';
      verdict.className = 'msg ' + (ready ? 'ok' : 'warn');
      verdict.textContent = ready
        ? '週間計画とワークスケジュールは、Google と写しが全部そろっています。画面の部品も入っています（切り替えてよい状態です）。'
        : 'まだ切り替えられません: ' + reasons.join('／') + '。' + (plan.length ? '「足りない分を写す」を押すと、Google から写しを取り直します。' : '');
    } catch (e) {
      verdict.className = 'msg ng';
      verdict.textContent = '点検できませんでした: ' + String(e && e.message || e);
    } finally {
      busy(false);
    }
  }

  async function fillMissing() {
    var tgt = gasTarget();
    if (!tgt || !plan.length) return;
    var keys = plan.slice(), done = 0, okN = 0, failN = 0;
    var sb = SUAuth.client();
    busy(true, '写しています… 0／' + keys.length);
    try {
      for (var i = 0; i < keys.length; i += FILL_BATCH) {
        var part = keys.slice(i, i + FILL_BATCH);
        var j = await gasPostRetry(tgt, { action: 'pull', keys: part }, 120000, function (n) {
          busy(true, '写しています… ' + done + '／' + keys.length + '（Google の応答が遅いため、やり直しています ' + n + '回目）');
        });
        var ents = j.entries || {};
        for (var n = 0; n < part.length; n++) {
          var k = part[n], e = ents[k];
          if (e && Number(e.rev) >= 1 && e.data != null && typeof e.data === 'object') {
            var r = await sb.rpc('kv_import', { p_key: k, p_rev: Number(e.rev), p_data: e.data });
            if (!r.error && r.data && r.data.ok) okN++; else failN++;
          } else failN++;
          done++;
        }
        busy(true, '写しています… ' + done + '／' + keys.length);
      }
      msg('写し終えました（' + okN + '件' + (failN ? '・写せなかった ' + failN + '件' : '') + '）。続けて点検し直します。', failN ? 'warn' : 'ok');
    } catch (e) {
      msg('途中で止まりました（' + done + '／' + keys.length + '件まで）: ' + String(e && e.message || e) + '。もう一度押すと続きから写します。', 'warn');
    }
    busy(false);
    await runCheck();
  }

  async function load() {
    var sb = SUAuth.client();
    var cols = 'source_id,' + SUMasterShadow.FIELDS.join(',');
    var a = await sb.from('master_residents').select(cols).order('room', { ascending: true });
    if (a.error) throw a.error;
    var b = await sb.from('master_sync_runs').select('at,device_label,source_count,inserted,updated,unchanged,missing,failed')
      .order('at', { ascending: false }).limit(20);
    if (b.error) throw b.error;
    renderCompare(a.data || []);
    renderRuns(b.data || []);
    $('kv-admin').hidden = !(me && me.role === 'admin');
    try { await loadWeight(sb); }
    catch (e) {
      $('wt-verdict').className = 'msg warn';
      $('wt-verdict').textContent = '体重の写しはまだ読めません（データベースの準備 0008 が未適用の可能性）。';
    }
    try { await loadKv(sb); }
    catch (e) {
      // 週間計画の写しの表（0005）がまだ無い時も、入居者マスタの見比べは使えるようにする
      $('kv-verdict').className = 'msg warn';
      $('kv-verdict').textContent = '週間計画の写しはまだ読めません（データベースの準備 0005 が未適用の可能性）。';
    }
  }

  /* 体重の写し（統合 0008）: 写しの件数と、写しを取った記録（件数だけ） */
  async function loadWeight(sb) {
    var kk = $('wt-kpis'), v = $('wt-verdict'), ul = $('wt-runs');
    kk.replaceChildren(); ul.replaceChildren();
    var q = await Promise.all([
      sb.from('weight_residents').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      sb.from('weight_records').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      sb.from('weight_sync_runs').select('at,residents,records,inserted,updated,unchanged,deleted,refused').order('at', { ascending: false }).limit(5)
    ]);
    var err = q.filter(function (r) { return r.error; })[0];
    if (err) throw err.error;
    kk.appendChild(kpi('写しの入居者', q[0].count || 0, '人'));
    kk.appendChild(kpi('写しの記録', q[1].count || 0, '件'));
    var runs = q[2].data || [];
    if (!runs.length) {
      v.className = 'msg warn';
      v.textContent = 'まだ写しがありません。事務所・管理者として体重管理を開くと、数秒後に写されます。';
      return;
    }
    var last = runs[0];
    kk.appendChild(kpi('最後に写した時刻', fmtTime(last.at)));
    v.className = 'msg ' + (last.refused ? 'warn' : 'ok');
    v.textContent = last.refused
      ? '最後の写しは受け付けませんでした（' + (last.refused === 'shrink' ? '件数が急に減っていたため。読み込みの途中切れの可能性' : last.refused) + '）。体重管理を開き直してください。'
      : '体重の写しは、最後に体重管理が読んだ全件と同じです。';
    runs.forEach(function (r) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(r.at)));
      left.appendChild(el('div', 'em', r.refused ? '受け付けず（' + r.refused + '）　入居者 ' + r.residents + '人・記録 ' + r.records + '件'
        : '入居者 ' + r.residents + '人・記録 ' + r.records + '件／追加 ' + r.inserted + '・更新 ' + r.updated + '・変化なし ' + r.unchanged + '・消えた印 ' + r.deleted));
      li.appendChild(left);
      ul.appendChild(li);
    });
  }

  async function start() {
    view('loading');
    var st;
    try { st = await SUAuth.check(); } catch (e) { st = { status: 'error', message: String(e && e.message || e) }; }
    me = st;
    if (st.status !== SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
      if (st.status === SUAuth.STATUS.OK) $('gate-why').textContent = 'このアカウント（現場）では開けません。事務所または管理者のアカウントでログインしてください。';
      else if (st.status === SUAuth.STATUS.ERROR) $('gate-why').textContent = st.message || '確かめられませんでした。';
      view('gate');
      return;
    }
    try {
      await load();
      view('main');
    } catch (e) {
      $('gate-why').textContent = '読み込めませんでした: ' + String(e && e.message || e);
      view('gate');
    }
  }
  var me = null;
  $('b-live').addEventListener('click', function () { setMode('live'); });
  $('b-shadow').addEventListener('click', function () { setMode('shadow'); });
  $('b-live-shift').addEventListener('click', function () { setShiftMode('live'); });
  $('b-shadow-shift').addEventListener('click', function () { setShiftMode('shadow'); });
  $('b-reload').addEventListener('click', function () { msg(''); load().catch(function (e) { msg(String(e && e.message || e)); }); });
  $('b-check').addEventListener('click', function () { msg(''); runCheck(); });
  $('b-fill').addEventListener('click', function () { msg(''); fillMissing(); });
  start();
})();
