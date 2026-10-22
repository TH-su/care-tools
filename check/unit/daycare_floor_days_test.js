/* デイ利用表（daycare-roster.html）の、週間計画からの利用日の取り出し・階の振り分け・☆（訪問診療）の計算の試験（2026-10-22 新設・改善プロンプト第4弾の7）
   実行: node check/unit/daycare_floor_days_test.js
   （画面を差し替えて試す時: DCR_HTML=差し替えた画面のパス node check/unit/daycare_floor_days_test.js）
   ★画面の本物の関数と本物の su-facility.js（施設情報の floors・visitingClinics）を動かす。偽物にするのは名簿の取得と、描画に要る小さな DOM だけ。利用者は架空。
   ほかの試験が見ている所は重ねない: 氏名の切れ目と roomToFloor の基本（care_namecut_test.js）、☆の取り直し（daycare_star_refresh_test.js）、
   ☆の判定の書き方と凡例の名前（facility_sample_test.js）。
   守ること:
     1. 週間計画からの利用日: 一覧の5タブが使う形（buildModel）は、通所（daycare）の予定だけを月〜土で拾う。曜日・時刻が読めない予定と、
        終わりが始まり以前の予定は捨てる。同じ曜日に2件あれば後の1件を使い、落とした件数を数える（警告に出すため）。退去した方は入れない。
        入浴は曜日ごと。並びは五十音順。利用表タブ（collectDaycare）とデイ母集団の判定（isDaycareResident）は日曜も拾い、日曜があれば7列にする
     2. 入居前・非表示の除外: 該当者がいなければ元の名簿をそのまま（同じもの）返す＝使っていない間は何も変えない。入居前の人数は通所予定のある方だけ数える
     3. 階の振り分け: 居室番号の先頭の数字が施設情報の floors にある階ならその階。無い階・先頭が数字でない居室（"B201" 等）は 0（階未設定）にして、
        週間計画の旧い階（1 か 2）へ逃がす。それも無ければ階未設定。施設情報の floors が１階だけなら "201" は２階にしない。階の出典の内訳を数える
     4. 利用表タブ: 時間帯ごとに ２階→１階→階未設定 の順で区画を作り、該当者0名の階は区画を作らない。区画の中は五十音順。
        入院中の方は表に残すが、利用合計・入浴合計には数えない。週間名簿の階分けも同じ順で、各階の先頭にだけ階の見出しを付ける
     5. ☆の計算（名簿から）: かかりつけが施設情報の訪問診療の医療機関（名前か別名を含む）で、往診曜日が曜日1文字の方だけ☆の曜日を持つ。
        「他」・空欄・2文字以上・ほかの医療機関は持たない。往診曜日を返さない旧い名簿では☆の地図を作らない（null）。
        入院は名簿に項目がある方だけ、居室は空でない方だけ控える。氏名の文字は控えない
     6. ☆の重ね合わせ: 描画用の写しにだけ重ね、元の名簿は書き換えない。変わる所が無ければ元の名簿をそのまま返す。
        ☆の地図に無い方は☆を消す（空にする）。入院は控えのある方だけ・居室は控えのある方だけ重ねる
     7. ☆の表示（デイ利用者一覧表の昼食の区画）: その曜日がその方の往診曜日の時だけ、氏名の右の欄に☆を出す。デイに行く日（通所の区画）には出さない
     8. 合計: 通所合計・昼食合計は入院中の方を数えない。昼食合計（通所＋昼食）は曜日によらず同じ数になる */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = fs.readFileSync(process.env.DCR_HTML || path.join(ROOT, 'daycare-roster.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
const J = JSON.stringify;
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

/* ── 切り出し（care_namecut_test.js と同じ方式：文字列・コメントを飛ばして括弧の対を数える）── */
function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(SRC, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return SRC.slice(start, end + 1);
}
/* 1行の宣言（const X = ...;）か、{ } / [ ] で囲まれた宣言を var にして取り出す */
function grabVar(name) {
  const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=\\s*', 'm').exec(SRC);
  if (!m) throw new Error('宣言が見つかりません: ' + name);
  const vpos = m.index + m[0].length, open = SRC[vpos];
  let text;
  if (open === '{' || open === '[') {
    let j = scanBlock(SRC, vpos, open, open === '{' ? '}' : ']') + 1;
    while (j < SRC.length && SRC[j] !== ';') j++;
    text = SRC.slice(m.index, j + 1);
  } else {
    const eol = SRC.indexOf('\n', vpos);
    text = SRC.slice(m.index, eol < 0 ? SRC.length : eol);
  }
  return text.replace(/^(?:const|let)\s/, 'var ');
}

/* ── 描画に要る分だけの小さな DOM ── */
function makeEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), className: '', children: [], _text: '', title: '', dataset: {}, style: {}, rowSpan: 1, colSpan: 1,
    appendChild(c) { this.children.push(c); return c; },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set textContent(v) { this._text = String(v); this.children = []; },
    classList: null
  };
  e.classList = { add(c) { if ((' ' + e.className + ' ').indexOf(' ' + c + ' ') < 0) e.className = (e.className ? e.className + ' ' : '') + c; } };
  return e;
}

/* ── 施設情報（本物の su-facility.js に見本の施設情報を読ませる）── */
const SAMPLE = JSON.parse(read('facility-profile.sample.json'));
function facility(profile) {
  const box = { console, JSON, localStorage: { getItem: k => (k === 'su_facility_json_v1' ? JSON.stringify(profile) : null), setItem() {} } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('su-facility.js'), box);
  return box.SUFacility;
}

/* ── 画面の関数を1つの砂場に入れる ── */
function makeBox(fac) {
  const roster = { list: null, calls: 0 };
  const box = {
    console, JSON, String, Object, Array, Date, Promise, Math, Number, isFinite, parseInt, Set,
    setTimeout: () => 0, clearTimeout: () => {},
    document: { createElement: makeEl, createTextNode: s => ({ textContent: String(s), children: [] }) },
    dcrGetMasterCfg: () => ({ url: 'https://example.invalid/exec', token: '見本' }),
    SU: { data: { getRoster: () => { roster.calls++; return Promise.resolve({ roster: JSON.parse(J(roster.list)) }); } } }
  };
  box.window = box;
  if (fac) box.SUFacility = fac;
  vm.createContext(box);
  vm.runInContext([
    grabVar('DAYS_JA'), grabVar('NDAY'), grabVar('dupCount'), grabVar('floorSrcCount'), grabVar('SU_FAC_WAIT_MS'),
    'var DCR_HOSP_TTL_MS = 60000, dcrHospMap = null, dcrVmedMap = null, dcrRoomMap = null, dcrNameCutMap = null, dcrHospAt = 0, dcrHospRev = null, dcrHospBusy = false, dcrClinicSigUsed = null;',
    grabVar('FLOOR_ORDER'), grabVar('FLOOR_LABEL'), grabVar('byKana'),
    grabVar('onDay'), grabVar('offDay'), grabVar('countOn'), grabVar('countOff'),
    grabFn('toMin'), grabFn('minToLabel'), grabFn('el'), grabFn('roomToFloor'),
    grabFn('buildModel'), grabFn('isDaycareResident'), grabFn('collectDaycare'), grabFn('weeklyByFloor'),
    grabFn('viewExcludingHidden'), grabFn('viewExcludingPreAdmitted'), grabFn('countPreAdmitted'),
    grabFn('dcrClinicOf_'), grabFn('dcrClinicSig_'), grabFn('dcrClinicLabel_'), grabFn('suFacReady_'),
    grabFn('dcrFetchMasterHosp'), grabFn('dcrOverlayMaster'), grabFn('deiCells'), grabFn('sectionRows')
  ].join('\n'), box);
  return { box, roster };
}

/* 架空の利用者。ev は [曜日(0=月), 始まり, 終わり, 入浴] の並び */
function res(id, kana, room, evs, extra) {
  return Object.assign({ id: 'r' + id, masterId: 'm' + id, name: '見本 ' + id, kana: kana, room: room,
    events: evs.map(e => ({ serviceType: 'daycare', dayOfWeek: e[0], startTime: e[1], endTime: e[2], bathing: !!e[3] })) }, extra || {});
}

(async () => {
  const F = facility(SAMPLE);

  console.log('\n— 1. 週間計画からの利用日の取り出し —');
  {
    const { box } = makeBox(F);
    const db = { residents: [
      res('甲', 'こう', '201', [[0, '09:00', '15:00', true], [2, '10:00', '13:30']]),
      Object.assign(res('乙', 'おつ', '101', []), { events: [
        { serviceType: 'visit', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },    // 訪問は拾わない
        { serviceType: 'daycare', dayOfWeek: 'x', startTime: '09:00', endTime: '15:00' },  // 曜日が読めない
        { serviceType: 'daycare', dayOfWeek: 7, startTime: '09:00', endTime: '15:00' },    // 曜日の外
        { serviceType: 'daycare', dayOfWeek: 1, startTime: '9時', endTime: '15:00' },      // 時刻が読めない
        { serviceType: 'daycare', dayOfWeek: 3, startTime: '15:00', endTime: '15:00' },    // 終わり＝始まり
        { serviceType: 'daycare', dayOfWeek: 4, startTime: '09:30', endTime: '15:30' },
        null
      ] }),
      res('丙', 'へい', '102', [[1, '09:00', '12:00'], [1, '13:00', '16:00', true]]),   // 同じ曜日に2件
      res('丁', 'てい', '202', [[6, '09:00', '15:00']]),                                 // 日曜だけ
      res('戊', 'ぼ', '203', [[0, '09:00', '15:00']], { movedOut: true }),               // 退去
      res('己', 'き', '204', [])                                                         // 予定なし
    ] };
    const ppl = box.buildModel(db);
    t('母集団は通所の予定がある方だけ（日曜だけ・退去・予定なしは入れない）・五十音順', J(ppl.map(p => p.kana)) === J(['おつ', 'こう', 'へい']), ppl.map(p => p.kana));
    const kou = ppl.find(p => p.kana === 'こう'), otsu = ppl.find(p => p.kana === 'おつ'), hei = ppl.find(p => p.kana === 'へい');
    t('月と水だけを拾い、時刻を分で持つ・入浴は曜日ごと', J(kou.days) === J([{ s: 540, e: 900, bath: true }, null, { s: 600, e: 810, bath: false }, null, null, null]), kou.days);
    t('訪問・読めない曜日・曜日の外・読めない時刻・終わりが始まり以前の予定は捨てる（金だけ残る）', J(otsu.days.map(d => !!d)) === J([false, false, false, false, true, false]), otsu.days);
    t('同じ曜日に2件あれば後の1件を使う', J(hei.days[1]) === J({ s: 780, e: 960, bath: true }), hei.days[1]);
    t('落とした件数を数える（1件）', box.dupCount === 1, box.dupCount);
    t('並びの番号（pid）は並べた後の 0,1,2', J(ppl.map(p => p.pid)) === J([0, 1, 2]), ppl.map(p => p.pid));
    t('デイ母集団の判定は日曜も拾う', box.isDaycareResident(db.residents[3]) === true && box.isDaycareResident(db.residents[5]) === false, '');
    const cd = box.collectDaycare(db);
    t('利用表タブは日曜があれば7列にする', cd.nCols === 7, cd.nCols);
    const cd2 = box.collectDaycare({ residents: db.residents.filter(r => r.id !== 'r丁') });
    t('日曜が無ければ月〜土の6列', cd2.nCols === 6, cd2.nCols);
    t('名簿が壊れていても止まらない（空の一覧）', J(box.buildModel(null)) === '[]' && J(box.buildModel({ residents: 'x' })) === '[]' && box.collectDaycare(undefined).plans.length === 0, '');
  }

  console.log('\n— 2. 入居前・非表示の除外 —');
  {
    const { box } = makeBox(F);
    const db = { residents: [res('甲', 'こう', '201', [[0, '09:00', '15:00']]), res('乙', 'おつ', '101', [[1, '09:00', '15:00']])] };
    t('入居前がいなければ同じ名簿を返す', box.viewExcludingPreAdmitted(db) === db, '');
    t('非表示がいなければ同じ名簿を返す', box.viewExcludingHidden(db) === db, '');
    const db2 = { rev: 3, residents: [db.residents[0], Object.assign({}, db.residents[1], { preAdmitted: true, dcrHidden: true }), Object.assign(res('丙', 'へい', '102', []), { preAdmitted: true })] };
    const v = box.viewExcludingPreAdmitted(db2);
    t('入居前の方を外した写しを返し、元の名簿と他の項目はそのまま', v !== db2 && v.rev === 3 && v.residents.length === 1 && db2.residents.length === 3, v.residents.map(r => r.id));
    t('入居前の人数は通所の予定がある方だけ・うち非表示も付いている人数', J(box.countPreAdmitted(db2)) === J({ total: 1, hidden: 1 }), box.countPreAdmitted(db2));
    t('非表示の方を外す', box.viewExcludingHidden(db2).residents.map(r => r.id).join() === 'r甲,r丙', box.viewExcludingHidden(db2).residents.map(r => r.id));
  }

  console.log('\n— 3. 階の振り分け —');
  {
    const { box } = makeBox(F);
    t('見本の施設情報（１階・２階）: 201→2・１０５→1・B201→0・301→0・空→0', J(['201', '１０５', 'B201', '301', '', null].map(box.roomToFloor)) === J([2, 1, 0, 0, 0, 0]), ['201', '１０５', 'B201', '301', '', null].map(box.roomToFloor));
    const ppl = box.buildModel({ residents: [
      res('甲', 'あ', '201', [[0, '09:00', '15:00']]),
      res('乙', 'い', 'B201', [[0, '09:00', '15:00']], { floor: 1 }),   // 居室が規約外→週間計画の旧い階へ
      res('丙', 'う', '', [[0, '09:00', '15:00']], { floor: 2 }),
      res('丁', 'え', '', [[0, '09:00', '15:00']], { floor: 3 }),       // 旧い階は 1 か 2 だけ
      res('戊', 'お', '501', [[0, '09:00', '15:00']])
    ] });
    t('居室が第一・週間計画の旧い階（1 か 2）が次・それも無ければ階未設定', J(ppl.map(p => p.floor)) === J([2, 1, 2, 0, 0]), ppl.map(p => p.floor));
    t('階の出典の内訳を数える（居室1・旧い階2・不明2）', J(box.floorSrcCount) === J({ room: 1, plan: 2, none: 2 }), box.floorSrcCount);
  }
  {
    const one = JSON.parse(J(SAMPLE)); one.floors = [{ no: 1, label: '１階' }];
    const { box } = makeBox(facility(one));
    t('施設情報が１階だけなら 201 は２階にしない（階未設定）・101 は１階', J(['201', '101'].map(box.roomToFloor)) === J([0, 1]), ['201', '101'].map(box.roomToFloor));
  }
  {
    const { box } = makeBox(null);
    t('施設情報の部品が無い端末では従来の判定（先頭の 1 か 2）・全角も読む', J(['２０１', '105', 'B201', '301'].map(box.roomToFloor)) === J([2, 1, 0, 0]), ['２０１', '105', 'B201', '301'].map(box.roomToFloor));
  }

  console.log('\n— 4. 利用表タブと週間名簿の階分け —');
  {
    const { box } = makeBox(F);
    const db = { residents: [
      res('甲', 'し', '101', [[0, '09:00', '15:00', true]]),
      res('乙', 'か', '102', [[0, '09:00', '15:00', true]], { hospitalized: true }),
      res('丙', 'さ', '201', [[0, '09:00', '15:00']]),
      res('丁', 'あ', '', [[0, '09:00', '15:00', true]]),
      res('戊', 'た', '202', [[0, '10:00', '13:00']])
    ] };
    const cd = box.collectDaycare(db);
    t('時間帯は始まりの早い順・表記は 9:00〜15:00', J(cd.plans.map(p => p.label)) === J(['9:00〜15:00', '10:00〜13:00']), cd.plans.map(p => p.label));
    t('区画は ２階→１階→階未設定 の順', J(cd.plans[0].blocks.map(b => b.floor)) === J([2, 1, 0]), cd.plans[0].blocks.map(b => b.floor));
    t('該当者0名の階は区画を作らない（10:00〜13:00 は２階だけ）', J(cd.plans[1].blocks.map(b => b.floor)) === J([2]), cd.plans[1].blocks.map(b => b.floor));
    const f1 = cd.plans[0].blocks.find(b => b.floor === 1);
    t('区画の中は五十音順（か→し）・入院中の方も表に残す', J(f1.days[0].map(x => x.kana + (x.hosp ? '入院' : ''))) === J(['か入院', 'し']), f1.days[0]);
    t('入院中の方は利用合計・入浴合計に数えない（月: 利用4・入浴2）', cd.use[0] === 4 && cd.bath[0] === 2, [cd.use[0], cd.bath[0]]);
    t('入院中の方の一覧', J(cd.hosp) === J(['見本 乙']), cd.hosp);
    t('階の見出しは FLOOR_LABEL（２階・１階・階未設定）', J([2, 1, 0].map(f => box.FLOOR_LABEL[f])) === J(['２階', '１階', '階未設定']), '');
    const wk = box.weeklyByFloor(box.buildModel(db));
    t('週間名簿は ２階→１階→階未設定 の順で、各階の先頭にだけ見出し', J(wk.map(x => x.p.kana + ':' + x.flr)) === J(['さ:2', 'た:null', 'か:1', 'し:null', 'あ:0']), wk.map(x => x.p.kana + ':' + x.flr));
  }

  console.log('\n— 5. ☆の計算（名簿から）—');
  {
    const { box, roster } = makeBox(F);
    roster.list = [
      { masterId: 'a', hospital: '見本クリニック（内科）', visitDay: '火', room: '201', name: '見本 甲', hospitalized: false },
      { masterId: 'b', hospital: '見本クリ', visitDay: ' 水 ', room: '', name: '見本 乙' },            // 別名・前後の空白
      { masterId: 'c', hospital: '見本クリニック', visitDay: '他', room: '101', name: '見本丙' },
      { masterId: 'd', hospital: '見本クリニック', visitDay: '', name: '見本 丁', hospitalized: true },
      { masterId: 'e', hospital: '見本クリニック', visitDay: '火水' },
      { masterId: 'f', hospital: 'ほかの病院', visitDay: '火' },
      { id: 'g', hospital: '見本クリニック', visitDay: '金' }                                          // masterId が無く id だけ
    ];
    const ok = await box.dcrFetchMasterHosp(true); await settle();
    t('名簿が読めた', ok === true, ok);
    t('☆は医療機関（名前か別名）が当たり、往診曜日が1文字の方だけ（a 火・b 水・g 金）', J(box.dcrVmedMap) === J({ a: '火', b: '水', g: '金' }), box.dcrVmedMap);
    t('入院は名簿に項目がある方だけ控える', J(box.dcrHospMap) === J({ a: false, d: true }), box.dcrHospMap);
    t('居室は空でない方だけ控える', J(box.dcrRoomMap) === J({ a: '201', c: '101' }), box.dcrRoomMap);
    t('氏名の文字は控えない（空白のある方だけ、切れ目の位置と文字数の数だけ）', J(box.dcrNameCutMap) === J({ a: { cut: 2, len: 3 }, b: { cut: 2, len: 3 }, d: { cut: 2, len: 3 } }) && !/見本/.test(J([box.dcrHospMap, box.dcrVmedMap, box.dcrRoomMap, box.dcrNameCutMap])), box.dcrNameCutMap);
  }
  {
    const { box, roster } = makeBox(F);
    roster.list = [{ masterId: 'a', hospital: '見本クリニック', room: '201' }];   // 往診曜日を返さない旧い名簿
    await box.dcrFetchMasterHosp(true); await settle();
    t('往診曜日を返さない旧い名簿では☆の地図を作らない（null）', box.dcrVmedMap === null, box.dcrVmedMap);
  }
  {
    const none = JSON.parse(J(SAMPLE)); delete none.visitingClinics;
    const { box, roster } = makeBox(facility(none));
    roster.list = [{ masterId: 'a', hospital: '見本クリニック', visitDay: '火' }];
    await box.dcrFetchMasterHosp(true); await settle();
    t('施設情報に訪問診療の医療機関が無ければ、だれにも☆を付けない', J(box.dcrVmedMap) === '{}', box.dcrVmedMap);
  }

  console.log('\n— 6. ☆の重ね合わせ —');
  {
    const { box } = makeBox(F);
    const r1 = res('甲', 'こう', '', [[0, '09:00', '15:00']], { masterId: 'a', visitingMed: '' });
    const r2 = res('乙', 'おつ', '101', [[0, '09:00', '15:00']], { masterId: 'b', visitingMed: '木', hospitalized: true });
    const r3 = res('丙', 'へい', '102', [[0, '09:00', '15:00']], { masterId: '' });
    const db = { rev: 7, residents: [r1, r2, r3] };
    const before = J(db);
    t('控えが無い間は元の名簿をそのまま返す', box.dcrOverlayMaster(db) === db, '');
    box.dcrVmedMap = { a: '火' }; box.dcrHospMap = { a: true }; box.dcrRoomMap = { a: '201' };
    const out = box.dcrOverlayMaster(db);
    t('元の名簿は書き換えない', J(db) === before, '');
    t('☆・入院・居室を写しにだけ重ねる', out !== db && out.rev === 7 && out.residents[0].visitingMed === '火' && out.residents[0].hospitalized === true && out.residents[0].room === '201', out.residents[0]);
    t('☆の地図に無い方は☆を消す・入院の控えが無い方の入院はそのまま', out.residents[1].visitingMed === '' && out.residents[1].hospitalized === true && out.residents[1].room === '101', out.residents[1]);
    t('変わらない方・masterId の無い方は同じものを使う', out.residents[2] === r3, '');
    box.dcrVmedMap = { a: '火', b: '木' }; box.dcrHospMap = {}; box.dcrRoomMap = {};
    const same = { residents: [Object.assign({}, r1, { visitingMed: '火' }), r2, r3] };
    t('変わる所が無ければ元の名簿をそのまま返す', box.dcrOverlayMaster(same) === same, '');
  }

  console.log('\n— 7. ☆の表示（デイ利用者一覧表）—');
  {
    const { box } = makeBox(F);
    const ppl = box.buildModel({ residents: [
      res('甲', 'あ', '201', [[0, '09:00', '15:00']], { visitingMed: '火' }),   // 火はデイ休み＝昼食の区画で☆
      res('乙', 'い', '202', [[1, '09:00', '15:00']], { visitingMed: '火' })    // 火はデイ＝昼食の区画に出ない
    ] });
    /* 行ごと・曜日ごとの☆の欄（昼食の区画: 見出し・番号の後に 曜日ごとに 氏名・☆欄・空欄） */
    function starDays(isDei, showStar) {
      const tb = makeEl('tbody');
      box.sectionRows(tb, ppl, '２階入居者', isDei, false, showStar, 2);
      const hit = [];
      tb.children.forEach((tr, i) => {
        const off = i === 0 ? 2 : 1;
        for (let d = 0; d < box.NDAY; d++) {
          const nm = tr.children[off + d * 3], st = tr.children[off + d * 3 + 1];
          if (st && st.children.some(c => c.className === 'star' && c.textContent === '☆')) hit.push(box.DAYS_JA[d] + ':' + nm.textContent + ':' + st.title);
        }
      });
      return hit;
    }
    t('昼食の区画では、往診曜日の火にだけ☆（デイに行く方には出ない）・ふきだしは施設情報の名前', J(starDays(false, true)) === J(['火:見本 甲:見本クリニック 訪問診療']), starDays(false, true));
    t('☆を出さない指定では出ない', J(starDays(false, false)) === '[]', starDays(false, false));
    t('通所の区画には☆を出さない', J(starDays(true, true)) === '[]', starDays(true, true));
    t('一覧表は昼食の区画だけで☆を出す（通所の区画は false・昼食の区画は true）',
      /sectionRows\(tbody, f2, '２階入居者', true, true, false, 2\);/.test(SRC) && /sectionRows\(tbody, f2, '２階入居者', false, false, true, 2\);/.test(SRC), '');
  }

  console.log('\n— 8. 合計 —');
  {
    const { box } = makeBox(F);
    const ppl = box.buildModel({ residents: [
      res('甲', 'あ', '201', [[0, '09:00', '15:00'], [1, '09:00', '15:00']]),
      res('乙', 'い', '101', [[0, '09:00', '15:00']], { hospitalized: true }),
      res('丙', 'う', '102', [[2, '09:00', '15:00']])
    ] });
    const on = [0, 1, 2, 3, 4, 5].map(d => box.countOn(ppl, d)), off = [0, 1, 2, 3, 4, 5].map(d => box.countOff(ppl, d));
    t('通所合計は入院中の方を数えない（月 1・火 1・水 1）', J(on) === J([1, 1, 1, 0, 0, 0]), on);
    t('表示は入院中の方も残す（月のデイ 2名）', box.onDay(ppl, 0).length === 2, box.onDay(ppl, 0).length);
    t('昼食合計（通所＋昼食）は曜日によらず 2（入院中を除いた人数）', on.map((v, i) => v + off[i]).every(x => x === 2), on.map((v, i) => v + off[i]));
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
