/* accident-report-calc.js — 事故報告書（accident-report.html）の純関数（2026-11-28 新設・本人指示）
 *
 * 画面（事故報告書）と試験（check/unit/accident_report_calc_test.js）が使う。
 * 通信・端末への保存・画面の部品には触らない（localStorage も読まない・書かない）。
 *
 * 約束（共通 DB の事故報告書の移行（acc_*）と同じ決まり）:
 *   1. 1通の報告書＝1行。第1報・第n報・最終報告は別の行（続報は前の報告を写して作り、prev_id に元の id を持つ）
 *   2. 様式の欄は全部 data（object）に入れる。鍵は下の KEYS だけ。選択肢は id で持つ（紙の文言は OPTS の label）
 *   3. 欄と選択肢の定義はここに1つだけ置き、入力の画面と紙の両方をここから描く
 *   4. 紙は代表者が渡した様式の写真（自社で手を入れた版）を写す。法人名・事業所名・所在地・市名などの固有名詞は書かない
 *      （施設情報・入居者マスタ・入力から出す）
 *   5. 日付は 'YYYY-MM-DD' の文字で持つ。紙では 西暦｜年｜月｜日 の別々の枠に数字だけを入れる
 *   6. 寸法は様式の写真から取った 0.1mm 単位（表の幅 1770＝177mm）。紙は A4 縦・余白 10mm に収まる
 */
(function (root) {
  'use strict';

  var VERSION = '2026-11-28';

  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).replace(/^[\s　]+|[\s　]+$/g, ''); }
  function esc(s) {
    return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function half(s) { return str(s).replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }

  /* ═══════════ 欄と選択肢の定義（入力の画面と紙の両方がここから描く） ═══════════
     選択肢: { id, label（紙の文言）, chip（画面のチップの文言・無ければ label）, other（「その他（　）」の中の欄の鍵）,
              x（紙の位置・表の左端から 0.1mm）, line（欄の中の何行目）, c（真なら x は文字の中央） }
     multi: 真＝複数選べる（様式の注記「該当する項目が複数ある場合は全て選択」）／偽＝1つ（もう一度押すと外れる） */
  /* pill: 右の罫線・隣の選択肢との間が狭く、楕円では文字の角に掛かる選択肢。角の丸い長円で文字の外を回す */
  var OPTS = {
    severity: { multi: true, label: '事故状況の程度', opts: [
      { id: 'outpatient', label: '受診(外来･往診)、\n自施設で応急処置', chip: '受診（外来・往診）、自施設で応急処置', x: 391 },
      { id: 'admit', label: '入院', x: 945 },
      { id: 'death', label: '死亡', x: 1176 },
      { id: 'other', label: 'その他', other: 'severityOther', x: 1456, close: 1738 }] },
    offices: { multi: true, label: '事業所（施設）', opts: [
      { id: '施設', label: '施設' }, { id: '訪問', label: '訪問' }, { id: '通所', label: '通所' }] },
    serviceKinds: { multi: true, label: 'サービス種別', opts: [
      { id: 'in', label: '入所', x: 868 }, { id: 'visit', label: '訪問', x: 1041 }, { id: 'day', label: '通所', x: 1208 }] },
    gender: { multi: false, label: '性別', opts: [
      { id: 'm', label: '男性', x: 1486, c: true }, { id: 'f', label: '女性', x: 1693, c: true }] },
    addressKind: { multi: false, label: '住所', opts: [
      { id: 'office', label: '事業所所在地', x: 391 },
      { id: 'other', label: 'その他', other: 'addressOther', x: 813, close: 1738 }] },
    careLevel: { multi: false, label: '要介護度', opts: [
      { id: '要支援1', label: '要支援1', x: 698 }, { id: '要支援2', label: '要支援2', x: 823 }, { id: '要介護1', label: '要介護1', x: 948 },
      { id: '要介護2', label: '要介護2', x: 1065 }, { id: '要介護3', label: '要介護3', x: 1201 }, { id: '要介護4', label: '要介護4', x: 1343 },
      { id: '要介護5', label: '要介護5', x: 1458 }, { id: '自立', label: '自立', x: 1584 }] },
    /* 認知症高齢者の日常生活自立度。紙は様式どおりのローマ数字、画面のチップは読みやすい英字（小さな字の記号を画面に出さない） */
    dementia: { multi: false, label: '認知症高齢者の日常生活自立度', opts: [
      { id: 'I', label: 'Ⅰ', chip: 'I', x: 746, c: true }, { id: 'IIa', label: 'Ⅱa', chip: 'IIa', x: 876, c: true },
      { id: 'IIb', label: 'Ⅱb', chip: 'IIb', x: 998, c: true }, { id: 'IIIa', label: 'Ⅲa', chip: 'IIIa', x: 1114, c: true },
      { id: 'IIIb', label: 'Ⅲb', chip: 'IIIb', x: 1251, c: true }, { id: 'IV', label: 'Ⅳ', chip: 'IV', x: 1390, c: true },
      { id: 'M', label: 'M', x: 1506, c: true }] },
    place: { multi: true, label: '発生場所', opts: [
      { id: 'room1', label: '居室（個室）', x: 390, line: 0 }, { id: 'room2', label: '居室（多床室）', x: 813, line: 0 },
      { id: 'toilet', label: 'トイレ', x: 1175, line: 0 }, { id: 'hall', label: '廊下', x: 1456, line: 0 },
      { id: 'dining', label: '食堂等共用部', x: 390, line: 1 }, { id: 'bath', label: '浴室・脱衣室', x: 813, line: 1 },
      { id: 'training', label: '機能訓練室', x: 1175, line: 1 }, { id: 'yard', label: '施設敷地内の建物外', x: 1456, line: 1, pill: true },
      { id: 'outside', label: '敷地外', x: 390, line: 2 }, { id: 'other', label: 'その他', other: 'placeOther', x: 813, close: 1426, line: 2 }] },
    kind: { multi: true, label: '事故の種別', opts: [
      { id: 'fall', label: '転倒', x: 390, line: 0 }, { id: 'pica', label: '異食', x: 813, line: 0 }, { id: 'unknown', label: '不明', x: 1336, line: 0 },
      { id: 'drop', label: '転落', x: 390, line: 1 }, { id: 'med', label: '誤薬、与薬もれ等', x: 813, line: 1 },
      { id: 'other', label: 'その他', other: 'kindOther', x: 1336, close: 1669, line: 1 },
      { id: 'choke', label: '誤嚥・窒息', x: 390, line: 2 }, { id: 'tube', label: '医療処置関連（チューブ抜去等）', x: 813, line: 2 }] },
    consult: { multi: true, label: '受診方法', opts: [
      { id: 'doctor', label: '施設内の医師\n(配置医含む)が対応', chip: '施設内の医師（配置医含む）が対応', x: 390 },
      { id: 'visit', label: '受診\n(外来・往診)', chip: '受診（外来・往診）', x: 930, c: true },
      { id: 'ambulance', label: '救急搬送', x: 1175 },
      { id: 'other', label: 'その他', other: 'consultOther', x: 1456, close: 1740 }] },
    diag: { multi: true, label: '診断内容', opts: [
      { id: 'cut', label: '切傷・擦過傷', x: 391, line: 0 }, { id: 'bruise', label: '打撲・捻挫・脱臼', x: 694, line: 0 },
      { id: 'fracture', label: '骨折', open: '(部位：', other: 'fracturePart', x: 1064, close: 1717, line: 0 },
      { id: 'other', label: 'その他', other: 'diagOther', x: 391, close: 1723, line: 1 }] },
    familyRel: { multi: true, label: '報告した家族等の続柄', opts: [
      { id: 'spouse', label: '配偶者', x: 691 }, { id: 'child', label: '子、', chip: '子', x: 942, tight: true },
      { id: 'childSpouse', label: '子の配偶者', x: 1010, pill: true, near: true },
      { id: 'other', label: 'その他', other: 'familyOther', x: 1336, close: 1622 }] },
    agencies: { multi: true, label: '連絡した関係機関', opts: [
      { id: 'city', label: '他の自治体', x: 391, sub: '自治体名', other: 'agencyCity', close: 773 },
      { id: 'police', label: '警察', x: 942, sub: '警察署名', other: 'agencyPolice', close: 1294 },
      { id: 'other', label: 'その他', x: 1456, sub: '名称', other: 'agencyOther', close: 1734 }] }
  };
  var GROUPS = Object.keys(OPTS);
  /* 事業所の種類（施設情報の offices の kind）と、選んだ時に連動するサービス種別 */
  var OFFICE_KINDS = ['施設', '訪問', '通所'];
  var OFFICE_SERVICE = { '施設': 'in', '訪問': 'visit', '通所': 'day' };

  /* 報告区分（行の report_kind / report_no） */
  var REPORT_KINDS = ['first', 'nth', 'final'];
  function kindLabel(kind, no) {
    if (kind === 'final') return '最終報告';
    if (kind === 'nth') return '第' + (no ? no : '＿') + '報';
    return '第1報';
  }

  /* 文字の欄（鍵・上限の字数・欄の名前（別紙の見出しと未記入の数の説明に使う）・長文か） */
  var TEXT = [
    ['severityOther', 60, '事故状況の程度（その他）'], ['deathDate', 10, '死亡年月日'],
    ['corpName', 100, '法人名'], ['officeNo', 20, '事業所番号'], ['officeAddress', 120, '所在地'],
    ['name', 60, '氏名'], ['age', 3, '年齢'], ['serviceStart', 10, 'サービス提供開始日'], ['insurer', 60, '保険者'],
    ['addressOther', 120, '住所（その他）'],
    ['occurDate', 10, '発生日'], ['occurHour', 2, '発生の時'], ['occurMin', 2, '発生の分'],
    ['placeOther', 60, '発生場所（その他）'], ['kindOther', 60, '事故の種別（その他）'],
    ['detail', 4000, '発生時状況、事故内容の詳細', true], ['special', 2000, 'その他特記すべき事項', true],
    ['response', 4000, '発生時の対応', true], ['consultOther', 60, '受診方法（その他）'],
    ['hospName', 80, '医療機関名'], ['hospTel', 30, '連絡先（電話番号）'], ['diagName', 120, '診断名'],
    ['fracturePart', 60, '骨折の部位'], ['diagOther', 100, '診断内容（その他）'], ['treatment', 2000, '検査、処置等の概要', true],
    ['status', 4000, '利用者の状況', true], ['familyOther', 40, '報告した家族等の続柄（その他）'], ['familyDate', 10, '家族等への報告年月日'],
    ['agencyCity', 60, '自治体名'], ['agencyPolice', 60, '警察署名'], ['agencyOther', 60, '関係機関の名称'],
    ['followup', 2000, '本人、家族、関係先等への追加対応予定', true],
    ['cause', 6000, '事故の原因分析', true], ['prevention', 6000, '再発防止策', true], ['note', 3000, 'その他 特記すべき事項', true]
  ];
  var TEXT_MAX = {}, TEXT_LABEL = {}, LONG = [];
  TEXT.forEach(function (t) { TEXT_MAX[t[0]] = t[1]; TEXT_LABEL[t[0]] = t[2]; if (t[3]) LONG.push(t[0]); });
  var DATE_KEYS = ['deathDate', 'serviceStart', 'occurDate', 'familyDate'];
  var LIST_KEYS = ['severity', 'offices', 'serviceKinds', 'place', 'kind', 'consult', 'diag', 'familyRel', 'agencies'];
  var SINGLE_KEYS = ['gender', 'addressKind', 'careLevel', 'dementia'];
  /* officeNames: 保存した時の事業所の正式名（施設・訪問・通所の順・無い事業所は空）。施設情報が後で変わっても過去の紙が変わらない */
  var KEYS = TEXT.map(function (t) { return t[0]; }).concat(LIST_KEYS, SINGLE_KEYS, ['officeNames']);
  var DATA_MAX = 60000;

  function optIds(group) { return OPTS[group].opts.map(function (o) { return o.id; }); }
  function optOf(group, id) { var o = null; OPTS[group].opts.forEach(function (x) { if (x.id === id) o = x; }); return o; }

  /* ═══════════ 日付・年齢 ═══════════ */
  function isIso(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(d));
    if (!m) return false;
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
  }
  /* 入居者マスタの日付を 'YYYY-MM-DD' にそろえる（'2026/2/3'・時刻つき・全角の数字も読む）。読めなければ空 */
  function normDate(v) {
    var s = half(trim(v)).slice(0, 10);
    var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(s) || /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(half(trim(v)));
    if (!m) return '';
    var d = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    return isIso(d) ? d : '';
  }
  function todayJST(now) {
    var t = (now instanceof Date ? now : new Date()).getTime() + 9 * 3600000, d = new Date(t);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function nowJST(now) {
    var d = new Date((now instanceof Date ? now : new Date()).getTime() + 9 * 3600000);
    return { date: todayJST(now), hour: String(d.getUTCHours()), min: String(d.getUTCMinutes()) };
  }
  /* その日の満年齢（生年月日が読めない・その日が生まれる前なら空） */
  function ageAt(birth, on) {
    var b = normDate(birth), o = normDate(on);
    if (!b || !o) return '';
    var bp = b.split('-').map(Number), op = o.split('-').map(Number);
    var a = op[0] - bp[0];
    if (op[1] < bp[1] || (op[1] === bp[1] && op[2] < bp[2])) a--;
    return a >= 0 && a < 140 ? String(a) : '';
  }
  /* 発生日を変えた時の年齢。今の年齢が「前の発生日（無ければ今日）で数えた年齢」か空の時だけ数え直す（手で直した年齢は上書きしない） */
  function ageAfterDateChange(curAge, birth, oldDate, newDate, today) {
    var before = ageAt(birth, isIso(oldDate) ? oldDate : today);
    var c = trim(curAge);
    if (c !== '' && c !== before) return c;
    var next = ageAt(birth, isIso(newDate) ? newDate : today);
    return next || c;
  }
  function ymd(d) { if (!isIso(d)) return { y: '', m: '', d: '' }; var p = d.split('-'); return { y: String(+p[0]), m: String(+p[1]), d: String(+p[2]) }; }
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function jpDate(d) { if (!isIso(d)) return ''; var p = ymd(d); return p.y + '年' + p.m + '月' + p.d + '日'; }
  function mdw(d) {
    if (!isIso(d)) return '';
    var p = d.split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return (+p[0]) + '/' + (+p[1]) + '/' + (+p[2]) + '（' + WD[dt.getUTCDay()] + '）';
  }

  /* ═══════════ 入居者マスタの値の読み方 ═══════════ */
  /* 性別（入居者マスタは '女' / '男'） */
  function normGender(v) {
    var s = half(trim(v)).toLowerCase();
    if (s === '男' || s === '男性' || s === 'm' || s === 'male') return 'm';
    if (s === '女' || s === '女性' || s === 'f' || s === 'female') return 'f';
    return '';
  }
  /* 要介護度（入居者マスタの選択肢は 要支援1〜2・要介護1〜5・自立。全角の数字・空白も読む）。当たらなければ空（事業対象者・非該当などは空） */
  function normCareLevel(v) {
    var s = half(trim(v)).replace(/[\s　]/g, '');
    return optIds('careLevel').indexOf(s) >= 0 ? s : '';
  }
  /* 認知症高齢者の日常生活自立度。入居者マスタ（resident-master.js の bfNormRank）と同じ読み方で正しい書き方にそろえ、
     様式の選択肢（Ⅰ〜M）に当たる時だけ返す。「自立」や読めない値は空（推測で埋めない） */
  var RANKS = ['', '自立', 'Ⅰ', 'Ⅱa', 'Ⅱb', 'Ⅲa', 'Ⅲb', 'Ⅳ', 'M'];
  var RANK_ALIAS = { 'I': 'Ⅰ', 'II': 'Ⅱ', 'III': 'Ⅲ', 'IV': 'Ⅳ', 'Ⅰ': 'Ⅰ', 'Ⅱ': 'Ⅱ', 'Ⅲ': 'Ⅲ', 'Ⅳ': 'Ⅳ' };
  function bfNormRank(s) {
    var t = trim(s);
    if (t === '' || RANKS.indexOf(t) > 0) return t;
    var m = /^([IVⅠⅡⅢⅣ]+)\s*([ab]?)$/i.exec(t);
    if (!m) return t;
    var head = RANK_ALIAS[m[1].toUpperCase()] || RANK_ALIAS[m[1]];
    if (!head) return t;
    var cand = head + (m[2] || '').toLowerCase();
    return RANKS.indexOf(cand) > 0 ? cand : t;
  }
  function normDementia(v) {
    var r = bfNormRank(v), hit = '';
    OPTS.dementia.opts.forEach(function (o) { if (o.label === r) hit = o.id; });
    return hit;
  }

  /* 施設情報（SUFacility.get() の写し）から、紙と自動入力に使う形だけを取る */
  function facOf(p) {
    p = p && typeof p === 'object' ? p : {};
    var offices = Array.isArray(p.offices) ? p.offices : [];
    var out = { municipality: trim(p.municipality), corpName: trim(p.corpName), offices: {} };
    OFFICE_KINDS.forEach(function (k) {
      var o = null; offices.forEach(function (x) { if (x && x.kind === k && !o) o = x; });
      out.offices[k] = { name: trim(o && (o.formalName || o.name)), officeNo: trim(o && o.officeNo), address: trim(o && o.address) };
    });
    return out;
  }
  /* facOf の形ならそのまま、施設情報そのもの（offices が配列）なら facOf で読む */
  function asFac(fac) { return fac && fac.offices && !Array.isArray(fac.offices) ? fac : facOf(fac); }
  function officeNamesOf(fac) { return OFFICE_KINDS.map(function (k) { return fac.offices[k].name; }); }

  /* ═══════════ 報告書の中身（data）の形 ═══════════ */
  function blankData() {
    var d = {};
    TEXT.forEach(function (t) { d[t[0]] = ''; });
    LIST_KEYS.forEach(function (k) { d[k] = []; });
    SINGLE_KEYS.forEach(function (k) { d[k] = ''; });
    d.officeNames = [];
    return d;
  }
  /* 保存されている data を今の形にそろえる（知らない鍵・知らない選択肢・長すぎる文字は持たない。型の違う値は空） */
  function normData(raw) {
    var src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var d = blankData();
    TEXT.forEach(function (t) { var v = src[t[0]]; if (typeof v === 'string' || typeof v === 'number') d[t[0]] = String(v).slice(0, t[1]); });
    LIST_KEYS.forEach(function (k) {
      var ids = optIds(k), v = Array.isArray(src[k]) ? src[k] : [];
      d[k] = ids.filter(function (id) { return v.indexOf(id) >= 0; });   // 並びは定義の順
    });
    SINGLE_KEYS.forEach(function (k) { var v = str(src[k]); d[k] = optIds(k).indexOf(v) >= 0 ? v : ''; });
    if (Array.isArray(src.officeNames)) d.officeNames = OFFICE_KINDS.map(function (k, i) { return str(src.officeNames[i]).slice(0, 100); });
    return d;
  }
  /* 選択肢を押した時（複数は足す／外す・1つはもう一度押すと外れる）。新しい data を返す（引数は書き換えない） */
  function toggle(data, group, id) {
    var d = normData(data);
    if (!OPTS[group] || optIds(group).indexOf(id) < 0) return d;
    if (OPTS[group].multi) {
      var on = d[group].indexOf(id) >= 0;
      var next = on ? d[group].filter(function (x) { return x !== id; }) : d[group].concat([id]);
      d[group] = optIds(group).filter(function (x) { return next.indexOf(x) >= 0; });
    } else {
      d[group] = d[group] === id ? '' : id;
    }
    /* 外した選択肢の括弧の中（その他の内容・骨折の部位・自治体名など）は空にする（紙に丸の無い括弧の中身を残さない） */
    clearOff(d);
    return d;
  }
  /* 選ばれていない選択肢の括弧の中（その他の内容・骨折の部位・自治体名など）と、死亡を選んでいない時の死亡年月日を空にする
     （紙に丸の無い括弧の中身を残さない・押して外した時も、入居者マスタから入れ直した時も同じ） */
  function clearOff(d) {
    GROUPS.forEach(function (g) { OPTS[g].opts.forEach(function (o) { if (o.other && !isOn(d, g, o.id)) d[o.other] = ''; }); });
    if (!isOn(d, 'severity', 'death')) d.deathDate = '';
    return d;
  }
  function isOn(data, group, id) {
    var v = data ? data[group] : null;
    return Array.isArray(v) ? v.indexOf(id) >= 0 : v === id;
  }

  /* 事業所を選んだ時の連動（サービス種別・事業所番号・所在地）。
     prevSel は押す前の事業所の選び。自動で入れた値（前の選びから作った値）か空の時だけ入れ直し、手で直した値は残す */
  function linkOffices(data, prevSel, fac) {
    var d = normData(data), f = asFac(fac);
    var before = Array.isArray(prevSel) ? prevSel : [];
    /* サービス種別: 外した事業所の種別を外し、足した事業所の種別を足す（ほかに選んでいる事業所の種別は残す） */
    var keep = {};
    d.offices.forEach(function (k) { keep[OFFICE_SERVICE[k]] = 1; });
    before.forEach(function (k) { if (d.offices.indexOf(k) < 0 && !keep[OFFICE_SERVICE[k]]) d.serviceKinds = d.serviceKinds.filter(function (s) { return s !== OFFICE_SERVICE[k]; }); });
    d.offices.forEach(function (k) { if (before.indexOf(k) < 0 && d.serviceKinds.indexOf(OFFICE_SERVICE[k]) < 0) d.serviceKinds.push(OFFICE_SERVICE[k]); });
    d.serviceKinds = optIds('serviceKinds').filter(function (x) { return d.serviceKinds.indexOf(x) >= 0; });
    var autoNo = function (sel) { return sel.length === 1 ? f.offices[sel[0]].officeNo : ''; };
    var autoAddr = function (sel) { return sel.length ? f.offices[sel[0]].address : ''; };
    if (trim(d.officeNo) === '' || d.officeNo === autoNo(before)) d.officeNo = autoNo(d.offices);
    if (trim(d.officeAddress) === '' || d.officeAddress === autoAddr(before)) d.officeAddress = autoAddr(d.offices);
    return d;
  }

  /* 入居者マスタの1人分（getSection 'basic' の形）と施設情報から、3 対象者と 2 事業所の欄を入れる。
     返すのは { data, auto:[入れた鍵] }。入居者マスタに無い値は入れない（空のまま） */
  function fromResident(data, rec, fac, today) {
    var d = normData(data), f = asFac(fac), auto = [], autoFac = [];
    var r = rec && typeof rec === 'object' ? rec : {};
    var set = function (k, v, list) { if (v !== '' && v != null) { d[k] = v; (list || auto).push(k); } };
    set('name', trim(r.name).slice(0, TEXT_MAX.name));
    set('age', ageAt(r.birthDate, isIso(d.occurDate) ? d.occurDate : today));
    set('gender', normGender(r.gender));
    set('serviceStart', normDate(r.admissionDate));
    if (trim(r.insurer)) set('insurer', trim(r.insurer).slice(0, TEXT_MAX.insurer));
    else set('insurer', f.municipality.slice(0, TEXT_MAX.insurer), autoFac);   // 入居者マスタに無ければ施設情報の市区町村
    set('addressKind', 'office');
    set('careLevel', normCareLevel(r.careLevel));
    set('dementia', normDementia(r.dementia));
    /* 2 事業所: 施設（kind 施設）の事業所がある事業者は施設（入所）。施設が無く事業所が1つだけの事業者はその1つ。それ以外は選ばない。
       法人名・事業所番号・所在地は施設情報から */
    var have = OFFICE_KINDS.filter(function (k) { return f.offices[k].name !== ''; });
    var pick = have.indexOf('施設') >= 0 ? '施設' : (have.length === 1 ? have[0] : '');
    if (pick) {
      var prev = d.offices.slice();
      if (d.offices.indexOf(pick) < 0) d.offices = OFFICE_KINDS.filter(function (k) { return k === pick || d.offices.indexOf(k) >= 0; });
      d = linkOffices(d, prev, f);
      if (d.offices.length === 1) d.officeNo = f.offices[d.offices[0]].officeNo;
      if (f.offices[d.offices[0]].address) d.officeAddress = f.offices[d.offices[0]].address;
    }
    if (f.corpName) d.corpName = f.corpName.slice(0, TEXT_MAX.corpName);
    ['offices', 'serviceKinds', 'officeNo', 'officeAddress', 'corpName'].forEach(function (k) { if (str(d[k]) !== '' && !(Array.isArray(d[k]) && !d[k].length)) autoFac.push(k); });
    clearOff(d);   // 住所を事業所所在地にした時は「その他」の住所を空にする（押して替えた時と同じ）
    return { data: d, auto: auto, autoFac: autoFac };
  }

  /* ═══════════ 報告書の行 ═══════════ */
  var SAVE_KEYS = ['resident_id', 'resident_name', 'occurred_on', 'report_kind', 'report_no', 'submit_date', 'prev_id', 'data'];
  function blankReport(resident, today) {
    return { id: null, rev: null, resident_id: str(resident && resident.id), resident_name: str(resident && resident.name),
      report_kind: 'first', report_no: '', submit_date: isIso(today) ? today : '', prev_id: '', data: blankData() };
  }
  function fromRow(r) {
    r = r || {};
    return { id: r.id == null ? null : String(r.id), rev: r.rev == null ? null : Number(r.rev), resident_id: str(r.resident_id), resident_name: str(r.resident_name),
      report_kind: REPORT_KINDS.indexOf(r.report_kind) >= 0 ? r.report_kind : 'first', report_no: r.report_no == null ? '' : String(r.report_no),
      submit_date: isIso(r.submit_date) ? r.submit_date : '', prev_id: r.prev_id == null ? '' : String(r.prev_id), data: normData(r.data),
      updated_at: str(r.updated_at), occurred_on: isIso(r.occurred_on) ? r.occurred_on : '' };
  }
  /* 保存する本文（決まった8つの鍵＋更新の時は id）。空の日付は null（データベースも空文字を null にする） */
  function toSave(rep, fac) {
    var d = normData(rep.data);
    if (fac) { var nn = officeNamesOf(asFac(fac)); if (nn.some(function (x) { return x !== ''; })) d.officeNames = nn; }   // 施設情報が読めない時は保存済みの写しを残す
    var o = {};
    if (rep.id) o.id = rep.id;
    o.resident_id = str(rep.resident_id);
    o.resident_name = trim(rep.resident_name).slice(0, 60);
    o.occurred_on = isIso(d.occurDate) ? d.occurDate : null;
    o.report_kind = REPORT_KINDS.indexOf(rep.report_kind) >= 0 ? rep.report_kind : 'first';
    o.report_no = o.report_kind === 'nth' && /^\d{1,2}$/.test(str(rep.report_no)) ? Number(rep.report_no) : null;
    o.submit_date = isIso(rep.submit_date) ? rep.submit_date : null;
    o.prev_id = rep.prev_id ? String(rep.prev_id) : null;
    o.data = d;
    return o;
  }
  /* 保存の前の確かめ（職員に分かる文の配列。空なら保存してよい） */
  function checkReport(rep) {
    var e = [];
    if (!/^[0-9A-Za-z_-]{1,32}$/.test(str(rep && rep.resident_id))) e.push('入居者を選んでください。');
    if (!rep) return e;
    if (rep.report_kind === 'nth') {
      var n = Number(rep.report_no);
      if (!/^\d{1,2}$/.test(str(rep.report_no)) || n < 2 || n > 99) e.push('「第＿報」の番号を 2〜99 で入れてください。');
    }
    if (rep.submit_date && !isIso(rep.submit_date)) e.push('提出日の形が違います。日付を選び直してください。');
    var d = rep.data || {};
    DATE_KEYS.forEach(function (k) { if (trim(d[k]) && !isIso(d[k])) e.push(TEXT_LABEL[k] + 'の形が違います。日付を選び直してください。'); });
    if (trim(d.occurHour) && !(/^\d{1,2}$/.test(trim(d.occurHour)) && +d.occurHour <= 23)) e.push('発生の時刻（時）は 0〜23 で入れてください。');
    if (trim(d.occurMin) && !(/^\d{1,2}$/.test(trim(d.occurMin)) && +d.occurMin <= 59)) e.push('発生の時刻（分）は 0〜59 で入れてください。');
    if (trim(d.age) && !/^\d{1,3}$/.test(trim(d.age))) e.push('年齢は数字で入れてください。');
    TEXT.forEach(function (t) { if (str(d[t[0]]).length > t[1]) e.push(t[2] + 'は ' + t[1] + ' 字までです。'); });
    if (JSON.stringify(normData(d)).length > DATA_MAX) e.push('書いた量が多すぎて保存できません。長い欄を短くしてください。');
    return e;
  }
  function sameReport(a, b) {
    if (!a || !b) return false;
    var x = toSave(a), y = toSave(b);
    delete x.data.officeNames; delete y.data.officeNames;
    return JSON.stringify(x) === JSON.stringify(y);
  }
  /* 並び: 発生日の新しい順 → 更新の新しい順 */
  function sortReports(list) {
    return (Array.isArray(list) ? list.slice() : []).filter(Boolean).sort(function (a, b) {
      var x = str(a.occurred_on), y = str(b.occurred_on);
      if (x !== y) return x < y ? 1 : -1;
      return str(a.updated_at) < str(b.updated_at) ? 1 : (str(a.updated_at) > str(b.updated_at) ? -1 : 0);
    });
  }
  /* 開いた報告を写して続報を作る（kind: 'nth' | 'final'）。中身は全部写し、区分・番号・提出日・元の報告だけを変える */
  function nextNo(row) {
    if (row && row.report_kind === 'nth' && /^\d{1,2}$/.test(str(row.report_no))) return Math.min(99, Number(row.report_no) + 1);
    return 2;
  }
  function followUp(row, kind, today) {
    var r = fromRow(row);
    return { id: null, rev: null, resident_id: r.resident_id, resident_name: r.resident_name, report_kind: kind === 'final' ? 'final' : 'nth',
      report_no: kind === 'final' ? '' : String(nextNo(r)), submit_date: isIso(today) ? today : '', prev_id: r.id || '',
      data: normData(JSON.parse(JSON.stringify(r.data))) };
  }

  /* 節ごとの未記入の数（第1報の注記「少なくとも1から6までについては可能な限り記載」に合わせて、知らせるだけ・止めない）。
     「その他」を選んだ時の括弧の中、死亡を選んだ時の死亡年月日、受診・救急搬送の時の医療機関・診断名も数える */
  function missing(data) {
    var d = normData(data), has = function (k) { return trim(d[k]) !== ''; }, out = {};
    var cnt = function (list) { return list.filter(function (k) { return Array.isArray(d[k]) ? !d[k].length : !has(k); }).length; };
    var oth = function (g) { return (isOn(d, g, 'other') && !has(optOf(g, 'other').other)) ? 1 : 0; };
    out[1] = cnt(['severity']) + oth('severity') + (isOn(d, 'severity', 'death') && !has('deathDate') ? 1 : 0);
    out[2] = cnt(['corpName', 'offices', 'officeNo', 'serviceKinds', 'officeAddress']);
    out[3] = cnt(['name', 'age', 'gender', 'serviceStart', 'insurer', 'addressKind', 'careLevel', 'dementia']) + (d.addressKind === 'other' && !has('addressOther') ? 1 : 0);
    out[4] = cnt(['occurDate', 'occurHour', 'place', 'kind', 'detail']) + oth('place') + oth('kind');
    var hosp = isOn(d, 'consult', 'visit') || isOn(d, 'consult', 'ambulance');
    out[5] = cnt(['response', 'consult']) + oth('consult') + (hosp ? cnt(['hospName', 'diagName']) : 0) + oth('diag') + (isOn(d, 'diag', 'fracture') && !has('fracturePart') ? 1 : 0);
    out[6] = cnt(['status', 'familyRel', 'familyDate', 'followup']) + oth('familyRel');
    out[7] = cnt(['cause']); out[8] = cnt(['prevention']); out[9] = 0;
    return out;
  }

  /* ═══════════ 紙（A4 縦・2ページ固定＋入りきらない欄の別紙） ═══════════
     寸法は様式の写真から取った 0.1mm 単位。表の列の線（左端からの位置）と行の高さ */
  var COLS = [0, 75, 305, 385, 581, 686, 806, 936, 1056, 1170, 1330, 1450, 1561, 1770];
  var ROWS1 = [85, 65, 66, 65, 65, 130, 65, 65, 65, 65, 65, 65, 65, 65, 196, 195, 277, 81, 274, 80, 65, 65, 129, 65];
  var ROWS2 = [213, 76, 76, 128, 85, 36, 417, 36, 418, 129];
  var TABLE_TOP1 = 268;              // 1ページ目の表の上端（題・注記・報告区分の下）
  var PAGE_W = 1900, PAGE_H = 2760;  // 紙の中（A4 の 210×297mm から余白 10mm を引き、高さは改ページの丸めに 1mm を残す）
  /* 様式の写真では、日付の行（死亡年月日・発生日時・家族等への報告年月日）の右の水色が表の外へ EXT だけはみ出している（発生日時の「分頃（24時間表記）」はそこまで続く）。
     その分も紙に入るよう、表の左端を決める */
  var EXT = 113;
  var TABLE_LEFT = Math.round((PAGE_W - COLS[COLS.length - 1] - EXT) / 2);
  /* 文字の大きさ（mm）。値の欄は収まらない時に段階で下げる（FIT_STEPS）。最小でも収まらない時は別紙 */
  var FS = { label: 2.3, small: 2.3, title: 3.5, choice: 2.9, value: 3.2, office: 1.9, kindBig: 3.4, long: 3.0 };
  var FIT_MIN = 2.0;
  function fitSteps(base) { if (!(base > FIT_MIN)) return [base]; var out = []; for (var v = base; v > FIT_MIN - 0.001; v = Math.round((v - 0.2) * 10) / 10) out.push(v); if (out[out.length - 1] > FIT_MIN) out.push(FIT_MIN); return out; }

  /* 紙の型の名前は ar- の接頭辞だけ（入力画面の .row などの汎用の型を紙に当てない）。'row ctr' → 'ar-row ar-ctr' */
  function pre(cls) { return str(cls).split(/\s+/).filter(Boolean).map(function (c) { return 'ar-' + c; }).join(' '); }
  function mm(v) { return (Math.round(v) / 10) + 'mm'; }
  function tops(rows, base) { var t = [base], y = base; rows.forEach(function (h) { y += h; t.push(y); }); return t; }

  /* 紙の上の選択肢（押すと丸が付く・印刷では文字の位置を動かさない楕円） */
  function optSpan(group, o, data, fs) {
    var on = isOn(data, group, o.id);
    var lines = str(o.label).split('\n').map(esc).join('<br>');
    return '<span class="ar-o' + (on ? ' ar-on' : '') + (/\n/.test(o.label) ? ' ar-two' : '') + (o.tight ? ' ar-tight' : '') + (o.pill || group === 'careLevel' ? ' ar-pill' : '') + (o.near ? ' ar-near' : '') + '" data-g="' + esc(group) + '" data-id="' + esc(o.id) +
      '" role="checkbox" aria-checked="' + on + '" aria-label="' + esc(OPTS[group].label + '：' + str(o.chip || o.label).replace(/\n/g, '')) + '" style="font-size:' + fs + 'mm">' + lines + '</span>';
  }
  /* 位置を決めた箱（表の左上から・0.1mm）。cls で中身の並べ方を決める */
  function box(x, y, w, h, html, cls, extra) {
    return '<div class="ar-b' + (cls ? ' ' + pre(cls) : '') + '" style="left:' + mm(x) + ';top:' + mm(y) + ';width:' + mm(w) + ';height:' + mm(h) + (extra ? ';' + extra : '') + '">' + html + '</div>';
  }
  /* 文字を収める欄（画面が実際の大きさを測って段階で縮め、最小でも収まらなければ別紙へ回す） */
  function fitText(key, text, base, cls, over) {
    /* 別紙へ回した欄も「別紙のとおり」が欄に入るまで縮める（狭い括弧の中でも閉じ括弧を押し出さない）。印 data-sheet は測り直しで別紙を取り消さないため */
    if (over && over[key]) return '<div class="ar-fit ' + pre(cls) + '" data-fit="' + esc(key) + '" data-sheet="1" data-fs="' + fitSteps(base).concat([1.8, 1.6]).join(',') + '" style="font-size:' + base + 'mm">別紙のとおり</div>';
    return '<div class="ar-fit ' + pre(cls) + '" data-fit="' + esc(key) + '" data-fs="' + fitSteps(base).join(',') + '" style="font-size:' + base + 'mm">' + esc(text) + '</div>';
  }
  /* 表の1つの枠（罫線と水色）。r: 行の番号・rs: 何行ぶん・c0/c1: 列の線の番号 */
  function cell(T, r, rs, c0, c1, blue, html, cls) {
    var x = COLS[c0], y = T[r], w = COLS[c1] - x, h = T[r + rs] - y;
    var bd = 'ar-c' + (blue ? ' ar-bl' : '') + (c0 === 0 ? ' ar-lft' : '') + (r === 0 ? ' ar-tp' : '') + (cls ? ' ' + pre(cls) : '');
    return '<div class="' + bd + '" style="left:' + mm(x) + ';top:' + mm(y) + ';width:' + mm(w) + ';height:' + mm(h) + '">' + (html || '') + '</div>';
  }
  /* 表の右の外へはみ出した水色（様式の写真のとおり・右の端に罫線なし）。上下の罫線は表の中と続ける */
  function ext(T, r, keepBorder) {
    var y = T[r], h = T[r + 1] - y;
    return '<div class="ar-c ar-bl ar-ext' + (keepBorder ? '' : ' ar-join') + '" style="left:' + mm(COLS[13]) + ';top:' + mm(y) + ';width:' + mm(EXT) + ';height:' + mm(h) + '"></div>';
  }
  function lab(t, cls) { return '<div class="ar-l' + (cls ? ' ' + pre(cls) : '') + '">' + str(t).split('\n').map(esc).join('<br>') + '</div>'; }
  function stack(t) { return '<div class="ar-l ar-stk">' + str(t).split('').map(esc).join('<br>') + '</div>'; }
  function val(t, cls, fs) { return '<div class="ar-v' + (cls ? ' ' + pre(cls) : '') + '" style="font-size:' + (fs || FS.value) + 'mm">' + esc(t) + '</div>'; }

  /* 日付の枠の並び（西暦｜値｜年｜値｜月｜値｜日）。cs は 8 本の列の線の番号 */
  function dateCells(T, r, cs, iso) {
    var p = ymd(iso), h = '';
    h += cell(T, r, 1, cs[0], cs[1], true, lab('西暦', 'ctr'));
    h += cell(T, r, 1, cs[1], cs[2], false, val(p.y, 'ctr'));
    h += cell(T, r, 1, cs[2], cs[3], true, lab('年', 'ctr'));
    h += cell(T, r, 1, cs[3], cs[4], false, val(p.m, 'ctr'));
    h += cell(T, r, 1, cs[4], cs[5], true, lab('月', 'ctr'));
    h += cell(T, r, 1, cs[5], cs[6], false, val(p.d, 'ctr'));
    h += cell(T, r, 1, cs[6], cs[7], true, lab('日', 'ctr'));
    return h;
  }
  /* 1行に並ぶ選択肢（y は行の中の中央・0.1mm）。その他（　）の括弧の中も入れる */
  function optLine(T, r, group, data, fs, lineYs, over) {
    var h = '', rowTop = T[r];
    OPTS[group].opts.forEach(function (o) {
      var yc = rowTop + (lineYs ? lineYs[o.line || 0] : (T[r + 1] - T[r]) / 2);
      var lh = /\n/.test(o.label) ? 76 : 50;
      if (o.other && o.close && !o.sub) {
        /* 「その他（　）」: 選択肢の文字・開きの括弧・中の欄・閉じの括弧を、閉じの括弧の位置まで1行に並べる */
        h += box(o.x, yc - lh / 2, o.close - o.x + 30, lh,
          optSpan(group, o, data, fs) + '<span class="ar-p" style="font-size:' + fs + 'mm">' + esc(o.open || '（') + '</span>' +
          fitText(o.other, data[o.other], fs, 'in', over) + '<span class="ar-p ar-cl" style="font-size:' + fs + 'mm">）</span>', 'row');
      } else if (o.c) {
        h += box(o.x - 150, yc - lh / 2, 300, lh, optSpan(group, o, data, fs), 'row ctr');
      } else {
        h += box(o.x, yc - lh / 2, 600, lh, optSpan(group, o, data, fs), 'row');
      }
    });
    return h;
  }

  function page1(m) {
    var d = m.data, f = m.fac, T = tops(ROWS1, 0), over = m.over || {}, h = '';
    var L = TABLE_LEFT;
    /* 題・注記・報告区分・提出日（表の外） */
    var head = '';
    head += box(L + 123, 0, 1500, 62, '<span class="ar-title">事故報告書　（事業者→' + (f.municipality ? esc(f.municipality) : '　　') + '）</span>', 'row');
    head += box(L + 83, 78, 1800, 40, '<span>※第１報<span class="ar-red">（電話での第一報を除く）</span>は、少なくとも1から6までについては可能な限り記載し、事故発生後速やかに、遅くとも５日以内を目安に提出すること</span>', 'row note');
    head += box(L + 83, 113, 1800, 40, '<span>※選択肢については該当する項目をチェックし、該当する項目が複数ある場合は全て選択すること</span>', 'row note');
    var rk = m.kind, no = m.no;
    var kOn = function (k) { return rk === k ? ' ar-on' : ''; };
    head += '<div class="ar-rk" style="left:' + mm(L + 75) + ';top:' + mm(183) + ';width:' + mm(1095) + ';height:' + mm(50) + '">' +
      '<div class="ar-rk-a" style="width:' + mm(731) + '"></div></div>';
    head += box(L + 313, 183, 200, 50, '<span class="ar-o' + kOn('first') + '" data-g="report" data-id="first" role="checkbox" aria-checked="' + (rk === 'first') + '" aria-label="報告区分：第1報" style="font-size:' + FS.choice + 'mm">第1報</span>', 'row');
    head += box(L + 596, 183, 200, 50, '<span class="ar-o' + kOn('nth') + '" data-g="report" data-id="nth" role="checkbox" aria-checked="' + (rk === 'nth') + '" aria-label="報告区分：第＿報" style="font-size:' + FS.choice + 'mm">第<span class="ar-u">' + (rk === 'nth' && no ? esc(no) : '') + '</span>報</span>', 'row');
    head += box(L + 819, 183, 364, 50, '<span class="ar-o' + kOn('final') + '" data-g="report" data-id="final" role="checkbox" aria-checked="' + (rk === 'final') + '" aria-label="報告区分：最終報告" style="font-size:' + FS.choice + 'mm">最終報告</span>', 'row ctr');
    head += box(L + 313, 236, 800, 28, '<span class="ar-red">※電話での第一報を除く</span>', 'row note');
    var sp = ymd(m.submit);
    head += box(L + 1180, 183, 583, 50, '<span class="ar-sub">提出日：西暦 ' + (sp.y ? esc(sp.y) : '<i>　　</i>') + ' 年 ' + (sp.m ? esc(sp.m) : '<i>　</i>') + ' 月 ' + (sp.d ? esc(sp.d) : '<i>　</i>') + ' 日</span>', 'row rgt');

    /* 表 */
    var t = '';
    /* 節の見出し（左の列） */
    t += cell(T, 0, 2, 0, 1, true, lab('1事故\n状況', 'sec1'));
    t += cell(T, 2, 4, 0, 1, true, stack('2事業所の概要'));
    t += cell(T, 6, 7, 0, 1, true, stack('3対象者'));
    t += cell(T, 13, 5, 0, 1, true, stack('4事故の概要'));
    t += cell(T, 18, 6, 0, 1, true, stack('5事故発生時の対応'));
    /* 欄の名前（2列目） */
    [[0, 1, '事故状況の程度'], [1, 1, '死亡に至った場合\n死亡年月日'], [2, 1, '法人名'], [3, 1, '事業所（施設）名'], [4, 1, 'サービス種別'], [5, 1, '所在地'],
     [6, 1, '氏名・年齢・性別'], [7, 1, 'サービス提供開始日'], [8, 1, '住所'], [9, 4, '身体状況'], [13, 1, '発生日時'], [14, 1, '発生場所'],
     [15, 1, '事故の種別'], [16, 1, '発生時状況、事故内容の詳細'], [17, 1, 'その他\n特記すべき事項'], [18, 1, '発生時の対応'], [19, 1, '受診方法'],
     [20, 1, '受診先'], [21, 1, '診断名'], [22, 1, '診断内容'], [23, 1, '検査、処置等の概要']].forEach(function (x) {
      t += cell(T, x[0], x[1], 1, 2, true, lab(x[2]));
    });
    /* 1 事故状況 */
    t += cell(T, 0, 1, 2, 13, false, '');
    t += optLine(T, 0, 'severity', d, FS.choice, null, over);
    t += dateCells(T, 1, [2, 3, 4, 5, 6, 7, 8, 9], d.deathDate);
    t += cell(T, 1, 1, 9, 13, true, '');
    t += ext(T, 1, true);
    /* 2 事業所の概要 */
    t += cell(T, 2, 1, 2, 13, false, '');
    t += box(305, T[2], 1465, T[3] - T[2], fitText('corpName', d.corpName, 3.1, 'one', over), 'pad');
    t += cell(T, 3, 1, 2, 9, false, '');
    var names = (Array.isArray(d.officeNames) && d.officeNames.some(function (x) { return trim(x); })) ? d.officeNames : officeNamesOf(f);
    var parts = [];
    OFFICE_KINDS.forEach(function (k, i) {
      var nm = trim(names[i]); if (!nm) return;
      var on = d.offices.indexOf(k) >= 0;
      /* 様式の写真: 1つ目の名前の後は空き、2つ目と3つ目の間は「・」。丸が隣の名前に掛からないよう、名前の左右に丸の張り出しより広い間を取る */
      if (parts.length === 1) parts.push('<span class="ar-gap"></span>');
      else if (parts.length > 1) parts.push('<span class="ar-dot">・</span>');
      parts.push('<span class="ar-o' + (on ? ' ar-on' : '') + '" data-g="offices" data-id="' + esc(k) + '" role="checkbox" aria-checked="' + on + '" aria-label="事業所：' + esc(nm) + '">' + esc(nm) + '</span>');
    });
    t += box(349, T[3], 1170 - 349 - 10, T[4] - T[3], over.offices ? '<div class="ar-fit ar-one" data-fit="offices" data-sheet="1" data-fs="2.3" style="font-size:2.3mm">別紙のとおり</div>'
      : '<div class="ar-fit ar-offs" data-fit="offices" data-fs="1.9,1.8,1.7,1.6,1.5" data-wrap="1" style="font-size:' + FS.office + 'mm">' + parts.join('') + '</div>', 'pad');
    t += cell(T, 3, 1, 9, 10, true, lab('事業所番号'));
    t += cell(T, 3, 1, 10, 13, false, '');
    t += box(1330, T[3], 440, T[4] - T[3], fitText('officeNo', d.officeNo, FS.value, 'one ctr', over), 'pad');
    t += cell(T, 4, 1, 2, 13, false, '');
    OPTS.serviceKinds.opts.forEach(function (o, i) {
      t += box(o.x, T[4] + 8, 200, 50, optSpan('serviceKinds', o, d, FS.kindBig), 'row');
      if (i < 2) t += box(o.x + 94, T[4] + 8, 53, 50, '<span style="font-size:' + FS.kindBig + 'mm">・</span>', 'row ctr');
    });
    t += cell(T, 5, 1, 2, 13, false, '');
    t += box(305, T[5], 1465, T[6] - T[5], fitText('officeAddress', d.officeAddress, 3.4, 'ctr mid', over), 'pad');
    /* 3 対象者 */
    t += cell(T, 6, 1, 2, 3, true, lab('氏名', 'ctr'));
    t += cell(T, 6, 1, 3, 6, false, '');
    t += box(385, T[6], 421, T[7] - T[6], fitText('name', d.name, FS.value, 'one ctr', over), 'pad');
    t += cell(T, 6, 1, 6, 7, true, lab('年齢', 'ctr'));
    t += cell(T, 6, 1, 7, 9, false, val(d.age, 'ctr'));
    t += cell(T, 6, 1, 9, 10, true, lab('性別：', 'ctr'));
    t += cell(T, 6, 1, 10, 13, false, '');
    t += optLine(T, 6, 'gender', d, 3.0, null, over);
    t += dateCells(T, 7, [2, 3, 4, 5, 6, 7, 8, 9], d.serviceStart);
    t += cell(T, 7, 1, 9, 10, true, lab('保険者', 'ctr'));
    t += cell(T, 7, 1, 10, 13, false, '');
    t += box(1330, T[7], 440, T[8] - T[7], fitText('insurer', d.insurer, 3.3, 'one ctr', over), 'pad');
    t += cell(T, 8, 1, 2, 13, false, '');
    t += optLine(T, 8, 'addressKind', d, 3.0, null, over);
    t += cell(T, 9, 2, 2, 5, true, lab('要介護度', 'ctr'));
    t += cell(T, 9, 1, 5, 13, false, '');
    t += cell(T, 10, 1, 5, 13, false, '');
    t += optLine(T, 10, 'careLevel', d, 2.75, null, over);
    t += cell(T, 11, 2, 2, 5, true, lab('認知症高齢者\n日常生活自立度', 'ctr'));
    t += cell(T, 11, 1, 5, 13, false, '');
    t += cell(T, 12, 1, 5, 13, false, '');
    t += optLine(T, 12, 'dementia', d, 2.8, null, over);
    /* 4 事故の概要 */
    t += dateCells(T, 13, [2, 3, 4, 5, 6, 7, 8, 9], d.occurDate);
    t += cell(T, 13, 1, 9, 10, false, val(d.occurHour, 'ctr'));
    t += cell(T, 13, 1, 10, 11, true, lab('時', 'ctr'));
    t += cell(T, 13, 1, 11, 12, false, val(d.occurMin, 'ctr'));
    t += cell(T, 13, 1, 12, 13, true, '', 'nor');
    t += ext(T, 13, false);
    t += box(COLS[12], T[13], COLS[13] + EXT - COLS[12], T[14] - T[13], lab('分頃（24時間表記）', 'nw'), '');
    t += cell(T, 14, 1, 2, 13, false, '');
    t += optLine(T, 14, 'place', d, 3.25, [32, 98, 163], over);
    t += cell(T, 15, 1, 2, 13, false, '');
    t += optLine(T, 15, 'kind', d, 3.25, [32, 97, 161], over);
    t += cell(T, 16, 1, 2, 13, false, fitText('detail', d.detail, FS.long, 'long', over));
    t += cell(T, 17, 1, 2, 13, false, fitText('special', d.special, FS.long, 'long', over));
    /* 5 事故発生時の対応 */
    t += cell(T, 18, 1, 2, 13, false, fitText('response', d.response, FS.long, 'long', over));
    t += cell(T, 19, 1, 2, 13, false, '');
    t += optLine(T, 19, 'consult', d, 3.2, null, over);
    t += cell(T, 20, 1, 2, 4, true, lab('医療機関名', 'ctr'));
    t += cell(T, 20, 1, 4, 8, false, '');
    t += box(581, T[20], 475, T[21] - T[20], fitText('hospName', d.hospName, 3.3, 'one ctr', over), 'pad');
    t += cell(T, 20, 1, 8, 10, true, lab('連絡先（電話番号）', 'ctr'));
    t += cell(T, 20, 1, 10, 13, false, '');
    t += box(1330, T[20], 440, T[21] - T[20], fitText('hospTel', d.hospTel, 3.3, 'one ctr', over), 'pad');
    t += cell(T, 21, 1, 2, 13, false, '');
    t += box(305, T[21], 1465, T[22] - T[21], fitText('diagName', d.diagName, 3.3, 'one ctr', over), 'pad');
    t += cell(T, 22, 1, 2, 13, false, '');
    t += optLine(T, 22, 'diag', d, 3.25, [33, 96], over);
    t += cell(T, 23, 1, 2, 13, false, fitText('treatment', d.treatment, FS.long, 'long', over));
    h += head + '<div class="ar-tbl" style="left:' + mm(L) + ';top:' + mm(TABLE_TOP1) + ';width:' + mm(COLS[13]) + ';height:' + mm(T[T.length - 1]) + '">' + t + '</div>';
    return '<section class="ar-page" data-page="1">' + h + '</section>';
  }

  function page2(m) {
    var d = m.data, T = tops(ROWS2, 0), over = m.over || {}, t = '';
    t += cell(T, 0, 5, 0, 1, true, stack('6事故発生後の状況'));
    [[0, 1, '利用者の状況'], [1, 2, '家族等への報告'], [3, 1, '連絡した関係機関\n(連絡した場合のみ)'], [4, 1, '本人、家族、関係先等\nへの追加対応予定']].forEach(function (x) {
      t += cell(T, x[0], x[1], 1, 2, true, lab(x[2]));
    });
    t += cell(T, 0, 1, 2, 13, false, fitText('status', d.status, FS.long, 'long', over));
    t += cell(T, 1, 1, 2, 4, true, lab('報告した家族等の\n続柄', 'ctr'));
    t += cell(T, 1, 1, 4, 13, false, '');
    t += optLine(T, 1, 'familyRel', d, 3.35, null, over);
    t += cell(T, 2, 1, 2, 4, true, lab('報告年月日', 'ctr'));
    t += dateCells(T, 2, [4, 5, 6, 7, 8, 9, 10, 11], d.familyDate);
    t += cell(T, 2, 1, 11, 13, true, '');
    t += ext(T, 2, true);
    t += cell(T, 3, 1, 2, 13, false, '');
    OPTS.agencies.opts.forEach(function (o) {
      t += box(o.x, T[3] + 31 - 25, 500, 50, optSpan('agencies', o, d, 3.35), 'row');
      t += box(o.x, T[3] + 95 - 25, o.close - o.x + 30, 50, '<span class="ar-p" style="font-size:3.35mm">' + esc(o.sub) + '（</span>' +
        fitText(o.other, d[o.other], 3.35, 'in', over) + '<span class="ar-p ar-cl" style="font-size:3.35mm">）</span>', 'row');
    });
    t += cell(T, 4, 1, 2, 13, false, fitText('followup', d.followup, FS.long, 'long', over));
    t += cell(T, 5, 2, 0, 3, true, lab('7 事故の原因分析\n（本人要因、職員要因、環境要因の分析）', 'wide'));
    t += cell(T, 5, 1, 3, 13, false, lab('（できるだけ具体的に記載すること）', 'hint'));
    t += cell(T, 6, 1, 3, 13, false, fitText('cause', d.cause, FS.long, 'long', over));
    t += cell(T, 7, 2, 0, 3, true, lab('8 再発防止策\n（手順変更、環境変更、その他の対応、\n再発防止策の評価時期および結果等）', 'wide'));
    t += cell(T, 7, 1, 3, 13, false, lab('（できるだけ具体的に記載すること）', 'hint'));
    t += cell(T, 8, 1, 3, 13, false, fitText('prevention', d.prevention, FS.long, 'long', over));
    t += cell(T, 9, 1, 0, 3, true, lab('9 その他\n特記すべき事項', 'wide'));
    t += cell(T, 9, 1, 3, 13, false, fitText('note', d.note, FS.long, 'long', over));
    return '<section class="ar-page" data-page="2"><div class="ar-tbl" style="left:' + mm(TABLE_LEFT) + ';top:0;width:' + mm(COLS[13]) + ';height:' + mm(T[T.length - 1]) + '">' + t + '</div></section>';
  }

  /* 別紙に出す欄（最小の大きさでも枠に収まらなかった欄の鍵の一覧から。並びは様式の順） */
  function sheetItems(data, overKeys, fac) {
    var d = normData(data), set = {}, out = [];
    (Array.isArray(overKeys) ? overKeys : Object.keys(overKeys || {})).forEach(function (k) { set[k] = 1; });
    /* 事業所（施設）名の行が最小の大きさで2行に折っても入らない時は、名前を全部並べ、選んだ物に「（選択）」を付ける */
    if (set.offices) {
      var names = (Array.isArray(d.officeNames) && d.officeNames.some(function (x) { return trim(x); })) ? d.officeNames : (fac ? officeNamesOf(asFac(fac)) : []);
      var lines = [];
      OFFICE_KINDS.forEach(function (k, i) { var nm = trim(names[i]); if (nm) lines.push(nm + (d.offices.indexOf(k) >= 0 ? '（選択）' : '')); });
      if (lines.length) out.push({ key: 'offices', label: '事業所（施設）名', text: lines.join('\n') });
    }
    return out.concat(TEXT.filter(function (t) { return set[t[0]] && trim(d[t[0]]) !== ''; }).map(function (t) { return { key: t[0], label: t[2], text: d[t[0]] }; }));
  }
  function sheetPage(m) {
    var items = sheetItems(m.data, m.over || {}, m.fac);
    if (!items.length) return '';
    var who = [trim(m.data.name) ? '対象者：' + m.data.name : '', isIso(m.data.occurDate) ? '発生日：' + jpDate(m.data.occurDate) : '', kindLabel(m.kind, m.no)].filter(Boolean).join('　');
    return '<section class="ar-sheet2"><h2 class="ar-s-h">別紙</h2><p class="ar-s-w">' + esc(who) + '</p>' +
      items.map(function (it) { return '<div class="ar-s-i"><div class="ar-s-l">' + esc(it.label) + '</div><div class="ar-s-t">' + esc(it.text) + '</div></div>'; }).join('') + '</section>';
  }
  /* 紙の全体。m = { data, kind, no, submit, fac（facOf の形か施設情報そのもの）, over（別紙へ回す欄の鍵: 真） } */
  function paperHtml(m) {
    var x = { data: normData(m && m.data), kind: m && m.kind, no: m && m.no, submit: m && m.submit,
      fac: asFac(m && m.fac), over: (m && m.over) || {} };
    return '<div class="ar-paper">' + page1(x) + page2(x) + sheetPage(x) + '</div>';
  }

  /* ═══════════ 画面の決まり ═══════════ */
  /* 入居者の検索（氏名・ふりがな・居室・番号）。退居の方は出さない。空の時は全員（居室の順） */
  function norm(s) {
    return str(s).replace(/[\s　]/g, '').replace(/[ァ-ン]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).toLowerCase();
  }
  function roomKey(r) { var m = /\d+/.exec(str(r && r.room)); return m ? ('000000' + m[0]).slice(-6) : '999999'; }
  function searchResidents(roster, q) {
    var list = (Array.isArray(roster) ? roster : []).filter(function (r) { return r && r.id != null && r.active !== false; });
    var k = norm(q);
    if (k) list = list.filter(function (r) {
      return norm(r.name).indexOf(k) >= 0 || norm(r.kana).indexOf(k) >= 0 || norm(r.room).indexOf(k) >= 0 || norm(r.id) === k;
    });
    return list.sort(function (a, b) { var x = roomKey(a), y = roomKey(b); return x < y ? -1 : (x > y ? 1 : (str(a.kana) < str(b.kana) ? -1 : 1)); });
  }
  /* 医療機関の候補（過去の報告の名前と電話・acc_list の hospitals）。名前が重なるものは1つ */
  function hospitalChoices(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (h) { var n = trim(h && h.name); if (!n || seen[n]) return; seen[n] = 1; out.push({ name: n, tel: trim(h.tel) }); });
    return out;
  }
  /* 画面の状態（端末に残すのは決まった値だけ） */
  var PANES = ['form', 'paper'];
  function pickPane(v) { return PANES.indexOf(v) >= 0 ? v : 'form'; }

  var api = {
    VERSION: VERSION, OPTS: OPTS, GROUPS: GROUPS, OFFICE_KINDS: OFFICE_KINDS, OFFICE_SERVICE: OFFICE_SERVICE, REPORT_KINDS: REPORT_KINDS,
    TEXT: TEXT, TEXT_MAX: TEXT_MAX, TEXT_LABEL: TEXT_LABEL, LONG: LONG, KEYS: KEYS, LIST_KEYS: LIST_KEYS, SINGLE_KEYS: SINGLE_KEYS, DATE_KEYS: DATE_KEYS,
    SAVE_KEYS: SAVE_KEYS, DATA_MAX: DATA_MAX, COLS: COLS, ROWS1: ROWS1, ROWS2: ROWS2, TABLE_TOP1: TABLE_TOP1, PAGE_W: PAGE_W, PAGE_H: PAGE_H, FIT_MIN: FIT_MIN, PANES: PANES,
    esc: esc, trim: trim, isIso: isIso, normDate: normDate, todayJST: todayJST, nowJST: nowJST, ageAt: ageAt, ageAfterDateChange: ageAfterDateChange,
    ymd: ymd, jpDate: jpDate, mdw: mdw, kindLabel: kindLabel, optOf: optOf, optIds: optIds, isOn: isOn, fitSteps: fitSteps,
    normGender: normGender, normCareLevel: normCareLevel, normDementia: normDementia, bfNormRank: bfNormRank, facOf: facOf, officeNamesOf: officeNamesOf,
    blankData: blankData, normData: normData, toggle: toggle, linkOffices: linkOffices, fromResident: fromResident,
    blankReport: blankReport, fromRow: fromRow, toSave: toSave, checkReport: checkReport, sameReport: sameReport, sortReports: sortReports,
    nextNo: nextNo, followUp: followUp, missing: missing, sheetItems: sheetItems, paperHtml: paperHtml,
    searchResidents: searchResidents, hospitalChoices: hospitalChoices, pickPane: pickPane
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AccidentReportCalc = api;
})(typeof window !== 'undefined' ? window : this);
