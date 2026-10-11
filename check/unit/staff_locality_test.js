/* 職員マスタの委員会の「熊本市基準」を所在自治体と法人設定から決める試験（2026-10-11 新設・監査10月版 第2版 10）
   実行: node check/unit/staff_locality_test.js
   対象を差し替える: STAFF_CALC=/tmp/変異版.js SU_FACILITY=/tmp/変異版.js node check/unit/staff_locality_test.js（変異試験用）

   守ること:
     ①未設定（施設情報が読めない・municipality が空）と熊本市は、委員会の一覧が今と1字も変わらない
     ②熊本市以外で法人設定が空 → 熊本の文字を1つも出さず、一般名「所在自治体の…」・案内ページ空・要確認
     ③法人設定に名称と URL があればそれを使う（https:// だけ受ける）
     ④サーバーの既定（COMMITTEE_DEFAULTS）は熊本市の文言のまま（staff-api.gs と1字一句そろえる約束）
     ⑤サーバーのマスタを受け取った後に所在自治体が分かっても、同じ規則で当て直す・人が書き換えた URL は残す
     ⑥施設情報の読み口（su-facility.js）が法人設定を読み、https:// 以外の URL は捨てる
     ⑦職員マスタの画面が施設情報を読み、起動時に当てる（計算部品の版と ?v= がそろう）
   ★このファイルは公開リポジトリの check/unit にある。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CALC_PATH = process.env.STAFF_CALC || path.join(ROOT, 'staff-master-calc.js');
const FAC_PATH = process.env.SU_FACILITY || path.join(ROOT, 'su-facility.js');
const HTML = fs.readFileSync(path.join(ROOT, 'staff-master.html'), 'utf8');
const PROFILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'facility-profile.json'), 'utf8'));

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 300) : '')); }
}
function fresh() { delete require.cache[require.resolve(CALC_PATH)]; return require(CALC_PATH); }
const KUMA_URL = 'https://www.city.kumamoto.jp/kiji0032329/index.html';

console.log('\n— ① 未設定・熊本市は今のまま —');
{
  const C = fresh();
  const base = JSON.stringify(C.committees());
  const baseDef = JSON.stringify(C.localDefaults());
  t('施設情報が空 → 変えない（false）', C.setLocality({}) === false && JSON.stringify(C.committees()) === base);
  t('municipality が空文字 → 変えない', C.setLocality({ municipality: '', homeGuidelineName: '', homeGuidelineUrl: '' }) === false);
  t('熊本市 → 変えない', C.setLocality({ municipality: '熊本市' }) === false && JSON.stringify(C.committees()) === base);
  t('既定に戻す用の既定（localDefaults）も今のまま', JSON.stringify(C.localDefaults()) === baseDef);
  t('熊本市の時は熊本市の指針と案内ページが出る',
    C.committees().find(c => c.code === 'restraint').purpose === '熊本市有料老人ホーム設置運営指導指針による義務'
    && C.committees().find(c => c.code === 'kondan').url === KUMA_URL);
  t('今の所在地の情報: 熊本市・既定のまま', C.locality().isDefault === true && C.locality().municipality === '熊本市');
}

console.log('\n— ② 熊本市以外・法人設定が空 —');
{
  const C = fresh();
  const raw = JSON.stringify(C.COMMITTEE_DEFAULTS);
  t('福岡市 → 変える（true）', C.setLocality({ municipality: '福岡市' }) === true);
  const list = C.committees(), all = JSON.stringify(list) + JSON.stringify(C.localDefaults());
  t('一覧にも既定にも「熊本」が1つも無い', all.indexOf('熊本') < 0, all.match(/.{20}熊本.{20}/g));
  const by = {}; list.forEach(c => { by[c.code] = c; });
  t('身体的拘束: 何のため＝一般名による義務', by.restraint.purpose === '所在自治体の有料老人ホーム設置運営指導指針による義務', by.restraint.purpose);
  t('身体的拘束: 案内ページは空・要確認を付け、何を確かめるかを書く',
    by.restraint.url === '' && by.restraint.todo === true && /法人設定/.test(by.restraint.todoNote), by.restraint);
  t('運営懇談会: いつから＝一般名・案内ページ空・要確認',
    by.kondan.startedAt === '確認できず（所在自治体の有料老人ホーム設置運営指導指針）' && by.kondan.url === '' && by.kondan.todo === true, by.kondan);
  t('虐待防止: 条文の部分はそのまま・指針の部分だけ一般名・e-Gov の URL は残す',
    by.abuse.basis === '居宅基準 第37条の2（訪問）／第105条で準用（通所）／所在自治体の有料老人ホーム設置運営指導指針'
    && /e-gov\.go\.jp/.test(by.abuse.url) && /所在自治体の指針が根拠/.test(by.abuse.startedAt), by.abuse);
  t('生産性向上: 確認先は施設のある市（福岡市に確認）・もともとの要確認は残す',
    /福岡市に確認してください/.test(by.safety.todoNote) && by.safety.todo === true, by.safety.todoNote);
  t('熊本と関係の無い委員会（感染対策）は1字も変わらない',
    JSON.stringify(by.infection) === JSON.stringify(fresh().committees().find(c => c.code === 'infection')));
  t('④ サーバーと照合する既定（COMMITTEE_DEFAULTS）は熊本市の文言のまま', JSON.stringify(C.COMMITTEE_DEFAULTS) === raw && raw.indexOf('熊本市有料老人ホーム設置運営指導指針') >= 0);
  t('熊本市に戻すと今と同じ一覧に戻る', C.setLocality({ municipality: '熊本市' }) === true
    && JSON.stringify(C.committees()) === JSON.stringify(fresh().committees()));
}

console.log('\n— ③ 法人設定に名称と URL —');
{
  const C = fresh();
  C.setLocality({ municipality: '試験市', homeGuidelineName: '試験市有料老人ホーム設置運営指導指針', homeGuidelineUrl: 'https://example.invalid/guide' });
  const by = {}; C.committees().forEach(c => { by[c.code] = c; });
  t('名称と案内ページは法人設定の値', by.restraint.purpose === '試験市有料老人ホーム設置運営指導指針による義務' && by.restraint.url === 'https://example.invalid/guide', by.restraint);
  t('案内ページが分かっているので要確認は足さない', by.restraint.todo === false && by.kondan.todo === false);
  t('いつからの略称も法人設定の名称', /有料老人ホームは試験市有料老人ホーム設置運営指導指針が根拠/.test(by.restraint.startedAt), by.restraint.startedAt);
  const D = fresh();
  D.setLocality({ municipality: '試験市', homeGuidelineName: '見本指針', homeGuidelineUrl: 'javascript:alert(1)' });
  t('https:// 以外の URL は受けない（空・要確認）', D.committees().find(c => c.code === 'restraint').url === ''
    && D.committees().find(c => c.code === 'restraint').todo === true);
  const E = fresh();
  t('熊本市で名称だけ法人設定 → 名称は法人設定・案内ページは空（熊本市の URL を別の文書に付けない）',
    E.setLocality({ municipality: '熊本市', homeGuidelineName: '見本指針' }) === true
    && E.committees().find(c => c.code === 'restraint').purpose === '見本指針による義務'
    && E.committees().find(c => c.code === 'restraint').url === '');
}

console.log('\n— ⑤ サーバーのマスタを受け取った後 —');
{
  const C = fresh();
  const n = C.setCommittees([
    { code: 'restraint', label: '身体的拘束等適正化委員会', freq: '3か月に1回以上' },                 /* url のキーごと無い＝未設定 */
    { code: 'kondan', label: '運営懇談会', url: 'https://example.invalid/own' }                         /* 人が書き換えた URL */
  ]);
  t('前提: サーバーのマスタを受け取れた', n > 0);
  C.setLocality({ municipality: '福岡市' });
  const by = {}; C.committees().forEach(c => { by[c.code] = c; });
  t('受け取り済みのマスタにも一般名を当て直す（根拠・何のため）', by.restraint.purpose.indexOf('所在自治体') === 0 && by.restraint.url === '', by.restraint);
  t('人が書き換えた URL は残す', by.kondan.url === 'https://example.invalid/own', by.kondan.url);
  t('既定にしか無い委員会も足される（件数は既定と同じ）', C.committees().length === C.COMMITTEE_DEFAULTS.length);
}

console.log('\n— ⑥ 施設情報の読み口 —');
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
  const F0 = loadFacility(base);
  t('今の facility-profile.json: 法人設定は空・所在地は熊本市',
    F0.corpSettings().homeGuidelineName === '' && F0.corpSettings().homeGuidelineUrl === '' && F0.municipality() === '熊本市');
  base.corpSettings = { homeGuidelineName: '見本指針', homeGuidelineUrl: 'https://example.invalid/g' };
  const F1 = loadFacility(base);
  t('名称と https の URL を読む', F1.corpSettings().homeGuidelineName === '見本指針' && F1.corpSettings().homeGuidelineUrl === 'https://example.invalid/g');
  base.corpSettings = { homeGuidelineName: '見本指針', homeGuidelineUrl: 'http://example.invalid/g' };
  t('http:// の URL は捨てる', loadFacility(base).corpSettings().homeGuidelineUrl === '');
  delete base.corpSettings;
  t('法人設定の無い古い施設情報でも空で返す（落ちない）', loadFacility(base).corpSettings().homeGuidelineName === '');
}

console.log('\n— ⑦ 画面のつなぎ —');
{
  const C = fresh();
  const vm1 = /staff-master-calc\.js\?v=([0-9.\-]+)/.exec(HTML);
  t('計算部品の ?v= と VERSION がそろう', vm1 && vm1[1] === C.VERSION, [vm1 && vm1[1], C.VERSION]);
  t('施設情報の読み口を計算部品より前に読む', HTML.indexOf('src="su-facility.js') > 0 && HTML.indexOf('src="su-facility.js') < HTML.indexOf('src="staff-master-calc.js'));
  const init = HTML.slice(HTML.indexOf('function init()'));
  t('起動時に所在自治体を当てる（委員会の読み込みの後）', /loadCommittees\(\);[^\n]*\n\s*applyLocality\(\);/.test(init));
  t('変わった時だけ描き直す（熊本市・未設定は描き直さない）', /if \(!changed\) return;/.test(HTML.slice(HTML.indexOf('function applyLocality()'), HTML.indexOf('function loadCommittees()'))));
  t('「既定に戻す」は所在自治体を当てた既定を引く', /SC\(\)\.localDefaults\(\)/.test(HTML.slice(HTML.indexOf('function cmtShippedOf('), HTML.indexOf('function cmtShippedOf(') + 400)));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
