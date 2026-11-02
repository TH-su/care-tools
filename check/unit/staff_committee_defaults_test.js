/* 職員マスタの委員会の「出荷時の既定」を、施設情報の法人設定（corpSettings.committeeDefaults）で差し替える試験
   （2026-11-02 新設・代表者の決定 判断5「今の既定は残し、上書きできるようにする」）
   実行: node check/unit/staff_committee_defaults_test.js
   対象を差し替える: STAFF_CALC=/tmp/変異版.js STAFF_HTML=/tmp/変異版.html node check/unit/staff_committee_defaults_test.js（変異試験用）

   守ること:
     1. 鍵が無い（null・undefined・書いていない）時は、委員会の一覧も「既定に戻す」の既定も今と1字も変わらない
     2. 正しい鍵 → 既定（localDefaults）がその値になり、サーバーのマスタを受け取った後も「既定が正」の項目はその値
     3. 1件でも崩れていれば丸ごと捨てて今の既定を使う（配列でない・空・件数違い・code の重複や組の違い・種別違い・
        文字数の上限超え・型違い・知らない項目など）
     4. 所在自治体の置き換えは差し替えた既定の上に当てる。鍵を消せば今の既定に戻る
     5. 画面が施設情報の committeeDefaults を、所在自治体と同じ時点で計算部品へ渡す
   ★このファイルは公開リポジトリの check/unit にある。氏名・施設名は使わない（値は「見本」「架空」で作る）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CALC_PATH = process.env.STAFF_CALC || path.join(ROOT, 'staff-master-calc.js');
const FAC_PATH = path.join(ROOT, 'su-facility.js');
const HTML = fs.readFileSync(process.env.STAFF_HTML || path.join(ROOT, 'staff-master.html'), 'utf8');
const PROFILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'facility-profile.sample.json'), 'utf8'));

let pass = 0, fail = 0;
function t(name, fn, info) {
  let ok = false, err = null;
  try { ok = !!fn(); } catch (e) { err = String(e && e.message || e); }
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (err ? '  → 例外: ' + err : (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 300) : ''))); }
}
function fresh() { delete require.cache[require.resolve(CALC_PATH)]; return require(CALC_PATH); }
const J = (v) => JSON.stringify(v);
const BASE = fresh();
const BASE_LIST = J(BASE.committees());
const BASE_DEF = J(BASE.localDefaults());
/* サーバーの返し方（staff-api.gs は保存が無くても既定の9件を全項目つきで返す） */
const serverShaped = () => JSON.parse(J(BASE.COMMITTEE_DEFAULTS));
/* 見本の差し替え: 今の既定の写しに、架空の文面を当てる */
function sample() {
  const a = JSON.parse(J(BASE.COMMITTEE_DEFAULTS));
  const by = {}; a.forEach(d => { by[d.code] = d; });
  by.abuse.label = '見本の虐待防止委員会';
  by.abuse.basis = '見本の根拠（架空）';
  by.abuse.purpose = '見本の目的（架空）';
  by.abuse.url = 'https://example.invalid/sample';
  by.kondan.kind = 'plan';
  by.kondan.sites = ['day'];
  by.kondan.hasPenalty = true;
  by.kondan.penalty = '見本の減算（架空）';
  by.hygiene.todoNote = '見本の確認事項（架空）';
  return a;
}
/* 崩れた差し替えは「変えない（false）・既定も一覧も今のまま」になる */
function rejects(name, v) {
  const C = fresh();
  t('崩れ: ' + name + ' → 丸ごと捨てて今の既定', () => C.setLocality({ committeeDefaults: v }) === false
    && J(C.localDefaults()) === BASE_DEF && J(C.committees()) === BASE_LIST);
}
function mutate(fn) { const a = sample(); fn(a); return a; }

console.log('\n— 1. 鍵が無い時は今のまま —');
{
  const C = fresh();
  t('鍵なし（{}）→ 変えない（false）', () => C.setLocality({}) === false);
  t('鍵が null → 変えない', () => C.setLocality({ committeeDefaults: null }) === false);
  t('鍵が undefined → 変えない', () => C.setLocality({ municipality: '', committeeDefaults: undefined }) === false);
  t('既定（localDefaults）は今と同じ', () => J(C.localDefaults()) === BASE_DEF);
  t('一覧（committees）も今と同じ', () => J(C.committees()) === BASE_LIST);
  t('サーバーのマスタを受け取った後も今と同じ', () => {
    const K = fresh(); K.setCommittees(serverShaped());
    const L = fresh(); L.setLocality({ committeeDefaults: null }); L.setCommittees(serverShaped());
    return J(K.committees()) === J(L.committees());
  });
}

console.log('\n— 2. 正しい鍵はその値 —');
{
  t('前提: 見本は架空の文面で、今の既定と違う', () => J(sample()) !== J(BASE.COMMITTEE_DEFAULTS));
  const C = fresh();
  t('正しい鍵 → 変える（true）', () => C.setLocality({ committeeDefaults: sample() }) === true);
  const d = {}; C.localDefaults().forEach(x => { d[x.code] = x; });
  t('既定（localDefaults）がその値（名前・根拠・目的・URL）', () => d.abuse.label === '見本の虐待防止委員会' && d.abuse.basis === '見本の根拠（架空）'
    && d.abuse.purpose === '見本の目的（架空）' && d.abuse.url === 'https://example.invalid/sample', d.abuse);
  t('既定（localDefaults）がその値（種別・対象事業所・減算・確認事項）', () => d.kondan.kind === 'plan' && J(d.kondan.sites) === J(['day'])
    && d.kondan.hasPenalty === true && d.kondan.penalty === '見本の減算（架空）' && d.hygiene.todoNote === '見本の確認事項（架空）', d.kondan);
  t('件数と並びは今の既定と同じ9件', () => J(C.localDefaults().map(x => x.code)) === J(BASE.COMMITTEE_DEFAULTS.map(x => x.code)));
  t('サーバーのマスタを受け取る前の一覧もその値', () => C.committees().find(x => x.code === 'abuse').label === '見本の虐待防止委員会');
  t('同じ値をもう一度 → 変えない（false＝描き直さない）', () => C.setLocality({ committeeDefaults: sample() }) === false);
  t('写しを返す（呼び手が書き換えても既定は崩れない）', () => { C.localDefaults()[0].sites.push('cm'); return J(C.localDefaults()[0].sites) === J(d.abuse.sites); });
  t('説明の欄（_ で始まる項目）は読み飛ばして受け入れる', () => {
    const E = fresh(); const a = sample(); a[0]._note = '見本の説明';
    return E.setLocality({ committeeDefaults: a }) === true && E.localDefaults()[0]._note === undefined;
  });
  t('今の既定そのままを書いても受け入れる（形の確かめが今の既定を断らない）', () => {
    const E = fresh(); return E.setLocality({ committeeDefaults: serverShaped() }) === true && J(E.localDefaults()) === BASE_DEF;
  });
  t('並びは書いた順', () => {
    const E = fresh(); const a = sample().reverse();
    return E.setLocality({ committeeDefaults: a }) === true && E.localDefaults()[0].code === 'hygiene';
  });
}
{
  const C = fresh();
  C.setLocality({ committeeDefaults: sample() });
  C.setCommittees(serverShaped());
  const by = {}; C.committees().forEach(x => { by[x.code] = x; });
  t('サーバーのマスタを受け取った後: 「既定が正」の項目（根拠・目的・種別・対象・減算・確認事項）はその値',
    () => by.abuse.basis === '見本の根拠（架空）' && by.abuse.purpose === '見本の目的（架空）' && by.kondan.kind === 'plan'
      && J(by.kondan.sites) === J(['day']) && by.kondan.hasPenalty === true && by.hygiene.todoNote === '見本の確認事項（架空）', [by.abuse, by.kondan]);
  t('サーバーのマスタを受け取った後: 名前・URL はサーバーの値（保存値を書き換えない・今と同じ）',
    () => by.abuse.label === BASE.COMMITTEE_DEFAULTS[0].label && by.abuse.url === BASE.COMMITTEE_DEFAULTS[0].url, by.abuse);
  t('件数はサーバーと同じ9件（知らない委員会を足さない）', () => C.committees().length === BASE.COMMITTEE_DEFAULTS.length);
  const D = fresh();
  D.setCommittees(serverShaped());
  t('先にサーバーのマスタ → 後から施設情報でも同じ規則で当て直す',
    () => D.setLocality({ committeeDefaults: sample() }) === true && D.committees().find(x => x.code === 'abuse').basis === '見本の根拠（架空）');
}

console.log('\n— 3. 崩れていれば丸ごと捨てる —');
rejects('配列でない（オブジェクト）', { abuse: sample()[0] });
rejects('配列でない（文字列）', '見本');
rejects('空の配列', []);
rejects('足りない（8件）', sample().slice(1));
rejects('多い（9件＋知らない委員会）', mutate(a => a.push(Object.assign({}, a[0], { code: 'sample_extra', label: '見本の追加' }))));
rejects('知らない code に置き換えた（9件のまま）', mutate(a => { a[8].code = 'sample_x'; }));
rejects('code の重複', mutate(a => { a[8].code = a[0].code; }));
rejects('code が文字列でない（配列）', mutate(a => { a[0].code = [a[0].code]; }));
rejects('code が無い', mutate(a => { delete a[0].code; }));
rejects('要素が null', mutate(a => { a[3] = null; }));
rejects('要素が文字列', mutate(a => { a[3] = 'abuse'; }));
rejects('知らない項目', mutate(a => { a[0].sampleKey = '見本'; }));
rejects('名前が文字列でない', mutate(a => { a[0].label = 5; }));
rejects('名前が空白だけ', mutate(a => { a[0].label = '   '; }));
rejects('名前が61字', mutate(a => { a[0].label = '見'.repeat(61); }));
rejects('名前の重複', mutate(a => { a[1].label = a[0].label; }));
rejects('種別が COMMITTEE_KINDS に無い', mutate(a => { a[0].kind = 'sample'; }));
rejects('種別に空白が付いている', mutate(a => { a[0].kind = ' plan'; }));
rejects('種別が無い', mutate(a => { delete a[0].kind; }));
rejects('対象事業所が配列でない', mutate(a => { a[0].sites = 'facility'; }));
rejects('対象事業所に知らない事業所', mutate(a => { a[0].sites = ['facility', 'sample']; }));
rejects('対象事業所の重複', mutate(a => { a[0].sites = ['facility', 'facility']; }));
rejects('根拠が201字', mutate(a => { a[0].basis = '見'.repeat(201); }));
rejects('根拠が文字列でない', mutate(a => { a[0].basis = ['見本']; }));
rejects('いつからが201字（最後の文の項目）', mutate(a => { a[0].startedAt = '見'.repeat(201); }));
rejects('URL が https/http でない', mutate(a => { a[0].url = 'javascript:alert(1)'; }));
rejects('URL が301字', mutate(a => { a[0].url = 'https://example.invalid/' + 'a'.repeat(301 - 24); }));
rejects('URL が文字列でない', mutate(a => { a[0].url = 1; }));
rejects('当事業所が始めた月が41字', mutate(a => { a[0].siteStartedAt = '見'.repeat(41); }));
rejects('当事業所が始めた月が文字列でない', mutate(a => { a[0].siteStartedAt = 2024; }));
rejects('減算の有無が真偽でない', mutate(a => { a[0].hasPenalty = 'true'; }));
rejects('要確認が真偽でない', mutate(a => { a[0].todo = 1; }));
rejects('対象外が真偽でない', mutate(a => { a[0].inactive = 'false'; }));
{
  const C = fresh();
  t('上限ちょうど（名前60字・文200字・URL300字・月40字）は受け入れる', () => C.setLocality({ committeeDefaults: mutate(a => {
    a[0].label = '見'.repeat(60); a[0].basis = '見'.repeat(200); a[0].url = 'https://example.invalid/' + 'a'.repeat(300 - 24); a[0].siteStartedAt = '見'.repeat(40);
  }) }) === true);
  const D = fresh();
  D.setLocality({ committeeDefaults: sample() });
  t('受け入れた後に崩れた値が来たら今の既定へ戻す（true）', () => D.setLocality({ committeeDefaults: [] }) === true && J(D.localDefaults()) === BASE_DEF && J(D.committees()) === BASE_LIST);
}

console.log('\n— 4. 所在自治体との重ね方・鍵を消した時 —');
{
  const KUMA_NAME = '熊本市有料老人ホーム設置運営指導指針';
  const C = fresh();
  const a = mutate(x => { x[0].purpose = KUMA_NAME + 'による見本の目的'; });
  t('所在自治体と同時 → 変える', () => C.setLocality({ municipality: '試験市', homeGuidelineName: '見本指針', homeGuidelineUrl: 'https://example.invalid/g', committeeDefaults: a }) === true);
  t('差し替えた既定の上に所在自治体の名前を当てる', () => C.localDefaults()[0].purpose === '見本指針による見本の目的', C.localDefaults()[0].purpose);
  t('所在自治体が同じで鍵だけ変わっても当て直す', () => C.setLocality({ municipality: '試験市', homeGuidelineName: '見本指針', homeGuidelineUrl: 'https://example.invalid/g', committeeDefaults: sample() }) === true
    && C.localDefaults()[0].purpose === '見本の目的（架空）');
  const D = fresh();
  D.setLocality({ committeeDefaults: sample() });
  t('鍵を消すと今の既定に戻る（true・一覧も既定も今と同じ）', () => D.setLocality({}) === true && J(D.localDefaults()) === BASE_DEF && J(D.committees()) === BASE_LIST);
  t('サーバーと照合する既定（COMMITTEE_DEFAULTS）は書き換えない', () => J(D.COMMITTEE_DEFAULTS) === J(BASE.COMMITTEE_DEFAULTS));
}

console.log('\n— 5. 施設情報の読み口と画面のつなぎ —');
function loadFacility(profile) {
  const store = { su_facility_json_v1: JSON.stringify(profile) };
  const sb = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: () => new Promise(() => {}), console
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(FAC_PATH, 'utf8'), sb);
  return sb.window.SUFacility;
}
{
  const base = JSON.parse(JSON.stringify(PROFILE));
  t('公開している見本（facility-profile.sample.json）には committeeDefaults の値が無い＝今の既定', () => loadFacility(base).section('committeeDefaults') === null);
  t('見本に committeeDefaults の説明がある', () => typeof base.corpSettings._noteCommitteeDefaults === 'string' && /committeeDefaults/.test(base.corpSettings._noteCommitteeDefaults));
  base.corpSettings.committeeDefaults = sample();
  const F = loadFacility(base);
  t('施設情報の読み口が法人設定の committeeDefaults を返す', () => J(F.section('committeeDefaults')) === J(sample()));
  const C = fresh();
  t('読み口の値をそのまま計算部品へ渡せる', () => C.setLocality({ municipality: F.municipality(), committeeDefaults: F.section('committeeDefaults') }) === true
    && C.localDefaults()[0].basis === '見本の根拠（架空）');
  const fn = HTML.slice(HTML.indexOf('function applyLocalityNow()'), HTML.indexOf('function loadCommittees()'));
  t('画面: 所在自治体と同じ時点（applyLocalityNow）で committeeDefaults を読む', () => /SUFacility\.section\('committeeDefaults'\)/.test(fn));
  t('画面: 読んだ値を setLocality に渡す', () => /setLocality\(\{[^}]*committeeDefaults: cd \}\)/.test(fn));
  t('画面: 読み口の無い古い施設情報部品では null（今の既定）', () => /typeof window\.SUFacility\.section === 'function' \? window\.SUFacility\.section\('committeeDefaults'\) : null/.test(fn));
  t('画面:「既定に戻す」は localDefaults を引く（差し替えた既定が効く）', () => /SC\(\)\.localDefaults\(\)/.test(HTML.slice(HTML.indexOf('function cmtShippedOf('), HTML.indexOf('function cmtShippedOf(') + 400)));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
