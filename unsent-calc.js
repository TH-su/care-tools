/* unsent-calc.js — 未送信の一覧（unsent.html）が使う、端末の送信待ちの読み取り（代表者の決定 2026-11-14【訂正】）
 *   メニューはこの部品を読まない。メニューの札は、一覧の画面が数え終えた時に書く件数の鍵（unsent_menu_due・menuDue の形）を
 *   ほかの札と同じ道で読むだけ（代表者の決定 2026-11-14・メニューは氏名の入った控えを読まない）
 *
 * 何をするか: 各画面が今すでに端末に残している送信待ち・未送信の印を読み、種類ごとに
 *   「件数・いちばん古い時刻・1件ずつの日付と種類」だけを返す。
 * 何をしないか:
 *   - 控えを書き換えない・消さない（setItem・removeItem を呼ばない。試験 unsent_calc_test で確かめる）
 *   - 通信しない（送り直しは各画面を開いた時の今ある道に任せる）
 *   - 氏名・病名・記録の本文・入居者の番号を返さない（控えに入っていても、返すのは日付・時刻・決まった種類の名前だけ）
 *   - 新しい種類の送信待ちを作らない（2026-11-12 の決定「送信待ちを端末に残すのは今すでに残している種類だけ」）
 *   - 現場の端末（su_device_role が field）では、事務所向けの画面（入居調整）の控えを読まない。事務所PCでも、
 *     事務所・管理者としてログインしていると確かめられた時（opts.admission が真）だけ読む（§2.7・反証レビュー 2026-11-14）
 *   - 例外を外に出さない（読めない・形が違う時は state: 'bad'＝「確かめられません」）
 * 返す形（collect）: [{ id, app, href, group: 'main'|'held'|'mirror', state: 'none'|'some'|'bad'|'unknown', n, oldest, items, why }]
 *   n: 件数（数えられない種類は null）・oldest: いちばん古い時刻（ミリ秒・無ければ null）
 *   items: [{ at: ミリ秒|null, day: 'YYYY-MM-DD'|'', label: 決まった語 }]（opts.detail が真の時だけ）
 */
(function (root) {
  'use strict';
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var YM_RE = /^\d{4}-\d{2}$/;
  var MIN_MS = Date.UTC(2020, 0, 1), MAX_MS = Date.UTC(2100, 0, 1);

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /* 時刻（ミリ秒の数か ISO の文字）を読む。範囲の外・読めない時は null */
  function ms(v) {
    var n = null;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) n = Date.parse(v);
    return (typeof n === 'number' && isFinite(n) && n >= MIN_MS && n < MAX_MS) ? n : null;
  }
  function day(v) { return (typeof v === 'string' && YMD_RE.test(v)) ? v : ''; }
  function get(st, key) {
    if (!st || typeof st.getItem !== 'function') throw new Error('no storage');
    return st.getItem(key);
  }
  function parse(raw) { return JSON.parse(raw); }

  /* 種類ごとの読み方。read(st, ss) は { n, items } か null（控えが無い）を返し、形が違えば例外を投げる */
  var WEIGHT_ACT = { saveRecord: '体重の記録', delRecord: '体重の記録の削除', saveResident: '入居者の情報', delResident: '入居者の削除', saveThr: '目安の設定' };
  function weightItems(a, label) {
    if (!Array.isArray(a)) throw new Error('shape');
    return a.map(function (it) {
      if (!isObj(it)) throw new Error('shape');
      return { at: ms(it.at), day: '', label: label ? label : (own(WEIGHT_ACT, String(it.action)) ? WEIGHT_ACT[it.action] : 'そのほかの変更') };
    });
  }
  var SHIFT_KEY = { staff: '職員', symbols: '記号', settings: '設定', freee: 'freee の設定' };
  var KINDS = [
    { id: 'weight', app: '体重管理', href: 'weight-record.html', group: 'main',
      why: '体重管理を開くと、つながっている時に自動で送り直します。',
      read: function (st) {
        var raw = get(st, 'wtmgr_pq_v1');
        if (raw == null) return null;
        var items = weightItems(parse(raw));
        return { n: items.length, items: items };
      } },
    { id: 'patch', app: '貼り薬カレンダー', href: 'patch-calendar.html', group: 'main',
      why: '貼り薬カレンダーを開くと自動で送り直します。権限で断られた分は、ログインし直してから開くと送り直します。',
      read: function (st) {
        var raw = get(st, 'apc2_sync_q');
        if (raw == null) return null;
        var o = parse(raw);
        if (!isObj(o) || !isObj(o.q)) throw new Error('shape');
        var ng = {};
        try { var g = parse(get(st, 'apc2_sync_ng') || 'null'); if (isObj(g) && isObj(g.r)) ng = g.r; } catch (e) { ng = {}; }
        var items = Object.keys(o.q).map(function (k) {
          var at = o.q[k], r = own(ng, k) ? ng[k] : null;
          var denied = isObj(r) && r.at === at;
          return { at: ms(at), day: '', label: denied ? '貼り薬の設定（断られた記録あり）' : '貼り薬の設定' };
        });
        return { n: items.length, items: items };
      } },
    /* 家族構成図は開いただけでは送り直さない（再送はつながった時・起動の下書きの窓の後・「↻ 同期」だけ）＝ボタンは「確かめる」（check） */
    { id: 'genogram', app: '家族構成図', href: 'genogram.html', group: 'main', check: true,
      why: '家族構成図を開いて［↻ 同期］を押すと送り直します。',
      read: function (st) {
        var raw = get(st, 'genogram:pendingSync');
        if (raw == null) return null;
        var a = parse(raw);
        if (!Array.isArray(a)) throw new Error('shape');
        var items = a.map(function (it) {
          if (!isObj(it)) throw new Error('shape');
          /* 食い違いの印（conflict）の付いた保留は、送り直しても通らない＝どちらを残すか人が選ぶ必要がある */
          var lb = it.kind === 'delete' ? '図の削除' : '図の保存';
          return { at: ms(it.queuedAt), day: '', label: it.conflict ? lb + '（食い違い・どちらを残すか人が選ぶ必要があります）' : lb, conflict: !!it.conflict };
        });
        return { n: items.length, items: items };
      } },
    { id: 'care', app: '週間計画', href: 'care-schedule.html', group: 'main',
      why: '週間計画を開くと自動で送ります（ほかの端末にも新しい変更がある時は、画面に出る案内に従ってください）。',
      read: function (st) {
        var raw = get(st, 'care_schedule_dirty_v1');
        if (raw == null) return null;
        if (raw !== '1') throw new Error('shape');
        return { n: 1, items: [{ at: null, day: '', label: '週間計画の編集' }] };
      } },
    { id: 'ws-day', app: 'ワークスケジュール（日ごと）', href: 'work-schedule.html', group: 'main',
      why: 'ワークスケジュールを開くと自動で送り直します。',
      read: function (st) {
        var raw = get(st, 'ws_dirty_v1');
        if (raw == null) return null;
        var o = parse(raw);
        if (!isObj(o)) throw new Error('shape');
        if (o.days == null) return { n: 0, items: [] };
        if (!isObj(o.days)) throw new Error('shape');
        var items = Object.keys(o.days).map(function (k) {
          return { at: ms(o.days[k]), day: day(k), label: '日ごとの予定' };
        });
        return { n: items.length, items: items };
      } },
    { id: 'ws-alt', app: 'ワークスケジュール（控えの案）', href: 'work-schedule.html', group: 'main',
      why: 'ワークスケジュールを事務所PCで開くと、控えから送り直します。',
      read: function (st) {
        var raw = get(st, 'ws_alt_pending_v2');
        if (raw == null) return null;
        var o = parse(raw);
        if (!isObj(o)) throw new Error('shape');
        var items = Object.keys(o).map(function (k) {
          var e = o[k];
          if (!isObj(e)) throw new Error('shape');
          return { at: ms(e.at), day: day(e.date), label: '控えの案' };
        });
        return { n: items.length, items: items };
      } },
    { id: 'ws-care', app: 'ワークスケジュール（週間計画の変更）', href: 'work-schedule.html', group: 'main',
      why: 'ワークスケジュールで直した週間計画の変更です。ワークスケジュールを開くと自動で送り直します。',
      read: function (st) {
        var raw = get(st, 'ws_care_ops_v1');
        if (raw == null) return null;
        var o = parse(raw);
        if (!isObj(o) || !Array.isArray(o.ops)) throw new Error('shape');
        var items = o.ops.map(function (op) {
          if (!isObj(op)) throw new Error('shape');
          return { at: ms(op.ts), day: '', label: '週間計画の変更' };
        });
        return { n: items.length, items: items };
      } },
    { id: 'ws-master', app: 'ワークスケジュール（支援マスタ）', href: 'work-schedule.html', group: 'main',
      why: 'ワークスケジュールを開くと自動で送ります。',
      read: function (st) {
        var raw = get(st, 'ws_master_unsent_v1');
        if (raw == null) return null;
        if (raw !== '1') throw new Error('shape');
        return { n: 1, items: [{ at: null, day: '', label: '支援マスタの変更' }] };
      } },
    { id: 'shift', app: 'シフト作成', href: 'shift-app.html', group: 'main',
      why: 'シフト作成を開くと、未送信がある時は上に帯が出ます。編集モードで確かめて送ってください。',
      read: function (st) {
        var raw = get(st, 'shiftapp:v1:_meta');
        if (raw == null) return null;
        /* シフト作成は自分の控えを縮めて書く（先頭の印 \u0001）。この画面には戻す部品を置かない＝「確かめられません」 */
        if (raw.charAt(0) === '\u0001') return { unknown: true };
        var o = parse(raw);
        if (!isObj(o)) throw new Error('shape');
        if (o.queue == null) return { n: 0, items: [] };
        if (!isObj(o.queue)) throw new Error('shape');
        var items = Object.keys(o.queue).map(function (k) {
          var e = o.queue[k], lb = own(SHIFT_KEY, k) ? SHIFT_KEY[k] : '', m = /^(sched|req|drafts):(.*)$/.exec(k);
          if (m) lb = m[1] === 'sched' ? '勤務表' : m[1] === 'req' ? '希望休' : '編集用の一覧';
          var ym = m && YM_RE.test(m[2]) ? m[2] : '';
          return { at: isObj(e) ? ms(e.queuedAt) : null, day: ym, label: lb || 'そのほかの変更' };
        });
        return { n: items.length, items: items };
      } },
    { id: 'shift-rescue', app: 'シフト作成（退避した編集）', href: 'shift-app.html', group: 'held',
      why: '自動では送りません。シフト作成の［マスタ→設定→バックアップ→退避データ一覧］から取り出して確かめてください。',
      read: function (st) {
        /* 鍵の名前だけを数える（中身は縮めてあり、読まない）。鍵の形 shiftapp:v1:local:<種類>:<元の鍵>:<退避した時刻> */
        if (!st || typeof st.key !== 'function' || typeof st.length !== 'number') throw new Error('no storage');
        var items = [];
        for (var i = 0; i < st.length; i++) {
          var k = st.key(i), m = k ? /^shiftapp:v1:local:(conflictRescue|importRescue):(.+):(\d{10,15})$/.exec(k) : null;
          if (!m) continue;
          var src = m[2], lb = own(SHIFT_KEY, src) ? SHIFT_KEY[src] : '', sm = /^(sched|req|drafts):(.*)$/.exec(src);
          if (sm) lb = sm[1] === 'sched' ? '勤務表' : sm[1] === 'req' ? '希望休' : '編集用の一覧';
          items.push({ at: ms(Number(m[3])), day: sm && YM_RE.test(sm[2]) ? sm[2] : '', label: (m[1] === 'importRescue' ? '取込前' : '競合解決前') + 'の' + (lb || 'そのほかの変更') });
        }
        return items.length ? { n: items.length, items: items } : null;
      } },
    /* 入居調整は §2.7 にそろえ、事務所PCで事務所・管理者としてログインしていると確かめられた時（opts.admission が真）だけ読む */
    { id: 'admission', app: '入居調整', href: 'admission-flow.html', group: 'main', officeOnly: true, needAuth: true,
      why: '入居調整を事務所PCで開くと自動で送ります（事務所・管理者のログインが要ります）。',
      whyLocked: 'この画面では確かめられません（事務所PCで事務所・管理者としてログインしていると確かめられた時だけ確かめます）。入居調整を開くと、未送信がある時は画面に案内が出ます。',
      read: function (st) {
        var raw = get(st, 'admf_cache');
        if (raw == null) return null;
        /* 中身（候補の方の情報）は読まない。控えの末尾の決まった欄（版・未送信の印・控えた時刻）だけを見る */
        var tail = String(raw).slice(-200);
        var m = /,"rev":\d+,"dirty":(true|false),"at":"([^"\\]{0,40})"\}$/.exec(tail);
        if (!m) throw new Error('shape');
        return m[1] === 'true' ? { n: 1, items: [{ at: ms(m[2]), day: '', label: '入居調整の変更（端末に控えた時刻）' }] } : { n: 0, items: [] };
      } },
    { id: 'supplies', app: '消耗品管理（出庫）', href: 'supplies.html', group: 'main', session: true,
      why: '消耗品管理を開き直すと送り直します。この控えは同じタブの中だけにあり、ほかのタブからは見えません。',
      read: function (st, ss) {
        var raw = get(ss, 'spl_pending');
        if (raw == null) return null;
        var a = parse(raw);
        if (!Array.isArray(a)) throw new Error('shape');
        var items = a.map(function (it) {
          if (!isObj(it)) throw new Error('shape');
          return { at: null, day: day(it.date), label: it.type === 'out' ? '出庫' : '入出庫' };
        });
        return { n: items.length, items: items };
      } },
    { id: 'weight-mirror', app: '体重管理（Google への写し返し）', href: 'weight-record.html', group: 'mirror',
      why: '記録は新しい保存先に保存済みです。体重管理を開いている間に、裏で Google へ写します。',
      read: function (st) {
        var raw = get(st, 'wtmgr_mirror_q');
        if (raw == null) return null;
        var items = weightItems(parse(raw), 'Google への写し返し');
        return { n: items.length, items: items };
      } },
    { id: 'kv-mirror', app: '週間計画・ワークスケジュールなど（Google への写し返し）', href: '', group: 'mirror',
      why: '記録は新しい保存先に保存済みです。関係する画面を開いている間に、裏で Google へ写します。',
      read: function (st) {
        var raw = get(st, 'su_kv_mirror_pending');
        if (raw == null) return null;
        var o = parse(raw);
        if (!isObj(o)) throw new Error('shape');
        var items = Object.keys(o).map(function (k) { return { at: ms(o[k]), day: '', label: 'Google への写し返し' }; });
        return { n: items.length, items: items };
      } }
  ];

  function isField(st) {
    try { return get(st, 'su_device_role') === 'field'; } catch (e) { return false; }
  }
  function note(where, e) {
    try { if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note('unsent:' + where, e); } catch (x) { /* 記録できなくても止めない */ }
  }
  /* 種類ごとに読む。opts: { local, session, field, detail } */
  function collect(opts) {
    var o = opts || {}, st = o.local, ss = o.session;
    var field = (o.field === undefined) ? isField(st) : !!o.field;
    var out = [];
    KINDS.forEach(function (k) {
      if (field && k.officeOnly) return;   // 現場の端末では事務所向けの画面の控えに触れない
      var row = { id: k.id, app: k.app, href: k.href, group: k.group, state: 'none', n: 0, oldest: null, items: [], why: k.why, session: !!k.session, check: !!k.check, conflict: 0 };
      if (k.needAuth && o.admission !== true) {   // 役割を確かめられていない時は読まない
        row.state = 'unknown'; row.n = null; row.why = k.whyLocked; out.push(row); return;
      }
      try {
        var r = k.read(st, ss);
        if (r && r.unknown) { row.state = 'unknown'; row.n = null; }
        else if (r) {
          row.n = r.n;
          row.state = r.n > 0 ? 'some' : 'none';
          r.items.forEach(function (it) { if (it.at != null && (row.oldest == null || it.at < row.oldest)) row.oldest = it.at; if (it.conflict) row.conflict++; });
          r.items.forEach(function (it) { delete it.conflict; });
          if (o.detail && !field) row.items = r.items.slice().sort(function (a, b) { return (a.at == null ? 1 : 0) - (b.at == null ? 1 : 0) || (a.at || 0) - (b.at || 0) || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0); });
        }
      } catch (e) {
        row.state = 'bad'; row.n = null; row.oldest = null; row.items = [];
        if (!(e && e.message === 'shape') && !(e instanceof SyntaxError)) note(k.id, e);
      }
      out.push(row);
    });
    return out;
  }
  /* メニューの札に使う合計（写し返し・退避した編集（自動では送らない）・数えられない種類は数えない）。読めない時は 0 */
  function total(opts) {
    try {
      return collect(opts).reduce(function (s, r) { return s + (r.group === 'main' && typeof r.n === 'number' ? r.n : 0); }, 0);
    } catch (e) { return 0; }
  }
  /* メニューの札の件数の鍵（unsent_menu_due）に書く中身。ほかの札（eql_menu_due など）と同じ形で、件数と数えた日だけ
     {"v":1,"at":"YYYY-MM-DD","unsent":true,"n":件数}（種類名・氏名・番号は入れない）。数えるのは total と同じ
     （写し返し・退避した編集・数えられない種類は数えない）。全部の種類が読めなかった時・日付の形が違う時は null（書かない） */
  function menuDue(rows, today) {
    try {
      if (!Array.isArray(rows) || !rows.length || !YMD_RE.test(String(today || ''))) return null;
      /* 数えられた種類が1つも無い時（全部が読めない・確かめられない）は書かない */
      if (!rows.some(function (r) { return r && (r.state === 'some' || r.state === 'none'); })) return null;
      var n = rows.reduce(function (s, r) { return s + (r && r.group === 'main' && typeof r.n === 'number' && isFinite(r.n) ? r.n : 0); }, 0);
      if (!(n >= 0 && n <= 9999 && Math.floor(n) === n)) return null;
      return JSON.stringify({ v: 1, at: String(today), unsent: true, n: n });
    } catch (e) { return null; }
  }
  /* 表示の時刻（11/14 9:05・年が違う時は 2025/11/14 9:05）。now は比べる年のため */
  function fmt(at, now) {
    if (typeof at !== 'number' || !isFinite(at)) return '';
    var d = new Date(at), y = new Date(typeof now === 'number' ? now : Date.now()).getFullYear();
    return (d.getFullYear() !== y ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  root.SUUnsent = { collect: collect, total: total, menuDue: menuDue, MENU_DUE_KEY: 'unsent_menu_due', fmt: fmt, KINDS: KINDS.map(function (k) { return k.id; }) };
})(typeof window !== 'undefined' ? window : this);
