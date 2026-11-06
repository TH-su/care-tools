/* 職員マスタの委員会: 2026-11-06 に足した係5件と「必要書類と開催の条件」（committeeDocs）の試験。
   node --test で走る。外部ライブラリ不要（node:test + node:assert/strict のみ）。

   守りたいのは次の6つ:
   1. 既定は14件。足した5件（accident・complaint・privacy・harassment・fire）が既存9件の末尾にこの順で並ぶ
   2. 古いサーバー（9件だけ返す）に繋がっても、計算部品が末尾に5件を補って14件になる
   3. committeeDocs(code) は14件すべてで書類と開催の条件を返し、知らない code・空・文字列でない値は null
   4. 戻り値は写し（呼び手が壊しても2回目は変わらない）。sites を書かない書類は委員会の対象事業所で補う
   5. 委員会マスタの要素のキーは増えていない（増やすと staff-api.gs が「受け付けない項目です」で保存を全部断る）
   6. 事故発生防止は担当者が空なら「担当者が決まっていません（指導指針の要件です）」を出す

   ★実在の氏名・住所・電話は1件も含まない（見本の職員は「見本 甲」「架空 乙」のみ）。

     node --test "…/check/unit/staff_committee_docs_test.js"
*/
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const CALC_PATH = path.join(__dirname, '..', '..', 'staff-master-calc.js');
/* 試験ごとに読み直す（setCommittees はモジュールの状態を書き換えるため） */
function fresh() { delete require.cache[require.resolve(CALC_PATH)]; return require(CALC_PATH); }

const OLD9 = ['abuse', 'restraint', 'infection', 'safety', 'kondan', 'dementia', 'bcp', 'disaster', 'hygiene'];
const NEW5 = ['accident', 'complaint', 'privacy', 'harassment', 'fire'];
const ALL14 = OLD9.concat(NEW5);
/* committees() の要素のキー（origin/main の fromDefault・setCommittees が組む形と同じ19個）。
   ★ここが増えたら staff-api.gs の COMMITTEE_ITEM_KEYS も同時に増やすこと */
const ITEM_KEYS = ['alias', 'basis', 'code', 'drill', 'freq', 'hasPenalty', 'inactive', 'kind', 'label', 'note',
  'penalty', 'purpose', 'siteStartedAt', 'sites', 'startedAt', 'todo', 'todoNote', 'training', 'url'];
const MEET_KEYS = ['freq', 'attend', 'method', 'minutes', 'notify', 'keep'];
const ASOF = '2026-11-06';
const OFFICER_GUIDE = '担当者が決まっていません（指導指針の要件です）';

/* 見本の職員（架空）。A＝見本 甲・B＝架空 乙 */
const NAMES = { A: ['見本 甲', 'ミホン コウ'], B: ['架空 乙', 'カクウ オツ'] };
const row = (id, list) => ({
  id: id, name: NAMES[id][0], kana: NAMES[id][1], hireDate: '2020-04-01', retireDate: '', jobTitle: '介護',
  committeesJson: list
});

/* ── 1. 既定の並び ──────────────────────────────────────────────── */

test('COMMITTEE_DEFAULTS: 既定は14件、足した5件は既存9件の末尾にこの順', () => {
  const S = fresh();
  assert.deepEqual(S.COMMITTEE_DEFAULTS.map((c) => c.code), ALL14);
  assert.deepEqual(S.committees().map((c) => c.code), ALL14);
  assert.deepEqual(S.localDefaults().map((c) => c.code), ALL14);
});

test('COMMITTEE_DEFAULTS: 足した5件の種別・対象事業所・要確認', () => {
  const S = fresh();
  const by = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { by[c.code] = c; });
  assert.equal(by.accident.label, '事故発生防止委員会');
  assert.equal(by.accident.kind, 'committee');
  assert.deepEqual(by.accident.sites, ['facility']);
  assert.equal(by.complaint.label, '苦情受付担当者・苦情解決責任者');
  assert.equal(by.privacy.label, '個人情報保護管理責任者');
  assert.equal(by.harassment.label, 'ハラスメント相談担当者');
  assert.equal(by.fire.label, '防火管理者');
  ['complaint', 'privacy', 'harassment', 'fire'].forEach((c) => assert.equal(by[c].kind, 'officer', c));
  ['complaint', 'privacy', 'harassment'].forEach((c) => assert.deepEqual(by[c].sites, ['facility', 'visit', 'day'], c));
  assert.deepEqual(by.fire.sites, ['facility', 'day']);
  /* どれも減算は無い。要確認は防火管理者だけ（収容人員で選任義務が決まる） */
  NEW5.forEach((c) => {
    assert.equal(by[c].hasPenalty, false, c);
    assert.equal(by[c].penalty, '', c);
    assert.equal(by[c].inactive, false, c);
    assert.equal(by[c].todo === true, c === 'fire', c);
    assert.equal(by[c].alias, undefined, c);     /* 既存の例（hygiene）と同じく alias・drill は書かない */
    assert.equal(by[c].drill, undefined, c);
  });
  assert.equal(by.fire.todoNote, '施設と通所の建物が同じ防火対象物か、収容人員の数え方を消防署に確認してください');
});

/* ── 2. 古いサーバー（9件）からの応答 ───────────────────────────── */

test('setCommittees: 9件だけの応答を受けても committees() は14件、末尾5件は既定の順', () => {
  const S = fresh();
  const old = JSON.parse(JSON.stringify(S.COMMITTEE_DEFAULTS.slice(0, 9)));
  assert.equal(S.setCommittees(old), 14);
  const list = S.committees();
  assert.equal(list.length, 14);
  assert.deepEqual(list.map((c) => c.code), ALL14);
  assert.deepEqual(list.slice(9).map((c) => c.code), NEW5);
  assert.equal(S.committeeOf('accident').label, '事故発生防止委員会');
});

test('setCommittees: 独自7件と既定の応答でも committees() は20件まで（staff-api.gs の上限と同じ）', () => {
  const S = fresh();
  /* サーバー（normCommittees_）は既定9件＋独自7件＋既定を上限20件まで足して返す＝20件 */
  const own = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ code: 'x' + n, label: '架空の係' + n, sites: ['visit'] }));
  const srv = JSON.parse(JSON.stringify(S.COMMITTEE_DEFAULTS.slice(0, 9))).concat(own)
    .concat(JSON.parse(JSON.stringify(S.COMMITTEE_DEFAULTS.slice(9, 13))));
  assert.equal(srv.length, 20);
  assert.equal(S.setCommittees(srv), 20);
  assert.equal(S.committees().length, 20);
  /* 旧サーバー（既定9件＋独自7件＝16件）でも、計算部品が足すのは上限まで */
  const T = fresh();
  T.setCommittees(JSON.parse(JSON.stringify(T.COMMITTEE_DEFAULTS.slice(0, 9))).concat(own));
  assert.equal(T.committees().length, 20);
  assert.deepEqual(T.committees().slice(16).map((c) => c.code), NEW5.slice(0, 4));
  /* 上限に届かない時は今までどおり全部足す */
  const U = fresh();
  U.setCommittees(JSON.parse(JSON.stringify(U.COMMITTEE_DEFAULTS.slice(0, 9))).concat(own.slice(0, 2)));
  assert.equal(U.committees().length, 16);
});

/* ── 5. 委員会マスタの要素のキーは増やさない ─────────────────────── */

test('committees(): 要素のキーは今までと同じ19個（起動直後・9件応答の後・14件応答の後）', () => {
  const S = fresh();
  const keysOf = (c) => Object.keys(c).sort();
  S.committees().forEach((c) => assert.deepEqual(keysOf(c), ITEM_KEYS, c.code));
  S.setCommittees(JSON.parse(JSON.stringify(S.COMMITTEE_DEFAULTS.slice(0, 9))));
  S.committees().forEach((c) => assert.deepEqual(keysOf(c), ITEM_KEYS, c.code));
  S.setCommittees(JSON.parse(JSON.stringify(S.COMMITTEE_DEFAULTS)));
  S.committees().forEach((c) => assert.deepEqual(keysOf(c), ITEM_KEYS, c.code));
  /* 必要書類の表は公開しない（通信にも載せない内部の表） */
  assert.equal(S.COMMITTEE_DOCS, undefined);
  assert.equal(S.COMMITTEE_MEET, undefined);
});

/* ── 3. committeeDocs の形 ─────────────────────────────────────── */

test('COMMITTEE_DOC_KINDS: 書類の種別は9つ', () => {
  const S = fresh();
  assert.deepEqual(S.COMMITTEE_DOC_KINDS, ['指針', '要綱', '規程', '計画', '議事録', '記録', '辞令', '様式', '掲示']);
});

test('committeeDocs: 14件すべてで書類と開催の条件を返す（形・種別・対象事業所）', () => {
  const S = fresh();
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
  S.COMMITTEE_DEFAULTS.forEach((def) => {
    const r = S.committeeDocs(def.code);
    assert.notEqual(r, null, def.code);
    assert.ok(Array.isArray(r.docs) && r.docs.length > 0, def.code);
    r.docs.forEach((d, i) => {
      const where = def.code + '[' + i + ']';
      ['name', 'kind', 'freq', 'basis'].forEach((k) => assert.ok(nonEmpty(d[k]), where + '.' + k));
      assert.ok(S.COMMITTEE_DOC_KINDS.indexOf(d.kind) >= 0, where + ' kind=' + d.kind);
      assert.ok(Array.isArray(d.sites), where + '.sites');
      d.sites.forEach((s) => assert.ok(def.sites.indexOf(s) >= 0, where + ' site=' + s));
    });
    assert.deepEqual(Object.keys(r.meet), MEET_KEYS, def.code);
    MEET_KEYS.forEach((k) => assert.equal(typeof r.meet[k], 'string', def.code + '.meet.' + k));
  });
});

test('committeeDocs: 知らない code・空・文字列でない値は null', () => {
  const S = fresh();
  assert.equal(S.committeeDocs(''), null);
  assert.equal(S.committeeDocs('   '), null);
  assert.equal(S.committeeDocs('ではない'), null);
  assert.equal(S.committeeDocs(null), null);
  assert.equal(S.committeeDocs(undefined), null);
  assert.equal(S.committeeDocs(1), null);
  assert.equal(S.committeeDocs({ code: 'abuse' }), null);
  /* 人が足した委員会（表に無い code）も null＝画面は区画を出さない */
  S.setCommittees([{ code: 'x1', label: '架空の委員会', sites: ['visit'] }]);
  assert.notEqual(S.committeeOf('x1'), null);
  assert.equal(S.committeeDocs('x1'), null);
});

/* ── 4. 写しと sites の補い ─────────────────────────────────────── */

test('committeeDocs: 戻り値を壊しても2回目は変わらない（docs・sites・meet とも写し）', () => {
  const S = fresh();
  ALL14.forEach((code) => {
    const a = S.committeeDocs(code);
    const want = JSON.stringify(a);
    const n = a.docs.length;
    if (a.docs[0]) { a.docs[0].sites.push('ではない'); a.docs[0].name = '壊した'; }
    a.docs.length = 0;
    a.meet.freq = '壊した';
    const b = S.committeeDocs(code);
    assert.equal(b.docs.length, n, code);
    assert.equal(JSON.stringify(b), want, code);
  });
  /* 補った sites が委員会マスタの配列そのものでないこと（壊してもマスタは崩れない） */
  const before = JSON.stringify(S.committeeOf('abuse').sites);
  S.committeeDocs('abuse').docs[0].sites.length = 0;
  assert.equal(JSON.stringify(S.committeeOf('abuse').sites), before);
});

test('committeeDocs: sites を書かない書類は委員会の対象事業所、書いた書類はその値', () => {
  const S = fresh();
  const ab = S.committeeDocs('abuse').docs;
  assert.deepEqual(ab[0].sites, ['facility', 'visit', 'day']);           /* 指針＝委員会と同じ */
  const reg = ab.filter((d) => d.name === '運営規程への虐待防止措置の記載')[0];
  assert.deepEqual(reg.sites, ['visit', 'day']);                         /* 書いてある値 */
  S.committeeDocs('accident').docs.forEach((d) => assert.deepEqual(d.sites, ['facility']));
  S.committeeDocs('fire').docs.forEach((d) => assert.deepEqual(d.sites, ['facility', 'day']));
  /* 生産性向上委員会は対象事業所が無い＝書類の対象も空（体制の警告を出さないのと同じ） */
  S.committeeDocs('safety').docs.forEach((d) => assert.deepEqual(d.sites, []));
});

test('committeeDocs: 開催の条件は §B の値、見出し語の順（回数・出席・開き方・議事録・周知・保存）', () => {
  const S = fresh();
  const m = S.committeeDocs('accident').meet;
  assert.equal(m.freq, '定期的（年4回程度で運用）');
  assert.equal(m.keep, '5年保存（熊本市）');
  /* 無いものは「—」 */
  assert.equal(S.committeeDocs('fire').meet.notify, '—');
  assert.equal(S.committeeDocs('fire').meet.keep, '—');
  assert.equal(S.committeeDocs('hygiene').meet.method, '—');
});

/* ── 6. 事故発生防止の担当者 ─────────────────────────────────────── */

test('committeeStats: 事故発生防止は担当者が空なら「指導指針の要件です」の注意を出す', () => {
  const S = fresh();
  const warnOf = (rows) => S.committeeStats(rows, ASOF).find((x) => x.code === 'accident').warn;
  /* 委員長あり・担当者なし */
  const w1 = warnOf([row('A', [{ code: 'accident', role: 'chair' }])]);
  assert.ok(w1.indexOf(OFFICER_GUIDE) >= 0, JSON.stringify(w1));
  assert.equal(w1.indexOf('委員長が決まっていません'), -1);
  assert.equal(w1.indexOf('担当者が決まっていません（減算の要件です）'), -1);   /* 減算は無い＝減算の文面は出さない */
  /* 担当者あり */
  const w2 = warnOf([row('A', [{ code: 'accident', role: 'chair' }]), row('B', [{ code: 'accident', role: 'officer' }])]);
  assert.equal(w2.indexOf(OFFICER_GUIDE), -1, JSON.stringify(w2));
  assert.deepEqual(w2, []);
  /* 委員長なし */
  const w3 = warnOf([row('B', [{ code: 'accident', role: 'officer' }])]);
  assert.ok(w3.indexOf('委員長が決まっていません') >= 0, JSON.stringify(w3));
  assert.equal(w3.indexOf(OFFICER_GUIDE), -1);
  /* 誰もいない */
  const w4 = warnOf([]);
  assert.deepEqual(w4, ['委員長が決まっていません', '委員が1人もいません', OFFICER_GUIDE]);
  /* 対象外（inactive）にした時は出さない */
  const list = S.committees().map((c) => Object.assign({}, c, { inactive: c.code === 'accident' }));
  S.setCommittees(list);
  assert.deepEqual(warnOf([]), []);
});

test('committeeStats: 指導指針の注意は事故発生防止だけ（他の13件には出ない）', () => {
  const S = fresh();
  S.committeeStats([], ASOF).forEach((c) => {
    if (c.code !== 'accident') assert.equal(c.warn.indexOf(OFFICER_GUIDE), -1, c.code);
  });
  /* 選任4件は委員会ではない＝委員長・委員の注意は出さない */
  ['complaint', 'privacy', 'harassment', 'fire'].forEach((code) => {
    const w = S.committeeStats([], ASOF).find((x) => x.code === code).warn;
    assert.equal(w.indexOf('委員長が決まっていません'), -1, code);
    assert.equal(w.indexOf('委員が1人もいません'), -1, code);
  });
  assert.deepEqual(S.committeeStats([], ASOF).find((x) => x.code === 'fire').warn, ['要確認（法令上の扱いを確かめてください）']);
});

test('setCommittees: 独自の委員会と同じ名前の既定は足さない（「同じ名前が2つあります」で保存が止まるのを防ぐ）', () => {
  const S = fresh();
  const old9 = S.COMMITTEE_DEFAULTS.slice(0, 9).map((c) => JSON.parse(JSON.stringify(c)));
  const fireLabel = S.COMMITTEE_DEFAULTS.find((c) => c.code === 'fire').label;
  S.setCommittees(old9.concat([{ code: 'c_fire1', label: fireLabel, sites: [] }]));
  const list = S.committees();
  const labels = list.map((c) => c.label);
  assert.equal(new Set(labels).size, labels.length, '同じ名前が無い');
  assert.equal(list.some((c) => c.code === 'fire'), false, '既定 fire は足さない');
  assert.ok(list.some((c) => c.code === 'c_fire1'), '独自の委員会は残る');
  assert.deepEqual(list.slice(10).map((c) => c.code), ['accident', 'complaint', 'privacy', 'harassment']);
});
