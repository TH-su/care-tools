/* 職員マスタの「法人設定」と初回の案内の試験（2026-10-11 新設・監査10月版 第2版 職員マスタ）
   実行: node check/unit/staff_corp_test.js
   対象を差し替える: STAFF_HTML=/tmp/変異版.html STAFF_CALC=/tmp/変異版.js node check/unit/staff_corp_test.js（変異試験用）
   守ること:
     ①既定（一度も保存していない）は今の値そのもの＝使う事業所は施設・訪問・通所／厨房は施設50：通所50（並びも同じ）
     ②形が違う値は1つも当てない（今の値のまま）。null は既定へ戻す
     ③差し替えると、厨房の方の所属・比率・事業所別の人数が新しい設定で数え直される。印のある方は変わらない
     ④画面: サーバーが古い・未接続・読み込めていない間は保存を押せない（理由を出す）／保存の前に同じ規則で見る
     ⑤初回の案内: 接続先が空のまま開いた端末だけ出し、3つの ✓ はその場の設定と接続テストの結果から決める
   ★このファイルは公開リポジトリの check/unit にある。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.STAFF_HTML || path.join(ROOT, 'staff-master.html'), 'utf8');
const CALC_PATH = process.env.STAFF_CALC || path.join(ROOT, 'staff-master-calc.js');
let pass = 0, fail = 0;
function t(name, ok, info) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }
function grab(name) {
  const i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('関数が見つかりません: ' + name);
  let d = 0, seen = false;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') { d++; seen = true; } else if (SRC[k] === '}') { d--; if (seen && d === 0) return SRC.slice(i, k + 1); }
  }
  throw new Error('終わりが見つかりません: ' + name);
}
function freshCalc() {
  delete require.cache[require.resolve(CALC_PATH)];
  return require(CALC_PATH);
}
const J = JSON.stringify;

console.log('\n— ① 既定は今の値そのもの —');
{
  const S = freshCalc();
  t('使う事業所は施設・訪問・通所', J(S.SITE_ACTIVE) === J(['facility', 'visit', 'day']));
  t('厨房は施設50：通所50（キーの並びも同じ）', J(S.KITCHEN_SITES) === J({ facility: 50, day: 50 }));
  t('corp() は既定と同じ', J(S.corp()) === J(S.corpDefault()));
  const before = J({ a: S.SITE_ACTIVE, k: S.KITCHEN_SITES });
  t('null で既定へ戻す（既定のままなら何も変わらない）', S.setCorp(null) === true && J({ a: S.SITE_ACTIVE, k: S.KITCHEN_SITES }) === before);
  t('公開の StaffCalc.SITE_ACTIVE・KITCHEN_SITES は差し替え後も同じ実体', (() => { const a = S.SITE_ACTIVE, k = S.KITCHEN_SITES; S.setCorp({ activeSites: ['facility', 'day'], kitchenSites: { day: 100 } }); const ok = a === S.SITE_ACTIVE && k === S.KITCHEN_SITES && J(a) === J(['facility', 'day']); S.setCorp(null); return ok; })());
}

console.log('\n— ② 形が違う値は当てない —');
{
  const S = freshCalc();
  const bad = [
    ['オブジェクトでない', 'x'], ['配列', []],
    ['知らない項目', { activeSites: ['facility'], kitchenSites: { facility: 100 }, extra: 1 }],
    ['使う事業所が空', { activeSites: [], kitchenSites: { facility: 100 } }],
    ['知らない事業所', { activeSites: ['facility', 'kitchen'], kitchenSites: { facility: 100 } }],
    ['同じ事業所が2回', { activeSites: ['facility', 'facility'], kitchenSites: { facility: 100 } }],
    ['兼務先が空', { activeSites: ['facility'], kitchenSites: {} }],
    ['兼務先が使う事業所の外', { activeSites: ['facility'], kitchenSites: { facility: 50, day: 50 } }],
    ['合計が100でない', { activeSites: ['facility', 'day'], kitchenSites: { facility: 60, day: 50 } }],
    ['小数', { activeSites: ['facility', 'day'], kitchenSites: { facility: 50.5, day: 49.5 } }],
    ['0', { activeSites: ['facility', 'day'], kitchenSites: { facility: 100, day: 0 } }],
    ['文字の数字', { activeSites: ['facility'], kitchenSites: { facility: '100' } }]
  ];
  bad.forEach(([n, v]) => {
    const before = J(S.corp());
    t('当てない: ' + n, S.normCorp(v) === null && S.setCorp(v) === false && J(S.corp()) === before);
  });
  t('並びは事業所の決まった順にそろえる', J(S.normCorp({ activeSites: ['cm', 'facility'], kitchenSites: { cm: 30, facility: 70 } })) === J({ activeSites: ['facility', 'cm'], kitchenSites: { facility: 70, cm: 30 } }));
}

console.log('\n— ③ 差し替えで厨房の方の数え方が変わる —');
{
  const S = freshCalc();
  const kitchen = { id: 'K1', hireDate: '2020-04-01', primarySite: 'kitchen' };
  const marked = { id: 'M1', hireDate: '2020-04-01', primarySite: 'kitchen', siteVisit: true };
  t('既定: 施設と通所に入る', S.belongsTo(kitchen, 'facility') && S.belongsTo(kitchen, 'day') && !S.belongsTo(kitchen, 'visit'));
  S.setCorp({ activeSites: ['facility', 'visit', 'day'], kitchenSites: { facility: 70, visit: 30 } });
  t('差し替え後: 施設と訪問に入り、通所には入らない', S.belongsTo(kitchen, 'facility') && S.belongsTo(kitchen, 'visit') && !S.belongsTo(kitchen, 'day'));
  t('比率も新しい値', J(S.siteRatios(kitchen)) === J({ facility: 70, visit: 30 }));
  t('印のある方は変わらない', S.belongsTo(marked, 'visit') && !S.belongsTo(marked, 'facility') && J(S.siteRatios(marked)) === '{}');
  const st = S.siteStats([kitchen], '2026-04-01', '2027-03-31', '2026-10-01');
  const head = (code) => { const r = (st.rows || st).filter((x) => x && x.site === code)[0]; return r ? r.head : undefined; };
  t('事業所別の人数も新しい設定で数える（訪問1・通所0）', head('visit') === 1 && head('day') === 0, st);
  S.setCorp(null);
  t('null で既定に戻る', S.belongsTo(kitchen, 'day') && !S.belongsTo(kitchen, 'visit'));
}

console.log('\n— ④ 画面の法人設定 —');
{
  const S = freshCalc();
  const sb = { txt: (v) => (v === undefined || v === null ? '' : String(v)), isFinite, Math, Number, Object, Array,
    URL_OK_RE: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, cfg: { url: '', token: '', by: '' },
    ST: { caps: null }, CORP: { loaded: false, busy: false } };
  sb.loadCfg = () => sb.cfg;
  sb.SC = () => S;
  sb.capsHas = (n) => !!(sb.ST.caps && sb.ST.caps.indexOf(n) >= 0);
  vm.createContext(sb);
  vm.runInContext(['corpLabel', 'corpFormError', 'corpWhy'].map(grab).join('\n'), sb);
  t('未接続: 接続先を入れるよう案内', /接続先URLと合言葉/.test(sb.corpWhy()));
  sb.cfg = { url: 'https://script.google.com/macros/s/AKfyTEST/exec', token: 'x', by: '' };
  t('接続を確かめる前: 接続テストを案内', /接続テスト/.test(sb.corpWhy()));
  sb.ST.caps = ['enums'];
  t('古い GAS: 更新を案内し、既定のまま動いていると伝える', /GAS を更新/.test(sb.corpWhy()) && /既定のまま/.test(sb.corpWhy()));
  sb.ST.caps = ['enums', 'corp'];
  t('読み込めていない: 読み込み直しを案内', /読み込み直す/.test(sb.corpWhy()));
  sb.CORP.loaded = true;
  t('読み込めていれば保存できる', sb.corpWhy() === '');
  t('保存前の確認: 使う事業所が空', /使う事業所/.test(sb.corpFormError({ activeSites: [], kitchenSites: { facility: 100 } })));
  t('保存前の確認: 兼務先が空', /兼務先/.test(sb.corpFormError({ activeSites: ['facility'], kitchenSites: {} })));
  t('保存前の確認: 整数でない', /整数/.test(sb.corpFormError({ activeSites: ['facility', 'day'], kitchenSites: { facility: 50.5, day: 49.5 } })));
  t('保存前の確認: 合計（いまの合計を出す）', /いま 110/.test(sb.corpFormError({ activeSites: ['facility', 'day'], kitchenSites: { facility: 60, day: 50 } })));
  t('保存前の確認: 正しい値は通す', sb.corpFormError({ activeSites: ['facility', 'day'], kitchenSites: { facility: 60, day: 40 } }) === '');
}

console.log('\n— ⑤ 初回の案内 —');
{
  const store = {};
  const els = {};
  const mkLi = () => ({ firstChild: { textContent: '' }, classList: { on: false, toggle(c, v) { this.on = !!v; } } });
  ['wizS1', 'wizS2', 'wizS3'].forEach((id) => { els[id] = mkLi(); });
  els.wizCard = { hidden: true }; els.wizTitle = { textContent: '' };
  const sb = { txt: (v) => (v === undefined || v === null ? '' : String(v)), Array,
    URL_OK_RE: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, cfg: { url: '', token: '', by: '' },
    ST: { caps: null }, UI_KEYS: { wiz: 'stfm_wiz' } };
  sb.loadCfg = () => sb.cfg;
  sb.lsGet = (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null);
  sb.lsSet = (k, v) => { store[k] = String(v); };
  sb.$ = (id) => els[id] || null;
  vm.createContext(sb);
  vm.runInContext(['wizSteps', 'startWizIfNew', 'renderWiz'].map(grab).join('\n'), sb);
  sb.cfg = { url: 'https://script.google.com/macros/s/AKfyTEST/exec', token: 'x', by: '' };
  t('接続先が入っている端末では始めない（印も付けない）', sb.startWizIfNew() === false && sb.lsGet('stfm_wiz') === null);
  sb.renderWiz();
  t('印が無ければ出さない', els.wizCard.hidden === true);
  sb.cfg = { url: '', token: '', by: '' };
  t('接続先が空なら始める', sb.startWizIfNew() === true && sb.lsGet('stfm_wiz') === '1');
  sb.renderWiz();
  t('出す・3つともまだ', els.wizCard.hidden === false && ['wizS1', 'wizS2', 'wizS3'].every((id) => !els[id].classList.on && /まだ/.test(els[id].firstChild.textContent)));
  sb.cfg = { url: 'https://script.google.com/macros/s/AKfyTEST/exec', token: 'x', by: '' };
  sb.renderWiz();
  t('①だけ済み', els.wizS1.classList.on && !els.wizS2.classList.on && !els.wizS3.classList.on);
  sb.ST.caps = ['enums'];
  sb.renderWiz();
  t('疎通確認（合言葉を見ない）だけでは2段目を ✓ にしない', !els.wizS2.classList.on);
  sb.ST.authOk = true;
  sb.cfg.by = '事務所PC';
  sb.renderWiz();
  t('3つ済めば「済みました」（閉じるまで出したまま）', els.wizCard.hidden === false && /済みました/.test(els.wizTitle.textContent) && /済み/.test(els.wizS3.firstChild.textContent));
  sb.lsSet('stfm_wiz', '0');
  sb.renderWiz();
  t('閉じたら出さない', els.wizCard.hidden === true);
  sb.cfg = { url: '', token: '', by: '' };
  t('閉じた端末は、接続先が空のままでも出し直さない', sb.startWizIfNew() === false && sb.lsGet('stfm_wiz') === '0');
}

console.log('\n— ⑦ レビューの指摘（2026-10-11）—');
{
  t('使う事業所に入れた事業所は所属の欄を出す（使わない事業所は印のある方だけ）', /if \(grp\) grp\.hidden = !siteIsActive\(s\.code\) && !on;/.test(grab('fillSites')));
  const sd = grab('saveDetail');
  t('厨房の導出で開いた方は、法人設定を読み込めていない間・開いた後で変わった時は保存しない',
    /if \(ST\.detail\.kitchenDerived && \(ST\.detail\.corpStale \|\| \(capsHas\('corp'\) && !CORP\.loaded\)\)\) \{/.test(sd)
    && sd.indexOf('ST.detail.corpStale ||') < sd.indexOf("apiPost("));
  t('法人設定が変わったら、開いている厨房の方に印を付ける', /if \(ST\.detail && ST\.detail\.kitchenDerived\) ST\.detail\.corpStale = true;/.test(grab('applyCorpResp')));
  const lc = grab('loadCorp');
  t('遅れて届いた読み込みの応答は当てない（世代）', /var gen = \+\+CORP\.gen;/.test(lc) && (lc.match(/if \(gen !== CORP\.gen\) return CORP\.loaded;/g) || []).length === 2);
  t('保存を始めたら読み込み中の応答を捨てる', /CORP\.gen\+\+;/.test(grab('saveCorp')) && grab('saveCorp').indexOf('CORP.gen++') < grab('saveCorp').indexOf("apiPost('setCorp'"));
  t('合言葉が通った時だけ2段目（getEnums・getCorp の成功）／接続設定を保存したら取り消す',
    /ST\.authOk = true;/.test(grab('loadEnums')) && /ST\.authOk = true;/.test(lc) && /ST\.authOk = false;/.test(grab('onSaveCfg')) && /loadEnums\(\);/.test(grab('onTest')));
}

console.log('\n— ⑥ つなぎ —');
{
  const S = freshCalc();
  t('計算部品の ?v= と VERSION がそろう', SRC.indexOf('staff-master-calc.js?v=' + S.VERSION + '"') > 0);
  t('setCorp は受付番号を付ける書く送信', /var REQ_WRITE_ACTIONS = \[[^\]]*'setCorp'/.test(SRC));
  t('保存は expect（読み込んだ目印）と端末の名前を付けて送る', /apiPost\('setCorp', \{ corp: o, by: loadCfg\(\)\.by, expect: CORP\.at \}\)/.test(SRC));
  const init = SRC.slice(SRC.indexOf('\nfunction init()'));
  t('起動時に欄を作って法人設定を読む', /buildCorpForm\(\);/.test(init) && /loadCorp\(\);/.test(init));
  t('接続先が空なら案内を始める（開く画面は変えない）', /\n\s*startWizIfNew\(\);/.test(init) && !/ST\.screen = 'settings'/.test(init));
  t('接続設定を保存したら読み直す', /loadCommittees\(\);\n\s*loadCorp\(\);\n\s*renderWiz\(\);/.test(grab('onSaveCfg')));
  t('接続の可否が変わる時（選択肢ボタンと同じ時）に欄と案内を取り直す', /updateCorpUi\(\);[^\n]*\n\s*renderWiz\(\);/.test(grab('updateEnumBtn')));
  t('中身が変わった時だけ集計・一覧を描き直す（一括編集中は描き直さない）', /JSON\.stringify\(corpNow\(\)\) !== before/.test(grab('applyCorpResp')) && /!ST\.bulk\) renderList\(\)/.test(grab('applyCorpResp')));
  t('案内の印は UI_KEYS に置く（業務データは残さない）', /wiz: 'stfm_wiz'/.test(SRC));
  t('最終更新の時刻は目印の #版 を外して出す', /replace\(\/#\.\*\$\/, ''\)/.test(grab('updateCorpUi')));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
