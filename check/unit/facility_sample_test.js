/* 施設情報を「公開は見本だけ・本番は配信の時に置く」形にしたことの試験（2026-10-14 新設・代表者の依頼）。
   守りたいこと:
     A 公開リポジトリには架空の見本 facility-profile.sample.json だけがあり、本番の facility-profile.json は git に無い
       （.gitignore の公開の許可に本番の名前が無く、見本の名前がある）
     B 見本は画面がそのまま読める形（施設・訪問・通所の3つ・階・訪問診療の医療機関）で、値は架空（見本・000-）
     C su-facility.js の visitingClinics() / clinicOf(): 書いた医療機関の name か aliases を含めば当たる。
       書いていない・壊れた値・空の名前は当たらない（空文字は何にでも当たるため捨てる）
     D デイ利用表の☆: 医療機関の名前をコードに持たず、施設情報の visitingClinics で判定する。凡例・ふきだしの名前も設定から
     E 配信（.github/workflows/pages.yml）: Secret から本番を置き、無い・壊れた・見本のままなら配らずに止める
     F 撮影・手元の確かめの道具（check/lib.mjs）は、本番が無ければ見本を返す（本番の画面は見本を読まない）
   実行: node check/unit/facility_sample_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const SAMPLE_SRC = read('facility-profile.sample.json');
const SAMPLE = JSON.parse(SAMPLE_SRC);
/* 実物の su-facility.js に、端末の控えとして設定を読ませる */
function facility(profile) {
  const box = { window: {}, console, JSON, localStorage: { getItem: k => (k === 'su_facility_json_v1' ? JSON.stringify(profile) : null), setItem() {} } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('su-facility.js'), box);
  return box.SUFacility;
}

(async () => {
  console.log('\n— A. 公開するのは見本だけ —');
  const GI = read('.gitignore');
  t('.gitignore は見本を公開の許可に入れている', /^!\/facility-profile\.sample\.json$/m.test(GI));
  t('.gitignore は本番（facility-profile.json）を公開の許可に入れていない', !/^!\/facility-profile\.json$/m.test(GI));
  let tracked = null;
  try { tracked = require('child_process').execFileSync('git', ['-C', ROOT, 'ls-files', 'facility-profile.json', 'facility-profile.sample.json'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) { tracked = null; }
  if (tracked) t('git が管理しているのは見本だけ（本番は管理の外）', tracked.length === 1 && tracked[0] === 'facility-profile.sample.json', tracked);
  else t('git が使えない環境（確かめを飛ばす）', true);

  console.log('\n— B. 見本の形と値 —');
  const F = facility(SAMPLE);
  t('画面の部品がそのまま読める（ready）', F.ready() === true);
  t('事業所は 施設・訪問・通所 の3つ', SAMPLE.offices.map(o => o.kind).sort().join() === ['施設', '訪問', '通所'].sort().join());
  t('名前は架空（法人・施設・事業所の名前がすべて「見本」を含む）',
    /見本/.test(SAMPLE.corpName) && /見本/.test(SAMPLE.facilityName) && SAMPLE.offices.every(o => /見本/.test(o.name) && /見本/.test(o.formalName)));
  t('電話は 000- で始まる架空の番号・事業所番号は 0 だけ', SAMPLE.offices.every(o => /^000-/.test(o.tel) && /^0*\d?$/.test(o.officeNo)));
  t('住所・市区町村も架空（見本）', SAMPLE.offices.every(o => /見本/.test(o.address)) && SAMPLE.municipality === '見本市');
  t('階は１階・２階（これまでの並びと同じ）', JSON.stringify(F.floors()) === JSON.stringify([{ no: 1, label: '１階' }, { no: 2, label: '２階' }]));
  t('訪問診療の医療機関を1つ書いている（書き方の手本）', F.visitingClinics().length === 1 && /見本/.test(F.visitingClinics()[0].name));
  t('間取り図も読める（各階に cells）', !!F.roomPlan() && Array.isArray(F.roomPlan().f1.cells) && Array.isArray(F.roomPlan().f2.cells));
  t('通所の名前に「デイ」を含めない（入居者マスタの通所の見分けの試験が、名前と「デイ」の語を別々に確かめるため）',
    !/デイ/.test(SAMPLE.offices.find(o => o.kind === '通所').name));

  console.log('\n— C. visitingClinics() / clinicOf() —');
  const base = JSON.parse(SAMPLE_SRC);
  base.visitingClinics = [{ name: '見本クリニック', aliases: ['見本クリ', '', '  '] }, { name: '架空医院', aliases: [] }, { name: '', aliases: ['空の名前'] }, null, { name: 'x'.repeat(41) }];
  const G = facility(base);
  t('空の名前・長すぎる名前・壊れた行は捨てる（2件だけ残る）', G.visitingClinics().map(c => c.name).join() === '見本クリニック,架空医院', G.visitingClinics());
  t('空の別名は捨てる（空文字は何にでも当たるため）', JSON.stringify(G.visitingClinics()[0].aliases) === JSON.stringify(['見本クリ']));
  t('かかりつけ欄が名前を含めば当たる', G.clinicOf('見本クリニック（内科）') === '見本クリニック');
  t('別名を含めば当たる（返すのは正式の名前）', G.clinicOf('見本クリ') === '見本クリニック');
  t('2つ目の医療機関も当たる', G.clinicOf('架空医院') === '架空医院');
  t('当たらない・空・null は空文字', G.clinicOf('ほかの病院') === '' && G.clinicOf('') === '' && G.clinicOf(null) === '');
  t('返した配列を書き換えても元は変わらない', (() => { const a = G.visitingClinics(); a[0].aliases.push('改'); a.pop(); return G.visitingClinics().length === 2 && G.visitingClinics()[0].aliases.length === 1; })());
  const none = JSON.parse(SAMPLE_SRC); delete none.visitingClinics;
  const N = facility(none);
  t('書いていなければ空の配列・何にも当たらない（☆を付けない）', N.visitingClinics().length === 0 && N.clinicOf('見本クリニック') === '');
  const broken = JSON.parse(SAMPLE_SRC); broken.visitingClinics = '見本クリニック';
  t('配列でなければ書いていない扱い', facility(broken).visitingClinics().length === 0);

  console.log('\n— D. デイ利用表の☆ —');
  const DCR = read('daycare-roster.html');
  t('デイ利用表のコードに医療機関の名前を書かない（わかば の語が無い）', !/わかば/.test(DCR));
  t('☆の判定は施設情報（dcrClinicOf_）で行う', /if \(dcrClinicOf_\(x\.hospital\) && \/\^\[月火水木金土日\]\$\/\.test\(vd\)\) vm\[String\(mid\)\] = vd;/.test(DCR));
  /* 2026-10-24（段2b）: 名簿は入口（su-roster.js）を通して読む。Google への読み取り（raw）は今までと同じ形のまま、施設情報と一緒に待つ */
  t('名簿の取得と一緒に施設情報を待つ（読めなければ☆を付けない）',
    /var raw = function\(\)\{ return SU\.data\.getRoster\(\{ endpoint: cfg\.url, token: cfg\.token \}\); \};/.test(DCR) && /return Promise\.all\(\[rosterP, suFacReady_\(\)\]\)/.test(DCR));
  const grab = name => { const s = DCR.indexOf('function ' + name + '('); const e = DCR.indexOf('\n}', s); return DCR.slice(s, e + 2); };
  const dbox = { window: {}, String };
  vm.createContext(dbox);
  vm.runInContext(['dcrOfficeName', 'dcrClinicOf_', 'dcrClinicLabel_', 'dcrFill'].map(grab).join('\n'), dbox);
  dbox.window.SUFacility = dbox.SUFacility = G;
  t('当たる医療機関の名前を返す・当たらなければ空', dbox.dcrClinicOf_('見本クリ') === '見本クリニック' && dbox.dcrClinicOf_('ほか') === '');
  t('凡例の {{訪問診療}} は設定の名前（複数は「・」でつなぐ）', dbox.dcrFill('☆＝その曜日に{{訪問診療}}の訪問診療がある方') === '☆＝その曜日に見本クリニック・架空医院の訪問診療がある方');
  dbox.window.SUFacility = dbox.SUFacility = N;
  t('書いていなければ凡例は「訪問診療の医療機関」', dbox.dcrClinicLabel_() === '訪問診療の医療機関');
  dbox.window.SUFacility = dbox.SUFacility = undefined;
  t('su-facility.js が無ければ何にも当たらない', dbox.dcrClinicOf_('見本クリニック') === '');
  t('凡例とふきだしは設定の名前を使う', /\['star', '☆＝その曜日に\{\{訪問診療\}\}の訪問診療がある方'\]/.test(DCR) && /st\.title = dcrClinicLabel_\(\) \+ ' 訪問診療';/.test(DCR) && /dcrFill\(t\)\.replace\('☆', ''\)/.test(DCR));

  console.log('\n— E. 配信（pages.yml）—');
  const Y = read('.github/workflows/pages.yml');
  t('配信の手順は公開リポジトリに入る（.gitignore の許可にある）', /^!\/\.github\/workflows\/pages\.yml$/m.test(GI));
  /* 2026-10-14 監査10月版 第4版 4: main に入った時ではなく、main の「試験」が成功した後に配る（手動の配信は残す） */
  t('main の「試験」が終わった時に動く（main への送信では直接動かない）', /on:\n  workflow_run:\n    workflows: \["試験"\]\n    types: \[completed\]\n    branches: \[main\]\n/.test(Y) && !/\n  push:/.test(Y));
  t('手動の配信（workflow_dispatch）は残す', /\n  workflow_dispatch:\n/.test(Y));
  t('配るのは試験が main への送信で成功した時だけ（PR の試験・失敗・別のリポジトリでは配らない）',
    /workflow_run\.conclusion == 'success'/.test(Y) && /workflow_run\.event == 'push'/.test(Y) && /workflow_run\.head_branch == 'main'/.test(Y) && /head_repository\.full_name == github\.repository/.test(Y));
  t('取り出すのは試験に合格した版', /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/.test(Y));
  const steps = Y.split('\n      - name: ').slice(1);
  const after = steps.slice(steps.findIndex(x => /^試験した版が今の main の先頭か/.test(x)) + 1);
  t('試験した版が main の先頭でなければ、その後の手順を全部飛ばす（古い版で上書きしない）',
    /git ls-remote origin refs\/heads\/main/.test(Y) && after.length >= 5 && after.every(x => /\n        if: steps\.head\.outputs\.go == '1'\n/.test(x)), after.length);
  t('本番の施設情報は Secret FACILITY_PROFILE_JSON から置く', /FP: \$\{\{ secrets\.FACILITY_PROFILE_JSON \}\}/.test(Y) && /printf '%s' "\$FP" > facility-profile\.json/.test(Y));
  t('Secret が無ければ止める（前の版を残す）', /if \[ -z "\$FP" \]; then[\s\S]{0,200}exit 1/.test(Y));
  /* 2026-10-26 本人指示: 判定は check/facility-secret-check.mjs の1つの関数にまとめ、公開の手順もそれを呼ぶ（中身の試験は facility_secret_check_test.js） */
  t('壊れた JSON・事業所のそろわない設定・見本のままの設定では止める（手元の道具と同じ判定を呼ぶ）',
    /\n          node check\/facility-secret-check\.mjs --github facility-profile\.json\n/.test(Y) && !/python3 - <<'PY'/.test(Y) && /^!\/check\/facility-secret-check\.mjs$/m.test(GI));
  t('配るのは git で管理しているファイル＋本番の施設情報', /git ls-files -z \| xargs -0 cp --parents/.test(Y) && /cp facility-profile\.json "\$RUNNER_TEMP\/site\/facility-profile\.json"/.test(Y));
  t('Secret の中身をログに出さない（echo "$FP" をしない）', !/echo[^\n]*\$FP/.test(Y));
  /* 2026-10-26 代表者の決定 B: Issue 機能を切ったリポジトリで Issue を立てる仕事が失敗していた。知らせは赤い×と失敗のメールだけ */
  t('失敗の知らせに Issue を使わない（仕事は deploy だけ・Issue の権限を持たない）',
    !/gh issue|issues: write|\n  notify:/.test(Y) && (Y.slice(Y.indexOf('\njobs:')).match(/^  [a-z][\w-]*:\n/mg) || []).length === 1, Y.slice(Y.indexOf('\njobs:')).match(/^  [a-z][\w-]*:\n/mg));

  console.log('\n— F. 撮影・手元の確かめの道具 —');
  const lib = await import(path.join(ROOT, 'check', 'lib.mjs'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facsample-'));
  try {
    fs.writeFileSync(path.join(tmp, 'facility-profile.sample.json'), '{"見本":1}');
    const s = await lib.startServer(tmp, 0);
    const a = await (await fetch(s.url + '/facility-profile.json')).text();
    fs.writeFileSync(path.join(tmp, 'facility-profile.json'), '{"本番":1}');
    const b = await (await fetch(s.url + '/facility-profile.json')).text();
    const c = await fetch(s.url + '/nothing.json');
    await s.close();
    t('本番が無ければ見本を返す・あれば本番を返す・ほかの無いファイルは 404', a === '{"見本":1}' && b === '{"本番":1}' && c.status === 404, [a, b, c.status]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
