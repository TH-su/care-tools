/* 採用管理の事業所の区分の名前を施設情報（corpSettings.siteLabels）から差し替える試験（2026-11-14 新設・代表者の決定 2026-11-14・職員マスタ #591 の続き）
   実行: node check/unit/ats_site_labels_test.js

   守ること:
     (1) 施設情報に書いていない・崩れている時は、今の3つの名前（施設・訪問・通所）のまま・false を返す（画面に触らない）
     (2) 確かめは職員マスタと同じ（staff-master-calc.js の normSiteLabels）。4つ全部がそろい、CSV の見出しの語（事業所・備考・厨房など）や
         ほかの区分の今の名前と重ならない時だけ差し替え、1つでも崩れていれば丸ごと今の名前。職員マスタが受け付ける値と受け付けない値が同じ
     (3) 差し替えるのは名前だけ。職員マスタへ送る値（fields）とその指紋（sentKey）・コード・必須の判定は変えない
     (4) 登録の確認の表の「職員マスタの欄」は職員マスタの区分の名前と同じ（今の施設では「施設・訪問・通所」のまま）
     (5) 画面は施設情報が届いた時に当て、開いている入職準備は描き直さず文字だけ替える（チェックの状態・選んだ主所属は残す）
   ★このファイルは公開リポジトリの check/unit にある。氏名・施設名は使わない（架空の区分名と架空の応募者だけ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const ATS_PATH = path.join(ROOT, 'ats-calc.js');
const SMC_PATH = path.join(ROOT, 'staff-master-calc.js');
const HTML = fs.readFileSync(path.join(ROOT, 'ats.html'), 'utf8');

let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 300) : '')); }
}
function fresh() {
  delete require.cache[require.resolve(ATS_PATH)];
  delete require.cache[require.resolve(SMC_PATH)];
  return { A: require(ATS_PATH), S: require(SMC_PATH) };
}
const DEF3 = { facility: '施設', visit: '訪問', day: '通所' };
const NEW = { facility: 'ホーム', visit: '訪問介護', day: 'デイ', cm: '居宅支援' };
const APPLICANT = {
  name: '甲野 一郎', start_on: '2026-12-01',
  prep: { employmentType: 'regular', workStyle: 'full_con', sites: { facility: true, day: true }, primarySite: 'day', hireDate: '2026-12-01' }
};
const ENUMS = { employmentType: [{ code: 'regular', label: '正社員' }], qualCodes: [] };

say('\n— (1) 書いていない・崩れている時は今の名前のまま —');
{
  const { A } = fresh();
  t('今の名前は施設・訪問・通所', JSON.stringify(A.SITE_LABEL) === JSON.stringify(DEF3));
  [null, undefined, {}, [], '施設', 1].forEach(function (v) {
    t('値 ' + JSON.stringify(v) + ' → false・変えない', A.setSiteLabels(v) === false && JSON.stringify(A.SITE_LABEL) === JSON.stringify(DEF3));
  });
}

say('\n— (2) 職員マスタと同じ確かめで差し替える —');
{
  const { A } = fresh();
  t('4つそろえば true', A.setSiteLabels(NEW) === true);
  t('採用管理の3つだけが替わる（居宅は持たない）', JSON.stringify(A.SITE_LABEL) === JSON.stringify({ facility: 'ホーム', visit: '訪問介護', day: 'デイ' }), A.SITE_LABEL);
  t('同じ値をもう一度 → false', A.setSiteLabels(JSON.parse(JSON.stringify(NEW))) === false);
  t('居宅の名前だけ違っても採用管理の3つが同じなら false', A.setSiteLabels(Object.assign({}, NEW, { cm: 'ケアプラン' })) === false);
  t('崩れた値を受けたら丸ごと今の名前へ戻す（true）', A.setSiteLabels({ facility: 'ホーム' }) === true && JSON.stringify(A.SITE_LABEL) === JSON.stringify(DEF3));
  const bad = [
    { facility: 'ホーム', visit: '訪問介護', day: 'デイ' },                       /* 居宅が無い（4つ全部が要る） */
    Object.assign({}, NEW, { day: '' }),
    Object.assign({}, NEW, { day: 'デイサービス本館' }),                          /* 7字 */
    Object.assign({}, NEW, { day: 'デ<i>' }),
    Object.assign({}, NEW, { day: 'ホーム' }),                                    /* 重なり */
    Object.assign({}, NEW, { facility: '事業所' }),                               /* CSV の見出しの語 */
    Object.assign({}, NEW, { day: '備考' }),
    Object.assign({}, NEW, { day: '厨房' }),
    Object.assign({}, NEW, { facility: '訪問' }),                                 /* ほかの区分の今の名前 */
    Object.assign({}, NEW, { day: 3 })
  ];
  bad.forEach(function (v) {
    const r = fresh();
    t('崩れた値 ' + JSON.stringify(v) + ' → 今の名前のまま', r.A.setSiteLabels(v) === false && JSON.stringify(r.A.SITE_LABEL) === JSON.stringify(DEF3));
    t('  同じ値を職員マスタも受け付けない', r.S.normSiteLabels(v) === null);
  });
  const r2 = fresh();
  t('自分の区分の今の名前はそのまま使える（職員マスタと同じ）', r2.A.setSiteLabels(Object.assign({}, NEW, { day: '通所' })) === true && r2.A.SITE_LABEL.day === '通所' && r2.S.normSiteLabels(Object.assign({}, NEW, { day: '通所' })) !== null);
  const r3 = fresh();
  t('前後の空白は職員マスタと同じく落とす', r3.A.setSiteLabels({ facility: ' ホーム ', visit: '訪問介護', day: 'デイ', cm: '居宅支援' }) === true && r3.A.SITE_LABEL.facility === 'ホーム');
}

say('\n— (3)(4) 送る値は変えず、確認の表の文字だけ替わる —');
{
  const { A } = fresh();
  const b0 = A.buildStaffCreate(APPLICANT, ENUMS);
  const row0 = b0.rows.filter((x) => x.label === '所属事業所')[0];
  const prim0 = b0.rows.filter((x) => x.label === '主所属')[0];
  t('今の施設: 所属事業所の行は「施設・通所」→「施設・訪問・通所」', row0 && row0.value === '施設・通所' && row0.target === '施設・訪問・通所', row0);
  t('今の施設: 主所属は「通所」', prim0 && prim0.value === '通所');
  A.setSiteLabels(NEW);
  const b1 = A.buildStaffCreate(APPLICANT, ENUMS);
  const row1 = b1.rows.filter((x) => x.label === '所属事業所')[0];
  const prim1 = b1.rows.filter((x) => x.label === '主所属')[0];
  t('差し替え後: 所属事業所の値と職員マスタの欄が新しい名前', row1 && row1.value === 'ホーム・デイ' && row1.target === 'ホーム・訪問介護・デイ', row1);
  t('差し替え後: 主所属は「デイ」', prim1 && prim1.value === 'デイ');
  t('送る値（fields）は同じ', JSON.stringify(b0.fields) === JSON.stringify(b1.fields), b1.fields);
  t('送る値の指紋（sentKey）も同じ', A.sentKey(b0.fields) === A.sentKey(b1.fields));
  t('必須の判定・登録できるかは同じ', b0.ready === b1.ready && JSON.stringify(b0.missing) === JSON.stringify(b1.missing));
  t('コードは同じ3つ', JSON.stringify(Object.keys(A.SITE_LABEL)) === JSON.stringify(['facility', 'visit', 'day']));
  /* 職員マスタの欄の名前と同じ（職員マスタの計算部品にも同じ施設情報を当てて比べる） */
  const r = fresh();
  r.A.setSiteLabels(NEW); r.S.setSiteLabels(NEW);
  t('職員マスタの区分の名前と同じ', ['facility', 'visit', 'day'].every((c) => r.A.SITE_LABEL[c] === r.S.SITE_LABEL[c]));
}

say('\n— (5) 画面: 施設情報が届いたら文字だけ替える —');
{
  const m = /\nfunction applySiteLabels_\(\)\{[\s\S]*?\n\}\n/.exec(HTML);
  t('画面に applySiteLabels_ がある', !!m);
  t('施設情報が届いた時に当てる（onReady）', /SUFacility\.onReady\(applySiteLabels_\)/.test(HTML));
  t('施設情報の読み口は siteLabels', /section\('siteLabels'\)/.test(HTML));
  t('ats-calc.js の版を上げた', /ats-calc\.js\?v=2026-11-14"/.test(HTML));
  const smv = /staff-master-calc\.js\?v=([^"]+)"/.exec(HTML);
  t('職員マスタの計算部品（normSiteLabels のある版）を ats-calc.js より前に読む',
    smv && /normSiteLabels/.test(fs.readFileSync(SMC_PATH, 'utf8')) && HTML.indexOf('staff-master-calc.js?v=') < HTML.indexOf('ats-calc.js?v='));
  if (m) {
    /* 入職準備を開いている所を偽物の DOM で作る */
    function textNode(v) { return { nodeType: 3, nodeValue: v }; }
    const els = {}, sel = { options: [] };
    Object.keys(DEF3).forEach(function (k) {
      const label = { children: [] };
      const input = { id: 'p-site-' + k, checked: k === 'day', parentNode: label };
      const txt = textNode(DEF3[k]);
      input.nextSibling = txt;
      label.appendChild = function (n) { label.children.push(n); };
      els['p-site-' + k] = input;
      els['txt-' + k] = txt;
      sel.options.push({ value: k, textContent: DEF3[k] });
    });
    sel.value = 'day';
    els['p-primary'] = sel;
    const notes = [];
    function run(section) {
      const r = fresh();
      const ctx = {
        AtsCalc: r.A,
        $: (id) => els[id] || null,
        document: { createTextNode: textNode },
        atsNote_: (w, e) => notes.push(w),
        window: { SUFacility: { section: (n) => (n === 'siteLabels' ? section : null) } }
      };
      vm.createContext(ctx);
      vm.runInContext(m[0] + '\napplySiteLabels_();', ctx);
      return r.A;
    }
    run(undefined);
    t('書いていない施設: 文字は今のまま', els['txt-facility'].nodeValue === '施設' && sel.options[2].textContent === '通所');
    run({ facility: 'ホーム' });
    t('崩れた施設情報: 文字は今のまま', els['txt-facility'].nodeValue === '施設' && sel.options[0].textContent === '施設');
    run(NEW);
    t('差し替え: チェックの名前', els['txt-facility'].nodeValue === 'ホーム' && els['txt-visit'].nodeValue === '訪問介護' && els['txt-day'].nodeValue === 'デイ');
    t('差し替え: 主所属の選択肢', sel.options.map((o) => o.textContent).join('/') === 'ホーム/訪問介護/デイ');
    t('チェックの状態・選んだ主所属・値は残す', els['p-site-day'].checked === true && els['p-site-facility'].checked === false && sel.value === 'day' && sel.options.map((o) => o.value).join('/') === 'facility/visit/day');
    t('エラーの記録なし', notes.length === 0, notes);
  }
}

say('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格・' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
