/* ats-calc.js — 採用管理（ats.html）の純関数（2026-10-26 新設・代表者承認の凍結仕様 v1）
 *
 * 画面（採用管理）と試験（check/unit/ats_calc_test.js）が使う。通信・端末への保存・画面の部品には触らない。
 *
 * 約束:
 *   1. 応募者の氏名・連絡先・本人希望などの文章は、ここでは計算に使うだけで、どこにも保存しない・送らない
 *   2. 日付の読み方は職員マスタの算出モジュール（staff-master-calc.js の StaffCalc.normDate）と同じ規則を使う
 *      （職員マスタへの登録の照合で、入職日・生年月日の読み方が食い違わないように）。読めない時は null
 *   3. 取り込みは推測で埋めない。読めない日付・知らない採用可否の語は空にして「入れられない理由」を返す
 *   4. 職員マスタへ送る項目は、職員マスタの GAS（staff-api.gs の STAFF_FIELDS）が受け付けるキーだけ。
 *      本人希望・条件・備考の文章は送らない
 *   5. 「登録できたか」の判定の分かれ方は入居調整の masterWriteVerdict と同じ（staffVerdict）。待つのは8分
 *      （職員マスタの GAS の処理中の印 420秒＝7分より長く）
 */
(function (root) {
  'use strict';

  var VERSION = '2026-10-27.2';

  /* 職員マスタの算出モジュール（日付の正規化をそのまま使う）。node では同じフォルダから読む */
  var SC = null;
  function staffCalc() {
    if (SC) return SC;
    if (root && root.StaffCalc) { SC = root.StaffCalc; return SC; }
    try { if (typeof require === 'function') SC = require('./staff-master-calc.js'); } catch (e) { SC = null; }
    return SC;
  }

  /* ── 段階（選考ボードの6列と、終わりの3つ） ── */
  var STAGES = [
    { id: 'applied', no: 1, label: '応募受付' },
    { id: 'screening', no: 2, label: '書類選考' },
    { id: 'interview', no: 3, label: '面接' },
    { id: 'offer', no: 4, label: '内定' },
    { id: 'prep', no: 5, label: '入職準備' },
    { id: 'hired', no: 6, label: '入職完了' }
  ];
  var END_STAGES = [
    { id: 'rejected', label: '不採用' },
    { id: 'declined', label: '辞退' },
    { id: 'lost', label: '連絡途絶' }
  ];
  var OUTCOME_REASONS = ['条件不一致', '他社決定', '連絡途絶', '本人都合', '適性', '定員充足', 'その他'];
  var CHANNELS = ['電話', 'メール', 'SMS', 'LINE', '対面', 'その他'];
  /* 評価項目の既定（設定で管理者が変えられる。各5段階＋コメント） */
  var DEFAULT_EVAL_ITEMS = ['経験・技術', '人柄・話し方', '勤務の希望が合うか', '通勤', '長く続けられそうか', '総合'];
  var DEFAULT_SETTINGS = { evalItems: DEFAULT_EVAL_ITEMS.slice(), retainMonths: 6, lostDays: 90 };
  var FIRST_CONTACT_HOURS = 24;
  var SETTLE_MS = 8 * 60 * 1000;   // 職員マスタの GAS の処理中の印（420秒）より長く待つ（2026-10-26 反証レビュー）

  function stageOf(id) {
    var i;
    for (i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return STAGES[i];
    return null;
  }
  function endOf(id) {
    var i;
    for (i = 0; i < END_STAGES.length; i++) if (END_STAGES[i].id === id) return END_STAGES[i];
    return null;
  }
  function isEnd(id) { return !!endOf(id); }
  function isStage(id) { return !!(stageOf(id) || endOf(id)); }
  /* 段階の名前（「3. 面接」の形。終わりの3つは名前だけ） */
  function stageLabel(id) {
    var s = stageOf(id);
    if (s) return s.no + '. ' + s.label;
    var e = endOf(id);
    return e ? e.label : '';
  }
  function stageRank(id) { var s = stageOf(id); return s ? s.no : 0; }
  function nextStage(id) {
    var s = stageOf(id);
    if (!s || s.no >= STAGES.length) return null;
    return STAGES[s.no].id;
  }
  /* 段階を動かせるか。入職完了へは職員マスタへ登録済み（staff_id あり）の時だけ。終わりの3つへは理由の窓から */
  function canMove(from, to, hasStaffId) {
    if (!isStage(to)) return { ok: false, reason: 'unknown' };
    if (from === to) return { ok: false, reason: 'same' };
    if (to === 'hired' && !hasStaffId) return { ok: false, reason: 'not_registered' };
    if (from === 'hired') return { ok: false, reason: 'hired' };
    return { ok: true, reason: '' };
  }

  /* ── 文字・日付の下ごしらえ ── */
  function str(v) { return v == null ? '' : String(v); }
  function nfkc(s) { var t = str(s); return t.normalize ? t.normalize('NFKC') : t; }
  function trim(s) { return str(s).replace(/^[\s　]+|[\s　]+$/g, ''); }
  /* 名寄せ用の氏名（NFKC・空白と全角空白を全部除く） */
  function normName(s) { return nfkc(s).replace(/[\s　]+/g, ''); }
  function importKey(name, received) { return normName(name) + '|' + str(received); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function lastDay(y, m) { return m === 2 ? (isLeap(y) ? 29 : 28) : ([4, 6, 9, 11].indexOf(m) >= 0 ? 30 : 31); }
  function ymd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }
  function isDate(s) { return !!ymd(s); }
  function todayJST(now) {
    var d = new Date((typeof now === 'number' ? now : Date.now()) + 9 * 3600000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function addDays(s, n) {
    var o = ymd(s);
    if (!o) return '';
    var t = Date.UTC(o.y, o.m - 1, o.d) + n * 86400000, d = new Date(t);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function daysBetween(a, b) {
    var x = ymd(a), y = ymd(b);
    if (!x || !y) return null;
    return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
  }
  /* 月を足す（月末を超える日は月末に寄せる） */
  function addMonths(s, n) {
    var o = ymd(s);
    if (!o) return '';
    var k = o.y * 12 + (o.m - 1) + n, y = Math.floor(k / 12), m = k % 12 + 1;
    return y + '-' + pad2(m) + '-' + pad2(Math.min(o.d, lastDay(y, m)));
  }
  /* 保管期限（選考が終わった日＋月数） */
  function retainUntil(closedOn, months) {
    var n = Number(months);
    if (!isDate(closedOn) || !(n >= 1)) return '';
    return addMonths(closedOn, Math.floor(n));
  }

  /* 年のある日付 → 'YYYY-MM-DD'（全角・和暦・Excel の数字も読む）。年の無い日付・読めない値は null。
     ★職員マスタの StaffCalc.normDate と同じ規則（上限は2年先まで＝入職予定日・返答期限が来年でも読める） */
  function normDate(raw) {
    var c = staffCalc();
    if (!c || typeof c.normDate !== 'function') return null;
    var s = trim(raw);
    if (!s) return null;
    return c.normDate(s, { aheadYears: 2 }) || null;
  }
  /* 年の無い日付（'1/31' '1月31日'）を基準日から補う。年のある日付はそのまま読む。読めなければ null。
     dir が 'past' でない時（就業開始日・返答期限など受付日より後の日付）: 月が基準日の月より前なら翌年。
     dir が 'past' の時（受付日を今日から補う）: 基準日より後の日付になるなら前の年（受付日は先の日付にならない） */
  var RE_MD = /^(\d{1,2})[\/\-.月](\d{1,2})日?$/;
  function completeYear(text, baseDate, dir) {
    var s = nfkc(text).replace(/[\s　]+/g, '').replace(/[（(][日月火水木金土祝・]+[)）]$/, '');
    if (!s) return null;
    var full = normDate(s);
    if (full) return full;
    var m = RE_MD.exec(s), b = ymd(baseDate);
    if (!m || !b) return null;
    var mo = +m[1], d = +m[2], y;
    if (dir === 'past') y = (mo > b.m || (mo === b.m && d > b.d)) ? b.y - 1 : b.y;
    else y = mo < b.m ? b.y + 1 : b.y;
    if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return null;
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }
  /* 「1/31見学のみ」→ {date:'YYYY-01-31', note:'見学のみ'}。日付が無ければ date:null で文章は note に残す。
     日付が2つ以上ある時は決めずに date:null・issue を返す（推測で選ばない）。
     dir は completeYear と同じ（'past' なら年の無い日付を基準日から前へ補う）。yearless は年の無い日付から補った印 */
  var RE_DATE_ANY = /(\d{4}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}日?|(?:令和|平成|昭和|[RHS])\d{1,2}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}日?|\d{1,2}[\/月]\d{1,2}日?)/g;
  function splitDateNote(text, baseDate, dir) {
    var s = trim(nfkc(text));
    if (!s) return { date: null, note: '', issue: '' };
    var hits = s.match(RE_DATE_ANY) || [];
    if (!hits.length) return { date: null, note: s, issue: '' };
    if (hits.length > 1) return { date: null, note: s, issue: '日付が2つ以上あります' };
    var d = completeYear(hits[0], baseDate, dir);
    if (!d) return { date: null, note: s, issue: '日付を読めません' };
    var note = trim(s.replace(hits[0], '').replace(/^[\s　]*[（(][日月火水木金土祝]+[)）]/, '').replace(/^[\s　、,・:：]+/, ''));
    return { date: d, note: note, issue: '', yearless: !completeYear(hits[0], '') };
  }
  /* 連絡先の欄 → {phones:[{num,label}], email, issues}。改行・空白で区切り、「↓」より前は旧番号。@ を含むものはメール */
  function parseContacts(text) {
    var s = nfkc(text).replace(/[‐-―−ー－]/g, '-');
    var out = { phones: [], email: '', issues: [] };
    if (!trim(s)) return out;
    var parts = s.split('↓'), oldN = parts.length - 1;
    parts.forEach(function (part, pi) {
      part.split(/[\s　,、;／\/]+/).forEach(function (tok) {
        tok = trim(tok);
        if (!tok) return;
        if (tok.indexOf('@') >= 0) {
          if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(tok)) { if (!out.email) out.email = tok; else out.issues.push('メールが2つ以上あります'); }
          else out.issues.push('メールの形が違います');
          return;
        }
        var digits = tok.replace(/[^0-9]/g, '');
        if (/^[0-9()\-+]+$/.test(tok) && digits.length >= 10 && digits.length <= 11) {
          out.phones.push({ num: tok.replace(/[()]/g, ''), label: pi < oldN ? '旧' : '' });
        } else out.issues.push('電話番号の形が違います');
      });
    });
    return out;
  }

  /* 取り込みの採用可否 → 段階。「採用」＋就業開始日は「入職完了」にはできない（職員マスタへの登録が要る）ので入職準備にして印を残す。
     印を付けるのは採用可否が「採用」の行だけ（「内定」「合格」などは就業開始日があっても内定のまま・印なし） */
  var RE_HIRED = /^(採用|採用決定|内定|合格)$/;
  var RE_REJECT = /^(不採用|不合格|見送り|お見送り)$/;
  var RE_DECLINE = /^(本人断り|辞退|採用辞退|内定辞退|本人辞退)$/;
  var RE_LOST = /^(連絡途絶|連絡なし|音信不通)$/;
  /* 採用可否の語の揺れを読む（2026-10-27 本物の面接者ノートの試算から）。返りは 'hired'／'rejected'／'declined'／'lost'／'hold'／''（読めない）。
     先頭の括弧の前の語（head）と、含む語で決める。辞退・断り・離脱（「採用→…保留」も）は辞退を優先、
     次に不採用・否・不可・見送り は不採用、採用・内定・合格・可 は採用、連絡途絶の語は連絡途絶、保留は保留 */
  function resultHead(res) { return trim(nfkc(res)).replace(/[\s　]+/g, '').split(/[(（]/)[0]; }
  function classifyResult(res) {
    var all = trim(nfkc(res)).replace(/[\s　]+/g, ''), head = resultHead(res);
    if (!all) return '';
    if (/辞退|断り|離脱/.test(all) || /採用.*保留/.test(all)) return 'declined';
    if (/不採用|不合格|見送り|否|不可/.test(all)) return 'rejected';
    if (/採用|内定|合格/.test(head) || head === '可') return 'hired';
    if (/連絡途絶|連絡なし|音信不通|途絶/.test(all)) return 'lost';
    if (/保留/.test(all)) return 'hold';
    return '';
  }
  /* past が true の行（受付日が今日より連絡途絶の日数以上前・受付日の無い行）は、終わった選考として決める（2026-10-27 本人指示）:
       採用可否が採用（採用決定・内定・合格・可を含む）、または空欄で就業開始日がある → 入職完了（取り込み元で入職済みの印 legacy:true）
       辞退の語 → 辞退／不採用の語 → 不採用／空欄（就業開始日なし）・保留 → 連絡途絶／知らない語 → 入れない
     新しい行: 採用（「採用」「可」だけの時に就業開始日があれば入職準備＋印）→ 内定、保留 → 面接、ほかは同じ */
  function deriveStage(row, today, lostDays, past) {
    var r = row || {}, res = trim(nfkc(r.result)).replace(/[\s　]+/g, '');
    var days = Number(lostDays) >= 1 ? Math.floor(Number(lostDays)) : DEFAULT_SETTINGS.lostDays;
    var cls = classifyResult(res), head = resultHead(res);
    var unknown = { stage: null, note: '', issue: '採用可否の「' + res.slice(0, 20) + '」を読めません', legacy: false };
    if (past === true) {
      if (!res) return r.startOn ? { stage: 'hired', note: '', issue: '', legacy: true } : { stage: 'lost', note: '', issue: '', legacy: false };
      if (cls === 'hired') return { stage: 'hired', note: '', issue: '', legacy: true };
      if (cls === 'rejected' || cls === 'declined' || cls === 'lost') return { stage: cls, note: '', issue: '', legacy: false };
      if (cls === 'hold') return { stage: 'lost', note: '', issue: '', legacy: false };
      return unknown;
    }
    if (res) {
      if (cls === 'hired') {
        if (r.startOn && (head === '採用' || head === '可')) return { stage: 'prep', note: '入職済みの印（取り込み元の就業開始日 ' + r.startOn + '）', issue: '' };
        return { stage: 'offer', note: '', issue: '' };
      }
      if (cls === 'rejected' || cls === 'declined' || cls === 'lost') return { stage: cls, note: '', issue: '' };
      if (cls === 'hold') return { stage: 'interview', note: '', issue: '' };
      return { stage: null, note: '', issue: unknown.issue };
    }
    var age = r.received ? daysBetween(r.received, today) : null;
    if (age != null && age > days) return { stage: 'lost', note: '', issue: '' };
    if (r.interviewOn) return { stage: 'interview', note: '', issue: '' };
    return { stage: 'applied', note: '', issue: '' };
  }

  /* ── CSV ── */
  /* RFC 4180 の形（"" の中の改行・カンマ・"" を読む）。先頭の BOM は落とす */
  function parseCsv(text) {
    var s = str(text).replace(/^﻿/, ''), rows = [], row = [], f = '', q = false, i, c;
    for (i = 0; i < s.length; i++) {
      c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
        continue;
      }
      if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return trim(x) !== ''; }); });
  }
  /* 見出しの呼び方（取り込み元の表の揺れ）。左が採用管理の項目 */
  var HEADERS = {
    no: ['No', 'NO', 'no', '番号', '通し番号'],
    received: ['受付日', '応募日', '受付', '応募受付日'],
    sources: ['経路', '応募経路', '媒体', '求人媒体'],
    name: ['氏名', '名前', '応募者', '応募者名'],
    kana: ['フリガナ', 'ふりがな', 'カナ', 'よみ'],
    gender: ['性別'],
    birth: ['生年月日', '誕生日'],
    jobs: ['職種', '希望職種', '応募職種'],
    quals: ['資格', '保有資格'],
    address: ['住所'],
    contacts: ['連絡先', '電話', '電話番号', 'TEL', '携帯'],
    email: ['メール', 'メールアドレス', 'mail', 'Email', 'E-mail'],
    wish: ['本人希望', '希望', '希望条件'],
    cond: ['条件', '勤務条件'],
    note: ['備考', 'メモ'],
    interview: ['面接日', '面接', '面接日時'],
    result: ['採用可否', '結果', '合否', '選考結果'],
    startOn: ['就業開始日', '入職日', '勤務開始日', '入職予定日'],
    replyDue: ['返答期限', '回答期限', '返答期限目安', '返答期限の目安'],
    age: ['年齢'],
    resultOn: ['可否連絡日', '結果連絡日', '合否連絡日']
  };
  function headKey(cell) {
    var h = nfkc(cell).replace(/[\s　]+/g, '').toLowerCase(), k, i;
    if (!h) return '';
    for (k in HEADERS) {
      if (!Object.prototype.hasOwnProperty.call(HEADERS, k)) continue;
      for (i = 0; i < HEADERS[k].length; i++) if (nfkc(HEADERS[k][i]).toLowerCase() === h) return k;
    }
    return '';
  }
  /* 見出しの行を探す（先頭10行のうち、氏名を含めて知っている見出しが3つ以上ある最初の行）。
     返り {index, map:{項目: 列番号}, unknown:[知らない見出し]} ／見つからなければ null */
  function detectHeader(rows) {
    var list = Array.isArray(rows) ? rows : [], i, j;
    for (i = 0; i < Math.min(10, list.length); i++) {
      var r = list[i] || [], map = {}, unknown = [], n = 0;
      for (j = 0; j < r.length; j++) {
        var k = headKey(r[j]);
        if (k && !(k in map)) { map[k] = j; n++; }
        else if (trim(r[j])) unknown.push(trim(r[j]));
      }
      if ('name' in map && n >= 3) return { index: i, map: map, unknown: unknown };
    }
    return null;
  }
  function splitList(s) {
    return trim(nfkc(s)).split(/[\s　]*[、,・\/／\n][\s　]*/).map(trim).filter(Boolean);
  }
  /* ── 応募の経路の名寄せ（2026-10-27 本人指示） ──
     経路は決まった名前にそろえる。大小文字・全角半角・空白・記号の揺れは吸収する。表に無い語は「その他」にし、元の書き方を返す。
     媒体の名前を先に当て、当たらない時に「紹介」「様」を含むかを見る（「ハローワーク紹介」はハローワーク） */
  var SOURCE_NAMES = ['Indeed', 'ジョブメドレー', 'ハローワーク', '求人ボックス', 'タイミー', 'ホームページ', '紹介', '求人誌', 'マイベストジョブ',
    '求人案内', 'タウンワーク', 'マッハバイト', 'みんジョブ', 'コメディカル.com', '介護ジョブ', '介護求人ネット', '介護求人ナビ', 'あつまるHD', '介護あるある', 'すぱいす',
    '直接応募', '派遣・紹介会社', 'その他'];
  /* 媒体の名前（打ち間違い・大小文字・全角半角を吸収）。照合は括弧の注記を外した形で行う */
  var SOURCE_RULES = [
    ['Indeed', /indee[dl]|インディード/],
    ['ジョブメドレー', /jobmedley|ジョブメ[ドソト]レー|メドレー/],
    ['ハローワーク', /ハローワーク|ハロワ|hellowork|職業安定所|職安/],
    ['求人ボックス', /求人ボックス|求人box|kyujinbox/],
    ['タイミー', /タイミー|timee/],
    ['マイベストジョブ', /マイベストジョブ|mybestjob/],
    ['タウンワーク', /タウンワーク|townwork/],
    ['マッハバイト', /マッハバイト/],
    ['みんジョブ', /みんジョブ|みんなのジョブ/],
    ['コメディカル.com', /コメディカル/],
    ['介護求人ネット', /介護求人ネット/],
    /* 「（地名）介護求人ナビ」は地名を名前に含むため、決まった名前を「介護求人ナビ」にする（公開リポジトリに地名を書かない） */
    ['介護求人ナビ', /介護求人ナビ/],
    ['介護ジョブ', /介護ジョブ/],
    ['あつまるHD', /あつまる/],
    ['介護あるある', /介護あるある/],
    ['すぱいす', /すぱいす|スパイス/],
    ['ホームページ', /ホームページ|^(自社|当社)?hp$|^(自社|当社)?(web|ウェブ)(サイト)?$|website/],
    ['求人案内', /求人案内|求人案件/],
    ['求人誌', /求人誌|求人情報誌|情報誌|フリーペーパー/],
    ['派遣・紹介会社', /派遣|担当|紹介会社|人材|セントメディア|日研|ミラクス/]
  ];
  /* 照合用の形（NFKC・小文字・空白と「-_.・」を除く） */
  function sourceKey(s) { return nfkc(s).toLowerCase().replace(/[\s　\-_.・･]+/g, ''); }
  /* 1語 → 決まった名前。順に: 媒体の名前 → 派遣・紹介会社 → 紹介（知人・元職員・ケアマネ・様・さん・教会・紹介）→
     直接応募（経由なし・直接・直電）→「ネット」だけはその他 → 漢字1〜4字だけの語（人の名字とみなす）は紹介 → 表に無い語はその他 */
  function canonSource(token) {
    var k = sourceKey(token), i;
    if (!k) return '';
    var core = k.replace(/[(（][^)）]*[)）]/g, '').replace(/^[→⇒]+/, '');
    for (i = 0; i < SOURCE_RULES.length; i++) if (core && SOURCE_RULES[i][1].test(core)) return SOURCE_RULES[i][0];
    if (core && /知人|元職員|ケアマネ|様|さん|教会|紹介/.test(core)) return '紹介';
    if (/経由なし|直接|直電/.test(k)) return '直接応募';
    if (core === 'ネット') return 'その他';
    if (/^[一-鿿々]{1,4}$/.test(core)) return '紹介';
    return 'その他';
  }
  /* 経路の欄 → {list:[決まった名前（重なりなし）], others:[その他にした元の書き方]}。「＆」「&」「・」「、」「,」「/」「+」改行で分ける */
  function canonSources(text) {
    var out = { list: [], others: [] };
    nfkc(text).split(/[&、,，・･\/／+＋\r\n]+/).forEach(function (raw) {
      var tok = trim(raw);
      if (!tok) return;
      var c = canonSource(tok);
      if (!c) return;
      if (out.list.indexOf(c) < 0) out.list.push(c);
      if (c === 'その他' && sourceKey(tok) !== 'その他' && out.others.indexOf(tok) < 0) out.others.push(tok);
    });
    return out;
  }

  /* 取り込み元で入職した方を職員マスタの一覧（退職した方も含む）から探す。
     正規化した氏名が同じで、入職日が就業開始日の前後30日以内の職員がちょうど1人の時だけ見つかったとする。
     返り {state:'found', id} ／ 'none'（いない・2人以上・就業開始日なし）／ 'nolist'（一覧を読めていない） */
  var LEGACY_MATCH_DAYS = 30;
  function legacyStaffMatch(list, name, startOn) {
    if (!Array.isArray(list)) return { state: 'nolist', id: '' };
    var n = normName(name);
    if (!n || !isDate(startOn)) return { state: 'none', id: '' };
    var hits = list.filter(function (r) {
      if (!r || normName(r.name) !== n || !isDate(r.hireDate)) return false;
      var d = daysBetween(startOn, r.hireDate);
      return d != null && Math.abs(d) <= LEGACY_MATCH_DAYS;
    });
    return hits.length === 1 && trim(hits[0].id) ? { state: 'found', id: trim(hits[0].id).slice(0, 40) } : { state: 'none', id: '' };
  }

  var TEXT_MAX = 20000;   // 本人希望・条件・備考（note_text）の上限（データベース 0030）
  var GENDER = { '男': 'M', '男性': 'M', 'M': 'M', 'm': 'M', '女': 'F', '女性': 'F', 'F': 'F', 'f': 'F' };

  /* 行の指紋（行の全部のセルを NFKC・前後の空白を除いてタブでつなぎ、FNV-1a 32bit を2回＝16進12桁）。決まった計算で、同じ行なら同じ値 */
  function rowHash(cells) {
    var t = (Array.isArray(cells) ? cells : []).map(function (x) { return trim(nfkc(x)); }).join('\t');
    function fnv(seed) {
      var h = seed >>> 0, i;
      for (i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return h >>> 0;
    }
    var a = fnv(2166136261), b = fnv(a ^ 0x9e3779b9);
    return ('00000000' + a.toString(16)).slice(-8) + ('0000' + (b >>> 16).toString(16)).slice(-4);
  }
  /* 取り込みの1行 → {row（ats_import に渡す1行）, issues:[入れない理由], warns:[元の書き方を備考に残した項目], staff:{state,id}, others:[その他にした経路]}。
     issues があれば入れない。面接者ノートの全部の列を、項目か備考（note_text）の見出しつきの行に残す（2026-10-27 本人指示）。
     ・受付日が空・読めない時は 面接日 → 可否連絡日 → 就業開始日 の順で最初に読める日付を使い、元の書き方を備考に残す。
       どれも読めなければ受付日は空のまま入れ、取り込みの鍵は「正規化氏名|no:元のNo」
     ・今日より連絡途絶の日数以上前の行（受付日の無い行を含む）は、終わった選考として段階を決める（deriveStage の past）
     ・性別・連絡先・生年月日・就業開始日・返答期限・面接日を読めない時は、入れずに止めず、元の書き方を備考に残す */
  function normApplicant(headerMap, cells, today, settings, staffList) {
    var map = headerMap || {}, c = cells || [], issues = [], warns = [], notes = [];
    var st = settings || DEFAULT_SETTINGS;
    var days = Number(st.lostDays) >= 1 ? Math.floor(Number(st.lostDays)) : DEFAULT_SETTINGS.lostDays;
    function cell(k) { return (k in map) ? trim(c[map[k]]) : ''; }
    function keep(label, text) { notes.push(label + ': ' + text); }
    function warn(label, text) { warns.push(label); keep(label + '（元の書き方）', text); }
    var name = trim(nfkc(cell('name')).replace(/[\s　]+/g, ' '));
    if (!name) issues.push('氏名がありません');
    else if (name.length > 80) issues.push('氏名が80字を超えています');
    /* データベースの表の上限（0026・0030）は試算で確かめる（1行の違反で全部が断られないように）。
       資格・住所・メールは超えたら備考へ全文、No は備考へ、採用可否の語は80字に切って全文を備考へ */
    if (cell('kana').length > 80) issues.push('カナが長すぎます');
    var noText = cell('no'), legacyNo = noText.length <= 40 ? noText : '';
    if (noText && !legacyNo) keep('No（元の書き方）', noText);
    /* 日付の欄（受付日を補う時は年の無い日付を今日から前へ補う） */
    var recText = cell('received'), ivText = cell('interview'), roText = cell('resultOn'), stText = cell('startOn');
    function readPast(t) { return t ? (normDate(t) || completeYear(t, today, 'past')) : null; }
    /* 年があるか（基準日なしで読めれば年がある） */
    function hasYear(t) { return !!completeYear(t, ''); }
    var received = readPast(recText), recFrom = '', recYearless = false;
    if (!received) {
      /* 代わりに使う日付は、年が無ければ今日から前へ補う（先の日付にしない・2026-10-27 反証レビュー） */
      var ivPast = ivText ? splitDateNote(ivText, today, 'past') : null;
      var cands = [['面接日', ivPast && ivPast.date, !!(ivPast && ivPast.yearless)], ['可否連絡日', readPast(roText), !!roText && !hasYear(roText)], ['就業開始日', readPast(stText), !!stText && !hasYear(stText)]];
      for (var ci = 0; ci < cands.length; ci++) if (cands[ci][1]) { received = cands[ci][1]; recFrom = cands[ci][0]; recYearless = cands[ci][2]; break; }
      keep('受付日（元の書き方）', (recText || '空欄') + (received ? '（' + recFrom + 'の日付を受付日にしました）' : '（読める日付がありません）'));
    }
    var base = received || today;
    var age = received ? daysBetween(received, today) : null;
    /* 年の無い日付から補った受付日の行は、補った年が取り込む日で変わるので過去の行として決める */
    var past = age == null || age >= days || recYearless;
    /* 経路 */
    var srcText = cell('sources'), src = canonSources(srcText);
    if (srcText) keep('求人媒体（元の書き方）', srcText);
    /* 性別・年齢・生年月日 */
    var g = trim(nfkc(cell('gender')));
    var gender = g ? (GENDER[g] || '') : '';
    if (g && !gender) warn('性別', g);
    if (cell('age')) keep('年齢', cell('age'));
    var birthText = cell('birth'), birth = birthText ? normDate(birthText) : null;
    if (birthText && !birth) warn('生年月日', birthText);
    /* 資格・住所（上限を超えたら備考へ全文） */
    var quals = cell('quals'), address = cell('address');
    if (quals.length > 1000) { warn('資格', quals); quals = ''; }
    if (address.length > 200) { warn('住所', address); address = ''; }
    /* 連絡先 */
    var ctText = cell('contacts'), ct = parseContacts(ctText);
    var email = cell('email') ? trim(nfkc(cell('email'))) : ct.email;
    if (cell('email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { warn('メール', cell('email')); email = ''; }
    if (email.length > 200) { warn('メール', email); email = ''; }
    if (ct.issues.length) warn('連絡先', ctText);
    /* 面接日（見学だけの行は面接にしない） */
    var iv = splitDateNote(ivText, base, recYearless ? 'past' : undefined);
    if (ivText) keep('面接日', iv.date ? iv.date + (iv.note ? ' ' + iv.note : '') : ivText);
    if (iv.issue) warns.push('面接日');
    var visitOnly = !!iv.date && /見学/.test(iv.note) && !/面接/.test(iv.note);
    var interviewOn = iv.date && !visitOnly ? iv.date : null;
    /* 返答期限目安・就業開始日 */
    var rdText = cell('replyDue'), replyDue = rdText ? completeYear(rdText, base) : null;
    if (rdText && !replyDue) warn('返答期限目安', rdText);
    var startOn = stText ? completeYear(stText, base) : null;
    if (stText && !startOn) warn('就業開始日', stText);
    /* 採用可否・可否連絡日 */
    var resText = cell('result');
    if (resText) keep('採用可否（元の書き方）', resText);
    if (roText) keep('可否連絡日', roText);
    var ds = deriveStage({ result: resText, startOn: startOn, received: received, interviewOn: iv.date }, today, days, past);
    if (ds.issue) issues.push(ds.issue);
    if (ds.note) notes.push(ds.note);
    /* 本人希望・条件・備考は切らずに全文（2万字まで） */
    var wish = cell('wish'), cond = cell('cond');
    if (cell('note')) notes.push(cell('note'));
    var noteText = notes.join('\n');
    if (wish.length > TEXT_MAX) issues.push('本人希望が2万字を超えています');
    if (cond.length > TEXT_MAX) issues.push('条件が2万字を超えています');
    if (noteText.length > TEXT_MAX) issues.push('備考が2万字を超えています');
    var stage = ds.stage;
    /* 終わった日は取り込み元の終わった日（可否連絡日 → 面接日 → 受付日の順で読める日付・どれも無ければ取り込んだ日）。
       取り込んだ記録は保管期限の対象外（データベースが retain_until を空にする・代表者の決定 2026-10-27） */
    var closed = null;   // データベース（0030）が使うのは不採用・辞退・連絡途絶の行だけ。入職完了の行には送らない
    if (stage && isEnd(stage)) closed = (roText ? completeYear(roText, base) : null) || iv.date || received || today;
    var key = '';
    /* 年の無い日付から補った受付日の行は、取り込む日で鍵が変わらないよう元の No で鍵を作る */
    if (name && received && !recYearless) key = importKey(name, received);
    else if (name && legacyNo) key = normName(name) + '|no:' + legacyNo;
    /* 日付も No も無い行（年の無い日付から補って No も無い行を含む）は、行の全部のセルの指紋で鍵を作る（同じ行なら同じ鍵・2026-10-27） */
    else if (name) key = normName(name) + '|h:' + rowHash(c);
    var row = {
      legacy_no: legacyNo || null,
      received_on: received,
      sources: src.list,
      name: name,
      kana: cell('kana') || null,
      gender: gender,
      birth_date: birth,
      jobs: splitList(cell('jobs')),
      quals_text: quals || null,
      address: address || null,
      phones: ct.phones,
      email: email || null,
      wish_text: wish || null,
      cond_text: cond || null,
      note_text: noteText || null,
      reply_due: replyDue,
      stage: stage,
      closed_on: closed,
      outcome_reason: stage === 'lost' ? '連絡途絶' : null,
      start_on: startOn,
      import_key: key
    };
    /* 取り込み元で入職済みの方（データベース 0030 の項目）。職員マスタで1人だけ見つかれば職員IDを付ける */
    var staff = { state: '', id: '' };
    /* legacy_hired は毎行送る（0030 は項目の無い送信を古い画面として断る） */
    row.legacy_hired = !!ds.legacy;
    /* 採用可否の元の語は、どの段階の行でも legacy_result（80字）と備考（全文）に残す */
    if (resText) row.legacy_result = trim(nfkc(resText)).slice(0, 80);
    if (ds.legacy) {
      staff = legacyStaffMatch(staffList, name, startOn);
      if (staff.state === 'found') row.staff_id = staff.id;
    }
    if (interviewOn) {
      row.interview_on = interviewOn;
      if (iv.note) row.interview_note = iv.note.slice(0, 200);
    }
    return { row: row, issues: issues, warns: warns, staff: staff, others: src.others, past: past };
  }
  /* CSV の全体 → 試算一覧。have は取り込み済みの import_key の一覧（重複は外す）。1回300行まで。
     staffList は職員マスタの一覧（読めなかった時は null＝職員IDを付けず、取り込み元で入職済みの印だけ）。
     summary: 入れられる行の段階ごと・職員マスタで見つかった／見つからなかった採用・面接日のある行・経路ごとの件数、
              入れられない行の理由ごとの件数、その他にした経路の元の書き方（全部の行から・件数つき） */
  var IMPORT_MAX = 300;
  function planImport(text, today, settings, have, staffList) {
    var rows = parseCsv(text), hd = detectHeader(rows);
    if (!hd) return { ok: false, error: '見出しの行（氏名・受付日など）が見つかりません', items: [] };
    var seen = {}, known = {}, items = [];
    var sum = { stages: {}, staffFound: 0, staffMissing: 0, staffList: Array.isArray(staffList), interviewOn: 0, reasons: {}, sources: {}, others: [], warned: 0 };
    var otherN = {};
    (have || []).forEach(function (k) { known[k] = 1; });
    rows.slice(hd.index + 1).forEach(function (cells, i) {
      var r = normApplicant(hd.map, cells, today, settings, staffList), why = r.issues.slice();
      var k = r.row.import_key;
      if (k && known[k]) why.push('取り込み済みです');
      else if (k && seen[k]) why.push(/\|h:/.test(k) ? '同じ内容の行が上にあります' : /\|no:/.test(k) ? '同じ氏名・No の行が上にあります' : '同じ氏名・受付日の行が上にあります');
      if (k) seen[k] = 1;
      r.others.forEach(function (o) { otherN[o] = (otherN[o] || 0) + 1; });
      items.push({ line: hd.index + i + 2, row: r.row, issues: why, warns: r.warns, staff: r.staff, ok: !why.length });
    });
    /* 同じ職員IDが取り込みの中で2行以上に当たったら、どの行にも付けない（取り込み元で入職済みの印だけ・2026-10-27 反証レビュー） */
    var sidN = {};
    items.forEach(function (x) { if (x.ok && x.row.staff_id) sidN[x.row.staff_id] = (sidN[x.row.staff_id] || 0) + 1; });
    items.forEach(function (x) {
      if (x.ok && x.row.staff_id && sidN[x.row.staff_id] > 1) { delete x.row.staff_id; x.staff = { state: 'dup', id: '' }; }
    });
    items.forEach(function (x) {
      var r = { row: x.row, warns: x.warns };
      if (!x.ok) { x.issues.forEach(function (w) { var rk = /^採用可否の「/.test(w) ? '採用可否を読めません' : w; sum.reasons[rk] = (sum.reasons[rk] || 0) + 1; }); return; }
      sum.stages[r.row.stage] = (sum.stages[r.row.stage] || 0) + 1;
      if (r.row.legacy_hired) { if (r.row.staff_id) sum.staffFound++; else sum.staffMissing++; }
      if (r.row.interview_on) sum.interviewOn++;
      if (r.warns.length) sum.warned++;
      (r.row.sources.length ? r.row.sources : ['（経路なし）']).forEach(function (s) { sum.sources[s] = (sum.sources[s] || 0) + 1; });
    });
    sum.others = Object.keys(otherN).sort().map(function (o) { return { text: o, n: otherN[o] }; });
    var n = items.filter(function (x) { return x.ok; }).length;
    return { ok: true, items: items, count: n, tooMany: n > IMPORT_MAX, unknown: hd.unknown, summary: sum };
  }

  /* ── 職員マスタへの登録 ── */
  /* 必須（そろうまで登録のボタンを押せない）。職員マスタの GAS が必ず求めるのは氏名と入職日だけだが、
     採用管理から登録する時は、雇用形態・勤務形態・所属事業所・主所属まで決めてから送る */
  var REQUIRED = [
    { key: 'name', label: '氏名' },
    { key: 'employmentType', label: '雇用形態' },
    { key: 'workStyle', label: '勤務形態' },
    { key: 'sites', label: '所属事業所' },
    { key: 'primarySite', label: '主所属' },
    { key: 'hireDate', label: '入職日' }
  ];
  var WORK_STYLES = ['full_ded', 'full_con', 'part_ded', 'part_con'];
  var SITE_KEYS = [['facility', 'siteFacility'], ['visit', 'siteVisit'], ['day', 'siteDay']];
  /* 応募者の行（入職準備の prep を含む）→ {fields（職員マスタの bulkSave の creates[].fields）, issues:[{key,reason}], rows（確認の表）, missing:[項目名]} */
  function buildStaffCreate(applicant, enums) {
    var a = applicant || {}, p = (a.prep && typeof a.prep === 'object') ? a.prep : {};
    var en = enums || {}, issues = [], f = {}, rows = [];
    function codeOk(list, code) {
      if (!Array.isArray(list)) return true;   // 選択肢を読めていない時は、職員マスタ側の検査に任せる（ボタンは画面で止める）
      return list.some(function (x) { return x && x.code === code; });
    }
    function add(label, value, target) { rows.push({ label: label, value: value, target: target }); }
    var name = trim(a.name);
    if (name) { f.name = name; add('氏名', name, '氏名'); }
    var kana = trim(p.kana || a.kana);
    if (kana) { f.kana = kana; add('フリガナ', kana, 'フリガナ'); }
    var birth = p.birthDate || a.birth_date || '';
    if (birth) {
      if (isDate(birth)) { f.birthDate = birth; add('生年月日', birth, '生年月日'); }
      else issues.push({ key: 'birthDate', reason: '生年月日の形が違います' });
    }
    var g = p.gender || a.gender || '';
    if (g) {
      if (g === 'M' || g === 'F') { f.gender = g; add('性別', g === 'M' ? '男' : '女', '性別'); }
      else issues.push({ key: 'gender', reason: '性別の形が違います' });
    }
    var phone = trim(p.phone || ((a.phones || []).filter(function (x) { return x && x.label !== '旧'; })[0] || {}).num || '');
    if (phone) { f.phone = phone.slice(0, 40); add('電話（主番号）', f.phone, '連絡先'); }
    var addr = trim(p.address || a.address);
    if (addr) { f.address = addr.slice(0, 200); add('住所', f.address, '住所'); }
    var em = p.emergency;
    if (em && typeof em === 'object' && (trim(em.name) || trim(em.phone))) {
      f.emergencyJson = [{ name: trim(em.name), relation: trim(em.relation), phone: trim(em.phone) }];
      add('緊急連絡先', [trim(em.name), trim(em.relation), trim(em.phone)].filter(Boolean).join('・'), '緊急連絡先');
    }
    if (p.employmentType) {
      if (codeOk(en.employmentType, p.employmentType)) { f.employmentType = p.employmentType; add('雇用形態', labelOf(en.employmentType, p.employmentType), '雇用区分'); }
      else issues.push({ key: 'employmentType', reason: '雇用形態が職員マスタの選択肢にありません' });
    }
    var job = trim(p.jobTitle || (a.jobs || [])[0] || '');
    if (job) { f.jobTitle = job.slice(0, 60); add('職種', f.jobTitle, '職種'); }
    var sites = (p.sites && typeof p.sites === 'object') ? p.sites : {}, on = [];
    SITE_KEYS.forEach(function (sk) { if (sites[sk[0]] === true) { f[sk[1]] = true; on.push(sk[0]); } });
    if (on.length) add('所属事業所', on.map(function (x) { return SITE_LABEL[x]; }).join('・'), '施設・訪問・通所');
    if (p.primarySite) {
      if (on.indexOf(p.primarySite) < 0) issues.push({ key: 'primarySite', reason: '主所属が所属事業所に入っていません' });
      else { f.primarySite = p.primarySite; add('主所属', SITE_LABEL[p.primarySite], '主たる事業所'); }
    }
    if (p.workStyle) {
      if (WORK_STYLES.indexOf(p.workStyle) >= 0) { f.workStyle = p.workStyle; add('勤務形態', WORK_LABEL[p.workStyle], '勤務形態'); }
      else issues.push({ key: 'workStyle', reason: '勤務形態の形が違います' });
    }
    var hire = p.hireDate || a.start_on || '';
    if (hire) {
      if (isDate(hire)) { f.hireDate = hire; add('入職日', hire, '入職日'); }
      else issues.push({ key: 'hireDate', reason: '入職日の形が違います' });
    }
    if (f.birthDate && f.hireDate && f.birthDate >= f.hireDate) issues.push({ key: 'hireDate', reason: '入職日が生年月日と同じか、それより前です' });
    var quals = Array.isArray(p.quals) ? p.quals : [];
    var qs = [];
    quals.forEach(function (q) {
      if (!q || !q.code) return;
      if (!codeOk(en.qualCodes, q.code)) { issues.push({ key: 'quals', reason: '資格が職員マスタの選択肢にありません' }); return; }
      if (q.acquiredOn && !isDate(q.acquiredOn)) { issues.push({ key: 'quals', reason: '資格の取得日の形が違います' }); return; }
      qs.push(q.acquiredOn ? { code: q.code, acquiredOn: q.acquiredOn } : { code: q.code });
    });
    if (qs.length) {
      f.qualsJson = qs.slice(0, 20);
      add('資格', qs.map(function (q) { return labelOf(en.qualCodes, q.code) + (q.acquiredOn ? '（' + q.acquiredOn + '）' : ''); }).join('・'), '資格');
    }
    var have = { name: !!f.name, employmentType: !!f.employmentType, workStyle: !!f.workStyle, sites: on.length > 0, primarySite: !!f.primarySite, hireDate: !!f.hireDate };
    var missing = REQUIRED.filter(function (r) { return !have[r.key]; }).map(function (r) { return r.label; });
    return { fields: f, issues: issues, rows: rows, missing: missing, ready: !missing.length && !issues.length };
  }
  var SITE_LABEL = { facility: '施設', visit: '訪問', day: '通所' };
  var WORK_LABEL = { full_ded: '常勤・専従', full_con: '常勤・兼務', part_ded: '非常勤・専従', part_con: '非常勤・兼務' };
  function labelOf(list, code) {
    if (Array.isArray(list)) for (var i = 0; i < list.length; i++) if (list[i] && list[i].code === code) return str(list[i].label || code);
    return str(code);
  }
  /* 「あと2項目（雇用形態・入職日）」 */
  function missingText(missing) {
    var m = missing || [];
    return m.length ? 'あと' + m.length + '項目（' + m.join('・') + '）' : '';
  }
  /* 送る内容の指紋（staff_sent_key）。同じ中身なら同じ値 */
  function sentKey(fields) {
    var keys = Object.keys(fields || {}).sort(), s = JSON.stringify(keys.map(function (k) { return [k, fields[k]]; })), h = 5381, i;
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return keys.length + ':' + (h >>> 0).toString(36);
  }
  /* 職員マスタの一覧の1行が、送った方と同じか（職員マスタの sameStaff と同じ: 氏名＋入職日＋生年月日（あれば）） */
  function sameStaff(row, sent) {
    if (!row || !sent || !sent.name || normName(row.name) !== normName(sent.name)) return false;
    if (str(row.hireDate) !== str(sent.hireDate)) return false;
    return !sent.birthDate || str(row.birthDate) === str(sent.birthDate);
  }
  /* 退職日のある職員は照合から外す（辞めた方につながない） */
  function isActiveStaff(r) { return !!r && !trim(r.retireDate); }
  function staffMatches(list, sent) {
    return (Array.isArray(list) ? list : []).filter(function (r) { return isActiveStaff(r) && sameStaff(r, sent); });
  }
  /* 氏名だけ一致する在籍の職員（入職日・生年月日は違う）。新しく登録する前に確かめるため */
  function sameNameActive(list, name) {
    var n = normName(name);
    return n ? (Array.isArray(list) ? list : []).filter(function (r) { return isActiveStaff(r) && normName(r.name) === n; }) : [];
  }
  /* 'hit'＝登録済み／'wait'＝まだ言い切れない（送り直させない）／'absent'＝入っていないと言い切れる
     （入居調整の masterWriteVerdict と同じ分かれ方） */
  function staffVerdict(hit, stamp, nowMs) {
    if (hit) return 'hit';
    var sent = Date.parse(stamp || '');
    if (!isFinite(sent)) return 'absent';
    if (sent - nowMs > SETTLE_MS) return 'absent';
    return (nowMs - sent < SETTLE_MS) ? 'wait' : 'absent';
  }
  function staffWaitMinutes(stamp, nowMs) {
    var sent = Date.parse(stamp || '');
    if (!isFinite(sent)) return 0;
    var left = SETTLE_MS - (nowMs - sent);
    return left > 0 ? Math.ceil(left / 60000) : 0;
  }
  /* 職員マスタの bulkSave の応答 → 'ok'（id を受け取った）／'ng'（断られた・何も書いていない）／'unsure'（書けたか分からない）。
     flush は FLUSH_FAIL_MSG（staff-api.gs の定数の写し・画面が渡す） */
  function staffResult(d, flushMsg) {
    if (!d || typeof d !== 'object') return { kind: 'unsure', id: '' };
    var created = Array.isArray(d.created) ? d.created : [];
    var id = created.length && created[0] && created[0].id ? str(created[0].id) : '';
    if (d.ok === true) return id ? { kind: 'ok', id: id } : { kind: 'unsure', id: '' };
    if (d.inProgress === true || d.partial === true || str(d.error) === str(flushMsg)) return { kind: 'unsure', id: id };
    return { kind: 'ng', id: '', error: str(d.error).slice(0, 200) };
  }

  /* ── 表示の判定 ── */
  /* 初動遅れ（応募受付・書類選考のうち、最初の連絡が無いまま受付から24時間を超えた）。返りは超えた時間（無ければ 0） */
  function firstContactLate(a, nowMs) {
    if (!a || a.first_contact_at || (a.stage !== 'applied' && a.stage !== 'screening')) return 0;
    var t = Date.parse(a.created_at || '');
    if (!isFinite(t) && isDate(a.received_on)) t = Date.parse(a.received_on + 'T00:00:00+09:00');
    if (!isFinite(t)) return 0;
    var h = Math.floor((nowMs - t) / 3600000);
    return h >= FIRST_CONTACT_HOURS ? h : 0;
  }
  /* 返答期限: 'past'（過ぎた）／'soon'（今日・明日）／'' */
  function replyDueState(due, today) {
    var n = daysBetween(today, due);
    if (n == null) return '';
    if (n < 0) return 'past';
    return n <= 1 ? 'soon' : '';
  }
  /* 評価の状態の文「2人中1人提出」 */
  function evalStatusText(submitted, total) {
    var s = Math.max(0, Number(submitted) || 0), t = Math.max(0, Number(total) || 0);
    return t ? t + '人中' + s + '人提出' : '面接官が決まっていません';
  }
  /* 評価の窓で他の面接官の評価を見られるか（自分が提出済みの時だけ） */
  function evalVisible(myEval) { return !!(myEval && myEval.status === 'submitted'); }
  /* 評価の入力の確かめ（各項目 1〜5・総合 1〜5）。提出の時だけ全部要る */
  function evalCheck(items, scores, overall, submit) {
    var miss = [];
    (items || []).forEach(function (k) { var v = scores ? Number(scores[k]) : NaN; if (!(v >= 1 && v <= 5)) miss.push(k); });
    var o = Number(overall);
    if (!(o >= 1 && o <= 5)) miss.push('総合の点');
    return { ok: !submit || !miss.length, missing: miss };
  }
  /* 評価項目の設定の確かめ（1〜12項目・1項目30字まで・重ならない） */
  function normEvalItems(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (x) {
      var s = trim(nfkc(x)).replace(/[\r\n\t]/g, ' ');
      if (s && s.length <= 30 && !seen[s]) { seen[s] = 1; out.push(s); }
    });
    return out.slice(0, 12);
  }
  function normSettings(o) {
    var s = o || {}, items = normEvalItems(s.eval_items || s.evalItems);
    var rm = Number(s.retain_months != null ? s.retain_months : s.retainMonths);
    var ld = Number(s.lost_days != null ? s.lost_days : s.lostDays);
    return {
      evalItems: items.length ? items : DEFAULT_EVAL_ITEMS.slice(),
      retainMonths: rm >= 1 && rm <= 60 ? Math.floor(rm) : DEFAULT_SETTINGS.retainMonths,
      lostDays: ld >= 7 && ld <= 365 ? Math.floor(ld) : DEFAULT_SETTINGS.lostDays
    };
  }

  /* ── 面接予定 ── */
  /* 面接の一覧 → {today:[], tomorrow:[], later:[]}（later は7日先まで）。時刻の順 */
  function scheduleBuckets(interviews, nowMs) {
    var today = todayJST(nowMs), tm = addDays(today, 1), end = addDays(today, 7), out = { today: [], tomorrow: [], later: [] };
    (interviews || []).forEach(function (iv) {
      var t = Date.parse(iv && iv.held_at || '');
      if (!isFinite(t)) return;
      var d = todayJST(t);
      if (d === today) out.today.push(iv);
      else if (d === tm) out.tomorrow.push(iv);
      else if (d > tm && d <= end) out.later.push(iv);
    });
    ['today', 'tomorrow', 'later'].forEach(function (k) { out[k].sort(function (a, b) { return Date.parse(a.held_at) - Date.parse(b.held_at); }); });
    return out;
  }

  /* ── 集計 ── */
  /* 期間の始まりと終わり（'month' 今月／'3m' 3か月／'fy' 今年度（4月始まり）／'all' 全期間・'year' 年ごと（全期間を年で分ける）） */
  function periodRange(kind, today) {
    var o = ymd(today);
    if (!o) return { from: '', to: '' };
    if (kind === 'month') return { from: o.y + '-' + pad2(o.m) + '-01', to: today };
    if (kind === '3m') return { from: addMonths(today, -3), to: today };
    if (kind === 'fy') return { from: (o.m >= 4 ? o.y : o.y - 1) + '-04-01', to: today };
    return { from: '', to: '' };
  }
  function rate(num, den) {
    if (!(den > 0)) return '—';
    return num + '/' + den + '（' + Math.round(num * 100 / den) + '%）';
  }
  /* 1人の数え方（集計の表と年ごとの表で同じ）:
       面接＝面接の行がある（取り込みで作った面接を含む）か、取り込みの面接日（interview_on）がある
       採用＝内定以上に進んだ（これまでに進んだいちばん先の段階）か、取り込み元で入職済み（legacy_hired）
       入職＝入職完了（取り込み元で入職済みを含む）／辞退＝辞退 */
  function countsOf(a) {
    var reached = Math.max(stageRank(a.stage), stageRank(a.reached));
    return {
      interviewed: (Number(a.interviews) || 0) > 0 || isDate(a.interview_on),
      offered: reached >= stageRank('offer'),
      accepted: reached >= stageRank('offer') || a.legacy_hired === true,
      hired: a.stage === 'hired',
      declined: a.stage === 'declined'
    };
  }
  /* 受付日が期間に入る応募者を数える。a.reached はこれまでに進んだいちばん先の段階（無ければ今の段階）、
     a.interviews は面接の回数。経路が複数の応募はそれぞれの経路に1件ずつ数える */
  function funnel(applicants, from, to) {
    var list = (applicants || []).filter(function (a) {
      var d = str(a && a.received_on);
      if (!d) return !from && !to;
      return (!from || d >= from) && (!to || d <= to);
    });
    var stages = {}, bySrc = {}, multi = 0;
    STAGES.concat(END_STAGES).forEach(function (s) { stages[s.id] = 0; });
    list.forEach(function (a) {
      if (a.stage in stages) stages[a.stage]++;
      var k = countsOf(a);
      var srcs = Array.isArray(a.sources) && a.sources.length ? a.sources : ['（経路なし）'];
      if (srcs.length > 1) multi++;
      srcs.forEach(function (s) {
        var b = bySrc[s] || (bySrc[s] = { source: s, n: 0, interviewed: 0, offered: 0, accepted: 0, hired: 0, declined: 0 });
        b.n++;
        if (k.interviewed) b.interviewed++;
        if (k.offered) b.offered++;
        if (k.accepted) b.accepted++;
        if (k.hired) b.hired++;
        if (k.declined) b.declined++;
      });
    });
    var sources = Object.keys(bySrc).map(function (k) { var b = bySrc[k]; b.few = b.n < 10; return b; })
      .sort(function (x, y) { return y.n - x.n || (x.source < y.source ? -1 : 1); });
    return { total: list.length, stages: stages, sources: sources, multiSource: multi };
  }
  /* 年ごとの表（受付日の年 × 応募・面接・採用・入職・辞退）。古い年から並べ、受付日の無い方は最後の「（受付日なし）」の行 */
  var NO_YEAR = '（受付日なし）';
  function yearTable(applicants) {
    var by = {};
    (applicants || []).forEach(function (a) {
      if (!a) return;
      var o = ymd(a.received_on), y = o ? String(o.y) : NO_YEAR, k = countsOf(a);
      var r = by[y] || (by[y] = { year: y, n: 0, interviewed: 0, accepted: 0, hired: 0, declined: 0 });
      r.n++;
      if (k.interviewed) r.interviewed++;
      if (k.accepted) r.accepted++;
      if (k.hired) r.hired++;
      if (k.declined) r.declined++;
    });
    return Object.keys(by).sort(function (x, y) { return x === NO_YEAR ? 1 : y === NO_YEAR ? -1 : (x < y ? -1 : 1); }).map(function (y) { return by[y]; });
  }
  /* 集計の期間の既定: 今月の応募が1件も無ければ全期間 */
  function defaultPeriod(applicants, today) {
    var rg = periodRange('month', today);
    var any = (applicants || []).some(function (a) { var d = str(a && a.received_on); return d && d >= rg.from && d <= rg.to; });
    return any ? 'month' : 'all';
  }
  /* 選考ボードに出さない方: 取り込み元で入職済み・入職日（start_on）が60日より前の入職完了（「終わった人」の一覧に出す） */
  var BOARD_HIRED_DAYS = 60;
  function boardHidden(a, today) {
    if (!a) return false;
    if (a.legacy_hired === true) return true;
    if (a.stage !== 'hired' || !isDate(a.start_on)) return false;
    var d = daysBetween(a.start_on, today);
    return d != null && d > BOARD_HIRED_DAYS;
  }

  /* ── 保管期限 ── */
  /* 期限を過ぎて消せる行（retain_until が今日より前・職員マスタに登録していない） */
  function purgeable(applicants, today) {
    return (applicants || []).filter(function (a) { return a && !a.staff_id && isDate(a.retain_until) && a.retain_until < today; });
  }

  /* ── 応募の知らせの貼り付け（2026-10-27 本人指示） ──
     求人サイトの応募の知らせ（メール本文・管理画面の応募者の欄）を貼ると、読める項目だけを拾って返す。
     貼った文面はここで読むだけで、返すのは拾った値だけ（文面そのものは返さない・保存しない）。
     確かめた書き方: ジョブメドレーの知らせ（氏名は無い・会員番号／応募求人／希望職種／保有資格）、Indeed の知らせ（「〜さんから応募がありました」）。
     そのほかの書き方は「見出し：値」または「見出し」の次の行の値を拾う（求人ボックス・管理画面の写しは未確認の書き方として扱う） */
  var POST_LABELS = {
    name: ['氏名', 'お名前', '名前', '応募者名', '応募者氏名'],
    kana: ['フリガナ', 'ふりがな', 'カナ', '氏名(カナ)', '氏名(フリガナ)', 'お名前(フリガナ)'],
    gender: ['性別'],
    birth: ['生年月日'],
    age: ['年齢'],
    phone: ['電話番号', '電話', '携帯電話', '携帯電話番号', '携帯番号', 'TEL', '連絡先電話番号'],
    email: ['メールアドレス', 'メール', 'Eメール', 'E-mail', 'Email'],
    address: ['住所', '現住所'],
    quals: ['保有資格', '資格', '所有資格'],
    wantJobs: ['希望職種'],
    jobs: ['応募職種', '職種', '募集職種'],
    posting: ['応募求人', '応募した求人', '求人名', '求人タイトル', '求人'],
    received: ['応募日', '応募日時', '応募受付日', '応募受付日時']
  };
  /* 求人の題名から職種を拾う時の言葉（長いものを先に当てる） */
  var JOB_WORDS = ['サービス提供責任者', '機能訓練指導員', '介護支援専門員', 'ケアマネージャー', '生活相談員', '理学療法士', '作業療法士', '言語聴覚士',
    '准看護師', '看護職員', '看護師', '介護福祉士', '介護職員', '介護スタッフ', '介護職', '訪問介護員', 'ホームヘルパー', 'ヘルパー', '入浴介助',
    '送迎ドライバー', 'ドライバー', '調理師', '調理員', '調理補助', '事務員', '医療事務', '事務', '管理者', '看護助手', '夜勤専従', '清掃'];
  var POST_INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤ㅤ﻿ﾠ]/g;
  function postLines(text) {
    return nfkc(text).replace(POST_INVISIBLE, '').replace(/\r\n?/g, '\n').split('\n').map(function (l) {
      return trim(l.replace(/^[\s|#>]+|[\s|]+$/g, ''));
    }).filter(Boolean);
  }
  function postLabelKey(s) { return nfkc(s).replace(/^[■□●○◆◇▼▽・*【\[]+|[】\]]+$/g, '').replace(/[\s　]+/g, '').toLowerCase(); }
  function isPostLabel(line) {
    var k = postLabelKey(line), key, i;
    for (key in POST_LABELS) for (i = 0; i < POST_LABELS[key].length; i++) if (postLabelKey(POST_LABELS[key][i]) === k) return true;
    return false;
  }
  /* 見出しの値: 「見出し：値」「見出し 値」（同じ行）／「見出し」だけの行の次の行（次の行が見出しなら無し） */
  function postValue(lines, key) {
    var labels = POST_LABELS[key].map(postLabelKey), i, j;
    for (i = 0; i < lines.length; i++) {
      var raw = lines[i].replace(/^[■□●○◆◇▼▽・*]+/, ''), head = postLabelKey(raw);
      if (labels.indexOf(head) >= 0) {
        var nx = lines[i + 1];
        if (nx && !isPostLabel(nx) && !/^-{3,}$/.test(nx)) return trim(nx);
        continue;
      }
      /* 同じ行: 「【見出し】値」「見出し：値」「見出し（タブ）値」「見出し 値」 */
      var ms = [/^[【\[]([^】\]]+)[】\]][\s　]*(.+)$/.exec(raw), /^([^:：\t]+?)[\s　]*[:：\t][\s　]*(.+)$/.exec(raw), /^([^\s　]+)[\s　]+(.+)$/.exec(raw)];
      for (j = 0; j < ms.length; j++) if (ms[j] && labels.indexOf(postLabelKey(ms[j][1])) >= 0 && trim(ms[j][2])) return trim(ms[j][2]);
    }
    return '';
  }
  function cutEllipsis(s) { return trim(str(s).replace(/(\.{2,}|…+)$/, '')); }
  function postList(s) { return cutEllipsis(s).split(/[\s　]*[、,，・\/／][\s　]*/).map(trim).filter(Boolean); }
  /* 求人の題名 → 職種（1）画面で使っている職種のうち題名に含まれる最も長いもの（2）ジョブメドレーの「〜 職種（雇用形態）」
     （3）決まった言葉のうち題名に含まれるもの（4）Indeed の「職種/…」の先頭。拾えなければ '' */
  function jobFromPosting(posting, site, knownJobs) {
    var p = nfkc(posting), best = '';
    (knownJobs || []).forEach(function (j) { var t = trim(nfkc(j)); if (t && p.indexOf(t) >= 0 && t.length > best.length) best = t; });
    if (best) return best;
    if (site === 'ジョブメドレー') {
      var m = /([^\s　]+?)[（(]([^）)]+)[）)][\s　]*$/.exec(p);
      if (m) return m[1];
    }
    for (var i = 0; i < JOB_WORDS.length; i++) if (p.indexOf(JOB_WORDS[i]) >= 0) return JOB_WORDS[i];
    var head = trim(p.split(/[\/／•|]/)[0]);
    return head && head.length <= 20 ? head : '';
  }
  var POST_SKIP_MAIL = /^(no-?reply|noreply|system|info|support|notice|do-?not-?reply)@|@(job-medley\.com|indeed\.com|kyujinbox\.com)$/i;
  /* 貼った文面 → {site, name, kana, gender, birth_date, age, phones:[{num,label}], email, address, quals_text, jobs:[], received_on,
     receivedGuess, member_no, posting, employment, note_text, warns:[], found:[拾えた項目の名前]}。today は 'YYYY-MM-DD' */
  function parsePosting(text, opts) {
    var o = opts || {}, today = isDate(o.today) ? o.today : todayJST();
    var lines = postLines(text), all = lines.join('\n'), out = {
      site: '', name: '', kana: '', gender: '', birth_date: '', age: '', phones: [], email: '', address: '', quals_text: '', jobs: [],
      received_on: today, receivedGuess: true, member_no: '', posting: '', employment: '', note_text: '', warns: [], found: []
    };
    if (!lines.length) return out;
    if (/job-?medley|ジョブメドレー/i.test(all)) out.site = 'ジョブメドレー';
    else if (/求人ボックス|kyujinbox/i.test(all)) out.site = '求人ボックス';
    else if (/indeed/i.test(all)) out.site = 'Indeed';
    function found(n) { if (out.found.indexOf(n) < 0) out.found.push(n); }
    /* 氏名: 見出しから。無ければ Indeed の「〜さんから応募がありました」「〜さんが…の求人に応募しました」 */
    var nm = postValue(lines, 'name');
    if (!nm) {
      lines.some(function (l) {
        var m = /^(.*?)さん(?:から応募がありました|が.+の求人に応募しました)/.exec(l);
        if (!m) return false;
        var s = m[1].split(/\s-\s/).pop().replace(/^(re|fw|fwd)\s*:\s*/i, '').replace(/^\[[^\]]*\]\s*/, '');
        nm = trim(s);
        return !!nm;
      });
    }
    nm = trim(nm.replace(/[\s　]*(様|さん)$/, ''));
    if (nm && nm.length <= 40 && !/[@\d:：]|会員番号/.test(nm)) { out.name = nm; found('氏名'); }
    var kana = postValue(lines, 'kana');
    if (kana && kana.length <= 80) { out.kana = trim(kana); found('フリガナ'); }
    var g = postValue(lines, 'gender');
    if (/^男/.test(g)) { out.gender = 'M'; found('性別'); } else if (/^女/.test(g)) { out.gender = 'F'; found('性別'); }
    var bd = postValue(lines, 'birth'), bm = bd && /(\d{4}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}日?|(?:令和|平成|昭和|[RHS])\d{1,2}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}日?)/.exec(bd);
    var b = bm ? normDate(bm[1]) : null;
    if (b && b < today) { out.birth_date = b; found('生年月日'); }
    var ag = /(\d{1,3})[\s　]*歳/.exec(postValue(lines, 'age') || bd || '');
    if (ag && +ag[1] >= 15 && +ag[1] <= 100) { out.age = ag[1]; found('年齢'); }
    /* 電話: 見出しの値。無ければ「0から始まる・ハイフンつき」の番号（郵便番号・URL の行は見ない） */
    var ph = postValue(lines, 'phone'), nums = [];
    function addNum(s) { var n = trim(s).replace(/[^\d\-]/g, ''); if (/^0\d{8,10}$/.test(n.replace(/-/g, '')) && nums.indexOf(n) < 0) nums.push(n); }
    if (ph) ph.split(/[\s　,、\/／]+/).forEach(addNum);
    if (!nums.length) lines.forEach(function (l) {
      if (/〒|https?:|www\./i.test(l)) return;
      (l.match(/(?:^|[^\d\-])(0\d{1,4}-\d{1,4}-\d{3,4})(?![\d\-])/g) || []).forEach(function (m) { addNum(m); });
    });
    if (nums.length) { out.phones = nums.slice(0, 3).map(function (n) { return { num: n, label: '' }; }); found('電話'); }
    /* メール: 見出しの値。無ければ文面のアドレスのうち、送り元（no-reply など・求人サイトの代表）でないもの */
    var em = postValue(lines, 'email'), ems = [];
    (em + '\n' + all).replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, function (a) { if (!POST_SKIP_MAIL.test(a) && ems.indexOf(a) < 0) ems.push(a); return a; });
    if (ems.length) { out.email = ems[0].slice(0, 200); found('メール'); }
    var ad = postValue(lines, 'address');
    if (ad && ad.length <= 200) { out.address = ad; found('住所'); }
    var q = postValue(lines, 'quals');
    if (q) {
      out.quals_text = postList(q).join('・').slice(0, 1000); found('資格');
      if (/(\.{2,}|…+)$/.test(q)) out.warns.push('資格は知らせの中では一部しか出ていません。求人サイトの画面で確かめてください。');
    }
    var mem = /会員番号[\s　]*[:：]?[\s　]*(\d{4,12})/.exec(all);
    if (mem) { out.member_no = mem[1]; found('会員番号'); }
    /* 応募した求人: 見出し。無ければ Indeed の「題名 • 地域」「〜さんが（題名）の求人に応募しました」 */
    var post = postValue(lines, 'posting');
    if (!post) lines.some(function (l) { var m = /^(.+?)[\s　]+•[\s　]+/.exec(l); if (m && !/さん/.test(m[1])) { post = m[1]; return true; } return false; });
    if (!post) lines.some(function (l) { var m = /さんが(.+?)の求人に応募しました/.exec(l); if (m) { post = m[1]; return true; } return false; });
    out.posting = trim(post).slice(0, 200);
    if (out.posting) found('応募求人');
    var emp = /[（(](正職員|正社員|契約職員|契約社員|パート・アルバイト|パート|アルバイト|業務委託|派遣)[）)]/.exec(out.posting);
    if (emp) out.employment = emp[1];
    /* 職種: 応募職種の見出し → 求人の題名 → 希望職種の見出し（応募者の希望・知らせでは一部だけのことがある） */
    var jl = postList(postValue(lines, 'jobs'));
    if (!jl.length && out.posting) { var jp = jobFromPosting(out.posting, out.site, o.knownJobs); if (jp) jl = [jp]; }
    var want = postValue(lines, 'wantJobs');
    if (!jl.length && want) jl = postList(want);
    out.jobs = jl.slice(0, 10).map(function (x) { return x.slice(0, 60); });
    if (out.jobs.length) found('職種');
    /* 受付日: 見出しの日付（年が無ければ今日から前へ補う）。無ければ今日（貼った人が直せる） */
    var rv = postValue(lines, 'received'), rm = rv && RE_DATE_ANY.exec(rv);
    RE_DATE_ANY.lastIndex = 0;
    var rd = rm ? completeYear(rm[1], today, 'past') : null;
    if (rd && rd <= today) { out.received_on = rd; out.receivedGuess = false; found('受付日'); }
    if (!out.name) out.warns.push('氏名を読めませんでした（ジョブメドレーの知らせには氏名がありません）。氏名を入れてください。');
    if (out.receivedGuess) out.warns.push('受付日が書かれていないため、今日の日付にしています。違う時は直してください。');
    /* 備考に残すのは、会員番号・応募した求人・雇用形態・希望職種・年齢だけ（貼った文面そのものは残さない） */
    var notes = ['（応募の知らせから）'];
    if (out.member_no) notes.push('会員番号: ' + out.member_no);
    if (out.posting) notes.push('応募求人: ' + out.posting);
    if (out.employment) notes.push('雇用形態: ' + out.employment);
    if (want) notes.push('希望職種: ' + postList(want).join('・'));
    if (out.age && !out.birth_date) notes.push('年齢: ' + out.age + '歳（応募時）');
    out.note_text = notes.length > 1 ? notes.join('\n') : '';
    return out;
  }
  /* 足す前の重なりの確かめ: 同じ会員番号（備考の「会員番号: N」）の方 → 'member'、同じ氏名・同じ受付日の方 → 'name'。無ければ null */
  function postingDup(p, applicants) {
    var list = applicants || [], hit = null, key = p && p.name ? importKey(p.name, p.received_on) : '';
    var mem = p && p.member_no ? new RegExp('(^|\\n)会員番号: ' + String(p.member_no).replace(/\D/g, '') + '(\\n|$)') : null;
    list.some(function (a) {
      if (!a) return false;
      if (mem && mem.test(nfkc(a.note_text || ''))) { hit = { kind: 'member', id: a.id, name: a.name }; return true; }
      if (key && importKey(a.name, a.received_on) === key) { hit = { kind: 'name', id: a.id, name: a.name }; return true; }
      return false;
    });
    return hit;
  }

  /* ── カレンダー（選考ボードの下・2026-10-27 本人指示） ──
     日付は日本時間で数える（面接の時刻は ISO を +9 時間して日と時刻を出す）。週は日曜はじまり */
  var CAL_KINDS = [
    { id: 'iv', label: '面接' }, { id: 'start', label: '入職' }, { id: 'due', label: '返答期限' }, { id: 'recv', label: '応募' }
  ];
  function isYm(s) { var m = /^(\d{4})-(\d{2})$/.exec(str(s)); return !!(m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 2000 && +m[1] <= 2100); }
  function ymAdd(ym, n) {
    var m = /^(\d{4})-(\d{2})$/.exec(str(ym)), k = (+m[1]) * 12 + (+m[2] - 1) + n;
    return Math.floor(k / 12) + '-' + pad2(k % 12 + 1);
  }
  /* 月の表: {ym, prev, next, weeks:[[ 'YYYY-MM-DD' | '' ×7 ]]}。ym が正しくなければ today の月 */
  function calMonth(ym, today) {
    var t = isDate(today) ? today : todayJST();
    if (!isYm(ym)) ym = t.slice(0, 7);
    var y = +ym.slice(0, 4), mo = +ym.slice(5, 7), first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), last = lastDay(y, mo);
    var cells = [], d, weeks = [];
    for (d = 0; d < first; d++) cells.push('');
    for (d = 1; d <= last; d++) cells.push(ym + '-' + pad2(d));
    while (cells.length % 7) cells.push('');
    for (d = 0; d < cells.length; d += 7) weeks.push(cells.slice(d, d + 7));
    return { ym: ym, prev: ymAdd(ym, -1), next: ymAdd(ym, 1), weeks: weeks };
  }
  function jstParts(iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return null;
    var x = new Date(t + 9 * 3600000);
    return { date: x.getUTCFullYear() + '-' + pad2(x.getUTCMonth() + 1) + '-' + pad2(x.getUTCDate()), time: pad2(x.getUTCHours()) + ':' + pad2(x.getUTCMinutes()) };
  }
  /* その月の予定: {'YYYY-MM-DD': [{kind, label, date, time, id, name, jobs, round}]}。
     apps は画面で絞り込んだ後の応募者（ここに無い方の面接は出さない）。kinds は {iv:true,...}。
     取り込みで入れた面接日（interview_on）は、その方のその日の面接の記録が無い時だけ出す（二重に出さない） */
  function calEvents(apps, ivs, kinds, ym) {
    var on = kinds || {}, by = {}, byId = {}, ivDay = {}, order = { iv: 0, start: 1, due: 2, recv: 3 };
    if (!isYm(ym)) return by;
    (apps || []).forEach(function (a) { if (a && a.id) byId[a.id] = a; });
    function push(kind, date, time, a, round) {
      if (!on[kind] || !isDate(date) || date.slice(0, 7) !== ym) return;
      (by[date] = by[date] || []).push({ kind: kind, label: (CAL_KINDS.filter(function (k) { return k.id === kind; })[0] || {}).label || '', date: date, time: time || '',
        id: a.id, name: str(a.name), jobs: (a.jobs || []).slice(), round: round == null ? null : round });
    }
    (ivs || []).forEach(function (v) {
      var a = v && byId[v.applicant_id], p = v && jstParts(v.held_at);
      if (!a || !p) return;
      ivDay[a.id + '|' + p.date] = 1;
      push('iv', p.date, p.time, a, Number(v.round) || null);
    });
    Object.keys(byId).forEach(function (id) {
      var a = byId[id];
      if (isDate(a.interview_on) && !ivDay[id + '|' + a.interview_on]) push('iv', a.interview_on, '', a, null);
      push('start', a.start_on, '', a);
      push('due', a.reply_due, '', a);
      push('recv', a.received_on, '', a);
    });
    Object.keys(by).forEach(function (d) {
      by[d].sort(function (x, y) {
        return (order[x.kind] - order[y.kind]) || (x.time < y.time ? -1 : x.time > y.time ? 1 : 0) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
      });
    });
    return by;
  }

  /* ── 取り込みの文字コード ── */
  /* UTF-8 として読んで置き換え文字（U+FFFD）が出たら Shift_JIS で読み直す。decoder(label) は TextDecoder を作る関数 */
  function decodeCsv(bytes, decoder) {
    var u = '';
    try { u = decoder('utf-8').decode(bytes); } catch (e) { u = ''; }
    if (u && u.indexOf('�') < 0) return { text: u, enc: 'UTF-8' };
    try { return { text: decoder('shift_jis').decode(bytes), enc: 'Shift_JIS' }; } catch (e) { return { text: u, enc: 'UTF-8' }; }
  }

  var api = {
    VERSION: VERSION,
    STAGES: STAGES, END_STAGES: END_STAGES, OUTCOME_REASONS: OUTCOME_REASONS, CHANNELS: CHANNELS,
    DEFAULT_EVAL_ITEMS: DEFAULT_EVAL_ITEMS, DEFAULT_SETTINGS: DEFAULT_SETTINGS, REQUIRED: REQUIRED, IMPORT_MAX: IMPORT_MAX,
    SITE_LABEL: SITE_LABEL, WORK_LABEL: WORK_LABEL, SETTLE_MS: SETTLE_MS, HEADERS: HEADERS,
    stageOf: stageOf, endOf: endOf, isEnd: isEnd, isStage: isStage, stageLabel: stageLabel, stageRank: stageRank,
    nextStage: nextStage, canMove: canMove,
    normName: normName, importKey: importKey, normDate: normDate, completeYear: completeYear, splitDateNote: splitDateNote,
    parseContacts: parseContacts, deriveStage: deriveStage, parseCsv: parseCsv, detectHeader: detectHeader,
    normApplicant: normApplicant, planImport: planImport,
    SOURCE_NAMES: SOURCE_NAMES, canonSource: canonSource, canonSources: canonSources, legacyStaffMatch: legacyStaffMatch, rowHash: rowHash, classifyResult: classifyResult, TEXT_MAX: TEXT_MAX,
    yearTable: yearTable, defaultPeriod: defaultPeriod, boardHidden: boardHidden, countsOf: countsOf,
    buildStaffCreate: buildStaffCreate, missingText: missingText, sentKey: sentKey, labelOf: labelOf,
    sameStaff: sameStaff, staffMatches: staffMatches, sameNameActive: sameNameActive, staffVerdict: staffVerdict, staffWaitMinutes: staffWaitMinutes, staffResult: staffResult,
    firstContactLate: firstContactLate, replyDueState: replyDueState, evalStatusText: evalStatusText, evalVisible: evalVisible,
    evalCheck: evalCheck, normEvalItems: normEvalItems, normSettings: normSettings,
    scheduleBuckets: scheduleBuckets, periodRange: periodRange, rate: rate, funnel: funnel,
    retainUntil: retainUntil, purgeable: purgeable, decodeCsv: decodeCsv,
    parsePosting: parsePosting, postingDup: postingDup, JOB_WORDS: JOB_WORDS, CAL_KINDS: CAL_KINDS, isYm: isYm, calMonth: calMonth, calEvents: calEvents,
    todayJST: todayJST, addDays: addDays, addMonths: addMonths, daysBetween: daysBetween, isDate: isDate
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtsCalc = api;
})(typeof window !== 'undefined' ? window : this);
