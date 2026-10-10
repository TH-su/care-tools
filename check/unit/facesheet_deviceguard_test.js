/* フェイスシート（facesheet.html）の「事務所PCとして詳細画面（全項目）を開いたまま端末の用途が現場用に
   変わった時に、全項目の画面を残さずページを読み込み直すこと」のテスト。
   対象: getDeviceRole・setDeviceRole・isField・fsReload_・applyRoleBadge・saveSync・onDeviceRoleChange_・readSavedCfg_ と
         var fsRoleApplied_・curRec・openSeq・CFG 等の行、storage・pageshow の受け口の行
         （HTML 全体は評価せず、実物のソースから切り出して vm に入れる。それ以外は偽物）
   実行: node "…/check/unit/facesheet_deviceguard_test.js"
         FACESHEET_HTML=<直した版>/facesheet.html FACESHEET_HTML_OLD=<直す前の版>/facesheet.html node "…/check/unit/facesheet_deviceguard_test.js"
         （FACESHEET_HTML_OLD を渡した時だけ「直す前は穴が再現する」群を実行する）

   背景（壊れうること）:
     端末の用途 su_device_role が field（現場）の時、フェイスシートは安全情報28項目だけを見せる。
     直す前は、事務所PCとして詳細画面（病名・処方・家族連絡先を含む全項目）を開いたまま用途が現場に変わると、
     表示（バッジ）だけ「現場」に変わり、全項目の画面とメモリの記録 curRec がそのまま残る。
     別のタブで用途が変わった時は何も起きない。
     直し方は入居者マスタと同じ「現場へ変わった瞬間にページを読み込み直す」（2026-10-01 本人決定）。
     事務所PCのまま使う間の動き・現場端末として起動した後の動きは変えない。事務所PCへ戻された通知では何もしない。
     このテストは上の穴が塞がったことと、それ以外の動きが変わっていないことを確かめる。

   実データは含まない。値は全て架空（氏名欄は「架空A」等の作り物で、実在の人名は1つも書かない）。
   ★出力に console を使わない（gas/tests にあった頃からの決まり。個人情報を出力に流さないため）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = process.env.FACESHEET_HTML || path.join(__dirname, '..', '..', 'facesheet.html');
const OLD_PATH = process.env.FACESHEET_HTML_OLD || '';

let ok = 0, ng = 0;
const say = m => process.stdout.write(m + '\n');
function group(n){ say('\n■ ' + n); }
function t(label, cond, info){ if(cond){ ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '\n    → ' + JSON.stringify(info) : '')); } }
function eq(label, got, want){ const g = JSON.stringify(got), w = JSON.stringify(want); t(label, g === w, g === w ? undefined : { 期待: want, 実際: got }); }

/* 関数を名前で切り出す（master_deviceguard_test.js と同じ作法） */
function grabFn(src, name){
  const start = src.indexOf('\nfunction ' + name + '(');
  if(start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false, q = null;
  for(let i = start; i < src.length; i++){
    const c = src[i], p = src[i-1];
    if(q){ if(c === q && p !== '\\') q = null; continue; }
    if(c === "'" || c === '"'){ q = c; continue; }
    if(c === '{'){ depth++; seen = true; }
    else if(c === '}'){ depth--; if(seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
/* var を切り出す（行末が ; の行まで。行末の // コメントも許す） */
function grabVar(src, name){
  const start = src.indexOf('\nvar ' + name + '=');
  if(start < 0) throw new Error('変数が見つかりません: ' + name);
  const lines = src.slice(start + 1).split('\n'), out = [];
  for(const l of lines){ out.push(l); if(/;\s*(?:\/\*.*\*\/\s*|\/\/.*)?$/.test(l)) break; }
  return out.join('\n');
}

/* 架空の詳細記録（全項目の画面に出る想定のもの）。値は作り物 */
const REC = { masterId: '901', name: '架空A', diseases: ['架空病名'], medsRegular: '架空薬A 1錠 朝', familyTel: '000-0000-0000' };

/* 直す前の版には無い名前（T5 で旧版を読む時だけ省く） */
/* devGen は 2026-10-02 に足した（デイ利用の取得の世代。入居者マスタと逐語同一のモジュールが読む）。
   これより前の版を FACESHEET_HTML に渡すと「変数が見つかりません: devGen」で落ちる＝守りが無いことの検出 */
const NEW_VARS = ['fsRoleApplied_', 'devGen'];
const NEW_FNS = ['fsReload_', 'onDeviceRoleChange_'];

function load(src, old, opt){
  opt = opt || {};
  const store = new Map();
  const cnt = { reload: 0, reloadAt: [], boot: 0, closeSync: 0, toast: [], setSync: [], showScreen: [], setView: [], saveOpenId: [], alert: [], order: [] };
  const els = {};
  function fakeEl(id){
    if(!els[id]){
      const cls = new Set();
      const sub = {};
      els[id] = { id, value: '', textContent: '', className: '', style: {},
        setAttribute(){}, addEventListener(){},
        querySelector(sel){ if(!sub[sel]) sub[sel] = { sel, style: {} }; return sub[sel]; },
        sub,
        classList: { toggle(c, on){ if(on === undefined) on = !cls.has(c); if(on) cls.add(c); else cls.delete(c); return on; },
          remove(c){ cls.delete(c); }, add(c){ cls.add(c); }, contains(c){ return cls.has(c); } } };
    }
    return els[id];
  }
  const listeners = {};   // window.addEventListener で登録された受け口（storage・pageshow）
  const throwKeys = new Set(opt.throwKeys || []);
  const box = {
    localStorage: {
      getItem(k){ return store.has(k) ? store.get(k) : null; },
      setItem(k, v){ if(throwKeys.has(k)) throw new Error('架空の書き込み失敗'); store.set(k, String(v)); },
      removeItem(k){ store.delete(k); }
    },
    $: fakeEl,
    document: { querySelectorAll(){ return []; }, getElementById: fakeEl },
    saveOpenId(id){ cnt.saveOpenId.push(id); },
    showScreen(n){ cnt.showScreen.push(n); },
    setView(v){ cnt.setView.push(v); box.curView = v; },
    boot(){ cnt.boot++; },
    closeSync(){ cnt.closeSync++; },
    toast(m){ cnt.toast.push(String(m)); },
    alert(m){ cnt.alert.push(String(m)); cnt.order.push('alert'); },
    setSync(m, c){ cnt.setSync.push([m, c || '']); },
    location: {},
    /* applyRoleBadge が触る他機能の控え（このテストでは箱で足りる） */
    curView: 'std',
    a4DayMap: { 架空: 1 }, a4DayPromise: { 架空: 1 }, a4DayFailAt: 5, a4DayFailMsg: '架空の失敗',
    fsMdMap: { 架空: 1 }, fsMdErr: '架空', fsMdLoading: true, fsMdGen: 0, fsMdPromise: { 架空: 1 }, fsMdPromiseRetry: true,
    mealRows: [{ name: '架空A' }], mealVia: 'bulk', mealSeq: 0, mealLoading: true, mealMsg: '架空'
  };
  /* reload が呼ばれた時点の状態（用途・メモリの記録）を控える＝「消してから読み込み直す」順序の検査用 */
  box.location.reload = function(){ cnt.reload++; cnt.reloadAt.push([box.getDeviceRole(), box.curRec]); cnt.order.push('reload'); };
  box.window = { addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); } };
  vm.createContext(box);
  const vars = ['CFG_KEY', 'COMMON_KEY', 'DEVICE_KEY', 'CFG', 'curRec', 'openSeq', 'cfgTestGen_'].concat(old ? [] : NEW_VARS);
  const fns = ['getDeviceRole', 'setDeviceRole', 'isField', 'readSavedCfg_', 'applyRoleBadge', 'saveSync'].concat(old ? [] : NEW_FNS);
  /* storage・pageshow の受け口（今回足したトップレベルの1行）も実物から切り出して登録させる */
  const lines = old ? [] : [
    ['storage', /\nwindow\.addEventListener\('storage',[^\n]*onDeviceRoleChange_[^\n]*\n/],
    ['pageshow', /\nwindow\.addEventListener\('pageshow',[^\n]*onDeviceRoleChange_[^\n]*\n/]
  ].map(([type, re]) => {
    const m = src.match(re);
    if(!m) throw new Error('受け口が見つかりません: ' + type);
    return m[0].trim();
  });
  const code = vars.map(n => grabVar(src, n)).concat(fns.map(n => grabFn(src, n)), lines).join('\n');
  vm.runInContext(code, box, { filename: 'facesheet.html(deviceguard)' });
  /* 2026-10-10: 設定の保存は、URL が変わる時に「入居者マスタのGASか」を確かめてから書く（verifyMasterUrl・通信あり）。
     この試験は端末の用途の切り替えを見るものなので、確かめは「入居者マスタだった」をその場で返す代役に置き換える
     （確かめそのものの試験は gas/tests/master_target_verdict_test.js）。古い版には確かめが無いので代役は使われない。 */
  box.verifyMasterUrl = function(){ return { then: function(f){ f('ok'); return this; } }; };
  const v = name => vm.runInContext(name, box);
  const set = js => vm.runInContext(js, box);
  function cfgForm(url, token, role){ fakeEl('cfgUrl').value = url; fakeEl('cfgToken').value = token; fakeEl('cfgDeviceRole').value = role; }
  /* 詳細画面に全項目が描かれている状態（事務所PCとして開いた後）を作る */
  function paintDetail(){
    set('curRec=' + JSON.stringify(REC) + ';');
    fakeEl('vName').textContent = '架空A';
    fakeEl('hlBand').textContent = '架空の要点';
    fakeEl('ftabs').textContent = '基本 医療 家族';
    fakeEl('viewBox').textContent = '架空病名 架空薬A 000-0000-0000';
  }
  function viewTexts(){ return ['vName', 'hlBand', 'ftabs', 'viewBox'].map(id => fakeEl(id).textContent); }
  return { box, v, set, cnt, store, els, listeners, cfgForm, paintDetail, viewTexts, fakeEl };
}

function main(){
  const SRC = fs.readFileSync(HTML_PATH, 'utf8');
  say('対象: ' + HTML_PATH);

  /* ── T1. applyRoleBadge ── */
  group('T1. applyRoleBadge（事務所PC・現場端末の起動・事務所→現場の切り替え）');
  {
    const L = load(SRC);
    eq('起動前の fsRoleApplied_ は null', L.v('fsRoleApplied_'), null);
    L.paintDetail();
    L.box.applyRoleBadge();
    eq('office: fsRoleApplied_=office', L.v('fsRoleApplied_'), 'office');
    eq('office: curRec に触らない・openSeq 0 のまま', [L.v('curRec'), L.v('openSeq')], [REC, 0]);
    eq('office: showScreen を呼ばない', L.cnt.showScreen, []);
    eq('office: 詳細画面の中身はそのまま', L.viewTexts(), ['架空A', '架空の要点', '基本 医療 家族', '架空病名 架空薬A 000-0000-0000']);
    eq('office: バッジ「事務所」・class=role', [L.els.roleBadge.textContent, L.els.roleBadge.className], ['事務所', 'role']);
    eq('office: 印刷ボタンを出す', [L.els.printBtn.style.display, L.els.printAllBtn.style.display], ['', '']);
    eq('office: 誕生日・食形態のタブを出す', [L.els.viewTabs.sub['.vtab[data-v="bday"]'].style.display, L.els.viewTabs.sub['.vtab[data-v="meal"]'].style.display], ['', '']);
    t('office: 控え（a4DayMap・fsMdMap・mealRows）は捨てない', L.v('a4DayMap') !== null && L.v('fsMdMap') !== null && L.v('mealRows') !== null);
    eq('office: saveOpenId を呼ばない', L.cnt.saveOpenId, []);
    eq('office: デイ利用の世代 devGen は進めない（事務所PCのままなら取得の応答は従来どおり入る）', L.v('devGen'), 0);
    L.box.applyRoleBadge();
    eq('office→office（もう一度）: curRec・画面に触らない', [L.v('curRec'), L.cnt.showScreen, L.v('openSeq')], [REC, [], 0]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.paintDetail();   /* 現場端末として安全情報の画面を開いている想定 */
    L.box.applyRoleBadge();
    eq('field（最初の呼び出し）: fsRoleApplied_=field', L.v('fsRoleApplied_'), 'field');
    eq('field（最初の呼び出し）: curRec に触らない・openSeq 0 のまま', [L.v('curRec'), L.v('openSeq')], [REC, 0]);
    eq('field（最初の呼び出し）: showScreen を呼ばない・画面はそのまま', [L.cnt.showScreen, L.viewTexts()[0]], [[], '架空A']);
    eq('field: バッジ「現場」・class=role field', [L.els.roleBadge.textContent, L.els.roleBadge.className], ['現場', 'role field']);
    eq('field: 印刷ボタンを隠す', [L.els.printBtn.style.display, L.els.printAllBtn.style.display], ['none', 'none']);
    eq('field: 誕生日・食形態のタブを隠す', [L.els.viewTabs.sub['.vtab[data-v="bday"]'].style.display, L.els.viewTabs.sub['.vtab[data-v="meal"]'].style.display], ['none', 'none']);
    eq('field: a4DayMap・a4DayPromise・fsMdMap・fsMdPromise・mealRows を捨てる',
      [L.v('a4DayMap'), L.v('a4DayPromise'), L.v('fsMdMap'), L.v('fsMdPromise'), L.v('mealRows')], [null, null, null, null, null]);
    eq('field: 世代（fsMdGen・mealSeq・devGen）が進む', [L.v('fsMdGen'), L.v('mealSeq'), L.v('devGen')], [1, 1, 1]);
    eq('field: saveOpenId(null) を呼ぶ', L.cnt.saveOpenId, [null]);
    L.paintDetail();
    L.box.applyRoleBadge();
    eq('field→field（もう一度）: curRec・画面に触らない', [L.v('curRec'), L.cnt.showScreen, L.v('openSeq'), L.viewTexts()[3]], [REC, [], 0, '架空病名 架空薬A 000-0000-0000']);
  }
  for(const view of ['bday', 'meal']){
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.curView = view;
    L.box.applyRoleBadge();
    eq('field・ビュー ' + view + ': setView(std) で標準へ戻す（従来どおり）', L.cnt.setView, ['std']);
  }
  {
    const L = load(SRC);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'field');
    L.box.applyRoleBadge();
    eq('office→field: curRec=null・openSeq が1進む', [L.v('curRec'), L.v('openSeq')], [null, 1]);
    eq('office→field: vName・hlBand・ftabs・viewBox が空', L.viewTexts(), ['', '', '', '']);
    eq('office→field: showScreen(list) が1回', L.cnt.showScreen, ['list']);
    eq('office→field: fsRoleApplied_=field', L.v('fsRoleApplied_'), 'field');
    eq('office→field: 既存の破棄も効く（バッジ現場・印刷なし・控えなし・saveOpenId(null)）',
      [L.els.roleBadge.textContent, L.els.printBtn.style.display, L.v('a4DayMap'), L.v('fsMdMap'), L.v('mealRows'), L.cnt.saveOpenId], ['現場', 'none', null, null, null, [null]]);
    L.paintDetail();
    L.box.applyRoleBadge();
    eq('office→field→field: 2回目は画面に触らない（showScreen 1回のまま・openSeq 1 のまま）', [L.cnt.showScreen.length, L.v('openSeq'), L.v('curRec')], [1, 1, REC]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'office');
    L.box.applyRoleBadge();
    eq('field→office: curRec・画面に触らない・fsRoleApplied_=office', [L.v('curRec'), L.cnt.showScreen, L.v('openSeq'), L.v('fsRoleApplied_')], [REC, [], 0, 'office']);
  }

  /* ── T2. saveSync ── */
  group('T2. saveSync（現場用への切り替えは読み込み直す・それ以外は従来どおり）');
  const PRE_CFG = JSON.stringify({ url: 'https://example.invalid/old', token: '', vmaUrl: 'https://example.invalid/vma' });
  {
    const L = load(SRC);
    L.store.set('rmaster_cfg', PRE_CFG);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.cfgForm('https://example.invalid/new', 'tok-架空', 'field');
    L.box.saveSync();
    let cfg = null; try{ cfg = JSON.parse(L.store.get('rmaster_cfg')); }catch(e){}
    eq('office→field: 用途 field', L.box.getDeviceRole(), 'field');
    eq('office→field: rmaster_cfg に url/token・vmaUrl は残る', cfg && [cfg.url, cfg.token, cfg.vmaUrl], ['https://example.invalid/new', 'tok-架空', 'https://example.invalid/vma']);
    eq('office→field: reload 1回・boot 0回・closeSync 1回', [L.cnt.reload, L.cnt.boot, L.cnt.closeSync], [1, 0, 1]);
    eq('office→field: reload の時点で用途 field・curRec null（順序）', L.cnt.reloadAt, [['field', null]]);
    eq('office→field: 詳細画面は空・一覧へ', [L.viewTexts(), L.cnt.showScreen], [['', '', '', ''], ['list']]);
    eq('office→field（接続先の保存成功）: alert は出さない・toast も出さない', [L.cnt.alert, L.cnt.toast], [[], []]);
  }
  {
    /* J2: 接続先（rmaster_cfg）だけ書けない端末で現場用へ切り替える */
    const L = load(SRC, false, { throwKeys: ['rmaster_cfg'] });
    L.box.applyRoleBadge();
    L.paintDetail();
    L.cfgForm('https://example.invalid/new', 'tok-架空', 'field');
    L.box.saveSync();
    eq('office→field（接続先の保存失敗）: alert 1回・文言は既存トーストの失敗側と同じ', L.cnt.alert, ['⚠️ 保存できませんでした（プライベートモード等）']);
    t('office→field（接続先の保存失敗）: alert の文言がソースの toast の失敗側と一字一句同じ',
      SRC.includes("toast(saved?'✅ 保存しました':'" + L.cnt.alert[0] + "');"), L.cnt.alert);
    eq('office→field（接続先の保存失敗）: alert の後に reload 1回（順序）', L.cnt.order, ['alert', 'reload']);
    eq('office→field（接続先の保存失敗）: 用途 field・boot 0回・reload の時点で curRec null', [L.box.getDeviceRole(), L.cnt.boot, L.cnt.reloadAt], ['field', 0, [['field', null]]]);
  }
  {
    /* J1(a): 現場端末として描いた画面で、別のタブが保存値だけ office に戻した後に「現場」を選び直して保存 */
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'office');
    L.cfgForm('https://example.invalid/new', '', 'field');
    L.box.saveSync();
    eq('描画 field・保存値 office → field を保存: reload 0回・boot 1回・toast 成功（従来どおり）', [L.cnt.reload, L.cnt.boot, L.cnt.toast], [0, 1, ['✅ 保存しました']]);
    eq('描画 field・保存値 office → field を保存: alert なし・用途 field・curRec に触らない', [L.cnt.alert, L.box.getDeviceRole(), L.v('curRec')], [[], 'field', REC]);
  }
  {
    /* J1(b): 事務所PCとして描いた画面で、保存値は既に field（storage を取りこぼした想定）のまま field で保存 */
    const L = load(SRC);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'field');
    L.cfgForm('https://example.invalid/new', '', 'field');
    L.box.saveSync();
    eq('描画 office・保存値 field → field を保存: reload 1回・boot 0回・curRec null', [L.cnt.reload, L.cnt.boot, L.v('curRec')], [1, 0, null]);
    eq('描画 office・保存値 field → field を保存: reload の時点で用途 field・curRec null', L.cnt.reloadAt, [['field', null]]);
  }
  {
    const L = load(SRC);
    L.store.set('rmaster_cfg', PRE_CFG);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.cfgForm('https://example.invalid/new', 'tok-架空', 'office');
    L.box.saveSync();
    let cfg = null; try{ cfg = JSON.parse(L.store.get('rmaster_cfg')); }catch(e){}
    eq('office→office: reload 0回・boot 1回・closeSync 1回', [L.cnt.reload, L.cnt.boot, L.cnt.closeSync], [0, 1, 1]);
    eq('office→office: toast「✅ 保存しました」', L.cnt.toast, ['✅ 保存しました']);
    eq('office→office: rmaster_cfg に url/token・vmaUrl は残る', cfg && [cfg.url, cfg.token, cfg.vmaUrl], ['https://example.invalid/new', 'tok-架空', 'https://example.invalid/vma']);
    eq('office→office: CFG も更新・curRec に触らない', [L.v('CFG.url'), L.v('curRec')], ['https://example.invalid/new', REC]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyRoleBadge();
    L.paintDetail();
    L.cfgForm('https://example.invalid/new', '', 'field');
    L.box.saveSync();
    eq('field→field: reload 0回・boot 1回・toast 成功', [L.cnt.reload, L.cnt.boot, L.cnt.toast], [0, 1, ['✅ 保存しました']]);
    eq('field→field: curRec・画面に触らない', [L.v('curRec'), L.cnt.showScreen], [REC, []]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyRoleBadge();
    L.cfgForm('https://example.invalid/new', '', 'office');
    L.box.saveSync();
    eq('field→office: 用途 office・reload 0回・boot 1回', [L.box.getDeviceRole(), L.cnt.reload, L.cnt.boot], ['office', 0, 1]);
  }
  {
    const L = load(SRC, false, { throwKeys: ['su_device_role'] });
    L.box.applyRoleBadge();
    L.cfgForm('https://example.invalid/new', '', 'field');
    L.box.saveSync();
    eq('用途を書けない端末で office→field: 用途 office のまま・reload 0回・boot 1回（従来どおり）', [L.box.getDeviceRole(), L.cnt.reload, L.cnt.boot], ['office', 0, 1]);
  }

  /* ── T3. onDeviceRoleChange_ ── */
  group('T3. onDeviceRoleChange_（別のタブで用途が変わった時）');
  {
    const L = load(SRC);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'field');
    L.box.onDeviceRoleChange_({ key: 'su_device_role' });
    eq('field・描画済み office: reload 1回・curRec null', [L.cnt.reload, L.v('curRec')], [1, null]);
    eq('field・描画済み office: reload の時点で用途 field・curRec null（順序）', L.cnt.reloadAt, [['field', null]]);
    eq('field・描画済み office: 画面を空にして一覧へ', [L.viewTexts(), L.cnt.showScreen], [['', '', '', ''], ['list']]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyRoleBadge();
    L.paintDetail();
    L.box.onDeviceRoleChange_({ key: 'su_device_role' });
    eq('描画済み field: 何もしない（reload 0・curRec そのまま）', [L.cnt.reload, L.v('curRec'), L.cnt.showScreen], [0, REC, []]);
  }
  {
    const L = load(SRC);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.box.onDeviceRoleChange_({ key: 'su_device_role' });
    eq('用途 office のまま: 何もしない', [L.cnt.reload, L.v('curRec'), L.v('fsRoleApplied_')], [0, REC, 'office']);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyRoleBadge();
    L.store.set('su_device_role', 'office');
    L.paintDetail();
    L.box.onDeviceRoleChange_({ key: 'su_device_role' });
    eq('事務所PCへ戻された通知: 何もしない（表示は現場のまま・reload 0）', [L.cnt.reload, L.els.roleBadge.textContent, L.v('fsRoleApplied_')], [0, '現場', 'field']);
  }
  {
    const L = load(SRC);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'field');
    L.box.onDeviceRoleChange_({ key: 'su_residents_common' });
    eq('別のキー（su_residents_common）: 何もしない', [L.cnt.reload, L.v('curRec'), L.v('fsRoleApplied_')], [0, REC, 'office']);
  }
  {
    const L = load(SRC);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'field');
    L.box.onDeviceRoleChange_({ key: null });
    eq('key が null で field: reload 1回・curRec null', [L.cnt.reload, L.v('curRec')], [1, null]);
  }
  {
    const L = load(SRC);
    L.box.applyRoleBadge();
    let threw = null;
    try{ L.box.onDeviceRoleChange_(); L.box.onDeviceRoleChange_(null); }catch(e){ threw = String(e); }
    eq('e が無い: 例外を出さない・reload 0', [threw, L.cnt.reload], [null, 0]);
  }

  /* ── T4. 受け口 ── */
  group('T4. 受け口（storage・pageshow）');
  t('storage の受け口の行がソースにある', /\nwindow\.addEventListener\('storage',function\(e\)\{ try\{ onDeviceRoleChange_\(e\); \}catch\(err\)\{\} \}\);\n/.test(SRC));
  t('pageshow の受け口の行がソースにある', /\nwindow\.addEventListener\('pageshow',function\(e\)\{ try\{ if\(e&&e\.persisted\) onDeviceRoleChange_\(\{key:DEVICE_KEY\}\); \}catch\(err\)\{\} \}\);\n/.test(SRC));
  t('既存の storage の受け口（COMMON_KEY で名簿を読み直す）が残っている',
    /\nwindow\.addEventListener\('storage',function\(e\)\{\n  if\(e\.key!==COMMON_KEY\)return;\n  loadCommonRoster\(\);\n  if\(!isField\(\)&&CFG\.url\) refreshRosterFromGas\(\); else renderRoster\(\);\n\}\);\n/.test(SRC));
  {
    const L = load(SRC);
    eq('実物の行を評価すると storage・pageshow が1つずつ登録される', [(L.listeners.storage || []).length, (L.listeners.pageshow || []).length], [1, 1]);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'field');
    L.listeners.storage[0]({ key: 'su_residents_common' });
    eq('storage の受け口: 別のキーでは何もしない', [L.cnt.reload, L.v('curRec')], [0, REC]);
    L.listeners.storage[0]({ key: 'su_device_role' });
    eq('storage の受け口: su_device_role の field で reload 1回・curRec null', [L.cnt.reload, L.v('curRec')], [1, null]);
    let threw = null;
    try{ L.listeners.storage[0](undefined); }catch(e){ threw = String(e); }
    eq('storage の受け口: 引数なしでも例外を外へ出さない', threw, null);
  }
  {
    const L = load(SRC);
    L.box.applyRoleBadge();
    L.paintDetail();
    L.store.set('su_device_role', 'field');
    L.listeners.pageshow[0]({ persisted: false });
    eq('pageshow persisted=false: 何もしない', [L.cnt.reload, L.v('curRec'), L.v('fsRoleApplied_')], [0, REC, 'office']);
    L.listeners.pageshow[0]({ persisted: true });
    eq('pageshow persisted=true・field・描画済み office: reload 1回・curRec null', [L.cnt.reload, L.v('curRec')], [1, null]);
    L.listeners.pageshow[0]({ persisted: true });
    eq('pageshow もう一度（描画済み field）: 読み込み直しを繰り返さない', L.cnt.reload, 1);
  }
  {
    const L = load(SRC);
    L.box.applyRoleBadge();
    L.listeners.pageshow[0]({ persisted: true });
    eq('pageshow persisted=true・office のまま: 何もしない', L.cnt.reload, 0);
  }

  /* ── T6. デイ利用の取得（a4EnsureDayMap）の応答が、現場用へ切り替えた後に届いた時 ──
     ★実物の a4EnsureDayMap・a4DayFail_ を切り出し、通信だけ偽物にして【実際に走らせる】。
       applyRoleBadge は控えを捨ててから読み込み直すが、読み込み直しが効かなかった時（保険の場面）に、
       切り替え前に出した取得の応答で、全利用者の氏名を含む一覧（a4DayMap）がメモリへ戻らないこと。
       入居者マスタ側は 9b60f5a で同じ守りを入れた（このモジュールは2ファイルで逐語同一） */
  group('T6. デイ利用の取得の応答が、現場用へ切り替えた後に届いた時（2026-10-02）');
  async function dayRun(opt){
    const L = load(SRC);
    let settle;
    const pending = new Promise((res, rej) => { settle = { res, rej }; });
    Object.assign(L.box, {
      A4_DAY_TTL: 600000, A4_DAY_FAIL_TTL: 30000,
      a4DayMap: null, a4DayPromise: null, a4DayFailAt: 0, a4DayFailMsg: '',
      a4SyncTarget: () => ({ endpoint: 'https://example.invalid/exec', token: '架空' }),
      fetchWithTimeout: () => pending,
      a4BuildDayMap: d => ({ at: Date.now(), 印: '架空の一覧（' + d.residents.length + '名）' })
    });
    L.box.window.SUKv = null;
    vm.runInContext(grabFn(SRC, 'a4EnsureDayMap') + '\n' + grabFn(SRC, 'a4DayFail_'), L.box, { filename: 'facesheet.html(dayuse)' });
    L.box.applyRoleBadge();                       // 事務所PCとして描く
    const p = L.box.a4EnsureDayMap();             // 事務所PCのうちに取得を出す
    if(opt.toField){ L.store.set('su_device_role', 'field'); L.box.applyRoleBadge(); }   // 応答を待つ間に現場用へ
    if(opt.fail) settle.rej(new Error('架空の通信失敗'));
    else settle.res({ text: () => Promise.resolve(JSON.stringify({ ok: true, data: { residents: [{ name: '架空A' }, { name: '架空B' }] } })) });
    const msg = await p;
    return { msg, map: L.v('a4DayMap'), prom: L.v('a4DayPromise'), failAt: L.v('a4DayFailAt'), failMsg: L.v('a4DayFailMsg') };
  }
  return (async function(){
    const C = await dayRun({});
    t('（対照）事務所PCのまま応答が届けば一覧を控える・取得中の印を下ろす', C.map && C.map.印 === '架空の一覧（2名）' && C.prom === null && C.failAt === 0, C);
    const F = await dayRun({ toField: true });
    eq('現場用へ切り替えた後に届いた応答: 一覧をメモリへ戻さない', F.map, null);
    eq('　取得中の印も立てたままにしない・失敗の印も付けない', [F.prom, F.failAt, F.failMsg], [null, 0, '']);
    const E = await dayRun({ toField: true, fail: true });
    eq('現場用へ切り替えた後に届いた失敗: 失敗の印を付けない（現場の画面に「未確認」の理由を残さない）', [E.map, E.failAt, E.failMsg], [null, 0, '']);
    const E0 = await dayRun({ fail: true });
    t('（対照）事務所PCのままの失敗は従来どおり失敗の印を付ける', E0.failAt > 0 && /週間計画を取得できなかった/.test(E0.failMsg), E0);
  })().then(() => finish(SRC));
}
function finish(SRC){
  /* ── T5. 直す前の版での再現 ── */
  group('T5. 直す前の版で穴が再現する（このテストが穴を検出できる証拠）');
  if(!OLD_PATH){
    say('  （省略: FACESHEET_HTML_OLD が渡されていない）');
  } else {
    say('  直す前の版: ' + OLD_PATH);
    const OLD = fs.readFileSync(OLD_PATH, 'utf8');
    {
      const L = load(OLD, true);
      L.box.applyRoleBadge();
      L.paintDetail();
      L.cfgForm('https://example.invalid/new', '', 'field');
      L.box.saveSync();
      eq('（直す前）saveSync で field へ切り替えても curRec が残り reload されない＝再現した',
        [L.box.getDeviceRole(), L.v('curRec'), L.cnt.reload], ['field', REC, 0]);
      eq('（直す前）全項目の画面がそのまま残る＝再現した', L.viewTexts()[3], '架空病名 架空薬A 000-0000-0000');
    }
    t('（直す前）別のタブの用途変更を受ける受け口が無い＝再現した', !/onDeviceRoleChange_/.test(OLD));
  }

  say('\nOK ' + ok + ' / NG ' + ng);
  if(ng > 0) process.exit(1);
}

function fatal(e){ say('例外: ' + (e && e.stack || e)); say('\nOK ' + ok + ' / NG ' + (ng + 1)); process.exit(1); }
try{ Promise.resolve(main()).catch(fatal); }catch(e){ fatal(e); }
