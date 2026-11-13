/*
 * shadow-check.js — 写しの見比べ（shadow-check.html）の動き。
 * 入居者マスタ: 正本＝この端末の共有名簿（localStorage su_residents_common。入居者マスタが一覧を読むたびに書く）。
 *               写し＝Supabase の master_residents。読むだけで、どちらにも書かない。
 * 切り替え前の点検（統合 0007）: ボタンを押した時だけ、Google（統合同期バックエンド）の全キーの版（list）と写しの版（kv_index）を見比べる。
 *   「足りない分を写す」は Google から中身を取り（pull・8件ずつ）、そのまま写す（kv_import＝古い版では上書きしない）。
 *   Google への合言葉は Google へだけ送る。画面に出すのはキー名（日付・月）と版と件数だけで、中身・氏名は出さない。
 * 訪問日・かかりつけ病院の写し（移行 0022・2026-10-24 代表者の決定4・段2b）: ボタンを押した時だけ、正本＝Google の入居者マスタの名簿
 *   （getRoster・この端末の rmaster_cfg の URL と合言葉。合言葉は Google へだけ送る）と、写し＝Supabase の master_residents_care を
 *   利用者No で突き合わせる。出すのは人数と、違いのある利用者No と項目名だけ（氏名・病院名・曜日の中身は出さない）。どちらにも書かない。
 * 入居者マスタの全項目の写し（統合 0034・2026-10-29 代表者の決定5）: 管理者がボタンを押した時だけ、su-res-full.js で Google（rmaster_cfg）から
 *   全員分を読み、Supabase へ写して読み直し、見比べる。Google へは読むだけ。出すのは人数・件数・利用者No・項目名だけ。
 */
/* 画面の中の窓（su-dialog.js）が読めなかった時の受け口（2026-11-13）。ブラウザの窓に落とし、呼ぶ側と同じ約束（Promise）で答える。
   この画面は CSP で直書きのスクリプトを置かないため、職員マスタと同じく、体重管理の HTML の受け口と同じ中身をここに置く */
if (!window.SUDialog) window.SUDialog = {
  alert: function (m) { try { window.alert(m); } catch (_) { /* 何もしない */ } return Promise.resolve(); },
  confirm: function (m) { var r = false; try { r = !!window.confirm(m); } catch (_) { /* 何もしない */ } return Promise.resolve(r); },
  busy: function () { return false; },
  idle: function () { return Promise.resolve(); }
};
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

  /* 結果の文は、ページ最上部の欄（読み上げ用 role=alert）に加えて、押したボタンの並びのすぐ下にも出す
   * （2026-10-16 代表者の指摘: 勤務表の切り替えの夜、下の方のボタンを押すと断りの文が最上部にだけ出て、
   *   「押しても何も起きない」ように見えた）。近くの写し（msg-near）は読み上げない＝二重に読まない。
   * 最上部の「見比べ直す」など、ページの上の方（v-main の外）のボタンは最上部の欄だけで足りる。 */
  var msgAnchor = null;
  document.addEventListener('click', function (e) {
    /* 画面の中の窓（su-dialog.js）の中（OK・キャンセル・Enter も押した扱い・窓の文・暗い後ろ）を押した時は付け替えない。
       答えの後の文を、窓を開いたボタンの並びの下に出すため（2026-11-13） */
    if (e.target && e.target.closest && e.target.closest('dialog')) return;
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    msgAnchor = b && b.closest ? b.closest('.acts') : null;
  }, true);
  function msg(text, kind) {
    var m = $('msg'); m.className = 'msg ' + (kind || 'ng'); m.textContent = text || '';
    var n = $('msg-near'); if (!n) return;
    var a = msgAnchor;
    if (!text || !a || !a.parentNode || !a.closest || !a.closest('#v-main')) { n.textContent = ''; return; }
    if (n.previousElementSibling !== a) a.parentNode.insertBefore(n, a.nextSibling);
    n.className = m.className; n.textContent = text;
  }
  /* 失敗の理由を画面に出す文にする（2026-11-13 代表者の指示・文は仮置き）。
     x は例外・データベースの断り（code・message）・文字列のどれでもよい。
     日本語（かな・漢字）を含む文は、この画面や部品が作った文なのでそのまま返す。
     含まない文（'Failed to fetch' などの英語の例外文・番号だけの断り）は画面に出さず、
     調べる人のために su-errors の記録へ残して、種類ごとの日本語の文を返す。
     short が真の時は、前後の文に挟むための短い言い方（句点なし）を返す */
  var JA_CHAR = /[\u3040-\u30ff\u3400-\u9fff]/;
  var JA_WHY = {
    net: ['つながりませんでした。インターネットの接続を確かめて、もう一度押してください。', 'つながりませんでした'],
    timeout: ['応答がありませんでした（時間切れ）。少し待ってから、もう一度押してください。', '応答がありませんでした（時間切れ）'],
    denied: ['この操作の権限がありません。管理者としてログインしているか確かめてください。', 'この操作の権限がありません'],
    prep: ['データベースの準備がまだです。開発の担当へ知らせてください。', 'データベースの準備がまだです'],
    other: ['うまくいきませんでした。少し待ってから、もう一度押してください。続く時は開発の担当へ知らせてください。', 'うまくいきませんでした']
  };
  /* 英語の文の種類（権限・時間切れ・通信・準備がまだ・そのほか）。nm は例外の名前 */
  function jaKind(all, nm) {
    return /42501|permission denied|not allowed|unauthori[sz]ed|forbidden|jwt|^40[13](\s|$)|\bstatus[ :=]*40[13]\b|\bHTTP\S*\s+40[13]\b/i.test(all) ? 'denied'
      : (nm === 'AbortError' || /abort|time ?out|timed out/i.test(all)) ? 'timeout'
      : (nm === 'FunctionsFetchError' || /failed to fetch|load failed|networkerror|network ?error|network request failed|fetch failed|failed to send a request/i.test(all)) ? 'net'
      : /PGRST202|PGRST205|42883|42P01/.test(all) ? 'prep'
      : 'other';
  }
  /* 日本語の文の中の英語の連なり（部品が英語の例外文に日本語の前後を付けた時）。
     英字の語が2つ以上つながったもの、または例外らしい語（Error・Failed・fetch など）を含むものだけを英語の文とみなす。
     Google・PC・GAS のような1語の名前と、番号・英字1語の印は残す（反証レビューの指摘 2026-11-13） */
  var EN_RUN = /[A-Za-z][\w.'\/-]*(?:[:,;]?[ \t]+[\w.'\/<>-]+)+|[A-Za-z]\w*(?:Error|Exception)\b/g;
  var EN_NAME = /^(Google|Drive|Supabase|GAS|PC|AI|PR|Mac|iPhone|iPad|Chrome|GitHub|OK|NG)$/;
  var EN_KEY = /Error|Exception|\bFailed\b|\bfetch\b|\bundefined\b|\bnull\b/;
  function enSentence(m) {
    var w = (m.match(/[A-Za-z]{2,}/g) || []).filter(function (x) { return !EN_NAME.test(x); });
    return w.length >= 2 || EN_KEY.test(m);
  }
  function jaWhy(where, x, short) {
    var s = '', nm = '', c = '';
    if (x && typeof x === 'object') { s = String(x.message || x.error || ''); c = String(x.code || ''); nm = String(x.name || ''); }
    else s = String(x == null ? '' : x);
    var all = (c ? c + ' ' : '') + s;
    if (JA_CHAR.test(s)) {
      var out = s.replace(EN_RUN, function (m) { return enSentence(m) ? JA_WHY[jaKind(m, '')][1] : m; });
      if (out !== s) { try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: ' + where, s); } catch (e) { /* 記録できなくても止めない */ } }
      return out;
    }
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: ' + where, (nm ? nm + ' ' : '') + (all || '（理由なし）')); } catch (e) { /* 記録できなくても止めない */ }
    return JA_WHY[jaKind(all, nm)][short ? 1 : 0];
  }
  /* 写しの断りの印（表に無い英字の印）を画面に出す言葉にする。表に無い印は記録に残して「ほかの理由」と出す */
  function refusedWord(map, code, where) {
    if (map[code]) return map[code];
    if (!code) return '';
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: ' + where + 'の断りの印', String(code)); } catch (e) { /* 記録できなくても止めない */ }
    return 'ほかの理由';
  }
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

  /* 訪問日・かかりつけ病院の写しの見比べ（純関数）。gasRoster＝Google の getRoster の roster、careRows＝master_residents_care の行。
   * 返すのは人数と利用者No と項目名だけ（値は返さない）:
   *   same 一致の人数・diff [{id, fields:[項目名]}]・notInCopy 写しに無い利用者No・notInSource 正本に無い利用者No・
   *   noField 正本の名簿に2項目のキーが無い利用者No（古い GAS・現場用の名簿＝比べられない） */
  var CARE_CMP = [['visit_day', 'visitDay', '訪問日'], ['hospital', 'hospital', 'かかりつけ病院']];
  function careCompare(gasRoster, careRows) {
    var byId = {}, seen = {}, same = 0, diff = [], notInCopy = [], noField = [];
    (Array.isArray(careRows) ? careRows : []).forEach(function (c) { if (c && typeof c.source_id === 'string') byId[c.source_id] = c; });
    (Array.isArray(gasRoster) ? gasRoster : []).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var id = String(x.id == null ? '' : x.id).trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      if (!Object.prototype.hasOwnProperty.call(x, 'visitDay') || !Object.prototype.hasOwnProperty.call(x, 'hospital')) { noField.push(id); return; }
      var c = byId[id];
      if (!c) { notInCopy.push(id); return; }
      var fields = CARE_CMP.filter(function (f) {
        return String(x[f[1]] == null ? '' : x[f[1]]) !== String(c[f[0]] == null ? '' : c[f[0]]);
      }).map(function (f) { return f[2]; });
      if (fields.length) diff.push({ id: id, fields: fields }); else same++;
    });
    var notInSource = Object.keys(byId).filter(function (id) { return !seen[id]; }).sort();
    return { same: same, diff: diff, notInCopy: notInCopy, notInSource: notInSource, noField: noField };
  }
  // 入居者マスタの接続先は接続設定と同じく Workspace ドメイン形式（/a/macros/<domain>/s/…/exec）も通す（Google の /exec だけ）
  var RMASTER_RE = /^https:\/\/script\.google\.com\/[^?#\s]*\/exec$/;
  function rmasterTarget() {
    try {
      var o = JSON.parse(localStorage.getItem('rmaster_cfg') || 'null');
      var u = String(o && o.url || '').trim(), t = String(o && o.token || '').trim();
      return RMASTER_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  /* 入居者マスタの名簿を Google から読む（各画面の getRoster と同じ送り方: POST・text/plain・合言葉は本文）。1分で見切る */
  function rmasterRoster(tgt) {
    var ctl = new AbortController();
    var tm = null;
    /* ログインしている時だけ証明を添える（su-gas-auth.js・GAS が READ_ROLE_CHECK の時に役割を確かめる・代表者の決定 2026-10-29）。
       1分の時計は証明を取った後に始める（待ち時間を減らさない） */
    var rb = { action: 'getRoster', token: tgt.token };
    var ga = (typeof SUGasAuth !== 'undefined') ? SUGasAuth : null;
    return (ga ? ga.addTo(rb) : Promise.resolve(rb)).then(function (b) {
      tm = setTimeout(function () { ctl.abort(); }, 60000);
      return fetch(tgt.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify(b), cache: 'no-store', redirect: 'follow', signal: ctl.signal });
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(tm);
        if (!j || j.error || !Array.isArray(j.roster)) throw new Error('Google が名簿を返しませんでした（接続先の合言葉を確かめてください）');
        return j.roster;
      }, function (e) { clearTimeout(tm); throw (e && e.name === 'AbortError') ? new Error('Google の応答がありません（時間切れ）') : new Error('Google に届きませんでした'); });
  }
  function careNoTable(err) {
    var c = String(err && err.code || '');
    return c === 'PGRST205' || c === 'PGRST202' || c === '42P01';
  }
  var CARE_LIST_MAX = 50;
  async function runCareCheck() {
    var kk = $('care-kpis'), v = $('care-verdict'), ul = $('care-list'), btn = $('b-care-check');
    kk.replaceChildren(); ul.replaceChildren();
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    var tgt = rmasterTarget();
    if (!tgt) { say('この端末には入居者マスタの接続先（Google）がありません。この端末で入居者マスタを開いてから、見比べ直してください。', 'warn'); return; }
    btn.disabled = true;
    say('見比べています…（Google から名簿を読んでいます）');
    try {
      var sb = SUAuth.client();
      var q = await Promise.all([rmasterRoster(tgt), sb.from('master_residents_care').select('source_id,visit_day,hospital')]);
      var c = q[1];
      if (c.error) {
        say(careNoTable(c.error) ? '訪問日・かかりつけ病院の写しはまだ読めません（データベースの準備 0022 が未適用の可能性）。'
          : '訪問日・かかりつけ病院の写しを読めませんでした（' + jaWhy('訪問日・かかりつけ病院の写し', c.error, true) + '）。', 'warn');
        return;
      }
      var d = careCompare(q[0], c.data || []);
      kk.appendChild(kpi('一致', d.same, '人'));
      kk.appendChild(kpi('違いあり', d.diff.length, '人'));
      kk.appendChild(kpi('写しに無い', d.notInCopy.length, '人'));
      kk.appendChild(kpi('正本に無い', d.notInSource.length, '人'));
      if (d.noField.length) kk.appendChild(kpi('正本に項目が無い', d.noField.length, '人'));
      var bad = d.diff.length + d.notInCopy.length + d.notInSource.length + d.noField.length;
      if (d.noField.length) say('Google の名簿に訪問日・かかりつけ病院がありません（入居者マスタの GAS が古いか、接続先の合言葉が現場用の可能性）。', 'warn');
      else if (bad) say('違いがあります。入居者マスタを開き直すと写しが最新になります。開き直しても残る違いは、下の利用者No を入居者マスタで確かめてください。', 'warn');
      else say('Google の名簿と写しの訪問日・かかりつけ病院は一致しています（' + d.same + '人）。', 'ok');
      var items = [];
      d.diff.forEach(function (x) { items.push([x.id, '違う項目: ' + x.fields.join('・')]); });
      d.notInCopy.forEach(function (id) { items.push([id, '写しにまだありません']); });
      d.notInSource.forEach(function (id) { items.push([id, '正本（Google の名簿）にいません']); });
      d.noField.forEach(function (id) { items.push([id, '正本の名簿に項目がありません']); });
      items.slice(0, CARE_LIST_MAX).forEach(function (it) {
        var li = el('li'), left = el('div');
        left.appendChild(el('div', 'nm', '利用者No ' + it[0]));
        left.appendChild(el('div', 'em', it[1]));
        li.appendChild(left);
        ul.appendChild(li);
      });
      if (items.length > CARE_LIST_MAX) ul.appendChild(el('li', null, 'ほか ' + (items.length - CARE_LIST_MAX) + '件'));
    } catch (e) {
      say('見比べられませんでした: ' + jaWhy('runCareCheck', e), 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  function renderRuns(runs) {
    var ul = $('runs');
    ul.replaceChildren();
    if (!runs.length) { ul.appendChild(el('li', 'muted', 'まだ記録がありません。事務所・管理者として入居者マスタを開くと記録されます。')); return; }
    runs.forEach(function (r) {
      var li = el('li');
      var left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(r.at) + (r.device_label ? '　' + r.device_label : '')));
      // 訪問日・かかりつけ病院を書けなかった人数（移行 0022 の care_failed・基本項目の failed とは別に数える）も同じ書き方で出す
      left.appendChild(el('div', 'em', '正本 ' + r.source_count + '人／新規 ' + r.inserted + '・更新 ' + r.updated +
        '・変化なし ' + r.unchanged + '・正本に無い ' + r.missing + (r.failed ? '・失敗 ' + r.failed : '') +
        (r.care_failed ? '・訪問日・病院 失敗 ' + r.care_failed : '')));
      li.appendChild(left);
      if (r.failed || r.care_failed) { var t = el('div', 'ops'); t.appendChild(el('span', 'tag', '要確認')); li.appendChild(t); }
      ul.appendChild(li);
    });
  }

  /* 並びに左右されない比べ方（オブジェクトのキーを並べ替えてから文字列にする）。
   * 2026-10-17: 同じ名前の canon が2つあり、関数の宣言は後の方が勝つため、前の方（キーを並べ替えたオブジェクトを返す版）は
   * 使われていなかった。実際に動いていた後の方（文字列を返す版）だけをここに残す＝動きは変わらない */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  function sameData(a, b) { return canon(a) === canon(b); }
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
    } else if (localRev === remote.rev && sameData(local, rd)) {
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
      : '週間計画とワークスケジュールを「写しの期間」に戻しますか？\n\n統合 GAS のスクリプト プロパティ KV_SWITCHED_FAMILIES から care・ws_master・wsday を外しましたか？（外さないと、Google へ戻した後の全端末の保存が断られます）';
    if (!(await window.SUDialog.confirm(q))) return;
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var r = await SUAuth.client().rpc('kv_set_family_mode', { p_families: CUT_FAMS, p_mode: mode });
    if (r.error || !r.data || !r.data.ok) {
      var why = String((r.error && (r.error.code || r.error.message)) || (r.data && r.data.error) || '');
      msg('変更できませんでした: ' + (/PGRST202|42883/.test(why) ? 'データベースの準備（0007）がまだです。' : jaWhy('週間計画とワークスケジュールの切り替え', why)));
      return;
    }
    msg(mode === 'live' ? '週間計画とワークスケジュールの保存先を Supabase（本番）にしました。明日の朝、全部のパソコンで3つの画面を開き直してください。'
                        : '週間計画とワークスケジュールを写しの期間に戻しました。', 'ok');
    await loadKv(SUAuth.client());
  }

  /* 管理者だけ: 勤務表の保存先の切り替え・戻し（統合 0009）。週間計画・ワークスケジュールとは別の夜に行う。
   * 切り替えは、この画面で点検して勤務表がそろっている時だけ（shiftReady）。
   * 戻す順番（2026-10-16 代表者の決定・ワークスケジュールの日ごとと同じ）:
   *   1.「勤務表を写しの期間に戻す」（Supabase が勤務表の保存を断る＝入力は端末に残る。スイッチは入ったままでよい）
   *   2.「勤務表を Google へ写し返す」（Supabase を正として、中身が違うキーだけ Google へ force で書く。全部そろうまで）
   *   3. 勤務表のスイッチ shift を切る PR を取り込む（端末が Google へ送る）。
   *   先にスイッチを切ると、端末が Google の古い中身を読み書きし、Supabase にだけある新しい入力を巻き戻すため、戻すのはスイッチを切る前。 */
  var shiftReady = false;
  function shiftSwitch() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.shift === true); }
  /* 切り替え・戻しを止める理由（押してよい時は ''）。mode＝押したボタン（live／shadow）・sw＝スイッチ shift が入か・ready＝点検がそろったか */
  function shiftModeBlock(mode, sw, ready) {
    if (mode === 'live' && !sw) return '勤務表の切り替えスイッチ（shift）がまだ「入」になっていません。先にスイッチを入れる PR を取り込み、1分ほど待ってから画面を開き直してください。';
    if (mode === 'live' && !ready) return '先に「切り替え前の点検をする」を押して、勤務表がそろっていることを確かめてください。';
    return '';   // 戻す（shadow）はいつでも（スイッチを切る前に行う）
  }
  async function setShiftMode(mode) {
    var why0 = shiftModeBlock(mode, shiftSwitch(), shiftReady);
    if (why0) { msg(why0, 'warn'); return; }
    var q = mode === 'live'
      ? '勤務表の保存先を Supabase（本番）に切り替えますか？\n\n編集中の端末は、いったん閲覧モードに戻ります（入力は端末に退避されます）。'
      : '勤務表を「写しの期間」に戻しますか？\n\n戻している間、勤務表の保存は各端末に残ります。続けて「勤務表を Google へ写し返す」を押し、全部そろってから勤務表のスイッチを切る PR を取り込んでください（スイッチを切るのは最後）。';
    if (!(await window.SUDialog.confirm(q))) return;
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var r = await SUAuth.client().rpc('kv_set_family_mode', { p_families: ['shift'], p_mode: mode });
    if (r.error || !r.data || !r.data.ok) {
      var why = String((r.error && (r.error.code || r.error.message)) || (r.data && r.data.error) || '');
      msg('変更できませんでした: ' + (why === 'notready' ? 'データベースの準備（0009）がまだです。' : /PGRST202|42883/.test(why) ? 'データベースの準備（0007）がまだです。' : jaWhy('勤務表の切り替え', why)));
      return;
    }
    msg(mode === 'live' ? '勤務表の保存先を Supabase（本番）にしました。明日の朝、勤務表を使う全部の端末で画面を開き直してください。'
                        : '勤務表を写しの期間に戻しました。続けて「勤務表を Google へ写し返す」を押してください（全部そろってから、勤務表のスイッチを切る PR を取り込みます）。', 'ok');
  }

  /* ── 勤務表を Google へ写し返す（戻し用・管理者だけ・2026-10-16 代表者の決定）──
   * 勤務表が写しの期間（shadow）の時だけ押せる（本番のままだと、写した後に Supabase 側だけが進む）。
   * Supabase の勤務表の全キー（shift_pull）と Google の中身（pull）を比べ、中身が違うキーだけを Google へ push（版0・force・券なし）。
   * Google の編集の権利（editlock・editlock-required）に止められたら、そこで止めて件数と案内を出す（成功扱いにしない）。
   * 本番の GAS は厳格モード（SHIFT_LOCK_REQUIRED=1）＝券の無い書き込みは止められる前提。 */
  var SHIFT_WB_RE = /^(staff|symbols|settings|freee|sched:\d{4}-\d{2}:[A-Za-z0-9_.:-]{1,80}|req:\d{4}-\d{2}|drafts:\d{4}-\d{2})$/;
  /* 写し返しを止める理由（押してよい時は ''）。mode＝勤務表の種類の状態・hasTarget＝Google の接続先があるか */
  function shiftWbBlock(mode, hasTarget) {
    if (!hasTarget) return 'この端末に Google の同期先（接続先と合言葉）がありません。週間計画かワークスケジュールを一度開いてから、もう一度押してください。';
    if (mode !== 'shadow') return '先に「勤務表を写しの期間に戻す」を押してください（本番のまま写すと、写した後に Supabase 側だけが進むことがあります）。';
    return '';
  }
  /* 写すキーの選び方。sbEnts＝Supabase の キー→{rev, data}、gasEnts＝Google の キー→{rev, data}。
   * 勤務表のキーで中身のあるものだけを見て、Google と中身が同じなら飛ばす。返すのは {write:[キー], same:件数}（キーは決まった順） */
  function shiftWbPlan(sbEnts, gasEnts) {
    var out = { write: [], same: 0 };
    Object.keys(sbEnts || {}).sort().forEach(function (k) {
      var s = sbEnts[k];
      if (!SHIFT_WB_RE.test(k) || !s || s.data == null || typeof s.data !== 'object') return;
      var g = gasEnts && gasEnts[k];
      if (g && g.data != null && sameData(g.data, s.data)) out.same++; else out.write.push(k);
    });
    return out;
  }
  /* Google の断りが編集の権利によるものか。'editlock-required'（厳格モード）／'editlock'（誰かが編集中）／''（それ以外） */
  function shiftWbRefusal(err) {
    var m = String(err && err.message || err || '');
    if (/Google が断りました（editlock-required）/.test(m)) return 'editlock-required';
    if (/Google が断りました（editlock）/.test(m)) return 'editlock';
    return '';
  }
  /* 編集の権利に止められた時の案内。n＝写せなかった件数（止められたキーと、その後の未着手のキー） */
  function shiftWbGuide(kind, n, wrote, same) {
    var head = 'Google の編集の権利に止められたため、' + n + '件を写せませんでした（写した ' + wrote + '件・同じ ' + same + '件）。';
    var how = kind === 'editlock-required'
      ? 'Google の勤務表が厳格モード（スクリプトプロパティ SHIFT_LOCK_REQUIRED=1 が本番の値）のため、券の無い書き込みを断っています。Google の厳格モードを一時的に外して（SHIFT_LOCK_REQUIRED を消す）から、もう一度押してください。写し終えたら 1 に戻してください。'
      : '勤務表を編集中の端末があります（Google の編集の権利が有効）。編集中の端末の勤務表を閉じてから（または編集の権利が切れる30分後に）、もう一度押してください。';
    return head + how + 'まだ勤務表のスイッチを切る PR は取り込まないでください。';
  }
  var SHB_MODE_LOST = '勤務表が写しの期間でなくなりました（本番に切り替えられた可能性があります）。写し返しを止めました。Supabase 側が進むため、Google がそろったとは言えません。勤務表のスイッチを切る PR は取り込まず、状態を確かめてから、もう一度「勤務表を写しの期間に戻す」から進めてください';
  function shbMsg(text, kind) { var e = $('shb-verdict'); e.className = 'msg' + (kind ? ' ' + kind : ''); e.textContent = text; }
  /* 写し返しの最中は、点検・足りない分を写す・勤務表を本番にする・戻す・厳格モードの入切も押させない（2026-10-16 差分審査 中2）。
   * 点検の終わり（busy(false)）や厳格モードの入切の終わりが、写し返しの最中にボタンを戻さないよう shbOn を見る */
  var shbOn = false;
  var SHB_LOCKS = ['b-shift-back', 'b-shadow-shift', 'b-live-shift', 'b-check', 'b-fill', 'b-lock-on', 'b-lock-off'];
  function shbBusy(on) { shbOn = !!on; SHB_LOCKS.forEach(function (id) { $(id).disabled = !!on; }); }
  /* 勤務表を本番から写しの期間へ戻している間か（＝写し返しの前・2026-10-16 差分審査 中2）。
   * famRow＝kv_families の勤務表の行（無ければ null）・sw＝勤務表のスイッチ shift が入か。
   * 行がある＝管理者が一度でも切り替え・戻しを押した。行が写しの期間で、スイッチがまだ入（手順3の前）なら戻している間とみなす。
   * この間は Supabase が正（Google は古いことがある）＝点検の「足りない分を写す」（Google を正とする kv_import）に勤務表を入れない。 */
  function shiftReturning(famRow, sw) { return !!(famRow && famRow.mode === 'shadow' && sw === true); }
  async function shiftFamMode(sb) {
    var r = await sb.from('kv_families').select('family,mode').eq('family', 'shift');
    if (r.error) throw new Error(String(r.error.message || r.error.code));
    return (r.data && r.data[0] && r.data[0].mode) || 'shadow';
  }
  async function writeBackShift() {
    var tgt = gasTarget(), sb = SUAuth.client();
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { shbMsg('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    if (!tgt) { shbMsg(shiftWbBlock('shadow', false), 'warn'); return; }
    shbBusy(true);
    var done = 0, wrote = 0, failed = [], todo = [], same = 0;
    try {
      var why0 = shiftWbBlock(await shiftFamMode(sb), true);
      if (why0) { shbMsg(why0, 'warn'); return; }
      shbMsg('比べています…（Supabase の勤務表を読んでいます）', 'warn');
      var sbEnts = await sbShiftPull(sb, null);
      var keys = Object.keys(sbEnts).filter(function (k) { return SHIFT_WB_RE.test(k); }).sort();
      var gasEnts = await gasPullAll(tgt, keys, function (n) {
        shbMsg('比べています…（Google の応答が遅いため、やり直しています ' + n + '回目）', 'warn');
      });
      var p = shiftWbPlan(sbEnts, gasEnts);
      todo = p.write; same = p.same;
      if (!todo.length) { shbMsg('全部そろっています（勤務表 ' + keys.length + '件とも Google と同じ中身）。勤務表のスイッチを切る PR を取り込んでかまいません。', 'ok'); return; }
      shbMsg('Google と中身が違う勤務表が ' + todo.length + '件あります（同じ ' + same + '件）。例: ' + todo.slice(0, 6).join('、'), 'warn');
      if (!(await window.SUDialog.confirm('勤務表の ' + todo.length + '件を、Supabase の中身で Google へ上書きします（中身が同じ ' + same + '件は飛ばします）。\n\nよろしいですか？'))) return;
      // 確認の間に本番へ切り替えられていないか、もう一度確かめる（2026-10-16 差分審査 低6）
      if (await shiftFamMode(sb) !== 'shadow') { shbMsg(SHB_MODE_LOST + '（まだ1件も写していません）', 'ng'); return; }
      for (var i = 0; i < todo.length; i++) {
        var k = todo[i];
        try {
          await gasPostRetry(tgt, { action: 'push', key: k, baseRev: 0, data: sbEnts[k].data, force: true }, 120000);
          wrote++;
        } catch (e) {
          var kind = shiftWbRefusal(e);
          if (kind) { shbMsg(shiftWbGuide(kind, todo.length - wrote - failed.length, wrote, same), 'ng'); return; }
          failed.push(k);
        }
        done++;
        shbMsg('写しています… ' + done + '／' + todo.length + '（写した ' + wrote + '件）', 'warn');
      }
      // 写している間に本番へ切り替えられていたら、そろったとは言えない（2026-10-16 差分審査 低6）
      if (await shiftFamMode(sb) !== 'shadow') { shbMsg(SHB_MODE_LOST + '（写した ' + wrote + '件・同じ ' + same + '件）', 'ng'); return; }
      if (failed.length) shbMsg('途中まで写しました（同じ ' + same + '件・写した ' + wrote + '件・写せなかった ' + failed.length + '件　例: ' + failed.slice(0, 4).join('、') + '）。もう一度押すと、まだ違う勤務表だけを写します。', 'warn');
      else shbMsg('全部そろいました（同じ ' + same + '件・写した ' + wrote + '件）。勤務表のスイッチを切る PR を取り込んでかまいません。', 'ok');
    } catch (e) {
      shbMsg('途中で止まりました（' + done + '／' + todo.length + '件まで）: ' + jaWhy('writeBackShift', e, true) + '。もう一度押すと、まだ違う勤務表だけを写します。', 'warn');
    } finally { shbBusy(false); }
  }

  /* ── Supabase 側の厳格モード（shift_settings.lock_required・2026-10-16 代表者の決定）──
   * 今の値を読む関数が無いため、操作記録（audit_log・管理者だけ読める）の entity='shift_settings' の最新行から出す。
   * 記録が無ければ既定（通常モード）。SQL エディタで表を直接変えた分は記録に残らないので、画面にその旨を添える。 */
  /* 操作記録の行（新しい順）→ true（厳格）／false（通常）／null（記録なし＝既定） */
  function lockStateFromAudit(rows) {
    for (var i = 0; i < (rows || []).length; i++) {
      var f = rows[i] && Array.isArray(rows[i].fields) ? rows[i].fields : [];
      for (var j = 0; j < f.length; j++) {
        if (f[j] === 'lock_required:true') return true;
        if (f[j] === 'lock_required:false') return false;
      }
    }
    return null;
  }
  function lockLabel(v) { return v === true ? '入（厳格モード）' : v === false ? '切（通常モード）' : '既定（通常モード）'; }
  function showLock(v, at) {
    var e = $('lk-state');
    e.className = 'msg ' + (v === true ? 'ok' : 'warn');
    e.textContent = 'Supabase 側の厳格モード（編集の権利が無い保存を断る）: ' + lockLabel(v) + (at ? '　' + fmtTime(at) + ' の操作' : '');
  }
  async function loadLock(sb) {
    var r = await sb.from('audit_log').select('at,fields').eq('entity', 'shift_settings').order('at', { ascending: false }).limit(10);
    if (r.error) throw new Error(String(r.error.message || r.error.code));
    var rows = r.data || [], v = lockStateFromAudit(rows), at = '';
    for (var i = 0; i < rows.length && v !== null; i++) { if ((rows[i].fields || []).indexOf('lock_required:' + v) >= 0) { at = rows[i].at; break; } }
    showLock(v, at);
  }
  async function setLock(on) {
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { msg('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var q = on
      ? 'Supabase 側の勤務表を厳格モードにしますか？\n\n編集の権利（券）を持たない端末の保存を、すべて断るようになります。'
      : 'Supabase 側の勤務表の厳格モードを外しますか？\n\n誰も編集中でない間は、編集の権利（券）を持たない端末の保存も通るようになります。';
    if (!(await window.SUDialog.confirm(q))) return;
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    $('b-lock-on').disabled = true; $('b-lock-off').disabled = true;
    try {
      var r = await SUAuth.client().rpc('shift_set_lock_required', { p_on: !!on });
      if (r.error || !r.data || !r.data.ok) {
        var why = String((r.error && (r.error.code || r.error.message)) || (r.data && r.data.error) || '');
        msg('変更できませんでした: ' + (/PGRST202|42883/.test(why) ? 'データベースの準備（0009）がまだです。' : why === '42501' ? '管理者だけが変えられます。' : jaWhy('勤務表の厳格モード', why)));
        return;
      }
      showLock(r.data.lockRequired === true, new Date().toISOString());
      msg(r.data.lockRequired === true ? 'Supabase 側の勤務表を厳格モードにしました。' : 'Supabase 側の勤務表の厳格モードを外しました。', 'ok');
    } finally { $('b-lock-on').disabled = shbOn; $('b-lock-off').disabled = shbOn; }
  }

  /* ── ワークスケジュールの日ごとだけを Google に戻す（2026-10-11 代表者の決定・現場のアカウントが日ごとを書けないため）──
   * ★順番: 手順1 日ごとを止める（kv_set_family_mode wsday→shadow。Supabase が日ごとの保存を断る＝入力は端末に残る）
   *        手順2 Google へ写し返す（Supabase の最新と Google の中身を比べ、違う日だけ Google へ force で書く）
   *        手順3 日ごとのスイッチ wsday を false にする PR（端末が Google へ送る）。
   *   Supabase→Google の写し返しは保存の20秒後に画面の中で行うだけなので、取りこぼした日があり得る。写し返す前に
   *   スイッチを切ると、端末の統合が Google の古い中身を「他端末の変更」として取り込み、新しい入力を巻き戻す。
   *   止めてから写し返すので、写し返した後に Supabase 側だけが進むことは無い。 */
  function wbMsg(text, kind) { var e = $('wb-verdict'); e.className = 'msg' + (kind ? ' ' + kind : ''); e.textContent = text; }
  function wbBusy(on) { $('b-wsday-stop').disabled = on; $('b-wsday-back').disabled = on; }
  async function wsdayMode(sb) {
    var r = await sb.from('kv_families').select('family,mode').eq('family', 'wsday');
    if (r.error) throw new Error(String(r.error.message || r.error.code));
    return (r.data && r.data[0] && r.data[0].mode) || 'shadow';
  }
  async function stopWsday() {
    if (!(await window.SUDialog.confirm('ワークスケジュールの日ごとの保存先（Supabase）を止めますか？\n\n止めている間、日ごとの保存は各端末に残り、日ごとのスイッチを切った後に Google へ届きます。\n\nスイッチを切る前に、統合 GAS のスクリプト プロパティ KV_SWITCHED_FAMILIES から wsday を外してください（外さないと日ごとの保存が全部断られます）。'))) return;
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    wbBusy(true);
    try {
      var r = await SUAuth.client().rpc('kv_set_family_mode', { p_families: ['wsday'], p_mode: 'shadow' });
      if (r.error || !r.data || !r.data.ok) {
        var why = String((r.error && (r.error.code || r.error.message)) || (r.data && r.data.error) || '');
        wbMsg('止められませんでした: ' + jaWhy('日ごとを止める', why), 'ng');
        return;
      }
      wbMsg('日ごとを止めました。続けて「手順2 日ごとを Google へ写し返す」を押してください。', 'ok');
    } finally { wbBusy(false); }
  }
  async function writeBackWsday() {
    var tgt = gasTarget(), sb = SUAuth.client();
    if (!tgt) { wbMsg('この端末に Google の同期先（接続先と合言葉）がありません。週間計画かワークスケジュールを一度開いてから、もう一度押してください。', 'warn'); return; }
    wbBusy(true);
    var done = 0, same = 0, wrote = 0, failed = [], keys = [];
    try {
      if (await wsdayMode(sb) !== 'shadow') { wbMsg('先に「手順1 日ごとを止める」を押してください（止めずに写すと、写した後に Supabase 側だけが進むことがあります）。', 'warn'); return; }
      var idx = await sb.rpc('kv_index', { p_family: 'wsday' });
      if (idx.error) throw new Error(String(idx.error.message || idx.error.code));
      keys = Object.keys((idx.data && idx.data.revs) || {}).sort();
      wbMsg('比べています… 0／' + keys.length, 'warn');
      for (var i = 0; i < keys.length; i += FILL_BATCH) {
        var part = keys.slice(i, i + FILL_BATCH);
        var j = await gasPostRetry(tgt, { action: 'pull', keys: part }, 120000, function (n) {
          wbMsg('比べています… ' + done + '／' + keys.length + '（Google の応答が遅いため、やり直しています ' + n + '回目）', 'warn');
        });
        var ents = j.entries || {};
        for (var n = 0; n < part.length; n++) {
          var k = part[n];
          var r = await sb.rpc('kv_get', { p_key: k });
          var sd = r.data && r.data.data;
          if (r.error || sd == null || typeof sd !== 'object') { failed.push(k); done++; continue; }
          var g = ents[k];
          if (g && g.data != null && sameData(g.data, sd)) { same++; done++; continue; }
          try {
            // mirror の印＝写し返し。統合 GAS が切り替え済みの種類への書き込みを断っていても、写し返しは通す（2026-10-17）
            await gasPostRetry(tgt, { action: 'put', key: k, rev: 0, data: sd, force: true, mirror: true }, 120000);
            wrote++;
          } catch (e) { failed.push(k); }
          done++;
        }
        wbMsg('比べています… ' + done + '／' + keys.length + '（写した ' + wrote + '件）', 'warn');
      }
      if (failed.length) wbMsg('途中まで写しました（同じ ' + same + '件・写した ' + wrote + '件・写せなかった ' + failed.length + '件　例: ' + failed.slice(0, 4).join('、') + '）。もう一度押すと、まだ違う日だけを写します。', 'warn');
      else wbMsg('全部そろいました（' + keys.length + '日のうち、同じ ' + same + '件・写した ' + wrote + '件）。日ごとのスイッチを切る PR を取り込んでかまいません。', 'ok');
    } catch (e) {
      wbMsg('途中で止まりました（' + done + '／' + keys.length + '件まで）: ' + jaWhy('writeBackWsday', e, true) + '。もう一度押すと、まだ違う日だけを写します。', 'warn');
    } finally { wbBusy(false); }
  }

  /* ── 本番の中身を Google と比べる（2026-10-16 代表者の依頼「Google 側の版の遅れを調べて」）──
   * 本番（live）になった週間計画・週の型・日ごとは、保存の20秒後に最新の中身を Google へ写し返す（su-kv.js scheduleMirror・force）。
   * Google の版の番号は Google 側で独自に進み、20秒の間の保存は1回の写し返しにまとまる＝版の番号の差は遅れの証拠にならない。
   * そこで中身そのものを比べ、Google が古い・無いキーを数える。読むだけ（どちらにも書かない）。
   * 写し返しは画面の中の20秒の待ちなので、保存してすぐ閉じると届かない（次の保存まで Google は古いまま）。
   * 勤務表は対象外: Google は厳格モードで写し返しを断るため、切り替えの時点で止まる（想定どおり）。
   * 日ごとは、Google を読む画面（俯瞰など）が使う範囲として、今日の30日前〜60日先だけを比べる。 */
  var MC_FAMS = [['care', '週間計画'], ['ws_master', 'ワークスケジュール（週の型）'], ['wsday', 'ワークスケジュール（日ごと）']];
  var MC_BACK = 30, MC_AHEAD = 60;
  function mcDayKeys(keys, today) {
    var t = Date.parse(today + 'T00:00:00Z'), lo = t - MC_BACK * 864e5, hi = t + MC_AHEAD * 864e5;
    return keys.filter(function (k) {
      var m = /^wsday_(\d{4}-\d{2}-\d{2})$/.exec(k); if (!m) return false;
      var d = Date.parse(m[1] + 'T00:00:00Z'); return d >= lo && d <= hi;
    }).sort();
  }
  /* sbData＝Supabase の キー→中身・gasEnts＝Google の キー→{rev, data}。返すのは {same, stale:[キー], missing:[キー], unread:[キー]} */
  function mcCompare(keys, sbData, gasEnts) {
    var out = { same: 0, stale: [], missing: [], unread: [] };
    keys.forEach(function (k) {
      var s = sbData[k];
      if (s == null || typeof s !== 'object') { out.unread.push(k); return; }
      var g = gasEnts[k];
      if (!g || g.data == null) out.missing.push(k);
      else if (sameData(g.data, s)) out.same++;
      else out.stale.push(k);
    });
    return out;
  }
  function mcToday() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var mcOn = false, mcFix = [];
  function mcShowFix() {
    var b = $('b-mirror-fix');
    b.hidden = !mcFix.length;
    if (mcFix.length) b.textContent = '違う分を Google へ写す（' + mcFix.length + '件）';
  }
  async function runMirrorCheck() {
    if (mcOn) return;
    var verdict = $('mc-verdict'), list = $('mc-list'), kpis = $('mc-kpis');
    kpis.replaceChildren(); list.replaceChildren(); mcFix = []; mcShowFix();
    function say(t, kind) { verdict.className = 'msg ' + (kind || 'warn'); verdict.textContent = t; }
    var tgt = gasTarget(), sb = SUAuth.client();
    if (!tgt) { say('この端末には週間計画・ワークスケジュールの接続先（Google）がありません。この端末で週間計画かワークスケジュールを一度開いてから、もう一度押してください。'); return; }
    mcOn = true; $('b-mirror-check').disabled = true;
    try {
      say('比べています… 本番になっている種類を確かめています');
      var fm = await sb.from('kv_families').select('family,mode');
      if (fm.error) throw new Error(String(fm.error.message || fm.error.code));
      var live = {};
      (fm.data || []).forEach(function (r) { if (r.mode === 'live') live[r.family] = true; });
      var total = 0, badAll = 0, unreadAll = 0;
      for (var i = 0; i < MC_FAMS.length; i++) {
        var f = MC_FAMS[i], keys;
        if (!live[f[0]]) { list.appendChild(preItem(f[1], 'まだ本番ではありません（写しの期間）。上の「切り替え前の点検」で見比べます。', false)); continue; }
        if (f[0] === 'care') keys = ['care_schedule_v2'];
        else if (f[0] === 'ws_master') keys = ['ws_weekly_master_v1'];
        else {
          var ix = await sb.rpc('kv_index', { p_family: 'wsday' });
          if (ix.error) throw new Error(String(ix.error.message || ix.error.code));
          keys = mcDayKeys(Object.keys((ix.data && ix.data.revs) || {}), mcToday());
        }
        say('比べています… ' + f[1] + '（' + keys.length + '件）');
        var gasEnts = await gasPullAll(tgt, keys, function (n) { say('比べています… ' + f[1] + '（Google の応答が遅いため、やり直しています ' + n + '回目）'); });
        var sbData = {};
        for (var j = 0; j < keys.length; j++) {
          var r = await sb.rpc('kv_get', { p_key: keys[j] });
          if (!r.error && r.data) sbData[keys[j]] = r.data.data;
        }
        var c = mcCompare(keys, sbData, gasEnts), bad = c.stale.length + c.missing.length;
        total += keys.length; badAll += bad; unreadAll += c.unread.length;
        mcFix = mcFix.concat(c.stale, c.missing);
        kpis.appendChild(kpi(f[1], c.same + '／' + keys.length, '同じ'));
        var note = bad
          ? 'Google が古い ' + c.stale.length + '件' + (c.missing.length ? '・Google に無い ' + c.missing.length + '件' : '') + '　例: ' + c.stale.concat(c.missing).slice(0, 6).join('、')
          : 'Google と中身が全部同じです' + (f[0] === 'wsday' ? '（今日の' + MC_BACK + '日前〜' + MC_AHEAD + '日先）' : '');
        if (c.unread.length) note += '（Supabase から読めなかった ' + c.unread.length + '件）';
        list.appendChild(preItem(f[1], note, bad > 0 || c.unread.length > 0));
      }
      if (!total) say('本番になっている種類がありません。', 'warn');
      else if (badAll) say('Google が古い・無いものが ' + badAll + '件あります。Google を読む画面（週間計画の俯瞰・支援の俯瞰・デイ利用日・フェイスシート・訓練計画）に古い中身が出ているおそれがあります。', 'warn');
      else if (unreadAll) say('比べられた分は全部同じですが、Supabase から読めなかったものが ' + unreadAll + '件あります。もう一度押してください。', 'warn');
      else say('本番の中身は、Google にも全部届いています（写し返しは遅れていません）。', 'ok');
    } catch (e) {
      say('比べられませんでした: ' + jaWhy('runMirrorCheck', e), 'ng');
    } finally { mcOn = false; $('b-mirror-check').disabled = false; mcShowFix(); }
  }
  /* 違う分を Google へ写す（2026-10-16 代表者の決定）。本番の間は Supabase が正しい中身＝Google をそれに合わせて force で上書きするだけ
   * （保存の20秒後の写し返し su-kv.js scheduleMirror と同じ動き）。写す直前に、その種類がまだ本番かを確かめ直す
   * （写しの期間へ戻した後に写すと、Google が正の間に古い中身を書くことになる）。写し終えたら比べ直す。管理者（二段階認証済み）だけ
   * 2026-10-17（改善プロンプト第2弾の8・代表者の決定）: mirror の印を付ける（統合 GAS の切り替え済みの断りを通る）。
   *   統合 GAS は印のある週間計画の「最後に直した人」を書き換えず、Supabase の中身（直した人は確かめ済み）のまま残す
   *   （反証レビュー: 押した管理者の証明で確かめると、直していない入居者まで管理者の名前になり、見比べも一致に戻らなかった） */
  async function runMirrorFix() {
    if (mcOn || !mcFix.length) return;
    var verdict = $('mc-verdict');
    function say(t, kind) { verdict.className = 'msg ' + (kind || 'warn'); verdict.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。'); return; }
    var tgt = gasTarget(), sb = SUAuth.client();
    if (!tgt) { say('この端末には Google の接続先がありません。'); return; }
    var keys = mcFix.slice();
    if (!(await window.SUDialog.confirm('Google の古い ' + keys.length + '件を、Supabase（本番）の中身で上書きしますか？\n\nGoogle を読む画面（俯瞰など）の表示が新しくなります。本番の中身（Supabase）は変わりません。'))) return;
    mcOn = true; $('b-mirror-check').disabled = true; $('b-mirror-fix').disabled = true;
    var wrote = 0, failed = [];
    try {
      var fm = await sb.from('kv_families').select('family,mode');
      if (fm.error) throw new Error(String(fm.error.message || fm.error.code));
      var live = {};
      (fm.data || []).forEach(function (r) { if (r.mode === 'live') live[r.family] = true; });
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        say('写しています… ' + i + '／' + keys.length);
        if (!live[famOf(k)]) { failed.push(k + '（本番ではない）'); continue; }
        var r = await sb.rpc('kv_get', { p_key: k });
        var sd = r.data && r.data.data;
        if (r.error || sd == null || typeof sd !== 'object') { failed.push(k); continue; }
        try {
          var g = await gasPostRetry(tgt, { action: 'put', key: k, rev: 0, data: sd, force: true, mirror: true }, 120000);
          if (g && g.ok) wrote++; else failed.push(k);
        } catch (e) { failed.push(k); }
      }
    } catch (e) {
      say('写せませんでした: ' + jaWhy('runMirrorFix', e), 'ng');
      mcOn = false; $('b-mirror-check').disabled = false; $('b-mirror-fix').disabled = false;
      return;
    }
    mcOn = false; $('b-mirror-check').disabled = false; $('b-mirror-fix').disabled = false;
    await runMirrorCheck();
    var head = '写した ' + wrote + '件' + (failed.length ? '・写せなかった ' + failed.length + '件（例: ' + failed.slice(0, 4).join('、') + '）' : '') + '。比べ直しました: ';
    verdict.textContent = head + verdict.textContent;
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
  // 勤務表の作りかけの案（sched:YYYY-MM:draft:*）は名前が決まっていないので、ここでは数えない。
  // 代わりに drafts:YYYY-MM の一覧に載っている案 id ごとに、版と中身を別に比べる（checkDrafts・2026-10-16）。
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
  var SHIFT_RETURNING_NOTE = '勤務表は本番から写しの期間へ戻している間です。戻している間は Supabase が正のため、勤務表は「足りない分を写す」（Google から写し直す）の対象に入れていません。先に「勤務表を Google へ写し返す」を押してください（全部そろってから、勤務表のスイッチを切る PR を取り込みます）。';

  /* ── 作りかけの案の中身の点検（2026-10-16 代表者の決定）──
   * drafts:YYYY-MM（案の一覧）に載っている id ごとに sched:YYYY-MM:draft:<id> の Google の版・中身と写しの版・中身を比べる。
   * 一覧は Google と写しの両方から集める（片方にだけ載っている案も見落とさない）。画面に出すのはキー名と版と件数だけ。 */
  var DRAFTS_RE = /^drafts:(\d{4}-\d{2})$/;
  var DRAFT_ID_RE = /^[A-Za-z0-9_.-]{1,60}$/;
  /* 案の一覧（キー→中身）から、案の本体のキーを並べる（id の形が違うものは数えない） */
  function draftKeysOf(lists) {
    var out = {};
    Object.keys(lists || {}).forEach(function (lk) {
      var m = DRAFTS_RE.exec(lk), list = lists[lk];
      if (!m || !Array.isArray(list)) return;
      list.forEach(function (d) {
        var id = d && d.id != null ? String(d.id) : '';
        if (DRAFT_ID_RE.test(id)) out['sched:' + m[1] + ':draft:' + id] = true;
      });
    });
    return Object.keys(out).sort();
  }
  /* 1つの案の見比べ。g＝Google の {rev, data}（無ければ null）、s＝写しの {rev, data}（無ければ null）。
   * 返す値: same（一致）／missing（写しに無い）／gasonly（Google に無い）／older（写しの版が古い）／newer（写しの版が新しい）／
   *         content（版は同じで中身が違う）。missing・older・content は「足りない分を写す」で直せる（kv_import は同じ版でも中身が違えば書く） */
  function draftCompare(g, s) {
    var gr = g && Number(g.rev) > 0 && g.data != null ? Number(g.rev) : 0;
    var sr = s && Number(s.rev) > 0 && s.data != null ? Number(s.rev) : 0;
    if (!gr && !sr) return 'same';
    if (!sr) return 'missing';
    if (!gr) return 'gasonly';
    if (sr < gr) return 'older';
    if (sr > gr) return 'newer';
    return sameData(g.data, s.data) ? 'same' : 'content';
  }
  /* Google の pull を少しずつ（FILL_BATCH 件ずつ）。返すのは キー→{rev, data} */
  async function gasPullAll(tgt, keys, onRetry) {
    var out = {};
    for (var i = 0; i < keys.length; i += FILL_BATCH) {
      var part = keys.slice(i, i + FILL_BATCH);
      var j = await gasPostRetry(tgt, { action: 'pull', keys: part }, 120000, onRetry);
      var ents = j.entries || {};
      part.forEach(function (k) { if (ents[k]) out[k] = { rev: Number(ents[k].rev) || 0, data: ents[k].data }; });
    }
    return out;
  }
  /* 写し（Supabase）の中身。shift_pull は写しの期間でも読める。返すのは キー→{rev, data} */
  async function sbShiftPull(sb, keys) {
    if (keys && !keys.length) return {};   // null は勤務表の全キー
    var r = await sb.rpc('shift_pull', { p_keys: keys });
    if (r.error) throw new Error(/PGRST202|42883/.test(String(r.error.code || r.error.message)) ? 'データベースの準備（0009）がまだです。' : String(r.error.message || r.error.code));
    var ents = (r.data && r.data.entries) || {}, out = {};
    Object.keys(ents).forEach(function (k) { out[k] = { rev: Number(ents[k].rev) || 0, data: ents[k].data }; });
    return out;
  }
  /* listKeys＝点検した範囲の drafts:YYYY-MM（Google か写しのどちらかにあるもの）。返すのは {total, same, bad:[{key, why}], fix:[キー]} */
  async function checkDrafts(tgt, sb, listKeys, onRetry) {
    var res = { total: 0, same: 0, bad: [], fix: [] };
    if (!listKeys.length) return res;
    var gl = await gasPullAll(tgt, listKeys, onRetry), sl = await sbShiftPull(sb, listKeys), lists = {};
    // 一覧は Google と写しの両方の id を合わせる
    listKeys.forEach(function (lk) {
      var a = gl[lk] && Array.isArray(gl[lk].data) ? gl[lk].data : [], b = sl[lk] && Array.isArray(sl[lk].data) ? sl[lk].data : [];
      lists[lk] = a.concat(b);
    });
    var keys = draftKeysOf(lists);
    res.total = keys.length;
    if (!keys.length) return res;
    var gd = await gasPullAll(tgt, keys, onRetry), sd = await sbShiftPull(sb, keys);
    keys.forEach(function (k) {
      var why = draftCompare(gd[k] || null, sd[k] || null);
      if (why === 'same') { res.same++; return; }
      res.bad.push({ key: k, why: why, g: gd[k] ? gd[k].rev : 0, s: sd[k] ? sd[k].rev : 0 });
      if (why === 'missing' || why === 'older' || why === 'content') res.fix.push(k);
    });
    return res;
  }
  var DRAFT_WHY = { missing: '写しに無い', gasonly: 'Google に無い', older: '写しの版が古い', newer: '写しの版が新しい', content: '版は同じで中身が違う' };

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
    $('b-check').disabled = on || shbOn; $('b-fill').disabled = on || shbOn;
    if (text != null) { $('pre-verdict').className = 'msg warn'; $('pre-verdict').textContent = text; }
  }

  async function runCheck() {
    var kpis = $('pre-kpis'), list = $('pre-list'), verdict = $('pre-verdict');
    kpis.replaceChildren(); list.replaceChildren(); $('b-fill').hidden = true; plan = [];
    shiftReady = false;   /* 点検の途中で失敗した時に、前回の「勤務表はそろっている」を残さない（2026-10-16） */
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
        checkHooks(),
        sb.from('kv_families').select('family,mode').eq('family', 'shift')
      ]);
      var gasRevs = res[0].revs, asked = res[0].asked, idx = res[1], hooks = res[2];
      if (res[3].error) throw new Error(String(res[3].error.message || res[3].error.code));
      var returning = shiftReturning((res[3].data || [])[0] || null, shiftSwitch());
      var idxErr = idx.filter(function (r) { return r.error; })[0];
      /* データベースの準備がまだの時は、今までどおりの文をここで出して終える（下の「点検できませんでした。」の一文にまとめないため・2026-11-13） */
      if (idxErr && /PGRST202|42883/.test(String(idxErr.error.code || idxErr.error.message))) {
        verdict.className = 'msg ng';
        verdict.textContent = '点検できませんでした: データベースの準備（0007）がまだです。';
        return;
      }
      if (idxErr) throw new Error(String(idxErr.error.message || idxErr.error.code));
      var ready = true, reasons = [], shiftBad = 0;
      FAMS.forEach(function (f, i) {
        var copy = (idx[i].data && idx[i].data.revs) || {};
        var same = 0, missing = [], diff = [], extra = 0;
        var noFill = f[0] === 'shift' && returning;   // 戻している間の勤務表は Google から写し直さない
        Object.keys(gasRevs).forEach(function (k) {
          if (famOf(k) !== f[0]) return;
          var g = gasRevs[k];
          if (!Object.prototype.hasOwnProperty.call(copy, k)) { missing.push(k); if (!noFill) plan.push(k); }
          else if (Number(copy[k]) === g) same++;
          else { diff.push(k + '（Google ' + g + '／写し ' + copy[k] + '）'); if (Number(copy[k]) < g && !noFill) plan.push(k); }
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
      // 作りかけの案の中身（2026-10-16）。違う案は勤務表の「そろっていない」に数え、直せるものは「足りない分を写す」に入れる
      var shCopy = (idx[FAMS.map(function (f) { return f[0]; }).indexOf('shift')].data || {}).revs || {};
      var dListKeys = Object.keys(asked).filter(function (k) {
        return DRAFTS_RE.test(k) && (Object.prototype.hasOwnProperty.call(gasRevs, k) || Object.prototype.hasOwnProperty.call(shCopy, k));
      }).sort();
      busy(true, '確かめています… 勤務表の作りかけの案');
      var dr = await checkDrafts(tgt, sb, dListKeys, function (n) {
        busy(true, '確かめています… 勤務表の作りかけの案（Google の応答が遅いため、やり直しています ' + n + '回目）');
      });
      kpis.appendChild(kpi('勤務表の作りかけの案', dr.same + '／' + dr.total, '一致'));
      if (!returning) dr.fix.forEach(function (k) { if (plan.indexOf(k) < 0) plan.push(k); });
      if (returning) list.appendChild(preItem('勤務表（本番から写しの期間へ戻している間）', SHIFT_RETURNING_NOTE, true));
      shiftBad += dr.bad.length;
      if (dr.bad.length) {
        var cnt = {};
        dr.bad.forEach(function (b) { cnt[b.why] = (cnt[b.why] || 0) + 1; });
        list.appendChild(preItem('勤務表（作りかけの案）（切り替えは別の夜・写しの確認）',
          Object.keys(cnt).map(function (w) { return DRAFT_WHY[w] + ' ' + cnt[w] + '件'; }).join('・') + '　例: ' +
          dr.bad.slice(0, 6).map(function (b) { return b.key + '（Google ' + b.g + '／写し ' + b.s + '）'; }).join('、'), true));
      }
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
      if (returning) $('sh-verdict').textContent += SHIFT_RETURNING_NOTE;
      $('b-fill').hidden = plan.length === 0;
      if (plan.length) $('b-fill').textContent = '足りない分を写す（' + plan.length + '件）';
      verdict.className = 'msg ' + (ready ? 'ok' : 'warn');
      verdict.textContent = ready
        ? '週間計画とワークスケジュールは、Google と写しが全部そろっています。画面の部品も入っています（切り替えてよい状態です）。'
        : 'まだ切り替えられません: ' + reasons.join('／') + '。' + (plan.length ? '「足りない分を写す」を押すと、Google から写しを取り直します。' : '');
    } catch (e) {
      verdict.className = 'msg ng';
      /* 元の文（英語のことがある）は画面に出さず記録に残す。画面の文は仮置き（2026-11-13） */
      try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: 切り替え前の点検', String(e && e.message || e)); } catch (x) { /* 記録できなくても止めない */ }
      /* Google の時間切れ（gasPost が作る日本語の文）だけは、切り替えの夜に原因が分かるよう今までどおりの文を出す（2026-11-13・仮置き）。
         ほかの失敗（Google の断り・応答の番号・通信の失敗など）は一文にまとめる */
      var timedOut = String(e && e.message || '') === 'Google の応答がありません（時間切れ）';
      verdict.textContent = timedOut ? '点検できませんでした: Google の応答がありません（時間切れ）'
        : '点検できませんでした。通信の状態を確かめて、もう一度押してください。';
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
      msg('途中で止まりました（' + done + '／' + keys.length + '件まで）: ' + jaWhy('fillMissing', e, true) + '。もう一度押すと続きから写します。', 'warn');
    }
    busy(false);
    await runCheck();
  }

  /* 写しを取った記録（最新20件）。訪問日・病院を書けなかった人数（care_failed・移行 0022）も読む。
     0022 を流す前のデータベースでは列が無く読み取り全体が断られるので、その時だけ care_failed を外して読み直す
     （写しの部品 su-master-shadow.js の「列が無い時は外して残し直す」と同じ考え方） */
  var RUN_COLS = 'at,device_label,source_count,inserted,updated,unchanged,missing,failed';
  function noCareFailedColumn(err) {
    var c = String(err && err.code || ''), m = String(err && err.message || '');
    return /care_failed/.test(m) && (c === '42703' || c === 'PGRST204' || /does not exist|could not find/i.test(m));
  }
  async function readRuns(sb) {
    var b = await sb.from('master_sync_runs').select(RUN_COLS + ',care_failed').order('at', { ascending: false }).limit(20);
    if (b.error && noCareFailedColumn(b.error)) b = await sb.from('master_sync_runs').select(RUN_COLS).order('at', { ascending: false }).limit(20);
    return b;
  }

  async function load() {
    var sb = SUAuth.client();
    var cols = 'source_id,' + SUMasterShadow.FIELDS.join(',');
    var a = await sb.from('master_residents').select(cols).order('room', { ascending: true });
    if (a.error) throw a.error;
    var b = await readRuns(sb);
    if (b.error) throw b.error;
    renderCompare(a.data || []);
    renderRuns(b.data || []);
    $('kv-admin').hidden = !(me && me.role === 'admin');
    if (me && me.role === 'admin') {
      try { await loadLock(sb); }
      catch (e) {
        /* 元の文は記録に残し、画面には職員に分かる一文だけを出す（仮置き・2026-11-13） */
        try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: 厳格モードの状態の読み込み', String(e && e.message || e)); } catch (x) { /* 記録できなくても止めない */ }
        $('lk-state').className = 'msg warn'; $('lk-state').textContent = 'Supabase 側の厳格モードの状態を読めませんでした。「見比べ直す」を押してください。';
      }
    }
    try { await loadWeight(sb); }
    catch (e) {
      $('wt-verdict').className = 'msg warn';
      $('wt-verdict').textContent = '体重の写しはまだ読めません（データベースの準備 0008 が未適用の可能性）。';
    }
    try { await loadResFullRuns(sb); }
    catch (e) { $('rf-verdict').className = 'msg warn'; $('rf-verdict').textContent = '全項目の写しの記録を読めませんでした。'; }
    try { await loadResMode(sb); } catch (e) { /* 0036 の前・読めない時はボタンを出さない */ }
    try { await loadTpRuns(sb); } catch (e) { $('tpf-verdict').className = 'msg warn'; $('tpf-verdict').textContent = '計画書の写しの記録を読めませんでした。'; }
    try { await loadTpMode(sb); } catch (e) { /* 0038 の前・読めない時はボタンを出さない */ }
    try { await loadAdmRuns(sb); } catch (e) { $('admf-verdict').className = 'msg warn'; $('admf-verdict').textContent = '入居調整の写しの記録を読めませんでした。'; }
    try { await loadAdmMode(sb); } catch (e) { /* 0042 の前・読めない時はボタンを出さない */ }
    try { await loadStf(sb); } catch (e) { $('stf-verdict').className = 'msg warn'; $('stf-verdict').textContent = '職員マスタの写しの記録を読めませんでした。'; }
    try { await loadSup(sb); } catch (e) { $('sup-verdict').className = 'msg warn'; $('sup-verdict').textContent = '備品の写しの記録を読めませんでした。'; }
    try { await probePrep(sb); } catch (e) { /* 確かめられなくても、ほかの欄はそのまま */ }
    try { await loadStfMode(sb); } catch (e) { /* 0045 の前・読めない時はボタンを出さない */ }
    try { await loadSupMode(sb); } catch (e) { /* 0047 の前・読めない時はボタンを出さない */ }
    try { await loadSa(sb); } catch (e) { $('sa-verdict').className = 'msg warn'; $('sa-verdict').textContent = 'シフト分析の写しの記録を読めませんでした。'; }
    try { await loadSaMode(sb); } catch (e) { saNote('印の欄', e); }   // 読めない時はボタンを出さない
    try { await loadGeno(sb); } catch (e) { $('geno-verdict').className = 'msg warn'; $('geno-verdict').textContent = '家族構成図の写しの記録を読めませんでした。'; }
    try { await loadGenoMode(sb); } catch (e) { genoNote('印の欄', e); }   // 読めない時はボタンを出さない
    try { await loadHb(sb); } catch (e) { $('hb-verdict').className = 'msg warn'; $('hb-verdict').textContent = '排泄ケア記録の写しの記録を読めませんでした。'; }
    try { await loadHbMode(sb); } catch (e) { genoNote('排泄の印の欄', e); }   // 0064 の前・読めない時はボタンを出さない
    try { await loadDoc(sb); } catch (e) { $('doc-verdict').className = 'msg warn'; $('doc-verdict').textContent = '添付書類の写しの記録を読めませんでした。'; }
    try { await loadDocMode(sb); } catch (e) { genoNote('書類の印の欄', e); }   // 0065 の前・読めない時はボタンを出さない
    try { await loadHo(sb); } catch (e) { $('ho-verdict').className = 'msg warn'; $('ho-verdict').textContent = '申し送りの写しの記録を読めませんでした。'; }
    try { await loadPatch(sb); }
    catch (e) {
      $('pt-verdict').className = 'msg warn';
      $('pt-verdict').textContent = '貼り薬の写しはまだ読めません（データベースの準備 0016 が未適用の可能性）。';
    }
    try { await loadKv(sb); }
    catch (e) {
      // 週間計画の写しの表（0005）がまだ無い時も、入居者マスタの見比べは使えるようにする
      $('kv-verdict').className = 'msg warn';
      $('kv-verdict').textContent = '週間計画の写しはまだ読めません（データベースの準備 0005 が未適用の可能性）。';
    }
    await gateRefresh(sb);   // 読めない時はボタンを押せないままにする
  }

  /* 貼り薬の写し（段階2「送るだけ」・2026-10-17）: サーバーの行数と、この端末の控え（apc2_res）との差。
   * 出すのは入居者IDと件数だけ（控えにも氏名は無い）。読むだけで、ここからは送らない（送るのは貼り薬カレンダー）。
   * 差の内訳: 端末だけにある（まだ届いていない）・サーバーだけにある（ほかの端末が送った）・中身が違う（開始日・場所・前日の場所）。
   * 中身が違う方は日時で分ける: 端末の方が新しい＝未送信／サーバーの方が新しい＝ほかの端末で新しい設定（段階3で取り込む）。
   * 日時の無い古い設定は送らない約束なので、差には数えず別に出す。形で断られた方も差に数えず、断りの欄だけで数える。
   * 判定を warn にするのは未送信（端末だけにある・端末の方が新しい）がある時だけ。送るスイッチが切の間は送っていないので warn にしない */
  var PT_LIST_MAX = 50;
  function patchRows(data) {
    // 受け取った応答を信じない（多端末同期の規約10）: 形が違えば読めなかった扱い
    if (!data || data.ok !== true || !data.rows || typeof data.rows !== 'object' || Array.isArray(data.rows)) return null;
    return data.rows;
  }
  async function loadPatch(sb) {
    var kk = $('pt-kpis'), v = $('pt-verdict'), ul = $('pt-list');
    kk.replaceChildren(); ul.replaceChildren();
    if (!window.SUPatchSync) { v.className = 'msg warn'; v.textContent = '貼り薬の部品（su-patch-sync.js）を読み込めませんでした。'; return; }
    var r = await sb.rpc('patch_get');
    if (r.error) throw r.error;
    var rows = patchRows(r.data);
    if (!rows) throw new Error('patch_get の応答の形が違います');
    var d = SUPatchSync.diff(SUPatchSync.readLocal(), rows);
    var pend = SUPatchSync.pending(), ng = d.refused;
    var gap = d.onlyLocal.length + d.onlyServer.length + d.differ.length;
    var unsent = d.onlyLocal.length + d.differLocal.length;
    kk.appendChild(kpi('サーバーの行数', Object.keys(rows).length, '人'));
    kk.appendChild(kpi('一致', d.same.length, '人'));
    kk.appendChild(kpi('端末だけにある', d.onlyLocal.length, '人'));
    kk.appendChild(kpi('サーバーだけにある', d.onlyServer.length, '人'));
    kk.appendChild(kpi('未送信（この端末の方が新しい）', d.differLocal.length, '人'));
    kk.appendChild(kpi('ほかの端末で新しい設定', d.differServer.length, '人'));
    kk.appendChild(kpi('送らない（日時なし）', d.noAt.length, '人'));
    kk.appendChild(kpi('この端末の送信待ち', pend.length, '人'));
    kk.appendChild(kpi('形の違いで断られた', ng.length, '人'));
    // スイッチは週間計画などと同じく su-kv.js が読んだ最新の値で出す（部品が起動時に控えた値は1つ前のことがある）
    var sw = window.SUKv ? SUKv._flags() : null;
    var swOn = sw && sw.supabase ? sw.supabase.patch_push === true : SUPatchSync.switchOn();
    kk.appendChild(kpi('送るスイッチ', swOn ? '入' : '切'));
    // ボタンの文言: 切の間は開いても送らないことが分かる形にする
    var go = $('pt-open');
    if (go) go.textContent = swOn ? '貼り薬カレンダーを開く（送り直す）' : '貼り薬カレンダーを開く（送るスイッチが切のため、送りません）';
    if (!gap) {
      v.className = 'msg ok';
      v.textContent = 'この端末の控えとサーバーの差は0件です。';
    } else if (!swOn) {
      v.className = 'msg';
      v.textContent = '送るスイッチが切のため、まだ送っていません（差は想定どおり）。差は ' + gap + '件です。';
    } else if (unsent) {
      v.className = 'msg warn';
      v.textContent = 'この端末に未送信の設定が ' + unsent + '件あります（差は全部で ' + gap + '件）。貼り薬カレンダーを開くと送り直します。';
    } else {
      v.className = 'msg ok';
      v.textContent = 'この端末の未送信は0件です。差の ' + gap + '件は、ほかの端末が送った設定です（表示へ取り込むのは段階3）。';
    }
    var items = [];
    d.onlyLocal.forEach(function (id) { items.push([id, '端末だけにある（未送信）']); });
    d.differLocal.forEach(function (id) { items.push([id, '未送信（この端末の方が新しい）']); });
    d.onlyServer.forEach(function (id) { items.push([id, 'サーバーだけにある']); });
    d.differServer.forEach(function (id) { items.push([id, 'ほかの端末で新しい設定（段階3で取り込む）']); });
    ng.forEach(function (x) { items.push([x.id, '形の違いで断られた（' + x.error + '）']); });
    items.slice(0, PT_LIST_MAX).forEach(function (it) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', '入居者ID ' + it[0]));
      left.appendChild(el('div', 'em', it[1]));
      li.appendChild(left);
      ul.appendChild(li);
    });
    if (items.length > PT_LIST_MAX) ul.appendChild(el('li', null, 'ほか ' + (items.length - PT_LIST_MAX) + '件'));
  }

  /* 入居者マスタの全項目の写し（統合 0034・2026-10-29 代表者の決定5）: 管理者がボタンを押した時だけ、su-res-full.js で
   * Google から全員分を読んで Supabase へ写し、読み直して見比べる。出すのは人数・件数・利用者No・項目名だけ */
  var RF_LIST_MAX = 50;
  function rmasterPost(tgt, body) {
    var ctl = new AbortController();
    var tm = null;
    /* 名簿の読み方（rmasterRoster）と同じく、ログインしている時だけ証明を添え、1分の時計は証明を取った後に始める */
    var rb = Object.assign({}, body, { token: tgt.token });
    var ga = (typeof SUGasAuth !== 'undefined') ? SUGasAuth : null;
    return (ga ? ga.addTo(rb) : Promise.resolve(rb)).then(function (b) {
      tm = setTimeout(function () { ctl.abort(); }, 60000);
      return fetch(tgt.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify(b), cache: 'no-store', redirect: 'follow', signal: ctl.signal });
    })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(tm); return j; },
            function (e) { clearTimeout(tm); throw (e && e.name === 'AbortError') ? new Error('Google の応答がありません（時間切れ）') : new Error('Google に届きませんでした'); });
  }
  async function loadResFullRuns(sb) {
    var ul = $('rf-runs');
    ul.replaceChildren();
    $('b-res-full').hidden = !(me && me.role === 'admin');
    var r = await sb.from('res_sync_runs').select('*').order('at', { ascending: false }).limit(5);
    if (r.error) { $('rf-verdict').className = 'msg'; $('rf-verdict').textContent = dbErrText(r.error, 'res_sync_runs', '全項目の写しの準備（データベース 0034）はまだです。'); $('b-res-full').hidden = true; return; }
    (r.data || []).forEach(function (x) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(x.at)));
      left.appendChild(el('div', 'em', x.status === 'done'
        ? '入居者 ' + x.residents + '人／追加 ' + x.inserted + '・更新 ' + x.updated + '・変化なし ' + x.unchanged + '・消えた印 ' + x.missing
          + '／担当者会議 ' + x.meetings + '件・薬の判断 ' + x.med_decisions + '件'
        : x.status === 'running' ? '途中で止まった写し（次に押すと取り消します）' : '受け付けず（' + refusedWord({}, x.refused, 'loadResFullRuns') + '）'));
      li.appendChild(left);
      ul.appendChild(li);
    });
  }
  async function runResFull() {
    var kk = $('rf-kpis'), v = $('rf-verdict'), ul = $('rf-list'), btn = $('b-res-full');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var tgt = rmasterTarget();
    if (!tgt) { say('この端末には入居者マスタの接続先（Google）がありません。この端末で入居者マスタを開いてから、押し直してください。', 'warn'); return; }
    if (!(await window.SUDialog.confirm('入居者マスタの全員分を Supabase へ写しますか？\n\n数分かかります。終わるまでこの画面を閉じないでください。Google の入居者マスタは読むだけで、変えません。'))) return;
    kk.replaceChildren(); ul.replaceChildren();
    btn.disabled = true;
    var sb = SUAuth.client();
    try {
      var res = await SUResFull.run({
        gas: function (body) { return rmasterPost(tgt, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        lastRun: async function (id) { var r = await sb.from('res_sync_runs').select('unknown_keys').eq('id', id).limit(1); return r.error ? null : (r.data || [])[0]; },
        progress: function (t) { say(t); }
      });
      if (!res.ok) { say('写せませんでした: ' + jaWhy('runResFull', res.why), 'warn'); return; }
      var c = res.cmp;
      kk.appendChild(kpi('写した入居者', res.residents, '人'));
      kk.appendChild(kpi('一致', c.same, '人'));
      kk.appendChild(kpi('違いあり', c.diff.length, '人'));
      kk.appendChild(kpi('写しに無い', c.notInCopy.length, '人'));
      kk.appendChild(kpi('担当者会議', res.meetings, '件'));
      kk.appendChild(kpi('薬の判断', res.medDecisions, '件'));
      var bad = c.diff.length + c.notInCopy.length;
      var tail = '（追加 ' + res.run.inserted + '・更新 ' + res.run.updated + '・変化なし ' + res.run.unchanged + '・消えた印 ' + res.run.missing + '）'
        + (res.run.unknown.length ? '　区分の決まっていない項目: ' + res.run.unknown.join('・') + '（現場には出していません）' : '');
      say(bad ? '写しましたが、読み直すと違いがあります。下の利用者No と項目名を開発の担当へ知らせてください。' + tail
              : '写して読み直し、Google と全項目一致しました（' + c.same + '人）。' + tail, bad || res.run.unknown.length ? 'warn' : 'ok');
      var items = [];
      c.diff.forEach(function (x) { items.push([x.id, '違う項目: ' + x.keys.join('・')]); });
      c.notInCopy.forEach(function (id) { items.push([id, '写しにありません']); });
      items.slice(0, RF_LIST_MAX).forEach(function (it) {
        var li = el('li'), left = el('div');
        left.appendChild(el('div', 'nm', '利用者No ' + it[0]));
        left.appendChild(el('div', 'em', it[1]));
        li.appendChild(left);
        ul.appendChild(li);
      });
      if (items.length > RF_LIST_MAX) ul.appendChild(el('li', null, 'ほか ' + (items.length - RF_LIST_MAX) + '件'));
    } catch (e) {
      say('写せませんでした: ' + jaWhy('runResFull', e), 'warn');
    } finally {
      btn.disabled = false;
      try { await loadResFullRuns(sb); } catch (e) { /* 記録の一覧が読めなくても結果の文は残す */ }
      await gateRefresh(sb);
    }
  }

  /* 個別機能訓練計画書の写し（統合 0037・2026-10-29）: 管理者がボタンを押した時だけ、su-tp-full.js で Google（tp_cfg）から
   * 索引と名簿の全員分の計画書を読んで Supabase へ写し、読み直して見比べる。出すのは件数・計画書の番号・違いの種類だけ */
  function tpTarget() {
    try {
      var o = JSON.parse(localStorage.getItem('tp_cfg') || 'null');
      var u = String(o && o.url || '').trim(), t = String(o && o.token || '').trim();
      return RMASTER_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  async function loadTpRuns(sb) {
    var ul = $('tpf-runs');
    ul.replaceChildren();
    $('b-tp-full').hidden = !(me && me.role === 'admin');
    var r = await sb.from('tp_sync_runs').select('*').order('at', { ascending: false }).limit(5);
    if (r.error) { $('tpf-verdict').className = 'msg'; $('tpf-verdict').textContent = dbErrText(r.error, 'tp_sync_runs', '計画書の写しの準備（データベース 0037）はまだです。'); $('b-tp-full').hidden = true; return; }
    (r.data || []).forEach(function (x) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(x.at)));
      left.appendChild(el('div', 'em', x.status === 'done'
        ? '計画書 ' + x.docs + '件／追加 ' + x.inserted + '・更新 ' + x.updated + '・変化なし ' + x.unchanged + '・消えた印 ' + x.missing
        : x.status === 'running' ? '途中で止まった写し（次に押すと取り消します）' : '受け付けず（' + refusedWord({}, x.refused, 'loadTpRuns') + '）'));
      li.appendChild(left);
      ul.appendChild(li);
    });
  }
  async function runTpFull() {
    var kk = $('tpf-kpis'), v = $('tpf-verdict'), ul = $('tpf-list'), btn = $('b-tp-full');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var tt = tpTarget(), mt = rmasterTarget();
    if (!tt) { say('この端末には個別機能訓練計画書の接続先（Google）がありません。この端末で計画書を開いてから、押し直してください。', 'warn'); return; }
    if (!mt) { say('この端末には入居者マスタの接続先（Google）がありません。この端末で入居者マスタを開いてから、押し直してください。', 'warn'); return; }
    if (!(await window.SUDialog.confirm('個別機能訓練計画書の全部を Supabase へ写しますか？\n\n数分かかります。終わるまでこの画面を閉じないでください。Google の計画書は読むだけで、変えません。'))) return;
    kk.replaceChildren(); ul.replaceChildren();
    btn.disabled = true;
    var sb = SUAuth.client();
    try {
      var res = await SUTpFull.run({
        gas: function (body) { return rmasterPost(tt, body); },
        rosterIds: async function () {
          var j = await rmasterPost(mt, { action: 'getRoster' });
          if (!j || !Array.isArray(j.roster)) throw new Error('名簿');
          return j.roster.map(function (x) { return x && x.id; });
        },
        rpc: function (name, args) { return sb.rpc(name, args); },
        progress: function (t) { say(t); }
      });
      if (!res.ok) { say('写せませんでした: ' + jaWhy('runTpFull', res.why), 'warn'); return; }
      var c = res.cmp;
      kk.appendChild(kpi('写した計画書', res.docs, '件'));
      kk.appendChild(kpi('一致', c.same, '件'));
      kk.appendChild(kpi('違いあり', c.diff.length, '件'));
      kk.appendChild(kpi('写しに無い', c.notInCopy.length, '件'));
      var bad = c.diff.length + c.notInCopy.length;
      var tail = '（追加 ' + res.run.inserted + '・更新 ' + res.run.updated + '・変化なし ' + res.run.unchanged + '・消えた印 ' + res.run.missing + '）'
        + (res.badIds ? '　形の合わない利用者No ' + res.badIds + '件は読んでいません' : '');
      say(bad ? '写しましたが、読み直すと違いがあります。下の番号を開発の担当へ知らせてください。' + tail
              : '写して読み直し、Google と全件一致しました（' + c.same + '件）。' + tail, bad ? 'warn' : 'ok');
      var items = [];
      c.diff.forEach(function (x) { items.push([x.key.replace(/^training_plan:/, ''), '違い: ' + x.why.join('・')]); });
      c.notInCopy.forEach(function (k) { items.push([k.replace(/^training_plan:/, ''), '写しにありません']); });
      items.slice(0, RF_LIST_MAX).forEach(function (it) {
        var li = el('li'), left = el('div');
        left.appendChild(el('div', 'nm', it[0] === 'index' ? '索引' : '利用者No ' + it[0]));
        left.appendChild(el('div', 'em', it[1]));
        li.appendChild(left);
        ul.appendChild(li);
      });
      if (items.length > RF_LIST_MAX) ul.appendChild(el('li', null, 'ほか ' + (items.length - RF_LIST_MAX) + '件'));
    } catch (e) {
      say('写せませんでした: ' + jaWhy('runTpFull', e), 'warn');
    } finally {
      btn.disabled = false;
      try { await loadTpRuns(sb); } catch (e) { /* 記録の一覧が読めなくても結果の文は残す */ }
      await gateRefresh(sb);
    }
  }

  /* 入居調整の台帳の写し（統合 0040・2026-10-29）: 管理者がボタンを押した時だけ、su-adm-full.js で Google（adm_cfg）から
   * 台帳を読んで Supabase へ写し、読み直して見比べる。出すのは件数と違いの種類だけ（添付書類は写さない） */
  function admTarget() {
    try {
      var o = JSON.parse(localStorage.getItem('adm_cfg') || 'null');
      var u = String(o && o.url || '').trim(), t = String(o && o.token || '').trim();
      return RMASTER_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  var ADM_RESULT = { inserted: '初めて写した', updated: '直した', unchanged: '変化なし' };
  async function loadAdmRuns(sb) {
    var ul = $('admf-runs');
    ul.replaceChildren();
    $('b-adm-full').hidden = !(me && me.role === 'admin');
    var r = await sb.from('adm_sync_runs').select('*').order('at', { ascending: false }).limit(5);
    if (r.error) { $('admf-verdict').className = 'msg'; $('admf-verdict').textContent = dbErrText(r.error, 'adm_sync_runs', '入居調整の写しの準備（データベース 0040）はまだです。'); $('b-adm-full').hidden = true; return; }
    (r.data || []).forEach(function (x) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(x.at)));
      left.appendChild(el('div', 'em', x.status === 'done'
        ? '版 ' + x.rev + '／生きている案件 ' + x.active + '件／' + (ADM_RESULT[x.result] || '')
        : '受け付けず（' + refusedWord({}, x.refused, 'loadAdmRuns') + '）'));
      li.appendChild(left);
      ul.appendChild(li);
    });
  }
  async function runAdmFull() {
    var kk = $('admf-kpis'), v = $('admf-verdict'), btn = $('b-adm-full');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var at = admTarget();
    if (!at) { say('この端末には入居調整の接続先（Google）がありません。この端末で入居調整を開いてから、押し直してください。', 'warn'); return; }
    if (!(await window.SUDialog.confirm('入居調整の台帳を Supabase へ写しますか？\n\nGoogle の台帳は読むだけで、変えません。添付書類は写しません。'))) return;
    kk.replaceChildren();
    btn.disabled = true;
    var sb = SUAuth.client();
    try {
      var res = await SUAdmFull.run({
        gas: function (body) { return rmasterPost(at, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        progress: function (t) { say(t); }
      });
      if (!res.ok) { say('写せませんでした: ' + jaWhy('runAdmFull', res.why), 'warn'); return; }
      kk.appendChild(kpi('台帳の版', res.rev, ''));
      kk.appendChild(kpi('生きている案件', res.active, '件'));
      var tail = '（' + (ADM_RESULT[res.result] || '') + '）';
      say(res.diff.length ? '写しましたが、読み直すと違いがあります（' + res.diff.join('・') + '）。開発の担当へ知らせてください。' + tail
                          : '写して読み直し、Google と一致しました。' + tail, res.diff.length ? 'warn' : 'ok');
    } catch (e) {
      say('写せませんでした: ' + jaWhy('runAdmFull', e), 'warn');
    } finally {
      btn.disabled = false;
      try { await loadAdmRuns(sb); } catch (e) { /* 記録の一覧が読めなくても結果の文は残す */ }
      await gateRefresh(sb);
    }
  }

  /* 職員マスタの写し（統合 0044・2026-11-02 代表者「全て進めて」）: 写しは職員マスタの GAS が1時間ごとに自動で取る。
   * ここでは写しの人数・版（stf_shadow_status）と、この端末の職員マスタの接続先（stfm_cfg）の今の版（ping・合言葉なし）を見比べる。
   * 出すのは人数・版・時刻・断った種類だけ（氏名・中身は出さない） */
  /* 備品の写し（統合 0046・2026-11-02 代表者「全て進めて」案2）: 写しは消耗品管理の GAS が1時間ごとに自動で取る。
   * 消耗品管理には全体の版の番号が無いので、最後の写しの結果と時刻（75分以内なら届いている）で確かめる。
   * 出すのは品目の数・出庫の行数・時刻・断った種類だけ（品名・入居者・金額は出さない）。Google へは何も送らない */
  /* データベースの断りを種類で分ける（2026-11-03・備品の 0046 が入っていなかった時に「準備がまだ」とだけ出て、
   *   ログインの断り・一時の失敗と見分けられなかったため）。
   *   無い（関数・表が無い）→ 各欄の「準備はまだです」＋最上部に足りない統合の番号／権限で断られた → ログインの文／それ以外 → 読めなかった文（記録に残す） */
  var DB_PREP = {
    weight_mode: '0032', res_sync_runs: '0034', res_mode_get: '0036', tp_sync_runs: '0037', tp_mode_get: '0038',
    adm_sync_runs: '0040', adm_mode_get: '0042', stf_shadow_status: '0044', stf_mode_get: '0045',
    sup_shadow_status: '0046', sup_mode_get: '0047', mirror_bot_me: '0047',
    sa_shadow_status: '0050', sa_mode_get: '0051', device_seen_summary: '0048', shadow_diff_days: '0055', shadow_diff_note: '0055',
    geno_shadow_status: '0053', geno_mode_get: '0054', hb_shadow_status: '0062', hb_mode_get: '0064', doc_shadow_status: '0063', doc_mode_get: '0065',
    ho_shadow_status: '0067'
  };
  var prepMissing = {};
  function dbErrKind(err) {
    var c = String(err && err.code || '');
    if (/^(PGRST202|PGRST205|42883|42P01)$/.test(c)) return 'missing';
    if (c === '42501') return 'denied';
    return 'other';
  }
  function notePrep(name) {
    var n = DB_PREP[name]; if (!n) return;
    prepMissing[n] = 1; renderPrep();
  }
  function renderPrep() {
    var b = $('db-prep'); if (!b) return;
    var ks = Object.keys(prepMissing).sort();
    if (!ks.length || !(me && me.role === 'admin')) { b.hidden = true; b.textContent = ''; return; }
    b.textContent = 'データベースの準備が足りません：統合 ' + ks.join('・') + '（Supabase の SQL Editor で、番号の小さい順に流してください）';
    b.hidden = false;
  }
  /* 印刷には出さない（画面だけ）。印刷の間だけ隠し、終わったら戻す */
  try {
    window.addEventListener('beforeprint', function () { var b = $('db-prep'); if (b) b.hidden = true; });
    window.addEventListener('afterprint', function () { renderPrep(); });
  } catch (x) { /* 印刷の知らせが無い環境でも止めない */ }
  /* 職員マスタ・備品の受け口が使う口（mirror_bot_me・統合 0047）。画面からは呼ばないので、無い時だけ準備の帯に足す（管理者だけ・読むだけ） */
  async function probePrep(sb) {
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('mirror_bot_me');
    if (r && r.error && dbErrKind(r.error) === 'missing') notePrep('mirror_bot_me');
  }
  /* 欄に出す文。missingText は「準備はまだです」の文（その欄の今の文のまま） */
  function dbErrText(err, name, missingText) {
    var k = dbErrKind(err);
    if (k === 'missing') { notePrep(name); return missingText; }
    if (k === 'denied') return '管理者か事務所のアカウントでログインしてください（2段階認証まで）。';
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: ' + name, String(err && err.code || 'error')); } catch (x) { /* 記録できなくても止めない */ }
    return '写しの様子を読めませんでした（少し待って読み込み直してください）。';
  }
  var SUP_FRESH_MS = 75 * 60 * 1000;
  var SUP_REFUSED = { stale: '前に読んだ写し', shrink: '急に減った', badrow: '形の違い', toolarge: '大きすぎる' };
  async function loadSup(sb, nowMs) {
    var kk = $('sup-kpis'), v = $('sup-verdict'), ul = $('sup-runs');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    kk.replaceChildren(); ul.replaceChildren();
    var st = await sb.rpc('sup_shadow_status');
    if (st.error) { say(dbErrText(st.error, 'sup_shadow_status', '備品の写しの準備（データベース 0046）はまだです。')); return; }
    var d = st.data || {};
    if (d.ver == null) { say('まだ写していません。消耗品管理の GAS の自動（autoMirror）が動くと、1時間以内に写ります。'); return; }
    kk.appendChild(kpi('写しの品目', d.items, '件'));
    kk.appendChild(kpi('写しの出庫', d.moves, '行'));
    supSize(d);
    var tail = '（最後に写した時刻 ' + fmtTime(d.lastAt || d.updatedAt) + '）';
    var last = Date.parse(d.lastAt || d.updatedAt || '');
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var live = false;
    try { var md = await sb.rpc('sup_mode_get'); live = !!(md && !md.error && md.data && md.data.mode === 'live'); } catch (e) { live = false; }
    if (live) say('切り替え済みです（備品の正本は Supabase）。写しは止めてあります（下の記録は切り替える前のものです）。Google へは1時間ごとに写し返しています。', 'ok');
    else if (d.lastStatus === 'refused') say('最後の写しは受け付けませんでした（' + refusedWord(SUP_REFUSED, d.lastRefused, 'loadSup') + '）。開発の担当へ知らせてください。' + tail, 'warn');
    else if (!isNaN(last) && now - last <= SUP_FRESH_MS) say('写しが1時間ごとに届いています。' + tail, 'ok');
    else say('しばらく写っていません。消耗品管理の GAS の自動（autoMirror）が止まっていないか確かめてください。' + tail, 'warn');
    var r = await sb.from('sup_sync_runs').select('at,status,refused,result,items,moves').order('id', { ascending: false }).limit(5);
    (r.data || []).forEach(function (x) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(x.at)));
      left.appendChild(el('div', 'em', x.status === 'done'
        ? '品目 ' + x.items + '件／出庫 ' + x.moves + '行／' + (ADM_RESULT[x.result] || '')
        : '受け付けず（' + refusedWord(SUP_REFUSED, x.refused, 'loadSup') + '）'));
      li.appendChild(left);
      ul.appendChild(li);
    });
  }

  /* 備品の大きさ（統合 0047・反証レビュー指摘3）: 新しい保存先は6つのタブの合計を 8MB までしか受けない。出庫は増え続けるので、
   * 上限の7割を超えたら早めに知らせる（そのまま増えると、切り替えた後の保存が「入りきらない」と断られる）。出すのは割合と大きさだけ */
  var SUP_SIZE_WARN = 0.7;
  function supSize(d) {
    var e = $('sup-size');
    e.className = 'msg'; e.textContent = '';
    var total = Number(d && d.bytesTotal), limit = Number(d && d.bytesLimit);
    if (!(total >= 0) || !(limit > 0)) return;   // 0047 の前は大きさを返さない
    var r = total / limit, pct = Math.round(r * 100), mb = function (n) { return (n / 1048576).toFixed(1) + 'MB'; };
    var t = '記録の大きさ: ' + mb(total) + '／上限 ' + mb(limit) + '（' + pct + '%）';
    if (r >= SUP_SIZE_WARN) { e.className = 'msg warn'; e.textContent = t + '。上限に近づいています。上限を超えると新しい保存先へ保存できなくなるので、開発の担当へ知らせてください。'; }
    else e.textContent = t + '。';
  }

  /* 備品の正本の切り替え（統合 0047・2026-11-02）: 職員マスタと同じ手順（su-sup-full.js の cutover・back）。管理者だけ・事務所PCだけ。
   * 切り替えボタンは切り替えスイッチ supplies が入で、この端末に消耗品管理の接続先がある時だけ出す */
  function suppliesOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.supplies === true); }
  function supTarget() {
    try {
      var o = JSON.parse(localStorage.getItem('spl_cfg') || 'null');
      var u = String(o && o.url || '').trim(), t = String(o && o.token || '').trim();
      return RMASTER_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  async function loadSupMode(sb) {
    var line = $('sup-mode'), bc = $('b-sup-cut'), bb = $('b-sup-back');
    bc.hidden = true; bb.hidden = true; line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('sup_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('sup_mode_get');
    if (r.error || !r.data) return;
    var live = r.data.mode === 'live', on = suppliesOn(), st = supTarget();
    if (live && !on) { line.className = 'msg warn'; line.textContent = '備品は新しい保存先へ切り替えた後ですが、切り替えスイッチ（supplies）が切です。画面が古い Google の中身を読まないよう、スイッチを入れ直すか「備品を写しの期間に戻す」を押してください。'; }
    else if (live) { line.className = 'msg ok'; line.textContent = '備品の正本は新しい保存先（Supabase）です。Google へは1時間ごとに写し返しています。'; }
    else line.textContent = '備品の正本は Google です（写しの期間）。' + (on ? '' : '切り替えるには、先に切り替えスイッチ（supplies）を入れる PR の取り込みが要ります。') + (st ? '（前の「切り替える」「写しの期間に戻す」が途中で止まり、Google の保存が止まったままの時は「備品を写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）' : '');
    bc.hidden = live || !on || !st;
    /* 戻すボタンは、接続先がある管理者にはいつも出す。消耗品管理の GAS は止めたままかを答えないため、データベースが写しの期間でも
       Google の保存が止まったまま（戻すが途中で止まった）の時に押せるように（戻すは写しの期間なら写し返しをせず、印を外すだけ・反証レビュー指摘3） */
    bb.hidden = !st;
  }
  async function runSupOp(kind) {
    var v = $('sup-mode');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var st = supTarget();
    if (!st) { say('この端末には消耗品管理の接続先（Google）がありません。この端末で消耗品管理を開いてから、押し直してください。', 'warn'); return; }
    if (kind === 'cut') {
      if (!suppliesOn()) { say('切り替えスイッチ（supplies）が入っていません。', 'warn'); return; }
      if (!(await oneDayOk('sup', say))) return;
      if (!(await fnOk('sup', 'b-sup-cut', say))) return;
      if (!(await window.SUDialog.confirm('備品（消耗品管理）の正本を新しい保存先（Supabase）へ切り替えますか？\n\n1分ほどかかります。その間は入出庫・品目・価格などの保存が断られます（「読み込み直して」と出ます）。終わるまでこの画面を閉じないでください。\n\n切り替えた後は、ログインしている端末だけが消耗品管理を使えます。Google へは1時間ごとに写し返します。いつでも「備品を写しの期間に戻す」で戻せます。'))) return;
    } else {
      if (!(await window.SUDialog.confirm('備品を写しの期間に戻しますか？\n\n切り替えていた間の保存を最後まで Google へ写し返してから、Google での保存を受け付けるように戻します。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var bc = $('b-sup-cut'), bb = $('b-sup-back');
    bc.disabled = true; bb.disabled = true;
    var sb = SUAuth.client();
    try {
      var io = {
        gas: function (body) { return rmasterPost(st, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
        progress: function (t) { say(t); }
      };
      var res = kind === 'cut' ? await SUSupFull.cutover(io) : await SUSupFull.back(io);
      if (!res.ok) { say((kind === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runSupOp', res.why), 'warn'); return; }
      say(kind === 'cut' ? '切り替えました（写した品目 ' + res.rows + '件）。消耗品管理の画面は、読み込み直すと新しい保存先で保存します。'
                         : '写しの期間に戻しました。正本は Google です。', 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runSupOp', e), 'warn');
    } finally {
      bc.disabled = false; bb.disabled = false;
      var keep = v.textContent, kc = v.className;
      try { await loadSupMode(sb); await loadSup(sb); } catch (e) { /* 読み直せなくても結果の文は残す */ }
      v.className = kc; v.textContent = keep;
    }
  }

  /* シフト分析（過去シフト・アナライザのクラウド同期）の写し（統合 0050・0051・2026-11-03 代表者の決定: アナライザを先に・管理者と事務所が編集）:
   * 写しはアナライザ同期の GAS が1時間ごとに自動で取る。最後の写しの結果と時刻（75分以内なら届いている）で確かめる。
   * 出すのはキーごとの版（rev）・月の数・人数・大きさ・時刻・断った種類だけ（氏名・資格の中身は出さない）。Google へは何も送らない */
  var SA_FRESH_MS = 75 * 60 * 1000;
  function saNote(where, e) {
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: シフト分析の' + where, String(e && (e.code || e.message) || e)); } catch (x) { /* 記録できなくても止めない */ }
  }
  var SA_REFUSED = {
    stale: '前に読んだ写し', shrink: '急に減った', badrow: '形の違い', toolarge: '大きすぎる', rewind: '版が巻き戻った', future: '時刻が先',
    toomany: 'キーが多すぎる', cutover: '切り替えの途中',
    trashed: '保存先フォルダのごみ箱に months.json があります。ごみ箱から取り出すか完全に消すまで、写せず・切り替えられません'
  };
  async function loadSa(sb, nowMs) {
    var kk = $('sa-kpis'), v = $('sa-verdict');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    kk.replaceChildren(); $('sa-size').textContent = '';
    var st = await sb.rpc('sa_shadow_status');
    if (st.error) { say(dbErrText(st.error, 'sa_shadow_status', 'シフト分析の写しの準備（データベース 0050）はまだです。')); return; }
    var d = st.data || {};
    var m = d.keys && d.keys.months;
    if (d.ver == null && !d.lastAt) { say('まだ写していません。アナライザ同期の GAS の自動（autoMirror）が動くと、1時間以内に写ります。'); return; }
    if (m) {
      kk.appendChild(kpi('写しの版（rev）', m.rev, ''));
      kk.appendChild(kpi('写しの月', m.months, '月'));
      kk.appendChild(kpi('資格の人数', m.quals, '人'));
    }
    saSize(d);
    var tail = '（最後に写した時刻 ' + fmtTime(d.lastAt || d.updatedAt) + '）';
    var last = Date.parse(d.lastAt || d.updatedAt || '');
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var live = false, mdd = null;
    try { var md = await sb.rpc('sa_mode_get'); mdd = md && !md.error ? md.data : null; live = !!(mdd && mdd.mode === 'live'); } catch (e) { saNote('印', e); live = false; }
    /* 切り替えた後は、Google への写し返しが遅れていないかを見る（写し返し終えた版が今の版より古く、最後に写し返してから75分を超えた・指摘6） */
    var mAt = mdd ? Date.parse(mdd.mirroredAt || '') : NaN;
    var lag = live && Number(mdd.version) > Number(mdd.mirroredVer) && !isNaN(mAt) && now - mAt > SA_FRESH_MS;
    if (lag) say('切り替え済みです（シフト分析の正本は Supabase）。ただし Google への写し返しが75分を超えて遅れています（最後に写し返した時刻 ' + fmtTime(mdd.mirroredAt) + '）。アナライザ同期の GAS の自動（autoMirror）が止まっていないか確かめてください。', 'warn');
    else if (live) say('切り替え済みです（シフト分析の正本は Supabase）。写しは止めてあります。Google へは1時間ごとに写し返しています。', 'ok');
    else if (d.lastStatus === 'refused') say('最後の写しは受け付けませんでした（' + refusedWord(SA_REFUSED, d.lastRefused, 'loadSa') + '）。' + (d.lastRefused === 'trashed' ? '' : '開発の担当へ知らせてください。') + tail, 'warn');
    else if (!isNaN(last) && now - last <= SA_FRESH_MS) say('写しが1時間ごとに届いています。' + tail, 'ok');
    else say('しばらく写っていません。アナライザ同期の GAS の自動（autoMirror）が止まっていないか確かめてください。' + tail, 'warn');
  }
  /* 大きさ: 新しい保存先は全部のキーの合計を 8MB までしか受けない。上限の7割を超えたら早めに知らせる */
  function saSize(d) { saSizeInto($('sa-size'), d); }
  function saSizeInto(e, d) {
    e.className = 'msg'; e.textContent = '';
    var total = Number(d && d.bytesTotal), limit = Number(d && d.bytesLimit);
    if (!(total >= 0) || !(limit > 0)) return;
    var r = total / limit, pct = Math.round(r * 100), mb = function (n) { return (n / 1048576).toFixed(1) + 'MB'; };
    var t = '記録の大きさ: ' + mb(total) + '／上限 ' + mb(limit) + '（' + pct + '%）';
    if (r >= 0.7) { e.className = 'msg warn'; e.textContent = t + '。上限に近づいています。上限を超えると新しい保存先へ保存できなくなるので、開発の担当へ知らせてください。'; }
    else e.textContent = t + '。';
  }
  /* 切り替えボタンは、切り替えスイッチ analyzer が入で、この端末にアナライザの接続先（URL と記憶した合言葉）がある時だけ出す */
  function analyzerOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.analyzer === true); }
  function saTarget() {
    try {
      var o = JSON.parse(localStorage.getItem('shiftanalyzer:v1:cloud') || 'null');
      var u = String(o && o.url || '').trim(), t = String(o && o.token || '').trim();
      return RMASTER_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  async function loadSaMode(sb) {
    var line = $('sa-mode'), bc = $('b-sa-cut'), bb = $('b-sa-back');
    bc.hidden = true; bb.hidden = true; line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('sa_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('sa_mode_get');
    if (r.error || !r.data) return;
    var live = r.data.mode === 'live', on = analyzerOn(), st = saTarget();
    if (live && !on) { line.className = 'msg warn'; line.textContent = 'シフト分析は新しい保存先へ切り替えた後ですが、切り替えスイッチ（analyzer）が切です。アナライザが古い Google の中身を読まないよう、スイッチを入れ直すか「シフト分析を写しの期間に戻す」を押してください。'; }
    else if (live) { line.className = 'msg ok'; line.textContent = 'シフト分析の正本は新しい保存先（Supabase）です。Google へは1時間ごとに写し返しています。'; }
    else line.textContent = 'シフト分析の正本は Google です（写しの期間）。' + (on ? '' : '切り替えるには、先に切り替えスイッチ（analyzer）を入れる PR の取り込みが要ります。') + (st ? '' : '切り替える・戻すには、この端末のアナライザで URL と合言葉を入れ「この端末にトークンを記憶する」に✔︎を入れてください。') + (st ? '（前の「切り替える」「写しの期間に戻す」が途中で止まり、Google の保存が止まったままの時は「シフト分析を写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）' : '');
    bc.hidden = live || !on || !st;
    bb.hidden = !st;   // 戻すは接続先がある管理者にはいつも出す（途中で止まった時に押せるように・備品と同じ）
  }
  async function runSaOp(kind) {
    var v = $('sa-mode');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var st = saTarget();
    if (!st) { say('この端末にはアナライザの接続先（URL と記憶した合言葉）がありません。この端末のアナライザで入れてから、押し直してください。', 'warn'); return; }
    if (kind === 'cut') {
      if (!analyzerOn()) { say('切り替えスイッチ（analyzer）が入っていません。', 'warn'); return; }
      if (!(await oneDayOk('sa', say))) return;
      if (!(await window.SUDialog.confirm('シフト分析（過去シフト・アナライザのクラウド同期）の正本を新しい保存先（Supabase）へ切り替えますか？\n\n1分ほどかかります。その間はクラウドへの保存が断られます（「読み込み直して」と出ます）。終わるまでこの画面を閉じないでください。\n\n切り替えた後は、事務所か管理者のアカウントでログインしている端末だけがクラウド同期を使えます。切り替えた後の最初の同期で、どの端末も全部を読み直して統合します。Google へは1時間ごとに写し返します。いつでも「シフト分析を写しの期間に戻す」で戻せます。'))) return;
    } else {
      if (!(await window.SUDialog.confirm('シフト分析を写しの期間に戻しますか？\n\n切り替えていた間の保存を最後まで Google へ写し返してから、Google での保存を受け付けるように戻します。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var bc = $('b-sa-cut'), bb = $('b-sa-back');
    bc.disabled = true; bb.disabled = true;
    var sb = SUAuth.client();
    try {
      var io = {
        gas: function (body) { return rmasterPost(st, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
        progress: function (t) { say(t); }
      };
      var res = kind === 'cut' ? await SUSaFull.cutover(io) : await SUSaFull.back(io);
      if (!res.ok) { say((kind === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runSaOp', res.why), 'warn'); return; }
      say(kind === 'cut' ? (res.unchanged ? 'もう切り替わっていました（何も変えていません）。' : '切り替えました（写した月 ' + res.months + '）。') + 'アナライザの画面は、読み込み直すと新しい保存先で同期します。'
                         : '写しの期間に戻しました。正本は Google です。', 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runSaOp', e), 'warn');
    } finally {
      bc.disabled = false; bb.disabled = false;
      var keep = v.textContent, kc = v.className;
      try { await loadSaMode(sb); await loadSa(sb); } catch (e) { saNote('読み直し', e); }   // 読み直せなくても結果の文は残す
      v.className = kc; v.textContent = keep;
    }
  }

  /* 家族構成図のクラウド同期の写し（統合 0053・0054・2026-11-03 代表者の決定: 管理者と事務所が保存・現場は見るだけ・
   *   名簿の1名にだけ一致した図を利用者No に結び付ける）: 写しは家族構成図同期の GAS が1時間ごとに自動で取る。
   * 出すのは図の枚数・結び付いた枚数・大きさ・時刻・断った種類だけ（氏名・家族の中身は出さない）。Google へは何も送らない */
  function genoNote(where, e) {
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: 家族構成図の' + where, String(e && (e.code || e.message) || e)); } catch (x) { /* 記録できなくても止めない */ }
  }
  var GENO_REFUSED = {
    stale: '前に読んだ写し', shrink: '急に減った', badrow: '形の違い（読めない図がある）', toolarge: '大きすぎる', future: '時刻が先',
    toomany: '図が多すぎる', badchar: '使えない文字', cutover: '切り替えの途中',
    dup: '同じ氏名の行が2つあります（家族構成図のスプレッドシートのタブ genograms で、片方の名前に区別を付けるか、要らない方を消すまで写せず・切り替えられません）'
  };
  async function loadGeno(sb, nowMs) {
    var kk = $('geno-kpis'), v = $('geno-verdict');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    kk.replaceChildren(); $('geno-size').textContent = '';
    var st = await sb.rpc('geno_shadow_status');
    if (st.error) { say(dbErrText(st.error, 'geno_shadow_status', '家族構成図の写しの準備（データベース 0053）はまだです。')); return; }
    var d = st.data || {};
    if (d.ver == null && !d.lastAt) { say('まだ写していません。家族構成図同期の GAS の自動（autoMirror）が動くと、1時間以内に写ります。'); return; }
    kk.appendChild(kpi('写しの図', d.docs, '枚'));
    kk.appendChild(kpi('利用者No に結び付いた図', d.linked, '枚'));
    kk.appendChild(kpi('氏名だけの図', d.unlinked, '枚'));
    saSizeInto($('geno-size'), d);
    var tail = '（最後に写した時刻 ' + fmtTime(d.lastAt || d.updatedAt) + '）';
    var last = Date.parse(d.lastAt || d.updatedAt || '');
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var live = false, mdd = null;
    try { var md = await sb.rpc('geno_mode_get'); mdd = md && !md.error ? md.data : null; live = !!(mdd && mdd.mode === 'live'); } catch (e) { genoNote('印', e); live = false; }
    var mAt = mdd ? Date.parse(mdd.mirroredAt || '') : NaN;
    var lag = live && Number(mdd.version) > Number(mdd.mirroredVer) && !isNaN(mAt) && now - mAt > SA_FRESH_MS;
    if (lag) say('切り替え済みです（家族構成図の正本は Supabase）。ただし Google への写し返しが75分を超えて遅れています（最後に写し返した時刻 ' + fmtTime(mdd.mirroredAt) + '）。家族構成図同期の GAS の自動（autoMirror）が止まっていないか確かめてください。', 'warn');
    else if (live) say('切り替え済みです（家族構成図の正本は Supabase）。写しは止めてあります。Google へは1時間ごとに写し返しています。', 'ok');
    else if (d.lastStatus === 'refused') say('最後の写しは受け付けませんでした（' + refusedWord(GENO_REFUSED, d.lastRefused, 'loadGeno') + '）。' + (d.lastRefused === 'dup' ? '' : '開発の担当へ知らせてください。') + tail, 'warn');
    else if (!isNaN(last) && now - last <= SA_FRESH_MS) say('写しが1時間ごとに届いています。' + tail, 'ok');
    else say('しばらく写っていません。家族構成図同期の GAS の自動（autoMirror）が止まっていないか確かめてください。' + tail, 'warn');
  }
  /* 添付書類の写し（統合 0063・2026-11-03 代表者の決定）: doc_shadow_status（事務所・管理者）。種類（職員マスタ・入居調整）ごとに
   * 写した件数・目録の件数・残り・読めなかった件数・最後に写した時刻だけを出す（書類の名前・氏名は返らない・出さない） */
  var DOC_KIND = { stf: '職員マスタ', adm: '入居調整' };
  var DOC_REFUSED = { shrink: '目録が急に減った', badrow: '形の違い' };
  async function loadDoc(sb, nowMs) {
    var kk = $('doc-kpis'), v = $('doc-verdict'), dt = $('doc-detail');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    kk.replaceChildren(); dt.className = 'msg'; dt.textContent = '';
    var st = await sb.rpc('doc_shadow_status');
    if (st.error) { say(dbErrText(st.error, 'doc_shadow_status', '添付書類の写しの準備（データベース 0063）はまだです。')); return; }
    var d = st.data || {}, now = typeof nowMs === 'number' ? nowMs : Date.now();
    var warn = [], lines = [], none = true;
    ['stf', 'adm'].forEach(function (k) {
      var x = (d[k] && typeof d[k] === 'object') ? d[k] : {};
      var nm = DOC_KIND[k];
      kk.appendChild(kpi(nm + '・写した書類', Number(x.have) || 0, '件'));
      if (!x.lastAt) { lines.push(nm + ': まだ写していません。'); warn.push(nm + 'はまだ写していません（' + nm + 'の GAS に docshadow.gs と新しい automirror.gs を貼ると、1時間以内に写り始めます）。'); return; }
      none = false;
      var last = Date.parse(x.lastAt || '');
      lines.push(nm + ': 目録 ' + (Number(x.catalog) || 0) + '件・写した書類 ' + (Number(x.have) || 0) + '件・残り ' + (Number(x.left) || 0) + '件・読めなかった書類 ' + (Number(x.failed) || 0) + '件（最後に写した時刻 ' + fmtTime(x.lastAt) + '）。');
      if (x.lastStatus === 'refused') warn.push(nm + 'の最後の写しは受け付けませんでした（' + refusedWord(DOC_REFUSED, x.lastRefused, 'loadDoc') + '）。開発の担当へ知らせてください。');
      else if (isNaN(last) || now - last > SA_FRESH_MS) warn.push(nm + 'の写しがしばらく届いていません。' + nm + 'の GAS の自動（autoMirror）が止まっていないか、' + nm + 'の写し返しそのものが止まっていないか（上の' + nm + 'の欄）を確かめてください。');
      else if (Number(x.failed) > 0) warn.push(nm + 'に、ドライブで読めない書類が ' + Number(x.failed) + '件あります（ドライブで消された・形が違うなど。切り替える前に開発の担当へ知らせてください）。');
    });
    dt.textContent = lines.join(' ');
    if (warn.length) { say(warn.join(' '), 'warn'); return; }
    var leftAll = ['stf', 'adm'].reduce(function (n, k) { return n + (Number(d[k] && d[k].left) || 0); }, 0);
    if (leftAll > 0) say('写しが届いています（初めの写しの途中です。残りは1時間ごとに少しずつ写します）。', 'ok');
    else if (!none) say('添付書類の写しが1時間ごとに届き、目録の書類は全部写してあります。', 'ok');
  }
  /* 排泄ケア記録の写し（統合 0062・2026-11-03 代表者の決定: 写すのは全部・1時間ごとに自動・写しと見比べは2週間以上）: hb_shadow_status（事務所・管理者）。
   * 出すのは日数・件数・照らし合わせの数・最後に写した時刻と、その回の数（違った日・残った日など）だけ（氏名・記録の中身は返らない・出さない）。
   * 切り替えのボタンはまだ無い（写しの期間だけ）。Google へは何も送らない */
  var HB_REFUSED = {
    stale: '前に読んだ写し', shrink: '急に減った', badrow: '形の違い', dup: '同じ日に同じ記録が2行', toomany: '一度に多すぎる',
    toolarge: '大きすぎる', future: '時刻が先'
  };
  /* 排泄ケア記録の切り替え（統合 0064）。ボタンは、切り替えスイッチ haiben が入で、この端末に排泄ケア記録の接続先（URL と合言葉）がある時だけ出す */
  function hbOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.haiben === true); }
  function hbTarget() {
    try {
      var u = String(localStorage.getItem('hbcr_api_url') || localStorage.getItem('hbcr_api_url_bak') || '').trim();
      var t = String(localStorage.getItem('hbcr_api_token') || localStorage.getItem('hbcr_api_token_bak') || '').trim();
      return RMASTER_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  /* 排泄ケア記録DB の GAS へ送る（止めた後の写しは数分かかるので、待つのは5分半まで。合言葉は本文に入れる＝今の画面と同じ形） */
  function hbPost(tgt, body) {
    var ctl = new AbortController();
    var tm = setTimeout(function () { ctl.abort(); }, 330000);
    return fetch(tgt.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify(Object.assign({}, body, { token: tgt.token })), cache: 'no-store', redirect: 'follow', signal: ctl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(tm); return j; },
            function (e) { clearTimeout(tm); throw (e && e.name === 'AbortError') ? new Error('Google の応答がありません（時間切れ）') : new Error('Google に届きませんでした'); });
  }
  async function loadHbMode(sb) {
    var line = $('hb-mode'), bc = $('b-hb-cut'), bb = $('b-hb-back');
    bc.hidden = true; bb.hidden = true; line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('hb_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('hb_mode_get');
    if (r.error || !r.data) return;
    var live = r.data.mode === 'live', on = hbOn(), st = hbTarget();
    if (live && !on) { line.className = 'msg warn'; line.textContent = '排泄ケア記録は新しい保存先へ切り替えた後ですが、切り替えスイッチ（haiben）が切です。排泄ケア記録の画面が新しい保存先へ保存できないので、スイッチを入れ直すか「排泄ケア記録を写しの期間に戻す」を押してください。'; }
    else if (live) { line.className = 'msg ok'; line.textContent = '排泄ケア記録の正本は新しい保存先（Supabase）です。Google へは1時間ごとに写し返しています。'; }
    else line.textContent = '排泄ケア記録の正本は Google です（写しの期間）。' + (on ? '' : '切り替えるには、先に切り替えスイッチ（haiben）を入れる PR の取り込みが要ります。') + (st ? '' : '切り替える・戻すには、この端末で排泄ケア記録を開き、設定で接続先と合言葉を入れてください。') + (st ? '（前の「切り替える」「写しの期間に戻す」が途中で止まり、Google の保存が止まったままの時は「排泄ケア記録を写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）' : '');
    bc.hidden = live || !on || !st;
    bb.hidden = !st;
  }
  async function runHbOp(kind) {
    var v = $('hb-mode');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var st = hbTarget();
    if (!st) { say('この端末には排泄ケア記録の接続先（URL と合言葉）がありません。この端末で排泄ケア記録を開き、設定で入れてから、押し直してください。', 'warn'); return; }
    if (kind === 'cut') {
      if (!(await gatePass('hb'))) { say(GATE_NG, 'warn'); return; }
      if (!hbOn()) { say('切り替えスイッチ（haiben）が入っていません。', 'warn'); return; }
      if (!(await oneDayOk('hb', say))) return;
      if (!(await window.SUDialog.confirm('排泄ケア記録の正本を新しい保存先（Supabase）へ切り替えますか？\n\n数分かかります。その間の保存は各端末に控えられ、後で送られます。終わるまでこの画面を閉じないでください。\n\n切り替えた後は、ログインしている端末だけが記録をサーバーへ送れます（ログインしていない端末は記録を端末に控え、帯で知らせます）。Google へは1時間ごとに写し返します。いつでも「排泄ケア記録を写しの期間に戻す」で戻せます。'))) return;
    } else {
      if (!(await window.SUDialog.confirm('排泄ケア記録を写しの期間に戻しますか？\n\n切り替えていた間の記録を最後まで Google へ写し返してから、Google での保存を受け付けるように戻します（その間の保存は各端末に控えられ、後で送られます）。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var bc = $('b-hb-cut'), bb = $('b-hb-back');
    bc.disabled = true; bb.disabled = true;
    var sb = SUAuth.client();
    try {
      var io = {
        gas: function (body) { return hbPost(st, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
        progress: function (t) { say(t); }
      };
      var res = kind === 'cut' ? await SUHbFull.cutover(io) : await SUHbFull.back(io);
      if (!res.ok) { say((kind === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runHbOp', res.why), 'warn'); return; }
      say(kind === 'cut' ? (res.unchanged ? 'もう切り替わっていました（何も変えていません）。' : '切り替えました（止めた後に写した日 ' + res.days + ' 日）。') + '排泄ケア記録の画面は、1分ほどで新しい保存先へ送り始めます。'
                         : '写しの期間に戻しました。正本は Google です。', 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runHbOp', e), 'warn');
    } finally {
      bc.disabled = false; bb.disabled = false;
      var keep = v.textContent, kc = v.className;
      try { await loadHbMode(sb); await loadHb(sb); } catch (e) { genoNote('排泄の読み直し', e); }   // 読み直せなくても結果の文は残す
      await gateRefresh(sb);   // 読み直しが途中で止まっても、ボタンは表の判定どおりに戻す（ほかの4つと同じ）
      v.className = kc; v.textContent = keep;
    }
  }
  /* 添付書類の正本の切り替え（統合 0065）。ボタンは管理者だけ・種類ごとに、切り替えスイッチ docs が入で、この端末にその種類の GAS の接続先（URL と合言葉）がある時だけ出す。
   * 職員マスタの書類は、職員マスタの正本を先に新しい保存先へ切り替えてある時だけ切り替えられる（GAS も確かめる） */
  var DOC_NAME = { stf: '職員マスタ', adm: '入居調整' };
  function docOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.docs === true); }
  function docTarget(kind) { return kind === 'stf' ? stfTarget() : admTarget(); }
  async function loadDocMode(sb) {
    var line = $('doc-mode');
    ['stf', 'adm'].forEach(function (k) { $('b-doc-' + k + '-cut').hidden = true; $('b-doc-' + k + '-back').hidden = true; });
    line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('doc_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('doc_mode_get');
    if (r.error || !r.data || r.data.ok !== true) return;
    var on = docOn(), parts = [], warn = false;
    ['stf', 'adm'].forEach(function (k) {
      var live = !!(r.data[k] && r.data[k].mode === 'live'), st = docTarget(k);
      if (live && !on) { warn = true; parts.push(DOC_NAME[k] + 'の書類は新しい保存先へ切り替えた後ですが、切り替えスイッチ（docs）が切です。画面が書類を置けないので、スイッチを入れ直すか「' + DOC_NAME[k] + 'の書類を写しの期間に戻す」を押してください。'); }
      else if (live) parts.push(DOC_NAME[k] + 'の書類の正本は新しい保存先（Supabase）です。Google ドライブへは1時間ごとに写し返しています。');
      else parts.push(DOC_NAME[k] + 'の書類の正本は Google ドライブです（写しの期間）。' + (st ? '' : '切り替える・戻すには、この端末で' + DOC_NAME[k] + 'を開き、設定で接続先と合言葉を入れてください。'));
      $('b-doc-' + k + '-cut').hidden = live || !on || !st;
      $('b-doc-' + k + '-back').hidden = !st;
    });
    if (!on) parts.push('切り替えるには、先に切り替えスイッチ（docs）を入れる PR の取り込みが要ります。');
    parts.push('（前の「切り替える」「写しの期間に戻す」が途中で止まり、Google での書類の出し入れが止まったままの時は「写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）');
    line.className = 'msg' + (warn ? ' warn' : '');
    line.textContent = parts.join('　');
  }
  async function runDocOp(kind, op) {
    var v = $('doc-mode'), nm = DOC_NAME[kind];
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var st = docTarget(kind);
    if (!st) { say('この端末には' + nm + 'の接続先（URL と合言葉）がありません。この端末で' + nm + 'を開き、設定で入れてから、押し直してください。', 'warn'); return; }
    if (op === 'cut') {
      if (!docOn()) { say('切り替えスイッチ（docs）が入っていません。', 'warn'); return; }
      if (!(await oneDayOk('doc', say))) return;
      if (!(await window.SUDialog.confirm(nm + 'の添付書類の正本を新しい保存先（Supabase）へ切り替えますか？\n\n数分かかります。その間は' + nm + 'で書類を置く・消すことができません。終わるまでこの画面を閉じないでください。\n\n切り替えた後は、ログインしている事務所のパソコンだけが書類を置く・開く・消すことができます。Google ドライブへは1時間ごとに写し返します。いつでも「' + nm + 'の書類を写しの期間に戻す」で戻せます。'))) return;
    } else {
      if (!(await window.SUDialog.confirm(nm + 'の書類を写しの期間に戻しますか？\n\n切り替えていた間に置いた・消した書類を最後まで Google ドライブへ写し返してから、Google での書類の出し入れを受け付けるように戻します（その間は書類を置く・消すことができません）。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var ids = ['b-doc-stf-cut', 'b-doc-stf-back', 'b-doc-adm-cut', 'b-doc-adm-back'];
    ids.forEach(function (id) { $(id).disabled = true; });
    var sb = SUAuth.client();
    try {
      var io = {
        gas: function (body) { return hbPost(st, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
        progress: function (t) { say(t); }
      };
      var res = op === 'cut' ? await SUDocFull.cutover(io, kind) : await SUDocFull.back(io, kind);
      if (!res.ok) { say((op === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runDocOp', res.why), 'warn'); return; }
      say(op === 'cut' ? (res.unchanged ? 'もう切り替わっていました（何も変えていません）。' : nm + 'の書類を切り替えました（止めた後に写した書類 ' + res.files + ' 件）。') + nm + 'の画面は、1分ほどで新しい保存先で書類を扱い始めます。'
                       : nm + 'の書類を写しの期間に戻しました。正本は Google ドライブです。', 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runDocOp', e), 'warn');
    } finally {
      ids.forEach(function (id) { $(id).disabled = false; });
      var keep = v.textContent, kc = v.className;
      try { await loadDocMode(sb); await loadDoc(sb); } catch (e) { genoNote('書類の読み直し', e); }   // 読み直せなくても結果の文は残す
      v.className = kc; v.textContent = keep;
    }
  }
  /* 正本の切り替えは1日1つ（CLAUDE.md §4）。排泄ケア記録・添付書類の「切り替える」は、今日の操作の記録を読み直して、別の正本を今日すでに
   * 切り替えていれば押させない（読めない時も押させない）。確かめの表の4項目のうち、この1つだけを当てる（画面の反証レビュー 指摘4） */
  /* 切り替える前に、その種類の受け口（Edge Function）が本番で答えるかを確かめる（2026-11-07・判定は SUCutGate.fnReady）。
   * 答えなければ、何も止めずに（GAS もデータベースの切り替えも呼ばずに）断る。送るのは中身の無い OPTIONS だけ。
   * 確かめる間はボタンを押せなくして、二度押しで確認の窓が2回出ないようにする。受け口を使わない種類は確かめない。戻す時は呼ばない */
  var FN_MS = 10000;
  function fnFetch(url, init) {
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    var tm = ac ? setTimeout(function () { ac.abort(); }, FN_MS) : null;
    return fetch(url, Object.assign({}, init, ac ? { signal: ac.signal } : {})).finally(function () { if (tm) clearTimeout(tm); });
  }
  async function fnOk(kind, btnId, say) {
    var name = SUCutGate.fnFor(kind);
    if (!name) return true;
    var b = $(btnId), was = b ? b.disabled : false;
    if (b) b.disabled = true;
    say('新しい保存先の受け口（' + name + '）が本番で答えるかを確かめています…');
    var v;
    try { v = await SUCutGate.fnReady(name, { fetch: fnFetch }); } finally { if (b) b.disabled = was; }
    if (v.ok) { say(''); return true; }
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: 受け口の確かめ', name + ' ' + v.state + ' ' + v.status); } catch (x) { /* 記録できなくても止めない */ }
    say(v.why, 'warn');
    return false;
  }
  async function oneDayOk(kind, say) {
    await gateRefresh(SUAuth.client());
    var c = gateIn && gateIn.cut;
    if (!c || c.error || !Array.isArray(c.audit)) { say('今日の切り替えの記録を読めませんでした（正本の切り替えは1日1つまでの確かめ）。少し待ってから、もう一度押してください。', 'warn'); return false; }
    var done = SUCutGate.cutsToday(c.audit, gateIn.today, kind);
    if (done.length) { say('今日すでに' + done.join('・') + 'を切り替えました。正本の切り替えは1日1つです。明日以降に押してください。', 'warn'); return false; }
    return true;
  }
  async function loadHb(sb, nowMs) {
    var kk = $('hb-kpis'), v = $('hb-verdict'), dt = $('hb-detail');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    kk.replaceChildren(); dt.className = 'msg'; dt.textContent = '';
    var st = await sb.rpc('hb_shadow_status');
    if (st.error) { say(dbErrText(st.error, 'hb_shadow_status', '排泄ケア記録の写しの準備（データベース 0062）はまだです。')); return; }
    var d = st.data || {}, s = (d.stat && typeof d.stat === 'object') ? d.stat : {};
    if (!d.lastAt) { say('まだ写していません。排泄ケア記録DB の GAS に写しの部品（shadow.gs・automirror.gs）を貼り、自動（setupAutoMirror）を入れると、1時間以内に写ります。'); return; }
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var since = Date.parse(d.since || '');
    var sinceDays = isNaN(since) ? 0 : Math.max(0, Math.floor((now - since) / 86400000));
    kk.appendChild(kpi('写した日', d.days, '日'));
    kk.appendChild(kpi('写した記録', d.rows, '件'));
    kk.appendChild(kpi('中身まで照らし合わせた日（14日）', d.verified14, '日'));
    kk.appendChild(kpi('食い違い（14日）', d.mismatch14, '日'));
    kk.appendChild(kpi('写し始めてから', sinceDays, '日'));
    var tail = '（最後に写した時刻 ' + fmtTime(d.lastAt) + '）';
    var last = Date.parse(d.lastAt || '');
    var notes = [];
    if (Number(s.left) > 0) notes.push('まだ写していない日が ' + Number(s.left) + '日あります（初めの写しの途中。次の回から続きを写します）。');
    if (Number(s.emptyHeld) > 0) notes.push('Google で記録が無くなった日が ' + Number(s.emptyHeld) + '日あり、10日を超えるので写しからは消していません。スプレッドシートの記録のタブ（Records・RecordsArchive）が消えたり名前が変わったりしていないか確かめ、開発の担当へ知らせてください。');
    if (Number(s.badId) > 0) notes.push('記録の番号か更新の時刻が新しい保存先で使えない形の記録が ' + Number(s.badId) + '件あり、写していません（開発の担当へ知らせてください）。');
    if (Number(s.badRow) > 0) notes.push('項目が多すぎる・大きすぎる記録が ' + Number(s.badRow) + '件あり、写していません（開発の担当へ知らせてください）。');
    if (Number(s.nodate) > 0) notes.push('日付の入っていない記録が ' + Number(s.nodate) + '件あります（どの日にも入らないので写していません。切り替える前に開発の担当へ知らせてください）。');
    if (Number(d.refused24h) > 0) notes.push('この24時間に受け付けなかった写しが ' + Number(d.refused24h) + '回ありました。');
    dt.textContent = (s.days != null ? 'Google の日数 ' + Number(s.days) + '日・記録 ' + Number(s.rows) + '件／最後の回: 違った日 ' + Number(s.diff || 0) + '日・写した日 ' + Number(s.sent || 0) + '日・照らし合わせ ' + Number(s.verify || 0) + '日。' : '') + (notes.length ? ' ' + notes.join(' ') : '');
    if (notes.length) dt.className = 'msg warn';
    if (d.lastStatus === 'refused') say('最後の写しは受け付けませんでした（' + refusedWord(HB_REFUSED, d.lastRefused, 'loadHb') + '）。開発の担当へ知らせてください。' + tail, 'warn');
    else if (isNaN(last) || now - last > SA_FRESH_MS) say('しばらく写っていません。排泄ケア記録DB の GAS の自動（autoMirror）が止まっていないか確かめてください。' + tail, 'warn');
    else if (Number(d.mismatch14) > 0) say('この14日に、要約は同じなのに中身が違った日が ' + Number(d.mismatch14) + '日ありました（写しは直してあります）。切り替える前に開発の担当へ知らせてください。' + tail, 'warn');
    else if (Number(s.left) > 0) say('写しが届いています（初めの写しの途中です）。' + tail, 'ok');
    else if (notes.length) say('写しは1時間ごとに届いていますが、下の知らせがあります（このままでは切り替えられません）。' + tail, 'warn');
    else say('写しが1時間ごとに届き、Google と同じです。写し始めてから ' + sinceDays + '日（2週間以上続けてから切り替えを決めます）。' + tail, 'ok');
  }
  /* 申し送りの写し（統合 0067・2026-11-05 代表者の決定: 案C の最初の段＝まず写しを作る・AI 要約は写さない）: ho_shadow_status（事務所・管理者）。
   * 出すのは種類（出来事・バイタル・食事量）ごとの日数・件数・照らし合わせの数・最後に写した時刻と、その回の数だけ（氏名・本文は返らない・出さない）。
   * 切り替えのボタンは無い（写しの期間だけ）。Google へは何も送らない */
  var HO_KIND = [['ev', '出来事'], ['vt', 'バイタル'], ['ml', '食事量']];
  var HO_REFUSED = {
    stale: '前に読んだ写し', shrink: '急に減った', badrow: '形の違い', badkind: '種類の違い', dup: '同じ日に同じ行が2つ', toomany: '一度に多すぎる',
    toolarge: '大きすぎる', future: '時刻が先'
  };
  async function loadHo(sb, nowMs) {
    var kk = $('ho-kpis'), v = $('ho-verdict'), dt = $('ho-detail');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    kk.replaceChildren(); dt.className = 'msg'; dt.textContent = '';
    var st = await sb.rpc('ho_shadow_status');
    if (st.error) { say(dbErrText(st.error, 'ho_shadow_status', '申し送りの写しの準備（データベース 0067）はまだです。')); return; }
    var d = st.data || {}, ks = (d.kinds && typeof d.kinds === 'object') ? d.kinds : {}, s = (d.stat && typeof d.stat === 'object') ? d.stat : {};
    if (!d.lastAt) { say('まだ写していません。申送ビューアの GAS に写しの部品（shadow.gs）を入れ、自動（setupHoShadow）を入れると、1時間以内に写ります。'); return; }
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var since = Date.parse(d.since || '');
    var sinceDays = isNaN(since) ? 0 : Math.max(0, Math.floor((now - since) / 86400000));
    var ver = 0, mis = 0, left = 0, notes = [], parts = [];
    HO_KIND.forEach(function (p) {
      var k = ks[p[0]] || {}, x = (s[p[0]] && typeof s[p[0]] === 'object') ? s[p[0]] : {};
      kk.appendChild(kpi(p[1] + 'の日', Number(k.days) || 0, '日'));
      ver += Number(k.verified14) || 0; mis += Number(k.mismatch14) || 0; left += Number(x.left) || 0;
      if (x.days != null) parts.push(p[1] + ': Google ' + Number(x.days) + '日・' + Number(x.rows || 0) + '行／最後の回 違った日 ' + Number(x.diff || 0) + '日・写した日 ' + Number(x.sent || 0) + '日・照らし合わせ ' + Number(x.verify || 0) + '日');
      if (Number(x.emptyHeld) > 0) notes.push(p[1] + 'で Google の行が無くなった日が ' + Number(x.emptyHeld) + '日あり、10日を超えるので写しからは消していません。申送イベントDB のタブが消えたり名前が変わったりしていないか確かめ、開発の担当へ知らせてください。');
      if (Number(x.bad) > 0) notes.push(p[1] + 'に新しい保存先で使えない形の行が ' + Number(x.bad) + '行あり、写していません（開発の担当へ知らせてください）。');
      if (Number(x.nodate) > 0) notes.push(p[1] + 'に日付の入っていない行が ' + Number(x.nodate) + '行あります（どの日にも入らないので写していません）。');
    });
    kk.appendChild(kpi('中身まで照らし合わせた日（14日）', ver, '日'));
    kk.appendChild(kpi('食い違い（14日）', mis, '日'));
    kk.appendChild(kpi('写し始めてから', sinceDays, '日'));
    if (left > 0) notes.unshift('まだ写していない日が ' + left + '日あります（初めの写しの途中。次の回から続きを写します）。');
    if (Number(d.refused24h) > 0) notes.push('この24時間に受け付けなかった写しが ' + Number(d.refused24h) + '回ありました。');
    var tail = '（最後に写した時刻 ' + fmtTime(d.lastAt) + '）';
    var last = Date.parse(d.lastAt || '');
    dt.textContent = parts.join('。') + (parts.length ? '。' : '') + (notes.length ? ' ' + notes.join(' ') : '');
    if (notes.length) dt.className = 'msg warn';
    if (d.lastStatus === 'refused') say('最後の写しは受け付けませんでした（' + refusedWord(HO_REFUSED, d.lastRefused, 'loadHo') + '）。開発の担当へ知らせてください。' + tail, 'warn');
    else if (isNaN(last) || now - last > SA_FRESH_MS) say('しばらく写っていません。申送ビューアの GAS の自動（hoShadowTick）が止まっていないか確かめてください。' + tail, 'warn');
    else if (mis > 0) say('この14日に、要約は同じなのに中身が違った日が ' + mis + '日ありました（写しは直してあります）。読み先を移す前に開発の担当へ知らせてください。' + tail, 'warn');
    else if (left > 0) say('写しが届いています（初めの写しの途中です）。' + tail, 'ok');
    else if (notes.length) say('写しは1時間ごとに届いていますが、下の知らせがあります。' + tail, 'warn');
    else say('写しが1時間ごとに届き、Google と同じです。写し始めてから ' + sinceDays + '日（2週間以上続けてから、申送ビューアの読み先を移すかを決めます）。' + tail, 'ok');
  }
  /* 切り替えボタンは、切り替えスイッチ genogram が入で、この端末に家族構成図の接続先（URL と合言葉）がある時だけ出す */
  function genoOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.genogram === true); }
  function genoTarget() {
    try {
      var o = JSON.parse(localStorage.getItem('genogram:cloudCfg') || 'null');
      var u = String(o && o.gasUrl || '').trim(), t = String(o && o.gasToken || '').trim();
      return RMASTER_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  async function loadGenoMode(sb) {
    var line = $('geno-mode'), bc = $('b-geno-cut'), bb = $('b-geno-back');
    bc.hidden = true; bb.hidden = true; line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('geno_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('geno_mode_get');
    if (r.error || !r.data) return;
    var live = r.data.mode === 'live', on = genoOn(), st = genoTarget();
    if (live && !on) { line.className = 'msg warn'; line.textContent = '家族構成図は新しい保存先へ切り替えた後ですが、切り替えスイッチ（genogram）が切です。家族構成図の画面が古い Google の中身を読まないよう、スイッチを入れ直すか「家族構成図を写しの期間に戻す」を押してください。'; }
    else if (live) { line.className = 'msg ok'; line.textContent = '家族構成図の正本は新しい保存先（Supabase）です。Google へは1時間ごとに写し返しています。'; }
    else line.textContent = '家族構成図の正本は Google です（写しの期間）。' + (on ? '' : '切り替えるには、先に切り替えスイッチ（genogram）を入れる PR の取り込みが要ります。') + (st ? '' : '切り替える・戻すには、この端末の家族構成図の ⚙ 設定で URL と編集できる合言葉を入れてください。') + (st ? '（前の「切り替える」「写しの期間に戻す」が途中で止まり、Google の保存が止まったままの時は「家族構成図を写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）' : '');
    bc.hidden = live || !on || !st;
    bb.hidden = !st;
  }
  async function runGenoOp(kind) {
    var v = $('geno-mode');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var st = genoTarget();
    if (!st) { say('この端末には家族構成図の接続先（URL と合言葉）がありません。この端末の家族構成図の ⚙ 設定で入れてから、押し直してください。', 'warn'); return; }
    if (kind === 'cut') {
      if (!genoOn()) { say('切り替えスイッチ（genogram）が入っていません。', 'warn'); return; }
      if (!(await oneDayOk('geno', say))) return;
      if (!(await window.SUDialog.confirm('家族構成図のクラウド同期の正本を新しい保存先（Supabase）へ切り替えますか？\n\n1分ほどかかります。その間はクラウドへの保存が断られます（端末には残ります）。終わるまでこの画面を閉じないでください。\n\n切り替えた後は、事務所か管理者のアカウントでログインしている端末だけが図を保存・削除できます（現場のアカウントは見るだけ・ログインしていない端末は使えません）。Google へは1時間ごとに写し返します。いつでも「家族構成図を写しの期間に戻す」で戻せます。'))) return;
    } else {
      if (!(await window.SUDialog.confirm('家族構成図を写しの期間に戻しますか？\n\n切り替えていた間の保存・削除を最後まで Google へ写し返してから、Google での保存を受け付けるように戻します。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var bc = $('b-geno-cut'), bb = $('b-geno-back');
    bc.disabled = true; bb.disabled = true;
    var sb = SUAuth.client();
    try {
      var io = {
        gas: function (body) { return rmasterPost(st, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
        progress: function (t) { say(t); }
      };
      var res = kind === 'cut' ? await SUGenoFull.cutover(io) : await SUGenoFull.back(io);
      if (!res.ok) { say((kind === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runGenoOp', res.why), 'warn'); return; }
      say(kind === 'cut' ? (res.unchanged ? 'もう切り替わっていました（何も変えていません）。' : '切り替えました（写した図 ' + res.docs + ' 枚・利用者No に結び付いた図 ' + res.linked + ' 枚）。') + '家族構成図の画面は、読み込み直すと新しい保存先で同期します。'
                         : '写しの期間に戻しました。正本は Google です。', 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runGenoOp', e), 'warn');
    } finally {
      bc.disabled = false; bb.disabled = false;
      var keep = v.textContent, kc = v.className;
      try { await loadGenoMode(sb); await loadGeno(sb); } catch (e) { genoNote('読み直し', e); }   // 読み直せなくても結果の文は残す
      v.className = kc; v.textContent = keep;
    }
  }

  var STF_REFUSED = { stale: '古い版', shrink: '急に減った', badrow: '形の違い', toolarge: '大きすぎる' };
  function stfUrl() {
    try { var o = JSON.parse(localStorage.getItem('stfm_cfg') || 'null'); var u = String(o && o.url || '').trim(); return RMASTER_RE.test(u) ? u : ''; } catch (e) { return ''; }
  }
  function stfPing(url) {
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 20000);
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({ action: 'ping' }), cache: 'no-store', redirect: 'follow', signal: ctl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(tm); return (j && j.ok === true && typeof j.ver === 'number') ? j.ver : null; },
            function () { clearTimeout(tm); return null; });
  }
  async function loadStf(sb) {
    var kk = $('stf-kpis'), v = $('stf-verdict'), ul = $('stf-runs');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    kk.replaceChildren(); ul.replaceChildren();
    var st = await sb.rpc('stf_shadow_status');
    if (st.error) { say(dbErrText(st.error, 'stf_shadow_status', '職員マスタの写しの準備（データベース 0044）はまだです。')); return; }
    var d = st.data || {};
    if (d.ver == null) { say('まだ写していません。職員マスタの GAS の自動（autoMirror）が動くと、1時間以内に写ります。'); return; }
    kk.appendChild(kpi('写しの職員', d.staff, '人'));
    kk.appendChild(kpi('写しの版', d.ver, ''));
    var url = stfUrl(), gv = url ? await stfPing(url) : null;
    if (gv != null) kk.appendChild(kpi('Google の版', gv, ''));
    var tail = '（最後に写した時刻 ' + fmtTime(d.updatedAt) + '）';
    /* 差の日ごとの記録（統合 0055）: 断った・写しが Google より新しい＝差1件、版が一致＝0件。Google が新しい（次の写しでそろう）・読めない時は残さない */
    if (d.lastStatus === 'refused') await noteDiff(sb, 'stf', 1);
    else if (url && gv != null && gv === d.ver) await noteDiff(sb, 'stf', 0);
    else if (url && gv != null && gv < d.ver) await noteDiff(sb, 'stf', 1);
    if (d.lastStatus === 'refused') say('最後の写しは受け付けませんでした（' + refusedWord(STF_REFUSED, d.lastRefused, 'loadStf') + '）。開発の担当へ知らせてください。' + tail, 'warn');
    else if (!url) say('写しはあります。この端末には職員マスタの接続先が無いので、Google の版とは見比べていません。' + tail);
    else if (gv == null) say('写しはあります。Google の版を読めませんでした（少し待ってから開き直してください）。' + tail, 'warn');
    else if (gv === d.ver) say('写しの版が Google と一致しています。' + tail, 'ok');
    else if (gv > d.ver) say('Google の方が新しい版です。次の自動の写し（1時間ごと）でそろいます。' + tail);
    else say('写しの版が Google より新しくなっています。開発の担当へ知らせてください。' + tail, 'warn');
    var r = await sb.from('stf_sync_runs').select('at,status,refused,result,ver,staff').order('id', { ascending: false }).limit(5);
    (r.data || []).forEach(function (x) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(x.at)));
      left.appendChild(el('div', 'em', x.status === 'done'
        ? '版 ' + x.ver + '／職員 ' + x.staff + '人／' + (ADM_RESULT[x.result] || '')
        : '受け付けず（' + refusedWord(STF_REFUSED, x.refused, 'loadStf') + '）'));
      li.appendChild(left);
      ul.appendChild(li);
    });
  }

  /* ログインしていない端末の数（統合 0048・2026-11-02 代表者の依頼）: device_seen_summary（管理者・aal2 だけ）。
   * 用途（事務所／現場）とログインの有無ごとに、今日・7日・30日以内に開いた端末の数だけを出す。端末の印は返らない・出さない */
  var DS_ROLE = { office: '事務所の端末', field: '現場の端末' };
  async function loadDeviceSeen(sb) {
    var kk = $('ds-kpis'), v = $('ds-verdict'), ul = $('ds-rows');
    function say(t, kind) { v.className = 'msg' + (kind ? ' ' + kind : ''); v.textContent = t; }
    kk.replaceChildren(); ul.replaceChildren();
    var r = await sb.rpc('device_seen_summary');
    if (r.error) {
      if (r.error.code === '42501') say('数を見られるのは管理者（2段階認証まで済んだ状態）だけです。');
      else say('ログインしていない端末の数の準備（データベース 0048）はまだです。');
      return;
    }
    var d = r.data || {}, rows = Array.isArray(d.rows) ? d.rows : [];
    if (!rows.length && !(Array.isArray(d.hb) && d.hb.length)) { say('まだ記録がありません。送るスイッチ（device_seen）が入ると、端末が画面を開いた日に1回ずつ届きます。'); return; }
    function sum(login, k) { return rows.filter(function (x) { return x.login === login; }).reduce(function (n, x) { return n + (Number(x[k]) || 0); }, 0); }
    kk.appendChild(kpi('ログインしていない（7日）', sum(false, 'd7'), '台'));
    kk.appendChild(kpi('ログインしていない（30日）', sum(false, 'd30'), '台'));
    kk.appendChild(kpi('ログイン中（7日）', sum(true, 'd7'), '台'));
    var out7 = sum(false, 'd7'), tail = '（最後に届いた時刻 ' + fmtTime(d.lastAt) + '）';
    /* 排泄ケア記録を開いた端末（統合 0062・2026-11-03）。切り替える前に「ログインしていない」が0台になったことを確かめる */
    var hb = Array.isArray(d.hb) ? d.hb : null;
    function hsum(login, k) { return (hb || []).filter(function (x) { return x.login === login; }).reduce(function (n, x) { return n + (Number(x[k]) || 0); }, 0); }
    if (hb) kk.appendChild(kpi('排泄ケア記録・ログインしていない（7日）', hsum(false, 'd7'), '台'));
    if (out7 > 0) say('この7日に、ログインしていない端末が ' + out7 + '台 入居者マスタを読む画面を開いています。その端末でログインしてください。' + tail, 'warn');
    else say('この7日に入居者マスタを読む画面を開いた端末は、すべてログインしています。' + tail, 'ok');
    if (hb) {
      var hb7 = hsum(false, 'd7'), hbIn7 = hsum(true, 'd7');
      var li0 = el('li'), left0 = el('div');
      left0.appendChild(el('div', 'nm', '排泄ケア記録を開いた端末'));
      left0.appendChild(el('div', 'em', hb7 + hbIn7 === 0 ? 'この7日はまだ届いていません（排泄ケア記録の画面が新しい版になると、開いた日に1回ずつ届きます）。'
        : 'この7日: ログインしていない ' + hb7 + '台／ログイン中 ' + hbIn7 + '台' + (hb7 > 0 ? '（切り替える前に、その端末でログインしてください）' : '（切り替えの前の確かめ: すべてログインしています）')));
      li0.appendChild(left0);
      ul.appendChild(li0);
    }
    rows.forEach(function (x) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', (DS_ROLE[x.role] || String(x.role || '')) + '・' + (x.login ? 'ログイン中' : 'ログインしていない')));
      left.appendChild(el('div', 'em', '今日 ' + (Number(x.d1) || 0) + '台／7日 ' + (Number(x.d7) || 0) + '台／30日 ' + (Number(x.d30) || 0) + '台'));
      li.appendChild(left);
      ul.appendChild(li);
    });
  }

  /* 職員マスタの正本の切り替え（統合 0045・2026-11-02）: 入居調整と同じ手順（su-stf-full.js の cutover・back）。管理者だけ・事務所PCだけ。
   * 切り替えボタンは切り替えスイッチ staff が入で、この端末に職員マスタの接続先がある時だけ出す。添付ファイル（Google ドライブ）はどちらでも触らない */
  function staffOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.staff === true); }
  function stfTarget() {
    try {
      var o = JSON.parse(localStorage.getItem('stfm_cfg') || 'null');
      var u = String(o && o.url || '').trim(), t = String(o && o.token || '').trim();
      return RMASTER_RE.test(u) && t ? { url: u, token: t } : null;
    } catch (e) { return null; }
  }
  async function loadStfMode(sb) {
    var line = $('stf-mode'), bc = $('b-stf-cut'), bb = $('b-stf-back');
    bc.hidden = true; bb.hidden = true; line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('stf_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('stf_mode_get');
    if (r.error || !r.data) return;
    var live = r.data.mode === 'live', on = staffOn(), st = stfTarget();
    if (live && !on) { line.className = 'msg warn'; line.textContent = '職員マスタは新しい保存先へ切り替えた後ですが、切り替えスイッチ（staff）が切です。画面が古い Google の中身を読まないよう、スイッチを入れ直すか「職員マスタを写しの期間に戻す」を押してください。'; }
    else if (live) { line.className = 'msg ok'; line.textContent = '職員マスタの正本は新しい保存先（Supabase）です。Google へは保存のたびと1時間ごとに写し返しています。添付ファイルは今までどおり Google ドライブです。'; }
    else line.textContent = '職員マスタの正本は Google です（写しの期間）。' + (on ? '' : '切り替えるには、先に切り替えスイッチ（staff）を入れる PR の取り込みが要ります。') + (st ? '（前の「切り替える」「写しの期間に戻す」が途中で止まり、Google の保存が止まったままの時は「職員マスタを写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）' : '');
    bc.hidden = live || !on || !st;
    /* 戻すボタンは、接続先がある管理者にはいつも出す（職員マスタの GAS も止めたままかを答えない。備品と同じ・反証レビュー指摘3） */
    bb.hidden = !st;
  }
  async function runStfOp(kind) {
    var v = $('stf-mode');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var st = stfTarget();
    if (!st) { say('この端末には職員マスタの接続先（Google）がありません。この端末で職員マスタを開いてから、押し直してください。', 'warn'); return; }
    if (kind === 'cut') {
      if (!(await gatePass('stf'))) { say(GATE_NG, 'warn'); return; }
      if (!staffOn()) { say('切り替えスイッチ（staff）が入っていません。', 'warn'); return; }
      if (!(await fnOk('stf', 'b-stf-cut', say))) return;
      if (!(await window.SUDialog.confirm('職員マスタの正本を新しい保存先（Supabase）へ切り替えますか？\n\n1分ほどかかります。その間は職員マスタ・採用管理からの保存が断られます（「読み込み直して」と出ます）。終わるまでこの画面を閉じないでください。\n\n添付ファイルは今までどおり Google ドライブに置きます。切り替えた後は、保存のたびと1時間ごとに Google へ写し返します。いつでも「職員マスタを写しの期間に戻す」で戻せます。'))) return;
    } else {
      if (!(await window.SUDialog.confirm('職員マスタを写しの期間に戻しますか？\n\n切り替えていた間の保存を最後まで Google へ写し返してから、Google での保存を受け付けるように戻します。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var bc = $('b-stf-cut'), bb = $('b-stf-back');
    bc.disabled = true; bb.disabled = true;
    var sb = SUAuth.client();
    try {
      var io = {
        gas: function (body) { return rmasterPost(st, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
        progress: function (t) { say(t); }
      };
      var res = kind === 'cut' ? await SUStfFull.cutover(io) : await SUStfFull.back(io);
      if (!res.ok) { say((kind === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runStfOp', res.why), 'warn'); return; }
      say(kind === 'cut' ? '切り替えました（写した職員 ' + res.rows + '人）。職員マスタ・採用管理の画面は、読み込み直すと新しい保存先で保存します。'
                         : '写しの期間に戻しました。正本は Google です。', 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runStfOp', e), 'warn');
    } finally {
      bc.disabled = false; bb.disabled = false;
      var keep = v.textContent, kc = v.className;
      try { await loadStfMode(sb); await loadStf(sb); } catch (e) { /* 読み直せなくても結果の文は残す */ }
      await gateRefresh(sb);   // 読み直しが途中で止まっても、ボタンは表の判定どおりに戻す（反証レビュー指摘4）
      v.className = kc; v.textContent = keep;
    }
  }

  /* 入居調整の台帳の正本の切り替え（統合 0042・2026-10-29）: 計画書と同じ手順（su-adm-full.js の cutover・back）。管理者だけ・事務所PCだけ。
   * 切り替えボタンは、切り替えスイッチ admission が入の時だけ出す。添付書類（Drive）はどちらでも触らない（案A）。
   * Google の印が立ったまま（前の戻しが途中）の時は、知らせて「写しの期間に戻す」を出す */
  function admissionOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.admission === true); }
  var admState = null;   // 直前に読んだ状態（戻すの確かめの文を選ぶ・反証レビュー指摘3）
  async function loadAdmMode(sb) {
    var line = $('admf-mode'), bc = $('b-adm-cut'), bb = $('b-adm-back');
    bc.hidden = true; bb.hidden = true; line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('adm_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('adm_mode_get');
    if (r.error || !r.data) return;
    var live = r.data.mode === 'live', on = admissionOn(), stuck = false;
    var at = admTarget();
    /* 戻すボタンは、接続先がある管理者にはいつも出す（職員マスタと同じ・2026-11-03）。Google が答えるのを待たずに先に出す（反証レビュー指摘6） */
    bb.hidden = !at;
    var unknown = false;
    if (!live && at) { try { var pg = await rmasterPost(at, { action: 'ping' }); stuck = !!(pg && pg.switched === true); } catch (e) { stuck = false; unknown = true; } }
    admState = { live: live, stuck: stuck, unknown: unknown };
    if (live && !on) { line.className = 'msg warn'; line.textContent = '入居調整は新しい保存先へ切り替えた後ですが、切り替えスイッチ（admission）が切です。画面が古い Google の中身を読まないよう、スイッチを入れ直すか「入居調整を写しの期間に戻す」を押してください。'; }
    else if (live) { line.className = 'msg ok'; line.textContent = '入居調整の台帳の正本は新しい保存先（Supabase）です。Google へは保存のたびに写し返しています。添付書類は今までどおり Google（Drive）です。'; }
    else if (stuck) { line.className = 'msg warn'; line.textContent = '前の「入居調整を写しの期間に戻す」が途中です（Google の保存を止めたままです）。もう一度押して、最後まで済ませてください。'; }
    else line.textContent = '入居調整の台帳の正本は Google です（写しの期間）。' + (on ? '' : '切り替えるには、先に切り替えスイッチ（admission）を入れる PR の取り込みが要ります。') + (at ? '（前の「切り替える」「入居調整を写しの期間に戻す」が途中で止まり、Google の保存が止まったままの時は「入居調整を写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）' : '')
      + (unknown ? '　Google に確かめられませんでした。止まったままなら『入居調整を写しの期間に戻す』を押してください。' : '');
    bc.hidden = live || stuck || !on || !at;
  }
  async function runAdmOp(kind) {
    var v = $('admf-mode');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var at = admTarget();
    if (!at) { say('この端末には入居調整の接続先（Google）がありません。この端末で入居調整を開いてから、押し直してください。', 'warn'); return; }
    if (kind === 'cut') {
      if (!(await gatePass('adm'))) { say(GATE_NG, 'warn'); return; }
      if (!admissionOn()) { say('切り替えスイッチ（admission）が入っていません。', 'warn'); return; }
      if (!(await fnOk('adm', 'b-adm-cut', say))) return;
      if (!(await window.SUDialog.confirm('入居調整の台帳の正本を新しい保存先（Supabase）へ切り替えますか？\n\n1分ほどかかります。その間は台帳の保存が断られます（「読み込み直して」と出ます）。終わるまでこの画面を閉じないでください。\n\n添付書類は今までどおり Google（Drive）に置きます。切り替えた後は、保存のたびに Google へ写し返します。いつでも「入居調整を写しの期間に戻す」で戻せます。'))) return;
    } else {
      /* 切り替えた後でも途中でもない時は、それに合う文で確かめる（反証レビュー指摘3） */
      var idle = !!(admState && !admState.live && !admState.stuck);
      if (!(await window.SUDialog.confirm(idle ? '入居調整の「写しの期間に戻す」を押しますか？\n\n止まったままの切り替えを終わらせます。止まっていなければ何も変わりません。'
                        : '入居調整を写しの期間に戻しますか？\n\n新しい保存先での保存を止め、切り替えていた間の保存を最後まで Google へ写し返してから、Google での保存を受け付けるように戻します。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var bc = $('b-adm-cut'), bb = $('b-adm-back');
    bc.disabled = true; bb.disabled = true;
    var sb = SUAuth.client();
    try {
      var io = {
        gas: function (body) { return rmasterPost(at, body); },
        rpc: function (name, args) { return sb.rpc(name, args); },
        token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
        progress: function (t) { say(t); }
      };
      var res = kind === 'cut' ? await SUAdmFull.cutover(io) : await SUAdmFull.back(io);
      if (!res.ok) { say((kind === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runAdmOp', res.why), 'warn'); return; }
      say(kind === 'cut' ? '切り替えました（生きている案件 ' + res.active + '件）。入居調整の画面は読み込み直すと新しい保存先で保存します。'
                         : (res.nothing ? '切り替えていないので、戻すものはありません。' : '写しの期間に戻しました（Google へ写し返した台帳 ' + res.docs + '件）。正本は Google です。'), 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runAdmOp', e), 'warn');
    } finally {
      bc.disabled = false; bb.disabled = false;
      var keep = v.textContent, kc = v.className;
      try { await loadAdmMode(sb); await loadAdmRuns(sb); } catch (e) { /* 読み直せなくても結果の文は残す */ }
      await gateRefresh(sb);   // 読み直しが途中で止まっても、ボタンは表の判定どおりに戻す（反証レビュー指摘4）
      v.className = kc; v.textContent = keep;
    }
  }

  /* 個別機能訓練計画書の正本の切り替え（統合 0038・2026-10-29）: 入居者マスタと同じ手順（su-tp-full.js の cutover・back）。管理者だけ・事務所PCだけ。
   * 切り替えボタンは切り替えスイッチ training が入で、この端末に計画書と入居者マスタの接続先がある時だけ出す。
   * 計画書の GAS の印が立ったまま（前の戻しが途中）の時は、知らせて「写しの期間に戻す」を出す */
  function trainingOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.training === true); }
  var tpState = null;   // 直前に読んだ状態（戻すの確かめの文を選ぶ・反証レビュー指摘3）
  async function loadTpMode(sb) {
    var line = $('tpf-mode'), bc = $('b-tp-cut'), bb = $('b-tp-back');
    bc.hidden = true; bb.hidden = true; line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('tp_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('tp_mode_get');
    if (r.error || !r.data) return;
    var live = r.data.mode === 'live', on = trainingOn(), stuck = false;
    var tt = tpTarget(), mt = rmasterTarget();
    /* 戻すボタンは、接続先がある管理者にはいつも出す（職員マスタと同じ・2026-11-03）。Google が答えるのを待たずに先に出す（反証レビュー指摘6） */
    bb.hidden = !tt;
    var unknown = false;
    if (!live && tt) { try { var pg = await rmasterPost(tt, { action: 'ping' }); stuck = !!(pg && pg.switched === true); } catch (e) { stuck = false; unknown = true; } }
    tpState = { live: live, stuck: stuck, unknown: unknown };
    if (live && !on) { line.className = 'msg warn'; line.textContent = '計画書は新しい保存先へ切り替えた後ですが、切り替えスイッチ（training）が切です。画面が古い Google の中身を読まないよう、スイッチを入れ直すか「計画書を写しの期間に戻す」を押してください。'; }
    else if (live) { line.className = 'msg ok'; line.textContent = '計画書の正本は新しい保存先（Supabase）です。Google へは保存のたびに写し返しています。'; }
    else if (stuck) { line.className = 'msg warn'; line.textContent = '前の「計画書を写しの期間に戻す」が途中です（Google の保存を止めたままです）。もう一度押して、最後まで済ませてください。'; }
    else line.textContent = '計画書の正本は Google です（写しの期間）。' + (on ? '' : '切り替えるには、先に切り替えスイッチ（training）を入れる PR の取り込みが要ります。') + (tt ? '（前の「切り替える」「計画書を写しの期間に戻す」が途中で止まり、Google の保存が止まったままの時は「計画書を写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）' : '')
      + (unknown ? '　Google に確かめられませんでした。止まったままなら『計画書を写しの期間に戻す』を押してください。' : '');
    bc.hidden = live || stuck || !on || !tt || !mt;
    $('b-tp-ai').hidden = false;
  }
  /* AI の中継の受け口（su-ai・統合 0028）へ、「はい」とだけ答えさせる決まった短い依頼を1回送り、届いたか・答えの状態だけを出す
   * （2026-10-30 代表者「確かめボタン」。切り替えスイッチ training_ai が切のままでも確かめられる）。管理者だけ。
   * 入居者の情報は送らない。1回の利用として数える。出すのは状態の番号・断りの種類・かかった秒数だけ */
  /* 受け口が返した断りの文は、日本語の時だけ「・文」で添える。英語・印だけの時は画面に出さず記録に残す（2026-11-13・仮置き） */
  function aiWhyTail(s, max) {
    s = String(s || '');
    if (!s) return '';
    if (JA_CHAR.test(s)) return '・' + s.slice(0, max);
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: AI の受け口の断り', s.slice(0, 200)); } catch (e) { /* 記録できなくても止めない */ }
    return '';
  }
  function aiProbeText(r, sec) {
    if (r && r.error) {
      var ctx = r.error.context, nm = String(r.error.name || '');
      if (ctx && typeof ctx.status === 'number') return Promise.resolve(typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : null).then(function (d) {
        return { k: 'warn', t: '受け口は答えましたが、断られました（状態 ' + ctx.status + (d && typeof d.error === 'string' ? aiWhyTail(d.error, 40) : d && typeof d.message === 'string' ? aiWhyTail(d.message, 60) : '') + '・' + sec + '秒）。' };
      });
      if (nm === 'FunctionsRelayError') { aiWhyTail(nm + ' ' + String(r.error.message || ''), 80); return Promise.resolve({ k: 'warn', t: '受け口の手前の中継で止まりました（' + sec + '秒）。' }); }
      return Promise.resolve({ k: 'warn', t: '受け口に届きませんでした（' + sec + '秒）。' + jaWhy('AI の受け口', r.error) });
    }
    var d = r ? r.data : null;
    if (d && d.ok === true && Number(d.status) >= 200 && Number(d.status) < 300) return Promise.resolve({ k: 'ok', t: '届きました。AI が答えました（' + sec + '秒）。新しい受け口は使えます。' });
    if (d && d.ok === true) return Promise.resolve({ k: 'warn', t: '受け口には届きましたが、AI が断りました（状態 ' + d.status + '・' + sec + '秒）。' });
    if (d && d.ok === false) { var tl = aiWhyTail(d.error, 40); return Promise.resolve({ k: 'warn', t: '受け口には届きましたが、断られました（' + (tl ? tl.slice(1) + '・' : '') + sec + '秒）。' }); }
    return Promise.resolve({ k: 'warn', t: '受け口から読めない答えが返りました（' + sec + '秒）。' });
  }
  async function runTpAi() {
    var v = $('tpf-ai');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    if (!(await window.SUDialog.confirm('AI の中継（新しい受け口）へ、「はい」とだけ答えさせる短い依頼を1回送りますか？\n\n入居者の情報は送りません。1回の利用として数えます。'))) return;
    var b = $('b-tp-ai'), t0 = Date.now();
    b.disabled = true; say('送っています…');
    try {
      var r = await SUAuth.client().functions.invoke('su-ai', { body: { purpose: 'training_plan',
        body: { model: 'claude-sonnet-5', max_tokens: 16, messages: [{ role: 'user', content: '「はい」とだけ答えてください' }] } } });
      var o = await aiProbeText(r, Math.round((Date.now() - t0) / 1000));
      say(o.t, o.k);
    } catch (e) {
      say('送れませんでした（' + jaWhy('runTpAi', e, true) + '・' + Math.round((Date.now() - t0) / 1000) + '秒）。', 'warn');
    } finally { b.disabled = false; }
  }
  async function runTpOp(kind) {
    var v = $('tpf-mode');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var tt = tpTarget(), mt = rmasterTarget();
    if (!tt || (kind === 'cut' && !mt)) { say('この端末には計画書・入居者マスタの接続先（Google）がありません。この端末で両方を開いてから、押し直してください。', 'warn'); return; }
    if (kind === 'cut') {
      if (!(await gatePass('tp'))) { say(GATE_NG, 'warn'); return; }
      if (!trainingOn()) { say('切り替えスイッチ（training）が入っていません。', 'warn'); return; }
      if (!(await fnOk('tp', 'b-tp-cut', say))) return;
      if (!(await window.SUDialog.confirm('個別機能訓練計画書の正本を新しい保存先（Supabase）へ切り替えますか？\n\n数分かかります。その間は計画書の保存が断られます（「読み込み直して」と出ます）。終わるまでこの画面を閉じないでください。\n\n切り替えた後は、保存のたびに Google へ写し返します。いつでも「計画書を写しの期間に戻す」で戻せます。'))) return;
    } else {
      /* 切り替えた後でも途中でもない時は、それに合う文で確かめる（反証レビュー指摘3） */
      var idle = !!(tpState && !tpState.live && !tpState.stuck);
      if (!(await window.SUDialog.confirm(idle ? '個別機能訓練計画書の「写しの期間に戻す」を押しますか？\n\n止まったままの切り替えを終わらせます。止まっていなければ何も変わりません。'
                        : '個別機能訓練計画書を写しの期間に戻しますか？\n\n新しい保存先での保存を止め、切り替えていた間の保存を最後まで Google へ写し返してから、Google での保存を受け付けるように戻します。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var bc = $('b-tp-cut'), bb = $('b-tp-back');
    bc.disabled = true; bb.disabled = true;
    var sb = SUAuth.client();
    try {
      var io = {
        gas: function (body) { return rmasterPost(tt, body); },
        rosterIds: async function () {
          var j = await rmasterPost(mt, { action: 'getRoster' });
          if (!j || !Array.isArray(j.roster)) throw new Error('名簿');
          return j.roster.map(function (x) { return x && x.id; });
        },
        rpc: function (name, args) { return sb.rpc(name, args); },
        token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
        progress: function (t) { say(t); }
      };
      var res = kind === 'cut' ? await SUTpFull.cutover(io) : await SUTpFull.back(io);
      if (!res.ok) { say((kind === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runTpOp', res.why), 'warn'); return; }
      say(kind === 'cut' ? '切り替えました（計画書 ' + res.docs + '件）。計画書の画面は読み込み直すと新しい保存先で保存します。'
                         : (res.nothing ? '切り替えていないので、戻すものはありません。' : '写しの期間に戻しました（Google へ写し返した計画書 ' + res.docs + '件）。正本は Google です。'), 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runTpOp', e), 'warn');
    } finally {
      bc.disabled = false; bb.disabled = false;
      var keep = v.textContent, kc = v.className;
      try { await loadTpMode(sb); await loadTpRuns(sb); } catch (e) { /* 読み直せなくても結果の文は残す */ }
      await gateRefresh(sb);   // 読み直しが途中で止まっても、ボタンは表の判定どおりに戻す（反証レビュー指摘4）
      v.className = kc; v.textContent = keep;
    }
  }

  /* 入居者マスタの正本の切り替え（統合 0036・2026-10-29 代表者の決定 案1）: 管理者だけ・事務所PCだけ。
   * 切り替える＝Google の保存を止める→止めた後の全項目の写し→全員一致の時だけタブを写す→切り替える（su-res-full.js の cutover）。
   * 戻す＝写しの期間に戻す→Google へ最後まで写し返してから止める印を外す（back）。どちらもデータベースの操作の札を取ってから行う。
   * 切り替えボタンは、切り替えスイッチ master_live が入の時だけ出す（切のまま切り替えると、画面が Google へ送って断られ、保存できなくなる）。
   * Google の印が立ったまま（前の戻しが途中）の時は、知らせて「写しの期間に戻す」を出す */
  function masterLiveOn() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.master_live === true); }
  var resState = null;   // 直前に読んだ状態（戻すの確かめの文を選ぶ・反証レビュー指摘3）
  async function loadResMode(sb) {
    var line = $('rf-mode'), bc = $('b-res-cut'), bb = $('b-res-back');
    bc.hidden = true; bb.hidden = true; line.className = 'msg'; line.textContent = '';
    if (!(me && me.role === 'admin')) return;
    var r = await sb.rpc('res_mode_get');
    if (r.error && dbErrKind(r.error) === 'missing') notePrep('res_mode_get');
    if (r.error || !r.data) return;
    var live = r.data.mode === 'live', on = masterLiveOn(), stuck = false;
    var tgt = rmasterTarget();
    /* 戻すボタンは、接続先がある管理者にはいつも出す（職員マスタと同じ・2026-11-03）。Google が答えるのを待たずに先に出す（反証レビュー指摘6） */
    bb.hidden = !tgt;
    var unknown = false;
    if (!live && tgt) { try { var pg = await rmasterPost(tgt, { action: 'ping' }); stuck = !!(pg && pg.switched === true); } catch (e) { stuck = false; unknown = true; } }
    resState = { live: live, stuck: stuck, unknown: unknown };
    if (live && !on) { line.className = 'msg warn'; line.textContent = '入居者マスタは新しい保存先へ切り替えた後ですが、切り替えスイッチ（master_live）が切です。画面が古い Google の中身を読まないよう、スイッチを入れ直すか「写しの期間に戻す」を押してください。'; }
    else if (live) { line.className = 'msg ok'; line.textContent = '入居者マスタの正本は新しい保存先（Supabase）です。Google へは保存のたびに写し返しています。'; }
    else if (stuck) { line.className = 'msg warn'; line.textContent = '前の「写しの期間に戻す」が途中です（Google の保存を止めたままです）。「写しの期間に戻す」をもう一度押して、最後まで済ませてください。'; }
    else line.textContent = '入居者マスタの正本は Google です（写しの期間）。' + (on ? '' : '切り替えるには、先に切り替えスイッチ（master_live）を入れる PR の取り込みが要ります。') + (tgt ? '（前の「切り替える」「写しの期間に戻す」が途中で止まり、Google の保存が止まったままの時は「写しの期間に戻す」を押すと最後まで済ませます。途中でなければ押しても何も変わりません）' : '')
      + (unknown ? '　Google に確かめられませんでした。止まったままなら『写しの期間に戻す』を押してください。' : '');
    bc.hidden = live || stuck || !on || !tgt;
  }
  function resOpIo(sb, tgt, say) {
    return {
      gas: function (body) { return rmasterPost(tgt, body); },
      rpc: function (name, args) { return sb.rpc(name, args); },
      lastRun: async function (id) { var r = await sb.from('res_sync_runs').select('unknown_keys').eq('id', id).limit(1); return r.error ? null : (r.data || [])[0]; },
      token: async function () { var s2 = await sb.auth.getSession(); return s2 && s2.data && s2.data.session ? s2.data.session.access_token : null; },
      progress: function (t) { say(t); }
    };
  }
  async function runResOp(kind) {
    var v = $('rf-mode');
    function say(t, k) { v.className = 'msg' + (k ? ' ' + k : ''); v.textContent = t; }
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { say('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var role = ''; try { role = localStorage.getItem('su_device_role') || ''; } catch (e) { role = ''; }
    if (role === 'field') { say('この端末は「現場」です。事務所のパソコンで行ってください。', 'warn'); return; }
    var tgt = rmasterTarget();
    if (!tgt) { say('この端末には入居者マスタの接続先（Google）がありません。この端末で入居者マスタを開いてから、押し直してください。', 'warn'); return; }
    if (kind === 'cut') {
      if (!(await gatePass('res'))) { say(GATE_NG, 'warn'); return; }
      if (!masterLiveOn()) { say('切り替えスイッチ（master_live）が入っていません。', 'warn'); return; }
      if (!(await fnOk('res', 'b-res-cut', say))) return;
      if (!(await window.SUDialog.confirm('入居者マスタの正本を新しい保存先（Supabase）へ切り替えますか？\n\n数分かかります。その間は入居者マスタ・担当者会議・入居調整などの保存が断られます（「読み込み直して」と出ます）。終わるまでこの画面を閉じないでください。\n\n切り替えた後は、保存のたびに Google へ写し返します。いつでも「写しの期間に戻す」で戻せます。'))) return;
    } else {
      /* 切り替えた後でも途中でもない時は、それに合う文で確かめる（反証レビュー指摘3） */
      var idle = !!(resState && !resState.live && !resState.stuck);
      if (!(await window.SUDialog.confirm(idle ? '入居者マスタの「写しの期間に戻す」を押しますか？\n\n止まったままの切り替えを終わらせます。止まっていなければ何も変わりません。'
                        : '入居者マスタを写しの期間に戻しますか？\n\n新しい保存先での保存を止め、切り替えていた間の保存を最後まで Google へ写し返してから、Google での保存を受け付けるように戻します。'))) return;
    }
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var bc = $('b-res-cut'), bb = $('b-res-back');
    bc.disabled = true; bb.disabled = true;
    var sb = SUAuth.client();
    try {
      var res = kind === 'cut' ? await SUResFull.cutover(resOpIo(sb, tgt, say)) : await SUResFull.back(resOpIo(sb, tgt, say));
      if (!res.ok) { say((kind === 'cut' ? '切り替えられませんでした: ' : '戻せませんでした: ') + jaWhy('runResOp', res.why), 'warn'); return; }
      say(kind === 'cut' ? '切り替えました（入居者 ' + res.residents + '人）。各画面は読み込み直すと新しい保存先で保存します。'
                         : (res.nothing ? '切り替えていないので、戻すものはありません。' : '写しの期間に戻しました（Google へ写し返した方 ' + res.records + '人）。正本は Google です。'), 'ok');
    } catch (e) {
      say('止まりました: ' + jaWhy('runResOp', e), 'warn');
    } finally {
      bc.disabled = false; bb.disabled = false;
      var keep = v.textContent, kc = v.className;
      try { await loadResMode(sb); await loadResFullRuns(sb); } catch (e) { /* 読み直せなくても結果の文は残す */ }
      await gateRefresh(sb);   // 読み直しが途中で止まっても、ボタンは表の判定どおりに戻す（反証レビュー指摘4）
      v.className = kc; v.textContent = keep;
    }
  }

  /* 体重の切り替え（統合 0032）: 印（weight_mode）を読んで出す。表がまだ無い（0032 の前）時は '' */
  var weightMode = '';
  var WT_MIRROR_LS = 'wtmgr_mirror_q';
  function weightMirrorCount() { try { var q = JSON.parse(localStorage.getItem(WT_MIRROR_LS) || '[]'); return Array.isArray(q) ? q.length : 0; } catch (e) { return 0; } }
  function weightSwitch() { var sw = window.SUKv ? SUKv._flags() : null; return !!(sw && sw.supabase && sw.supabase.weight === true); }
  async function loadWeightMode(sb) {
    var m = $('wt-mode');
    weightMode = '';
    var r = await sb.from('weight_mode').select('mode,updated_at').limit(1);
    if (r.error) { m.className = 'msg'; m.textContent = dbErrText(r.error, 'weight_mode', '体重の切り替えの準備（データベース 0032）はまだです。今は写しの期間です。'); return; }
    var row = (r.data || [])[0];
    weightMode = row && row.mode === 'live' ? 'live' : 'shadow';
    var mc = weightMirrorCount();
    m.className = 'msg ' + (weightMode === 'live' ? 'ok' : '');
    m.textContent = (weightMode === 'live'
      ? '体重の保存先: Supabase（本番）。切り替えた日時 ' + fmtTime(row.updated_at) + '。'
      : '体重の保存先: Google（写しの期間）。切り替えスイッチ weight は「' + (weightSwitch() ? '入' : '切') + '」です。')
      + (mc ? '　この端末に Google への写し返し待ちが ' + mc + '件あります（体重管理を開くと送ります）。' : '');
  }
  /* 管理者だけ: 体重の保存先の切り替え・戻し（weight_set_mode）。確認を2回とる。
   * 切り替えはスイッチ weight が入の時だけ（データベースは30分以内の写しがある時だけ受け付ける）。戻すのはいつでも */
  function weightModeBlock(mode, sw) {
    if (mode === 'live' && !sw) return '体重の切り替えスイッチ（weight）がまだ「入」になっていません。先にスイッチを入れる PR を取り込み、1分ほど待ってから画面を開き直してください。';
    return '';
  }
  async function setWeightMode(mode) {
    if (!(me && me.role === 'admin' && me.status === SUAuth.STATUS.OK)) { msg('管理者（二段階認証済み）のアカウントで開いてください。', 'warn'); return; }
    var why0 = weightModeBlock(mode, weightSwitch());
    if (why0) { msg(why0, 'warn'); return; }
    if (mode === 'live' && !(await gatePass('weight'))) { msg(GATE_NG, 'warn'); return; }
    var q = mode === 'live'
      ? '体重の保存先を Supabase（本番）に切り替えますか？\n\n15分以内に事務所PCで体重管理を開き、写しを最新にしてから進めてください。切り替えた後も、Google へは各端末が写し返します。'
      : '体重を「写しの期間」に戻しますか？\n\n各端末は次の通信から Google へ送ります（端末に残っている Google への写し返しを先に送ります）。';
    if (!(await window.SUDialog.confirm(q))) return;
    if (!(await window.SUDialog.confirm('本当に実行しますか？（操作は記録に残ります）'))) return;
    var r = await SUAuth.client().rpc('weight_set_mode', { p_mode: mode });
    if (r.error || !r.data || !r.data.ok) {
      var why = String((r.error && (r.error.code || r.error.message)) || (r.data && r.data.error) || '');
      msg('変更できませんでした: ' + (why === 'stale' ? '写しが15分より前か、最後の写しを受け付けていません。事務所PCで体重管理を開き、数秒待ってから、もう一度押してください。'
        : why === 'writes' ? '最後の写しの後に（または写しの直前に）体重の保存がありました。体重を入れていない時に、事務所PCで体重管理を開き直し、6分ほど待ってから、もう一度押してください。'
        : why === 'unmirrored' ? 'Google への体重の写し返しがまだ残っています。体重管理の GAS のエディタで autoMirror を1回実行するか、1時間ほど待ってから、もう一度押してください。'
        : /PGRST202|42883/.test(why) ? 'データベースの準備（0032）がまだです。'
        : why === '42501' ? '管理者（二段階認証済み）のアカウントで開いてください。' : jaWhy('体重の切り替え', why)));
      return;
    }
    msg(mode === 'live' ? '体重の保存先を Supabase（本番）にしました。各端末は次の通信から Supabase へ送ります。'
                        : '体重を写しの期間に戻しました。各端末は次の通信から Google へ送ります。', 'ok');
    await loadWeight(SUAuth.client());
    await gateRefresh(SUAuth.client());
  }

  /* 今日（日本時間）の体重の写しのうち、断った写しの数（差の日ごとの記録に使う） */
  function weightRefusedToday(rows, today) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.refused && SUCutGate.jstDay(r.at) === today; }).length;
  }
  /* 体重の写し（統合 0008）: 写しの件数と、写しを取った記録（件数だけ） */
  async function loadWeight(sb) {
    var kk = $('wt-kpis'), v = $('wt-verdict'), ul = $('wt-runs');
    kk.replaceChildren(); ul.replaceChildren();
    $('wt-admin').hidden = !(me && me.role === 'admin');
    try { await loadWeightMode(sb); } catch (e) { weightMode = ''; }
    var q = await Promise.all([
      sb.from('weight_residents').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      sb.from('weight_records').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      sb.from('weight_sync_runs').select('*').order('at', { ascending: false }).limit(5)
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
    if (weightMode === 'live') {
      v.className = 'msg ok';
      v.textContent = '切り替え済みです（体重の正本は Supabase）。写しは止めてあります（下の記録は切り替える前のものです）。';
    } else {
    /* 差の日ごとの記録（統合 0055）: 今日（日本時間）写した時だけ。今日の写しを全部見て、断った写しの数を差の件数にする
       （受け付けた写しは体重管理が読んだ全件と同じ＝0件。最後の1回だけを見ると、先に断った写しを見落とすため・反証レビュー指摘8） */
    if (SUCutGate.jstDay(last.at) === SUCutGate.jstDay(Date.now())) {
      var wt = await sb.from('weight_sync_runs').select('at,refused').gte('at', SUCutGate.jstDayStartIso(SUCutGate.jstDay(Date.now()))).limit(500);
      if (!wt.error) await noteDiff(sb, 'weight', weightRefusedToday(wt.data, SUCutGate.jstDay(Date.now())));
    }
    v.className = 'msg ' + (last.refused ? 'warn' : 'ok');
    v.textContent = last.refused
      ? '最後の写しは受け付けませんでした（' + (last.refused === 'shrink' ? '件数が急に減っていたため。読み込みの途中切れの可能性' : last.refused) + '）。体重管理を開き直してください。'
      : '体重の写しは、最後に体重管理が読んだ全件と同じです。';
    }
    runs.forEach(function (r) {
      var li = el('li'), left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(r.at)));
      left.appendChild(el('div', 'em', r.refused ? '受け付けず（' + r.refused + '）　入居者 ' + r.residents + '人・記録 ' + r.records + '件'
        : '入居者 ' + r.residents + '人・記録 ' + r.records + '件／追加 ' + r.inserted + '・更新 ' + r.updated + '・変化なし ' + r.unchanged + '・消えた印 ' + r.deleted
          + (r.kept ? '・切り替え中の書き込みを守った ' + r.kept : '')));
      li.appendChild(left);
      ul.appendChild(li);
    });
  }

  /* ── 正本を切り替える前の確かめの表（2026-11-03 代表者の依頼・判定は su-cutover-gate.js）──
   * 管理者だけ。6つの「切り替える／本番にする」ボタン（入居者マスタ・計画書・入居調整・職員マスタ・体重・排泄ケア記録）の前に4項目の表を出し、
   * 全部そろった時だけ押せる。押した時も読み直して確かめる（表を出した後に別の画面で切り替えた時のため）。最後に決めるのは今までどおりデータベース。
   * 戻すボタンと、備品・シフト分析・家族構成図・添付書類・週間計画・勤務表のボタンには付けない（依頼の外）。
   * 排泄ケア記録は 2026-11-13 に足した（代表者の指示・cross 6）。差の記録（0055）が排泄ケア記録を受け付けないので、今は1項目めが「確かめられません」で押せない。
   * 切り替えのボタンを足す時は、ここ（GATE）に足すか、check/unit/cutover_gate_registry_test.js の「付けない種類」に理由つきで足す（どちらも無いと試験で落ちる）
   * 読むもの: 差の日ごとの記録（shadow_diff_days・0055）・端末の数（device_seen_summary・0048）・毎晩の通し試験の結果（GitHub・公開リポジトリなので読むだけ）・
   *   今日の操作の記録（audit_log の *_mode と kv_families の「本番にした」記録）。どれかを読めない時は、その項目を満たさない扱いにする（押せない側に倒す） */
  var GATE = { res: 'b-res-cut', tp: 'b-tp-cut', adm: 'b-adm-cut', stf: 'b-stf-cut', weight: 'b-live-weight', hb: 'b-hb-cut' };
  var GATE_NG = '切り替える前の確かめがそろっていません。ボタンの上の表の「満たさない」の理由を見てください。';
  var FLOW_RUNS = 'https://api.github.com/repos/TH-su/care-tools/actions/workflows/flow-check.yml/runs?branch=main&per_page=20';
  var gateIn = null;
  /* 差の件数を日ごとに残す（事務所・管理者・統合 0055）。0055 の前・断られた時も見比べの表示は止めない */
  async function noteDiff(sb, kind, n) {
    if (!(me && me.role === 'admin')) return;   // 残せるのは管理者だけ（統合 0058・事務所が「差0件」を作れないように）
    try {
      var r = await sb.rpc('shadow_diff_note', { p_kind: kind, p_diffs: n });
      if (r && r.error && dbErrKind(r.error) === 'missing') notePrep('shadow_diff_note');
    } catch (e) { /* 残せなくても見比べの表示は続ける */ }
  }
  async function readFlowRuns() {
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 15000);
    try {
      var r = await fetch(FLOW_RUNS, { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal });
      if (!r.ok) return { error: 'other' };
      var j = await r.json();
      return Array.isArray(j && j.workflow_runs) ? { runs: j.workflow_runs } : { error: 'other' };
    } catch (e) { return { error: 'other' }; } finally { clearTimeout(tm); }
  }
  async function gateSafe(p) { try { return await p; } catch (e) { return { error: { code: 'thrown' } }; } }
  function gateErr(err, name) { var k = dbErrKind(err); if (k === 'missing') notePrep(name); return { error: k }; }
  async function loadGate(sb) {
    gateIn = null;
    if (me && me.role === 'admin') {
      var now = Date.now(), today = SUCutGate.jstDay(now);
      var q = await Promise.all([
        gateSafe(sb.rpc('shadow_diff_days', { p_days: 14 })),
        gateSafe(sb.rpc('device_seen_summary')),
        readFlowRuns(),
        /* 端末の時計が少しずれても取りこぼさないよう、前の日の0時から読み、今日かどうかはデータベースの日付で決める（反証レビュー指摘10） */
        gateSafe(sb.from('audit_log').select('at,entity,entity_ids,fields').eq('action', 'update').or('entity.like.*_mode,entity.eq.kv_families')
          .gte('at', SUCutGate.jstDayStartIso(SUCutGate.jstDay(now - 86400000))).limit(1000))
      ]);
      gateIn = {
        now: now, today: (!q[0].error && q[0].data && q[0].data.today) || today,
        diff: q[0].error ? gateErr(q[0].error, 'shadow_diff_days') : { rows: (q[0].data || {}).rows },
        dev: q[1].error ? gateErr(q[1].error, 'device_seen_summary') : { data: q[1].data },
        flow: q[2],
        cut: q[3].error ? { error: dbErrKind(q[3].error) } : { audit: q[3].data || [] }
      };
    }
    gateApply();
  }
  /* 表を出すのは、その切り替えボタンが出ている時だけ（体重は、管理者の欄が出ていて、まだ写しの期間の時） */
  function gateShown(k) {
    if (!(me && me.role === 'admin')) return false;
    return k === 'weight' ? !$('wt-admin').hidden && weightMode !== 'live' : !$(GATE[k]).hidden;
  }
  function gateApply() {
    Object.keys(GATE).forEach(function (k) {
      var box = $('gate-' + k), btn = $(GATE[k]);
      box.replaceChildren();
      box.hidden = !gateShown(k);
      if (box.hidden) return;
      if (!gateIn) { btn.disabled = true; box.appendChild(el('p', 'msg warn', '切り替える前の確かめの表を読めませんでした。「見比べ直す」を押してください（読めるまで押せません）。')); return; }
      var v = SUCutGate.judge(Object.assign({ kind: k }, gateIn));
      btn.disabled = !v.ok;
      renderGate(box, v);
    });
  }
  function renderGate(box, v) {
    var tb = el('table', 'gate-t');
    tb.appendChild(el('caption', v.ok ? 'ok' : 'ng', '切り替える前の確かめ：' + (v.ok ? '4項目そろっています。押せます。' : 'そろっていない項目があるので、まだ押せません。')));
    var hd = el('tr');
    ['項目', '今', '判定'].forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; hd.appendChild(th); });
    var thead = el('thead'), body = el('tbody');
    thead.appendChild(hd);
    v.items.forEach(function (x, i) {
      var tr = el('tr', x.ok ? 'ok' : 'ng');
      tr.appendChild(el('td', null, (i + 1) + '. ' + x.label));
      tr.appendChild(el('td', null, x.value));
      var td = el('td', null, x.ok ? '満たす' : '満たさない');
      if (!x.ok && x.why) td.appendChild(el('div', 'em', x.why));
      tr.appendChild(td);
      body.appendChild(tr);
    });
    tb.appendChild(thead); tb.appendChild(body);
    box.appendChild(tb);
  }
  /* 読み直して表とボタンを新しくする。例外は外へ出さない（読めない時は押せない側） */
  async function gateRefresh(sb) {
    try { await loadGate(sb); } catch (e) { gateIn = null; gateApply(); }
  }
  /* 押した時: 読み直してから判定する。そろっていなければ false（表も新しくなる）。
   * 読み直す間（GitHub を最大15秒待つ）はボタンを押せなくして、二度押しで確認の窓が2回出ないようにする（反証レビュー指摘5） */
  async function gatePass(k) {
    var b = $(GATE[k]);
    if (b) b.disabled = true;
    await gateRefresh(SUAuth.client());
    return !!gateIn && SUCutGate.judge(Object.assign({ kind: k }, gateIn)).ok;
  }

  async function start() {
    view('loading');
    var st;
    try { st = await SUAuth.check(); } catch (e) { st = { status: 'error', message: String(e && e.message || e) }; }
    me = st;
    if (st.status !== SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
      if (st.status === SUAuth.STATUS.OK) $('gate-why').textContent = 'このアカウント（現場）では開けません。事務所または管理者のアカウントでログインしてください。';
      else if (st.status === SUAuth.STATUS.ERROR) {
        /* 日本語の文はそのまま出す。英語の文は記録に残し、覆いの画面には押す所が無いので今までの既定の文を出す（仮置き・2026-11-13） */
        var gm = String(st.message || '');
        if (gm && !JA_CHAR.test(gm)) jaWhy('ログインの確かめ', gm);
        $('gate-why').textContent = gm && JA_CHAR.test(gm) ? gm : '確かめられませんでした。';
      }
      view('gate');
      return;
    }
    try {
      await load();
      view('main');
    } catch (e) {
      /* 元の文は記録に残し、画面にはほかの画面と同じ一文を出す（仮置き・2026-11-13） */
      try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('写しの見比べ: 開いた時の読み込み', String(e && e.message || e)); } catch (x) { /* 記録できなくても止めない */ }
      $('gate-why').textContent = '読み込めませんでした。ページを読み込み直してください。';
      view('gate');
    }
  }
  var me = null;
  /* 切り替え・戻す・写し返し・厳格モード・止める・写すの操作は、画面全体で1つずつ（2026-11-13 反証レビューの指摘・仮置き）。
   * ブラウザの窓はページを止めていたので、1回目の2段の確かめは途切れずに続いた。画面の中の窓では、確かめの前の待ち（1日1つの確かめなど）の間に
   * 二度押し・別の種類のボタンを押すと、窓が交互に並び、どの押しの「本当に」か見分けられないまま同じ切り替えが2本・別の種類が1日に2つ走り得る。
   * 押した最初に印が立っていれば何もせずに戻る（新しい文は出さない）。印は押した最初に立て、どの道で終わっても外す。
   * 関数の中身（ボタンを押せなくする処理を含む）は変えず、名前の指す先を包む */
  var opBusy = false;
  function oneOp(fn) {
    return async function () {
      if (opBusy) return;
      opBusy = true;
      try { return await fn.apply(null, arguments); } finally { opBusy = false; }
    };
  }
  setMode = oneOp(setMode); setShiftMode = oneOp(setShiftMode); writeBackShift = oneOp(writeBackShift); setLock = oneOp(setLock);
  stopWsday = oneOp(stopWsday); runMirrorFix = oneOp(runMirrorFix); runResFull = oneOp(runResFull); runTpFull = oneOp(runTpFull);
  runAdmFull = oneOp(runAdmFull); runSupOp = oneOp(runSupOp); runSaOp = oneOp(runSaOp); runHbOp = oneOp(runHbOp); runDocOp = oneOp(runDocOp);
  runGenoOp = oneOp(runGenoOp); runStfOp = oneOp(runStfOp); runAdmOp = oneOp(runAdmOp); runTpAi = oneOp(runTpAi); runTpOp = oneOp(runTpOp);
  runResOp = oneOp(runResOp); setWeightMode = oneOp(setWeightMode);
  $('b-live').addEventListener('click', function () { setMode('live'); });
  $('b-shadow').addEventListener('click', function () { setMode('shadow'); });
  $('b-live-shift').addEventListener('click', function () { setShiftMode('live'); });
  $('b-live-weight').addEventListener('click', function () { setWeightMode('live').catch(function (e) { msg(jaWhy('体重の切り替え', e)); }); });
  $('b-shadow-weight').addEventListener('click', function () { setWeightMode('shadow').catch(function (e) { msg(jaWhy('体重を写しの期間に戻す', e)); }); });
  $('b-shadow-shift').addEventListener('click', function () { setShiftMode('shadow'); });
  $('b-reload').addEventListener('click', function () { msg(''); load().catch(function (e) { msg(jaWhy('見比べ直す', e)); }); });
  $('b-care-check').addEventListener('click', function () { msg(''); runCareCheck(); });
  $('b-res-full').addEventListener('click', function () { msg(''); runResFull(); });
  $('b-res-cut').addEventListener('click', function () { msg(''); runResOp('cut'); });
  $('b-tp-full').addEventListener('click', function () { msg(''); runTpFull(); });
  $('b-tp-cut').addEventListener('click', function () { msg(''); runTpOp('cut'); });
  $('b-tp-back').addEventListener('click', function () { msg(''); runTpOp('back'); });
  $('b-tp-ai').addEventListener('click', function () { msg(''); runTpAi(); });
  $('b-adm-full').addEventListener('click', function () { msg(''); runAdmFull(); });
  $('b-adm-cut').addEventListener('click', function () { msg(''); runAdmOp('cut'); });
  $('b-adm-back').addEventListener('click', function () { msg(''); runAdmOp('back'); });
  $('b-stf-cut').addEventListener('click', function () { msg(''); runStfOp('cut'); });
  $('b-stf-back').addEventListener('click', function () { msg(''); runStfOp('back'); });
  $('b-sup-cut').addEventListener('click', function () { msg(''); runSupOp('cut'); });
  $('b-sup-back').addEventListener('click', function () { msg(''); runSupOp('back'); });
  $('b-sa-cut').addEventListener('click', function () { msg(''); runSaOp('cut'); });
  $('b-sa-back').addEventListener('click', function () { msg(''); runSaOp('back'); });
  $('b-geno-cut').addEventListener('click', function () { msg(''); runGenoOp('cut'); });
  $('b-geno-back').addEventListener('click', function () { msg(''); runGenoOp('back'); });
  $('b-hb-cut').addEventListener('click', function () { msg(''); runHbOp('cut'); });
  $('b-hb-back').addEventListener('click', function () { msg(''); runHbOp('back'); });
  $('b-doc-stf-cut').addEventListener('click', function () { msg(''); runDocOp('stf', 'cut'); });
  $('b-doc-stf-back').addEventListener('click', function () { msg(''); runDocOp('stf', 'back'); });
  $('b-doc-adm-cut').addEventListener('click', function () { msg(''); runDocOp('adm', 'cut'); });
  $('b-doc-adm-back').addEventListener('click', function () { msg(''); runDocOp('adm', 'back'); });
  $('b-res-back').addEventListener('click', function () { msg(''); runResOp('back'); });
  $('b-check').addEventListener('click', function () { msg(''); runCheck(); });
  $('b-mirror-check').addEventListener('click', function () { msg(''); runMirrorCheck(); });
  $('b-mirror-fix').addEventListener('click', function () { msg(''); runMirrorFix(); });
  $('b-fill').addEventListener('click', function () { msg(''); fillMissing(); });
  $('b-wsday-stop').addEventListener('click', function () { stopWsday(); });
  $('b-wsday-back').addEventListener('click', function () { writeBackWsday(); });
  $('b-shift-back').addEventListener('click', function () { msg(''); writeBackShift(); });
  $('b-lock-on').addEventListener('click', function () { setLock(true); });
  $('b-lock-off').addEventListener('click', function () { setLock(false); });
  start();
})();
