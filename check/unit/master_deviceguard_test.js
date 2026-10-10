/* 入居者マスタ（resident-master.html）の「端末を現場用へ切り替えた後に、遅れて届いた応答が
   一覧キャッシュ・共有名簿・メモリの控えを戻さないこと」のテスト。
   対象: saveRosterCache・writeCommonRoster・refreshRoster・applyDeviceGuard・toggleHosp・afterSaveOk_・
         saveSyncCfg・devDirty_・devReload_・onDeviceRoleStorage_ と var devGen=…（devBlocked_・rosterPurged_）等の行、
         storage・pageshow の受け口の行
         （HTML 全体は評価せず、実物のソースから切り出して vm に入れる。それ以外は偽物）
   実行: node "…/check/unit/master_deviceguard_test.js"
         MASTER_HTML=<直した版>/resident-master.html MASTER_HTML_OLD=<直す前の版>/resident-master.html node "…/check/unit/master_deviceguard_test.js"
         （MASTER_HTML_OLD を渡した時だけ「直す前は穴が再現する」群を実行する）

   背景（壊れうること）:
     端末の用途 su_device_role が field（現場）だと入居者マスタはブロック表示になる（applyDeviceGuard）。
     直す前は、事務所PCとして読み込み中に現場へ切り替えると、
       ①refreshRoster の応答が氏名・生年月日入りの一覧キャッシュ rmaster_roster を端末へ書き戻す
       ②入院トグル・保存の後処理が、空にした roster から共有名簿 su_residents_common を0名・1名で上書きする
       ③（別タブで切り替え＋未保存ありで読み込み直さなかった後）事務所PCへ戻してから届いた古い応答で、
         共有名簿が0名・1名に縮む（名簿を捨てた印 rosterPurged_ で止める）
       ④（006442b）別タブで現場用へ変わった時に未保存があると読み込み直さずブロックだけにするが、
         applyDeviceGuard が無条件に mdClearPending_ を呼び、薬効辞書の未保存の編集が黙って消える
         （mdDirty の時は捨てない。テストは mdClearPending_ と保留5つを実物から切り出して確かめる）
       ⑤（df01048）同じく「ブロックのみ」の場面で、ブロックより前に出した帳票・入居日・食形態一覧・デイ利用日・
         1人ぶんの記録・保存の後処理の応答が遅れて届くと、捨てた控えがメモリに戻り、ブロック表示の下に画面が描き直される
         （応答側で世代 devGen・mealSeq を照合して捨てる。G9〜G12・G7-3）
     を起こしうる。直し方は「現場へ切り替えた瞬間にページを読み込み直す（根治）＋保存の出口に現場判定＋
     refreshRoster の保険（世代 devGen）＋別タブ経由の検知（storage）」。事務所PCでの動作は変えない。
     このテストは上の穴が塞がったことと、事務所PCでの通常動作が変わっていないことを確かめる。
     MASTER_HTML_OLD の群（G7）は、渡された旧版が何を持つかで再現を選ぶ（23089f2 相当→G7-1・G7-2、
     006442b 相当→G7-2 だけ）。1つも再現を走らせなかった時は旧版の取り違えとして ✗ にする。

   実データは含まない。値は全て架空（氏名欄は「架空A」等の作り物で、実在の人名は1つも書かない）。
   ★出力に console を使わない（gas/tests にあった頃からの決まり。個人情報を出力に流さないため）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const OLD_PATH = process.env.MASTER_HTML_OLD || '';

let ok = 0, ng = 0;
const say = m => process.stdout.write(m + '\n');
function group(n){ say('\n■ ' + n); }
function t(label, cond, info){ if(cond){ ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '\n    → ' + JSON.stringify(info) : '')); } }
function eq(label, got, want){ const g = JSON.stringify(got), w = JSON.stringify(want); t(label, g === w, g === w ? undefined : { 期待: want, 実際: got }); }

/* 関数を名前で切り出す（master_fullguard_test.js と同じ作法） */
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
async function flush(n){ for(let k = 0; k < (n || 6); k++) await new Promise(r => setImmediate(r)); }

/* 架空の名簿（2名）。氏名は作り物 */
const ROS = [
  { id: 901, name: '架空A', kana: 'かくうえー', room: '901', gender: '', careLevel: '', active: true, birthDate: '1940-01-01', height: '160' },
  { id: 902, name: '架空B', kana: 'かくうびー', room: '902', gender: '', careLevel: '', active: true, birthDate: '1938-02-02', height: '150' }
];
const OLD_ROS = [{ id: 909, name: '架空Z', kana: 'かくうぜっと', room: '909', active: true, birthDate: '1930-03-03', height: '155' }];
const MARK = '{"目印":"共有名簿は書き換えられていない"}';
const RMARK = '{"目印":"一覧キャッシュは書き換えられていない"}';

/* 直す前の版には無いことがある名前（G7 で旧版を読む時は、旧版に有る時だけ切り出す。
   旧版が 23089f2 相当なら全部無い・006442b 相当なら全部有る） */
const NEW_VARS = ['devGen'];
const NEW_FNS = ['devDirty_', 'devReload_', 'onDeviceRoleStorage_'];
const hasVar = (src, n) => src.indexOf('\nvar ' + n + '=') >= 0;
const hasFn = (src, n) => src.indexOf('\nfunction ' + n + '(') >= 0;

function load(src, old){
  const store = new Map();
  const calls = [];
  const cnt = { renderView: 0, renderRoster: 0, setSync: [], toast: [], shadow: [], srevSeen: 0,
    reload: 0, alert: [], closeSync: 0, loadData: 0, setViewActions: [], paintHospBtn: [],
    showScreen: [], saveOpenId: [], paintShBars: 0, paintAdmBar: 0, paintMealBar: 0, certEnsureFresh_: 0, patchDayUse: 0,
    bkMarkStale_: 0, renderBulk: 0, navEnter: 0, pushState: 0, back: 0, closeBulk: 0 };
  const els = {};
  function fakeEl(id){
    if(!els[id]){
      const cls = new Set();
      els[id] = { id, value: '', textContent: '', disabled: false, hidden: false,
        setAttribute(){}, addEventListener(){},
        classList: { toggle(c, on){ if(on === undefined) on = !cls.has(c); if(on) cls.add(c); else cls.delete(c); return on; },
          remove(c){ cls.delete(c); }, add(c){ cls.add(c); }, contains(c){ return cls.has(c); } } };
    }
    return els[id];
  }
  function deferred(tag, args, timeout){
    let res, rej;
    const p = new Promise((a, b) => { res = a; rej = b; });
    const c = { tag, args, timeout, done: false, resolve(v){ c.done = true; res(v); }, reject(e){ c.done = true; rej(e || new Error('架空の通信失敗')); } };
    calls.push(c);
    return p;
  }
  const shadow = { push(r){ cnt.shadow.push(r.length); } };
  const listeners = {};   // window.addEventListener で登録された受け口（storage・pageshow）
  const box = {
    localStorage: { getItem(k){ return store.has(k) ? store.get(k) : null; }, setItem(k, v){ store.set(k, String(v)); }, removeItem(k){ store.delete(k); } },
    DEVICE_KEY: 'su_device_role', ROSTER_KEY: 'rmaster_roster',
    CFG: { url: 'https://example.invalid/exec', token: '', vmaUrl: '' },
    $: fakeEl,
    /* openResident・a4EnsureDayMap・bkEnsure・admEnsure・mealLoad は実物を切り出す（下の fns。G9〜G12 で使う） */
    /* showScreen・navEnter・navLeave・navTopModal と popstate の受け口は実物を切り出す（下の fns・lines）。
       呼ばれた回数だけは、切り出した後に実物を包んで数える（cnt.showScreen） */
    saveOpenId(v){ cnt.saveOpenId.push(v); },
    a4Off(){}, fitBdaySheet(){}, closeApps(){}, closeBulk(){ cnt.closeBulk++; }, msClose_(){ return true; }, mdPrintCancel_(){},
    /* history は pushState / back を数える偽物。back() は実物と同じく、少し後に popstate の受け口を呼ぶ（前の段＝state なし） */
    history: { pushState(){ cnt.pushState++; }, back(){ cnt.back++; setImmediate(() => { if(listeners.popstate) listeners.popstate({ state: null }); }); } },
    bkMarkStale_(){ cnt.bkMarkStale_++; },
    /* G13: 詳細の保存（saveResident）・食形態一覧の保存（mealSaveGo）・一括編集の読み込み（openBulk）用の偽物 */
    /* 画面の入力の代わり。保存を出す時の編集対象（editing＝実物の var。vm の大域は box のプロパティ）の番号を使う */
    collectForm(){ return { id: box.editing ? box.editing.id : null, name: '架空N' }; },
    apiPostRaw(body, timeout){ return deferred('apiPostRaw:' + (body && body.action), body, timeout); },
    document: { querySelectorAll(){ return []; } }, confirm(){ return true; },
    mealOnInput_(){}, renderBulk(){ cnt.renderBulk++; }, navEnter(){ cnt.navEnter++; },
    patchDayUse(){ cnt.patchDayUse++; },
    paintShBars(){ cnt.paintShBars++; }, paintAdmBar(){ cnt.paintAdmBar++; }, paintMealBar(){ cnt.paintMealBar++; },
    certEnsureFresh_(){ cnt.certEnsureFresh_++; }, fitMealSheet(){}, mealScreenReset_(){}, mdEnsure(){},
    esc: s => String(s), curView: 'std',
    apiGetRetry(args, timeout){ return deferred('apiGetRetry:' + (args && args.action), args, timeout); },
    fetchWithTimeout(url, opt, ms){ return deferred('fetch', { url, opt }, ms); },
    setViewActions(on){ cnt.setViewActions.push(on); },
    paintHospBtn(r){ cnt.paintHospBtn.push(r); },
    toast(m){ cnt.toast.push(String(m)); }, setSync(m, c){ cnt.setSync.push([m, c || '']); },
    renderRoster(){ cnt.renderRoster++; }, renderView(){ cnt.renderView++; },
    srevSeen(){ cnt.srevSeen++; }, srevPickMeta(){ return null; },
    /* closeSync は数える偽物。実物と同じく同期設定（mSync）の on を外す（popstate で勝手に閉じられたかを見るため） */
    closeSync(){ cnt.closeSync++; fakeEl('mSync').classList.remove('on'); }, loadData(){ cnt.loadData++; },
    alert(m){ cnt.alert.push(String(m)); },
    location: { reload(){ cnt.reload++; } },
    apiGet(args, timeout){ return deferred('apiGet:' + (args && args.action), args, timeout); },
    apiPost(body, timeout){ return deferred('apiPost:' + (body && body.action), body, timeout); },
    /* applyDeviceGuard が触る他機能の控え（このテストでは偽物で足りる。a4・bk・adm・meal の var は実物を切り出す） */
    fullMap: null, fullBad: null, fullGen: 0, fullLoading: false, fullErr: '', fullDone: 0, fullTotal: 0,
    mdDict: null, mdMap: null, mdGen: 0, mdPromise: null, mdPromiseRetry: false, mdLoading: false, mdErr: '', mdShowHidden: false,
    mdDirty: false,
    /* ★mdClearPending_ と保留の5つ（mdEdits・mdDels・mdNew・mdHides・mdRenames）は実物を切り出す（下の vars・fns）。
       偽物（何もしない関数）だと、未保存の編集を黙って捨てる欠陥を検出できなかった（2026-10-01） */
    msGen: 0, msRows: null, msRemote: null, msAuthSt: null, msBusy: false,
    bulkDirty: {}
  };
  box.SUMasterShadow = shadow;
  box.window = { SUMasterShadow: shadow, addEventListener(type, fn){ listeners[type] = fn; }, scrollTo(){} };
  /* reload が呼ばれた時点の状態（ブロック表示・用途）を控える＝「ブロックしてから読み込み直す」順序の検査用 */
  cnt.reloadAt = [];
  box.location.reload = function(){ cnt.reload++; cnt.reloadAt.push([fakeEl('deviceBlock').classList.contains('on'), box.getDeviceRole()]); };
  vm.createContext(box);
  const vars = ['roster', 'COMMON_KEY', 'COMMON_FIELDS', 'CFG_KEY', 'admMap', 'mealDirty', 'curResident',
    'mdEdits', 'mdDels', 'mdNew', 'mdHides', 'mdRenames',
    /* G9〜G12: 帳票（bk）・入居日（adm＝上の admMap の行に admLoading・admErr も入っている）・食形態一覧（meal）・デイ利用日（a4） */
    'bkRows', 'bkStale_', 'MEAL_KEYS', 'mealRows', 'mealLoading', 'mealSaving', 'mealMsg', 'mealSeq',
    'A4_DAY_TTL', 'A4_DAY_FAIL_TTL', 'a4DayMap', 'a4DayPromise', 'a4DayFailAt', 'A4_GAS_RE',
    /* G13: editing の行に editBaseUpdatedAt も入っている。bulkRows の行に bulkDirty・bulkLoading も入っている */
    'editing', 'MEAL_EDIT', 'MEAL_EDIT_LABEL', 'MEAL_MAX_LEN', 'bulkRows', '_navPushed'].concat(NEW_VARS.filter(n => !old || hasVar(src, n)))
    /* 入院/退院の結果の控え（2026-10-02 追加・openResident が見る）。それより前の版には無いので、有る時だけ */
    .concat(['hospPend_'].filter(n => hasVar(src, n)))
    /* 薬の変更候補（2026-10-06 追加）。applyDeviceGuard が現場用への切り替えで mcPurge_ を呼ぶ。それより前の版には無いので、有る時だけ */
    .concat(['mcGen', 'mcCur', 'mcBulk'].filter(n => hasVar(src, n)));
  const fns = ['getDeviceRole', 'setDeviceRole', 'loadRosterCache', 'saveRosterCache', 'refreshRoster', '_toTargetArr', '_ymd',
    'normRosterRow', 'writeCommonRoster', 'mealDirtyCells', 'bulkCellCount', 'toggleHosp', 'afterSaveOk_',
    'applyDeviceGuard', 'saveSyncCfg', 'mdClearPending_',
    'bkEnsure', 'admEnsure', 'mealPick_', 'mealSetMsg_', 'mealLoad', 'a4NmKey', 'a4SyncTarget', 'a4HM', 'a4BuildDayMap',
    'a4EnsureDayMap', 'a4DayFail_', 'openResident',
    'saveResident', 'saveStampSame_', 'mealDirtyPeople', 'mealRowOf', 'mealWho', 'mealNamed', 'verifyAppliedRows_', 'famCmp_',
    'bulkTruthy', 'mealSaveGo', 'openBulk', 'showScreen', 'navEnter', 'navLeave', 'navTopModal'].concat(NEW_FNS.filter(n => !old || hasFn(src, n)))
    /* toggleHosp が使う案内の文言の関数（2026-10-02 追加）。それより前の版には無いので、有る時だけ切り出す */
    .concat(['hospWho_', 'hospDoneMsg_', 'hospOnList_', 'hospNote_', 'hospApplyPend_'].filter(n => hasFn(src, n)))
    .concat(['mcPurge_'].filter(n => hasFn(src, n)));
  /* storage・pageshow の受け口（トップレベルの1行）も実物から切り出して登録させる（旧版は有る時だけ） */
  const lines = ['storage', 'pageshow'].map(type => {
    const m = src.match(new RegExp("\\nwindow\\.addEventListener\\('" + type + "',[^\\n]*\\n"));
    if(!m){ if(old) return ''; throw new Error('受け口が見つかりません: ' + type); }
    return m[0].trim();
  });
  /* popstate の受け口（複数行。行頭の "});" まで）も実物から切り出して登録させる */
  const pi = src.indexOf("\nwindow.addEventListener('popstate',function(ev){");
  if(pi < 0) throw new Error('受け口が見つかりません: popstate');
  const pe = src.indexOf('\n});', pi);
  lines.push(src.slice(pi + 1, pe + 4));
  const code = vars.map(n => grabVar(src, n)).concat(fns.map(n => grabFn(src, n)), lines).join('\n');
  vm.runInContext(code, box, { filename: 'resident-master.html(deviceguard)' });
  /* 2026-10-10: 設定の保存は、URL が変わる時に「入居者マスタのGASか」を確かめてから書く（verifyMasterUrl・通信あり）。
     この試験は端末の用途の切り替えを見るものなので、確かめは「入居者マスタだった」をその場で返す代役に置き換える
     （確かめそのものの試験は gas/tests/master_target_verdict_test.js）。古い版には確かめが無いので代役は使われない。 */
  box.verifyMasterUrl = function(){ return { then: function(f){ f('ok'); return this; } }; };
  /* 実物の showScreen を包んで、呼ばれた画面名を数える（中身は実物のまま） */
  box.__countShow = n => cnt.showScreen.push(n);
  vm.runInContext('var __realShowScreen=showScreen; showScreen=function(n){ __countShow(n); return __realShowScreen(n); };', box);
  const v = name => vm.runInContext(name, box);
  const set = js => vm.runInContext(js, box);
  const last = tag => calls.filter(c => c.tag === tag).slice(-1)[0];
  function toField(){ box.setDeviceRole('field'); return box.applyDeviceGuard(); }
  function toOffice(){ box.setDeviceRole('office'); return box.applyDeviceGuard(); }
  function common(){ try{ return JSON.parse(store.get('su_residents_common')); }catch(e){ return null; } }
  function cfgForm(url, token, role){ fakeEl('cfgUrl').value = url; fakeEl('cfgToken').value = token; fakeEl('cfgVmaUrl').value = ''; fakeEl('cfgDeviceRole').value = role; }
  return { box, v, set, calls, cnt, store, els, last, toField, toOffice, common, cfgForm, listeners };
}

/* 薬効辞書の保留（未保存の編集）。値は架空の薬剤名だけ（個人情報は入れない） */
function mdMarks(L){
  L.set('mdDirty=true; mdEdits["架空薬A"]="架空の効能（未保存）"; mdDels["架空薬B"]=true; mdHides["架空薬C"]=true;' +
        ' mdRenames["架空薬D"]="架空薬D2"; mdNew.push({name:"架空薬E"});');
}
function mdPending(L){
  return JSON.parse(L.v('JSON.stringify({edits:mdEdits,dels:mdDels,hides:mdHides,renames:mdRenames,news:mdNew,dirty:mdDirty})'));
}
const MD_MARKED = { edits: { '架空薬A': '架空の効能（未保存）' }, dels: { '架空薬B': true }, hides: { '架空薬C': true },
  renames: { '架空薬D': '架空薬D2' }, news: [{ name: '架空薬E' }], dirty: true };
const MD_EMPTY = { edits: {}, dels: {}, hides: {}, renames: {}, news: [], dirty: false };

/* G9〜G12・G7-3 用: 帳票・入居日・食形態一覧・デイ利用日・1人ぶんの記録の取得を、偽物の通信で動かす。
   値は架空（id 901＝新しい応答、909＝切り替えより前に出した古い応答の目印） */
const A4_EP = 'https://script.google.com/macros/s/FAKE-TEST/exec';
function a4Resp(mid, name){
  return { text(){ return Promise.resolve(JSON.stringify({ ok: true, data: { residents: [
    { masterId: mid, name: name, events: [{ serviceType: 'daycare', dayOfWeek: 0, startTime: '09:00', endTime: '16:00' }] }] } })); } };
}
const a4Mids = L => { const m = L.v('a4DayMap'); return m ? Object.keys(m.allMid) : null; };
const bkResp = mid => ({ rows: [{ id: mid, cmOffice: '架空居宅' + mid, admissionDate: '2020-04-01' }] });
const admResp = mid => ({ rows: [{ id: mid, admissionDate: mid === 909 ? '1999-09-09' : '2020-04-01' }] });
const mealResp = mid => ({ rows: [{ id: mid, name: '架空' + mid, room: String(mid), allergy: '架空アレルギー' }] });
const recResp = mid => ({ record: { id: mid, name: '架空' + mid, medsRegular: '架空薬A 1錠 朝' } });
/* 種類ごとに「通信を出す・どの通信か・控えを読む・取得中の印を読む」をまとめる */
const KINDS = {
  bkEnsure: { start: L => L.box.bkEnsure(false), tag: 'apiGet:getBulk', resp: bkResp,
    val: L => { const r = L.v('bkRows'); return r ? r.map(x => x.id) : null; }, busy: L => L.v('bkLoading') },
  admEnsure: { start: L => L.box.admEnsure(), tag: 'apiGet:getBulk', resp: admResp,
    val: L => { const m = L.v('admMap'); return m ? Object.keys(m).map(Number) : null; }, busy: L => L.v('admLoading') },
  mealLoad: { start: L => L.box.mealLoad(false), tag: 'apiGetRetry:getMealList', resp: mealResp,
    val: L => { const r = L.v('mealRows'); return r ? r.map(x => x.id) : null; }, busy: L => L.v('mealLoading') },
  a4EnsureDayMap: { start: L => { L.store.set('su_sync_common', JSON.stringify({ endpoint: A4_EP, token: '' })); return L.box.a4EnsureDayMap(); },
    tag: 'fetch', resp: mid => a4Resp(mid, '架空' + mid),
    val: L => { const m = a4Mids(L); return m ? m.map(Number) : null; }, busy: L => L.v('a4DayPromise') !== null }
};

async function main(){
  const SRC = fs.readFileSync(HTML_PATH, 'utf8');
  say('対象: ' + HTML_PATH);

  /* ── G1. 保存の出口 ── */
  group('G1. 保存の出口（saveRosterCache・writeCommonRoster）');
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    L.store.set('su_device_role', 'field');
    L.store.set('su_residents_common', MARK);
    L.store.set('rmaster_roster', RMARK);
    L.box.saveRosterCache();
    L.box.writeCommonRoster();
    eq('field: saveRosterCache は書かない（目印が残る）', L.store.get('rmaster_roster'), RMARK);
    eq('field: writeCommonRoster は書かない（目印が残る）', L.store.get('su_residents_common'), MARK);
  }
  {
    const L = load(SRC);
    const rows = [
      { id: 901, name: '架空A', kana: 'かくうえー', room: '901', active: true, birthDate: '1940-01-01', height: '160', hospitalized: true, targetApps: ['weight', 'haiben'] },
      { id: 902, name: '架空B', kana: 'かくうびー', room: '902', active: true, birthDate: '1938-02-02', height: '' },
      { id: 903, name: '架空C', kana: 'かくうしー', room: '903', active: false, birthDate: '1935-05-05', height: '150', hospitalized: false, dischargeDate: '2026-09-01' }
    ];
    L.set('roster=' + JSON.stringify(rows) + ';');
    L.store.set('su_residents_common', MARK);
    L.store.set('rmaster_roster', RMARK);
    L.box.saveRosterCache();
    L.box.writeCommonRoster();
    let rc = null; try{ rc = JSON.parse(L.store.get('rmaster_roster')); }catch(e){}
    eq('office: saveRosterCache は roster をそのまま書く', rc, rows);
    const c = L.common();
    const r = c && c.residents || [];
    eq('office: 共有名簿 v=1・3名', [c && c.v, r.length], [1, 3]);
    eq('office: masterId・name・height', r.map(x => [x.masterId, x.name, x.height]), [[901, '架空A', '160'], [902, '架空B', ''], [903, '架空C', '150']]);
    eq('office: hospitalized はキーがある時だけ', r.map(x => ('hospitalized' in x) ? x.hospitalized : '(無し)'), [true, '(無し)', false]);
    eq('office: dischargeDate は退去者だけ', r.map(x => ('dischargeDate' in x) ? x.dischargeDate : '(無し)'), ['(無し)', '(無し)', '2026-09-01']);
    eq('office: targetApps はある時だけ', r.map(x => x.targetApps || '(無し)'), [['weight', 'haiben'], '(無し)', '(無し)']);
    t('office: 共有名簿に生年月日を載せない', !JSON.stringify(c).includes('1940-01-01'));
  }
  {
    const L = load(SRC);
    eq('起動直後の rosterPurged_ は false', L.v('rosterPurged_'), false);
    L.set('roster=' + JSON.stringify(ROS) + ';rosterPurged_=true;');
    L.store.set('su_residents_common', MARK);
    L.store.set('rmaster_roster', RMARK);
    L.box.saveRosterCache();
    L.box.writeCommonRoster();
    eq('office・rosterPurged_=true: saveRosterCache は書かない（目印が残る）', L.store.get('rmaster_roster'), RMARK);
    eq('office・rosterPurged_=true: writeCommonRoster は書かない（目印が残る）', L.store.get('su_residents_common'), MARK);
    L.set('rosterPurged_=false;');
    L.box.saveRosterCache();
    L.box.writeCommonRoster();
    t('office・rosterPurged_=false: 従来どおり書く（一覧キャッシュ・共有名簿とも2名）',
      (L.store.get('rmaster_roster') || '').includes('架空B') && (L.common() && L.common().residents || []).length === 2);
  }

  /* ── G2. refreshRoster ── */
  group('G2. refreshRoster（事務所PCの通常動作・現場端末・読み込み中の切り替え）');
  {
    const L = load(SRC);
    L.store.set('su_residents_common', MARK);
    const p = L.box.refreshRoster();
    await flush();
    eq('office: getRoster を1回出す', L.calls.map(c => c.tag), ['apiGet:getRoster']);
    L.last('apiGet:getRoster').resolve({ roster: ROS, stateRev: 3 });
    const ret = await p;
    eq('office: 戻り値 true', ret, true);
    const rc = L.store.get('rmaster_roster') || '';
    t('office: 一覧キャッシュに書く', rc.includes('架空A') && rc.includes('架空B'), { 文字数: rc.length });
    eq('office: 共有名簿 2名', (L.common() && L.common().residents || []).map(x => x.masterId), [901, 902]);
    eq('office: SUMasterShadow.push に2名', L.cnt.shadow, [2]);
    eq('office: 版数を更新（srevSeen 1回）・同期OK', [L.cnt.srevSeen, L.cnt.setSync.slice(-1)[0]], [1, ['同期OK', 'ok']]);
  }
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    L.store.set('su_residents_common', MARK);
    const p = L.box.refreshRoster();
    await flush();
    L.last('apiGet:getRoster').resolve({ roster: [] });
    const ret = await p;
    eq('office: サーバー空×ローカル非空 → 戻り値 true・roster は保持', [ret, L.v('roster').length], [true, 2]);
    t('office: 空上書き保護の toast が出る', L.cnt.toast.some(m => m.includes('空の一覧')), L.cnt.toast);
    eq('office: 空上書き保護で共有名簿は目印のまま', L.store.get('su_residents_common'), MARK);
    eq('office: 状態表示は「要確認」', L.cnt.setSync.slice(-1)[0], ['要確認（サーバー応答が空）', 'err']);
  }
  {
    const L = load(SRC);
    const p = L.box.refreshRoster();
    await flush();
    L.last('apiGet:getRoster').reject(new Error('架空の通信失敗'));
    const ret = await p;
    eq('office: 通信失敗で false', ret, false);
    t('office: 通信失敗の toast が出る', L.cnt.toast.some(m => m.includes('一覧の取得に失敗')), L.cnt.toast);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    const ret = await L.box.refreshRoster();
    await flush();
    eq('field: 通信0回・戻り値 false', [L.calls.length, ret], [0, false]);
  }
  {
    const L = load(SRC);
    L.store.set('su_residents_common', MARK);
    const p = L.box.refreshRoster();
    await flush();
    eq('読み込み中に切り替え: applyDeviceGuard の戻り値は true', L.toField(), true);
    const r0 = L.cnt.renderRoster, s0 = L.cnt.setSync.length;
    L.last('apiGet:getRoster').resolve({ roster: ROS, stateRev: 5 });
    const ret = await p;
    await flush();
    eq('切り替え後の応答: 戻り値 false', ret, false);
    t('切り替え後の応答: rmaster_roster が無い', !L.store.has('rmaster_roster'), L.store.get('rmaster_roster'));
    eq('切り替え後の応答: 共有名簿は目印のまま', L.store.get('su_residents_common'), MARK);
    eq('切り替え後の応答: roster は空', L.v('roster'), []);
    eq('切り替え後の応答: renderRoster・setSync が呼ばれない', [L.cnt.renderRoster - r0, L.cnt.setSync.length - s0], [0, 0]);
    eq('切り替え後の応答: 版数を更新しない・Shadow へ送らない', [L.cnt.srevSeen, L.cnt.shadow], [0, []]);
  }
  {
    const L = load(SRC);
    const p = L.box.refreshRoster();
    await flush();
    L.toField();
    const t0 = L.cnt.toast.length, s0 = L.cnt.setSync.length;
    L.last('apiGet:getRoster').reject(new Error('架空の通信失敗'));
    const ret = await p;
    eq('切り替え後に reject で届く: 戻り値 false・toast/setSync なし', [ret, L.cnt.toast.length - t0, L.cnt.setSync.length - s0], [false, 0, 0]);
  }
  {
    const L = load(SRC);
    L.store.set('su_residents_common', MARK);
    const p1 = L.box.refreshRoster();
    await flush();
    const c1 = L.last('apiGet:getRoster');
    L.toField();
    L.box.setDeviceRole('office');
    eq('office へ戻すと applyDeviceGuard の戻り値は false', L.box.applyDeviceGuard(), false);
    const p2 = L.box.refreshRoster();
    await flush();
    const c2 = L.last('apiGet:getRoster');
    t('office へ戻した後の refreshRoster は新しく通信を出す', c2 && c2 !== c1, { 通信: L.calls.length });
    c1.resolve({ roster: OLD_ROS, stateRev: 1 });
    eq('古い応答（切り替え前に出したもの）は false', await p1, false);
    eq('古い応答で roster は空のまま・共有名簿は目印のまま', [L.v('roster'), L.store.get('su_residents_common')], [[], MARK]);
    c2.resolve({ roster: ROS, stateRev: 2 });
    eq('新しい応答は true', await p2, true);
    const rc = L.store.get('rmaster_roster') || '';
    eq('新しい roster は2名（架空A・架空B）', L.v('roster').map(r => r.name), ['架空A', '架空B']);
    t('一覧キャッシュに古い応答が混ざらない', rc.includes('架空A') && !rc.includes('架空Z'), { 文字数: rc.length });
    eq('共有名簿も新しい2名', (L.common() && L.common().residents || []).map(x => x.name), ['架空A', '架空B']);
  }
  {
    const L = load(SRC);
    L.store.set('su_residents_common', MARK);
    L.toField();
    L.toOffice();
    eq('field→office へ戻した直後: rosterPurged_=true のまま', L.v('rosterPurged_'), true);
    const p = L.box.refreshRoster();
    await flush();
    L.last('apiGet:getRoster').resolve({ roster: ROS, stateRev: 7 });
    eq('戻した後の refreshRoster 成功: 戻り値 true・rosterPurged_=false', [await p, L.v('rosterPurged_')], [true, false]);
    const rc = L.store.get('rmaster_roster') || '';
    t('戻した後の refreshRoster 成功: 一覧キャッシュに全員ぶん', rc.includes('架空A') && rc.includes('架空B'), { 文字数: rc.length });
    eq('戻した後の refreshRoster 成功: 共有名簿に全員ぶん', (L.common() && L.common().residents || []).map(x => x.masterId), [901, 902]);
  }
  {
    const L = load(SRC);
    L.store.set('su_residents_common', MARK);
    L.toField();
    L.toOffice();
    /* 戻した後に1人ぶん保存できて roster が1名だけ（ローカル非空）になった所へ、サーバーが空を返す */
    L.box.afterSaveOk_({ id: 901, name: '架空A' }, { id: 901, name: '架空A', birthDate: '1940-01-01' });
    const p = L.box.refreshRoster();
    await flush();
    L.last('apiGet:getRoster').resolve({ roster: [] });
    eq('サーバー空応答（emptyGuarded）: 戻り値 true・rosterPurged_ は下りない', [await p, L.v('rosterPurged_')], [true, true]);
    eq('サーバー空応答（emptyGuarded）: 共有名簿は目印のまま・rmaster_roster 無し', [L.store.get('su_residents_common'), L.store.has('rmaster_roster')], [MARK, false]);
  }

  /* ── G3. applyDeviceGuard ── */
  group('G3. applyDeviceGuard（世代・控えの破棄・未保存は残す）');
  {
    const L = load(SRC);
    eq('office: 戻り値 false・devGen は 0 のまま・devBlocked_=false', [L.box.applyDeviceGuard(), L.v('devGen'), L.v('devBlocked_')], [false, 0, false]);
    L.set('admMap={"901":"2020-04-01"};mealRows=[{id:901,allergy:"架空アレルギー"}];curResident={id:901,name:"架空A",medsRegular:"架空薬A 1錠 朝"};mealDirty={"901":{allergy:"架空の未保存"}};');
    L.box.$('viewBox').textContent = '架空Aの詳細';
    const blocked = L.toField();
    eq('field: 戻り値 true・devGen=1・devBlocked_=true', [blocked, L.v('devGen'), L.v('devBlocked_')], [true, 1, true]);
    eq('field: admMap・mealRows・curResident が null', [L.v('admMap'), L.v('mealRows'), L.v('curResident')], [null, null, null]);
    eq('field: setViewActions(false)・paintHospBtn(null) が呼ばれる', [L.cnt.setViewActions.slice(-1)[0], L.cnt.paintHospBtn.slice(-1)[0]], [false, null]);
    eq('field: 詳細画面の中身を空にする', L.box.$('viewBox').textContent, '');
    eq('field: 未保存の入力（mealDirty）は残る', L.v('mealDirty'), { '901': { allergy: '架空の未保存' } });
    t('field: ブロック表示', L.els.deviceBlock.classList.contains('on'));
    L.box.setDeviceRole('office');
    eq('office へ戻す: 戻り値 false・devGen は 1 のまま・devBlocked_=false', [L.box.applyDeviceGuard(), L.v('devGen'), L.v('devBlocked_')], [false, 1, false]);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    eq('office: applyDeviceGuard は rosterPurged_ を立てない', L.v('rosterPurged_'), false);
    L.toField();
    eq('field: applyDeviceGuard が rosterPurged_=true にする', L.v('rosterPurged_'), true);
    L.toOffice();
    eq('office へ戻しても applyDeviceGuard は rosterPurged_ を触らない（true のまま）', L.v('rosterPurged_'), true);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    mdMarks(L);
    L.set('mdDirty=false;');   // 目印は入れるが「未保存なし」の扱い
    L.toField();
    eq('薬効辞書に未保存なし（mdDirty=false）で field: 従来どおり保留が全部空になる', mdPending(L), MD_EMPTY);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.set('mdDict=[{name:"架空薬A"}]; mdMap={"架空薬A":{}}; mdGen=3;');
    mdMarks(L);
    L.toField();
    eq('薬効辞書に未保存あり（mdDirty=true）で field: 5つとも目印が残る・mdDirty は true のまま', mdPending(L), MD_MARKED);
    eq('薬効辞書に未保存ありで field: mdDict・mdMap は null（控えは捨てる）・mdGen は進む', [L.v('mdDict'), L.v('mdMap'), L.v('mdGen')], [null, null, 4]);
  }

  /* ── G4. 入院トグル・保存の後処理 ── */
  group('G4. 入院トグル（toggleHosp）・保存の後処理（afterSaveOk_）の応答が切り替え後に届く');
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';curResident={id:901,name:"架空A",hospitalized:false};');
    L.store.set('su_residents_common', MARK);
    L.box.toggleHosp();
    await flush();
    L.last('apiPost:setState').resolve({ ok: true, hospitalized: true, hospitalizedAt: 'T1' });
    await flush();
    const c = L.common();
    eq('office（デグレ確認）: 入院トグルで共有名簿2名・901 が入院中', c && c.residents.map(x => [x.masterId, x.hospitalized]), [[901, true], [902, undefined]]);
  }
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';curResident={id:901,name:"架空A",hospitalized:false};');
    L.box.toggleHosp();
    await flush();
    L.last('apiPost:setState').reject(new Error('架空の通信失敗'));
    await flush();
    eq('office（デグレ確認）: 入院トグルの失敗では取り直しの確認（getResident）を1本出す', L.calls.filter(c => c.tag === 'apiGet:getResident').length, 1);
  }
  for(const how of ['成功', '失敗']){
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';curResident={id:901,name:"架空A",hospitalized:false};');
    L.store.set('su_residents_common', MARK);
    L.box.toggleHosp();
    await flush();
    eq('入院トグル（' + how + '）: 通信中はボタンが押せない', L.els.hospBtn.disabled, true);
    L.toField();
    const t0 = L.cnt.toast.length;
    if(how === '成功') L.last('apiPost:setState').resolve({ ok: true, hospitalized: true, hospitalizedAt: 'T1' });
    else L.last('apiPost:setState').reject(new Error('架空の通信失敗'));
    await flush();
    eq('入院トグル（' + how + '）: 切り替え後は getResident の通信を1本も出さない', L.calls.filter(c => c.tag === 'apiGet:getResident').length, 0);
    eq('入院トグル（' + how + '）: toast が出ない', L.cnt.toast.slice(t0), []);
    eq('入院トグル（' + how + '）: ボタンの disabled が戻る', L.els.hospBtn.disabled, false);
    eq('入院トグル（' + how + '）: 共有名簿は目印のまま', L.store.get('su_residents_common'), MARK);
    t('入院トグル（' + how + '）: rmaster_roster が無い', !L.store.has('rmaster_roster'), L.store.get('rmaster_roster'));
  }
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    L.store.set('su_residents_common', MARK);
    L.box.afterSaveOk_({ id: 901, name: '架空A' }, { id: 901, name: '架空A2', birthDate: '1940-01-01' });
    await flush();
    eq('office（デグレ確認）: 保存の後処理で共有名簿2名・901 の氏名が更新', (L.common() && L.common().residents || []).map(x => x.name), ['架空A2', '架空B']);
  }
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    L.store.set('su_residents_common', MARK);
    L.toField();
    L.box.afterSaveOk_({ id: 901, name: '架空A' }, { id: 901, name: '架空A', birthDate: '1940-01-01', medsRegular: '架空薬A 1錠 朝' });
    await flush();
    eq('保存の後処理: 共有名簿は目印のまま', L.store.get('su_residents_common'), MARK);
    t('保存の後処理: rmaster_roster が無い', !L.store.has('rmaster_roster'), L.store.get('rmaster_roster'));
  }

  /* 本題: 通信中に field へ切り替え → office へ戻す → その後に応答が届く（別タブで切り替え＋未保存ありで読み込み直さなかった時） */
  async function refreshAll(L){
    const p = L.box.refreshRoster();
    await flush();
    L.last('apiGet:getRoster').resolve({ roster: ROS.map(r => Object.assign({}, r, r.id === 901 ? { hospitalized: true } : {})), stateRev: 9 });
    return p;
  }
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';curResident={id:901,name:"架空A",hospitalized:false};');
    L.store.set('su_residents_common', MARK);
    L.box.toggleHosp();
    await flush();
    L.toField();
    L.toOffice();
    L.last('apiPost:setState').resolve({ ok: true, hospitalized: true, hospitalizedAt: 'T1' });
    await flush();
    eq('入院トグル（field→office の後に応答）: 共有名簿は目印のまま', L.store.get('su_residents_common'), MARK);
    t('入院トグル（field→office の後に応答）: rmaster_roster が無い', !L.store.has('rmaster_roster'), L.store.get('rmaster_roster'));
    eq('入院トグル（field→office の後に応答）: 続く refreshRoster 成功で true', await refreshAll(L), true);
    eq('入院トグル（field→office の後に応答）: 共有名簿が全員ぶんで書かれる', (L.common() && L.common().residents || []).map(x => [x.masterId, x.hospitalized]), [[901, true], [902, undefined]]);
    t('入院トグル（field→office の後に応答）: 一覧キャッシュも全員ぶん', (L.store.get('rmaster_roster') || '').includes('架空B'));
  }
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    L.store.set('su_residents_common', MARK);
    L.toField();
    L.toOffice();
    L.box.afterSaveOk_({ id: 901, name: '架空A' }, { id: 901, name: '架空A', birthDate: '1940-01-01' });
    await flush();
    eq('保存の後処理（field→office の後に応答）: 共有名簿は目印のまま（1名に縮まない）', L.store.get('su_residents_common'), MARK);
    t('保存の後処理（field→office の後に応答）: rmaster_roster が無い', !L.store.has('rmaster_roster'), L.store.get('rmaster_roster'));
    eq('保存の後処理（field→office の後に応答）: 続く refreshRoster 成功で true', await refreshAll(L), true);
    eq('保存の後処理（field→office の後に応答）: 共有名簿が全員ぶんで書かれる', (L.common() && L.common().residents || []).map(x => x.masterId), [901, 902]);
    t('保存の後処理（field→office の後に応答）: 一覧キャッシュも全員ぶん', (L.store.get('rmaster_roster') || '').includes('架空B'));
  }

  /* ── G5. saveSyncCfg ── */
  group('G5. saveSyncCfg（現場用への切り替えは読み込み直す・未保存があれば止める）');
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.cfgForm('https://example.invalid/new', 'tok-架空', 'field');
    L.box.saveSyncCfg();
    let cfg = null; try{ cfg = JSON.parse(L.store.get('rmaster_cfg')); }catch(e){}
    eq('office→field（未保存なし）: 用途 field', L.box.getDeviceRole(), 'field');
    eq('office→field（未保存なし）: rmaster_cfg に url/token', cfg && [cfg.url, cfg.token], ['https://example.invalid/new', 'tok-架空']);
    eq('office→field（未保存なし）: reload 1回・closeSync 0回・loadData 0回', [L.cnt.reload, L.cnt.closeSync, L.cnt.loadData], [1, 0, 0]);
    t('office→field（未保存なし）: 読み込み直す前にブロック表示', L.els.deviceBlock.classList.contains('on') && L.v('devGen') === 1);
    eq('office→field（未保存なし）: alert は出ない', L.cnt.alert, []);
    eq('office→field（未保存なし）: reload の時点でブロック表示 on・用途 field（順序）', L.cnt.reloadAt, [[true, 'field']]);
  }
  if(hasFn(SRC, 'mcPurge_')){
    /* 薬の変更候補（申送の本文・定期薬を持つ）も、現場用へ切り替えた時に捨てる（2026-10-06・applyDeviceGuard → mcPurge_） */
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.set('mcSt={cands:[{srcKey:"S|901|2026-10-05|aaaaaaaa"}]}; mcCur={c:{}}; mcBulk={sel:{}};');
    const g0 = L.v('mcGen');
    L.store.set('su_device_role', 'field'); L.box.applyDeviceGuard();
    eq('現場用へ切り替えると薬の変更候補（mcSt・mcCur・mcBulk）を捨て、世代を進める', [L.v('mcSt'), L.v('mcCur'), L.v('mcBulk'), L.v('mcGen') > g0], [null, null, null, true]);
  }
  const dirtyCases = [
    ['食形態一覧', L => L.set('mealDirty={"901":{allergy:"架空の未保存"}};')],
    ['薬効辞書', L => mdMarks(L)],   // mdDirty=true と保留5つに目印（下で中身が残ることも見る）
    ['一括編集', L => L.set('bulkDirty={"901":{room:"999"}};')],
    ['編集画面（開いたまま）', L => L.box.$('sc-edit').classList.add('on')]
  ];
  for(const [name, make] of dirtyCases){
    const L = load(SRC);
    L.box.applyDeviceGuard();
    make(L);
    L.cfgForm('https://example.invalid/new', 'tok-架空', 'field');
    L.box.saveSyncCfg();
    t('office→field（未保存あり: ' + name + '）: alert に場所の名前', L.cnt.alert.length === 1 && L.cnt.alert[0].includes(name), L.cnt.alert);
    eq('office→field（未保存あり: ' + name + '）: 用途 office のまま・rmaster_cfg 無し・CFG.url 変わらず・reload 0回',
      [L.box.getDeviceRole(), L.store.has('rmaster_cfg'), L.box.CFG.url, L.cnt.reload], ['office', false, 'https://example.invalid/exec', 0]);
    if(name === '薬効辞書') eq('office→field（未保存あり: 薬効辞書）: 保留（5つ）と mdDirty が残る', mdPending(L), MD_MARKED);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.cfgForm('https://example.invalid/new', 'tok-架空', 'office');
    L.box.saveSyncCfg();
    eq('office→office: reload 0回・closeSync 1回・loadData 1回', [L.cnt.reload, L.cnt.closeSync, L.cnt.loadData], [0, 1, 1]);
    t('office→office: rmaster_cfg を保存', (L.store.get('rmaster_cfg') || '').includes('example.invalid/new'));
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.set('mealDirty={"901":{allergy:"架空の未保存"}};');
    L.cfgForm('https://example.invalid/new', 'tok-架空', 'office');
    L.box.saveSyncCfg();
    eq('office→office（未保存あり）: 止めない（alert 0・loadData 1）', [L.cnt.alert.length, L.cnt.loadData], [0, 1]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyDeviceGuard();
    L.cfgForm('https://example.invalid/exec', '', 'field');
    L.box.saveSyncCfg();
    eq('field（ブロック中）→field: reload 0回・loadData 0回・alert 0', [L.cnt.reload, L.cnt.loadData, L.cnt.alert.length], [0, 0, 0]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyDeviceGuard();
    L.cfgForm('https://example.invalid/exec', '', 'office');
    L.box.saveSyncCfg();
    eq('field→office: 用途 office・loadData 1回・reload 0回', [L.box.getDeviceRole(), L.cnt.loadData, L.cnt.reload], ['office', 1, 0]);
    t('field→office: ブロック表示が外れる', !L.els.deviceBlock.classList.contains('on'));
  }

  /* ── G6. onDeviceRoleStorage_ ── */
  group('G6. onDeviceRoleStorage_（別タブで用途が変わった時）');
  t('storage の受け口が window に登録されている', /window\.addEventListener\('storage',function\(e\)\{ try\{ onDeviceRoleStorage_\(e\); \}catch\(err\)\{\} \}\);/.test(SRC));
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.store.set('su_device_role', 'field');
    L.box.onDeviceRoleStorage_({ key: 'su_device_role' });
    eq('field・未保存なし: ブロック＋reload 1回', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [true, 1]);
    eq('field・未保存なし: reload の時点でブロック表示 on・用途 field（順序）', L.cnt.reloadAt, [[true, 'field']]);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.set('mealDirty={"901":{allergy:"架空の未保存"}};');
    L.store.set('su_device_role', 'field');
    L.box.onDeviceRoleStorage_({ key: 'su_device_role' });
    eq('field・未保存あり: ブロックのみ・reload 0回・未保存は残る', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload, L.v('mealDirtyCells()')], [true, 0, 1]);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.store.set('su_device_role', 'field');
    L.box.onDeviceRoleStorage_({ key: 'rmaster_cfg' });
    eq('別のキー: 何もしない（ブロックなし・reload 0・devGen 0）', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload, L.v('devGen')], [false, 0, 0]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyDeviceGuard();
    L.box.onDeviceRoleStorage_({ key: 'su_device_role' });
    eq('すでにブロック中: 何もしない（reload 0・devGen 1 のまま）', [L.cnt.reload, L.v('devGen')], [0, 1]);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.store.set('su_device_role', 'field');
    L.box.onDeviceRoleStorage_({ key: null });
    eq('key が null でも field なら効く（ブロック＋reload 1回）', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [true, 1]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyDeviceGuard();
    L.store.set('su_device_role', 'office');
    L.box.onDeviceRoleStorage_({ key: 'su_device_role' });
    eq('office になった通知: 何もしない（ブロックのまま・reload 0・loadData 0）', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload, L.cnt.loadData], [true, 0, 0]);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.box.onDeviceRoleStorage_({ key: 'su_device_role' });
    eq('office のまま su_device_role の通知: 何もしない', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [false, 0]);
  }
  {
    const L = load(SRC);
    t('実物の storage の受け口で field の通知を流すと効く', (() => {
      L.box.applyDeviceGuard();
      L.store.set('su_device_role', 'field');
      if(typeof L.listeners.storage !== 'function') return false;
      L.listeners.storage({ key: 'su_device_role' });
      return L.els.deviceBlock.classList.contains('on') && L.cnt.reload === 1;
    })(), { 登録: Object.keys(L.listeners), reload: L.cnt.reload });
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    mdMarks(L);   // 薬効辞書だけが未保存
    eq('薬効辞書だけ未保存: devDirty_() は ["薬効辞書"]', L.box.devDirty_(), ['薬効辞書']);
    L.store.set('su_device_role', 'field');
    L.listeners.storage({ key: 'su_device_role' });
    eq('薬効辞書だけ未保存で storage の通知: ブロックのみ・reload 0回', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [true, 0]);
    eq('薬効辞書だけ未保存で storage の通知: 保留（5つ）と mdDirty が残る', mdPending(L), MD_MARKED);
    eq('薬効辞書だけ未保存で storage の通知の後も devDirty_() は ["薬効辞書"]', L.box.devDirty_(), ['薬効辞書']);
    eq('続けて office へ戻す: applyDeviceGuard の戻り値 false', L.toOffice(), false);
    eq('続けて office へ戻す: 保留（5つ）と mdDirty が残ったまま', mdPending(L), MD_MARKED);
  }

  group('G6-2. pageshow（「戻る」でページ保存から復元された時）');
  t('pageshow の受け口が window に登録されている（ソース）', /window\.addEventListener\('pageshow',function\(e\)\{ try\{ if\(e&&e\.persisted\) onDeviceRoleStorage_\(\{key:DEVICE_KEY\}\); \}catch\(err\)\{\} \}\);/.test(SRC));
  {
    const L = load(SRC);
    eq('pageshow の受け口が登録される（実物の行を評価）', typeof L.listeners.pageshow, 'function');
    L.box.applyDeviceGuard();
    L.store.set('su_device_role', 'field');
    L.listeners.pageshow({ persisted: false });
    eq('persisted=false: 何もしない（ブロックなし・reload 0・devGen 0）', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload, L.v('devGen')], [false, 0, 0]);
    L.listeners.pageshow({ persisted: true });
    eq('persisted=true・field・未保存なし: ブロック＋reload 1回', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [true, 1]);
    eq('persisted=true: reload の時点でブロック表示 on・用途 field（順序）', L.cnt.reloadAt, [[true, 'field']]);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.set('bulkDirty={"901":{room:"999"}};');
    L.store.set('su_device_role', 'field');
    L.listeners.pageshow({ persisted: true });
    eq('persisted=true・field・未保存あり: ブロックのみ・reload 0回', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [true, 0]);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    mdMarks(L);   // 薬効辞書だけが未保存
    L.store.set('su_device_role', 'field');
    L.listeners.pageshow({ persisted: true });
    eq('persisted=true・薬効辞書だけ未保存: ブロックのみ・reload 0回', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [true, 0]);
    eq('persisted=true・薬効辞書だけ未保存: 保留（5つ）と mdDirty が残る', mdPending(L), MD_MARKED);
    eq('persisted=true・薬効辞書だけ未保存: devDirty_() は ["薬効辞書"]', L.box.devDirty_(), ['薬効辞書']);
  }
  {
    const L = load(SRC);
    L.box.applyDeviceGuard();
    L.listeners.pageshow({ persisted: true });
    eq('persisted=true・office のまま: 何もしない', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [false, 0]);
  }
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.applyDeviceGuard();
    L.listeners.pageshow({ persisted: true });
    eq('persisted=true・すでにブロック中: 何もしない（reload 0・devGen 1 のまま）', [L.cnt.reload, L.v('devGen')], [0, 1]);
  }

  /* ── G9. ブロックのみの場面で、切り替えより前に出した通信の応答が遅れて届く ── */
  group('G9. ブロックのみの場面で、切り替えより前に出した通信の応答が遅れて届く');
  for(const how of ['resolve', 'reject']){
    const L = load(SRC);
    L.set("curView='cm';");
    L.box.bkEnsure(false);
    await flush();
    const c = L.last('apiGet:getBulk');
    L.toField();
    const p0 = L.cnt.paintShBars, r0 = L.cnt.renderRoster, ce0 = L.cnt.certEnsureFresh_;
    if(how === 'resolve') c.resolve(bkResp(909)); else c.reject();
    await flush();
    eq('bkEnsure（' + how + '）: bkRows null・bkLoading false・bkErr ""', [L.v('bkRows'), L.v('bkLoading'), L.v('bkErr')], [null, false, '']);
    eq('bkEnsure（' + how + '）: 切り替え後に paintShBars・renderRoster・certEnsureFresh_ が呼ばれない',
      [L.cnt.paintShBars - p0, L.cnt.renderRoster - r0, L.cnt.certEnsureFresh_ - ce0], [0, 0, 0]);
  }
  for(const how of ['resolve', 'reject']){
    const L = load(SRC);
    L.set("curView='adm';");
    L.box.admEnsure();
    await flush();
    const c = L.last('apiGet:getBulk');
    L.toField();
    const p0 = L.cnt.paintAdmBar, r0 = L.cnt.renderRoster;
    if(how === 'resolve') c.resolve(admResp(909)); else c.reject();
    await flush();
    eq('admEnsure（' + how + '）: admMap null・admLoading false・admErr ""', [L.v('admMap'), L.v('admLoading'), L.v('admErr')], [null, false, '']);
    eq('admEnsure（' + how + '）: 切り替え後に paintAdmBar・renderRoster が呼ばれない', [L.cnt.paintAdmBar - p0, L.cnt.renderRoster - r0], [0, 0]);
  }
  for(const how of ['resolve', 'reject']){
    const L = load(SRC);
    L.set('mealDirty={"901":{allergy:"架空の未保存"}};');
    L.box.mealLoad(false);
    await flush();
    const c = L.last('apiGetRetry:getMealList');
    L.toField();
    const r0 = L.cnt.renderRoster;
    if(how === 'resolve') c.resolve(mealResp(909)); else c.reject(new Error('架空の通信失敗'));
    await flush();
    eq('mealLoad（' + how + '）: mealRows null・mealLoading false・mealMsg ""', [L.v('mealRows'), L.v('mealLoading'), L.v('mealMsg')], [null, false, '']);
    eq('mealLoad（' + how + '）: 未保存 mealDirty は残る', L.v('mealDirty'), { '901': { allergy: '架空の未保存' } });
    eq('mealLoad（' + how + '）: 切り替え後に renderRoster が呼ばれない', L.cnt.renderRoster - r0, 0);
  }
  for(const how of ['resolve', 'reject']){
    const L = load(SRC);
    const p = KINDS.a4EnsureDayMap.start(L);
    await flush();
    const c = L.last('fetch');
    L.toField();
    if(how === 'resolve') c.resolve(a4Resp(909, '架空Z')); else c.reject(new Error('架空の通信失敗'));
    const msg = await p;
    await flush();
    eq('a4EnsureDayMap（' + how + '）: a4DayMap null・失敗の印（a4DayFailAt）が立たない・戻り値 ""', [L.v('a4DayMap'), L.v('a4DayFailAt'), msg], [null, 0, '']);
  }
  for(const how of ['resolve', 'reject']){
    const L = load(SRC);
    L.box.openResident(901);
    await flush();
    const c = L.last('apiGetRetry:getResident');
    L.toField();
    const rv0 = L.cnt.renderView, sv0 = L.cnt.setViewActions.length, so0 = L.cnt.saveOpenId.length;
    if(how === 'resolve') c.resolve(recResp(901)); else c.reject(Object.assign(new Error('該当データなし'), { gone: true }));
    await flush();
    eq('openResident（' + how + '）: curResident null・renderView が呼ばれない・setViewActions/saveOpenId も呼ばれない',
      [L.v('curResident'), L.cnt.renderView - rv0, L.cnt.setViewActions.length - sv0, L.cnt.saveOpenId.length - so0], [null, 0, 0, 0]);
    t('openResident（' + how + '）: viewBox に失敗表示を書かない', !String(L.els.viewBox.innerHTML || '').includes('取得に失敗'), L.els.viewBox.innerHTML);
  }
  for(const back of [false, true]){
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    const dg = L.v('devGen');
    L.toField();
    if(back) L.toOffice();
    const ss0 = L.cnt.showScreen.length, rv0 = L.cnt.renderView, so0 = L.cnt.saveOpenId.length;
    L.box.afterSaveOk_({ id: 903, name: '架空C' }, { id: 903, name: '架空C', birthDate: '1935-05-05', medsRegular: '架空薬A 1錠 朝' }, dg);
    await flush();
    const tag = back ? '（field→office へ戻した後）' : '';
    eq('afterSaveOk_ に古い dg' + tag + ': roster に行を足さない・curResident null', [L.v('roster'), L.v('curResident')], [[], null]);
    eq('afterSaveOk_ に古い dg' + tag + ': showScreen・renderView・saveOpenId が呼ばれない',
      [L.cnt.showScreen.length - ss0, L.cnt.renderView - rv0, L.cnt.saveOpenId.length - so0], [0, 0, 0]);
  }
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    L.box.afterSaveOk_({ id: 903, name: '架空C' }, { id: 903, name: '架空C', birthDate: '1935-05-05' });
    eq('afterSaveOk_ に dg を渡さない（undefined）: 従来どおり roster に足し・詳細画面へ・記録を入れる',
      [L.v('roster').map(r => r.id), L.cnt.showScreen.slice(-1)[0], (L.v('curResident') || {}).id, L.cnt.saveOpenId.slice(-1)[0], L.cnt.renderView], [[901, 902, 903], 'view', 903, 903, 1]);
  }
  {
    const L = load(SRC);
    L.toField();
    L.toOffice();
    const dg = L.v('devGen');
    L.box.afterSaveOk_({ id: 903, name: '架空C' }, { id: 903, name: '架空C', birthDate: '1935-05-05' }, dg);
    eq('afterSaveOk_ に今の devGen と同じ dg: 従来どおり動く（roster に足し・詳細画面へ・記録を入れる）',
      [L.v('roster').map(r => r.id), L.cnt.showScreen.slice(-1)[0], (L.v('curResident') || {}).id], [[903], 'view', 903]);
  }

  /* ── G10. 往復（field→office へ戻す）しても古い応答が混ざらない ── */
  group('G10. 往復（field→office へ戻す）しても古い応答が混ざらない');
  for(const name of Object.keys(KINDS)){
    const K = KINDS[name];
    const L = load(SRC);
    const p1 = K.start(L);
    await flush();
    const c1 = L.last(K.tag);
    L.toField();
    L.toOffice();
    const p2 = K.start(L);
    await flush();
    const c2 = L.last(K.tag);
    t(name + ': office へ戻した後に新しい取得が始まる', !!c2 && c2 !== c1 && K.busy(L) === true, { 通信: L.calls.length, 取得中: K.busy(L) });
    c1.resolve(K.resp(909));
    await flush();
    eq(name + ': 古い応答が届いても新しい取得の印は消えない・古い値が入らない', [K.busy(L), K.val(L)], [true, null]);
    c2.resolve(K.resp(901));
    await flush();
    if(p1 && p1.then){ await p1; } if(p2 && p2.then){ await p2; }
    eq(name + ': 新しい応答で新しい値が入る・取得中の印が下りる', [K.val(L), K.busy(L)], [[901], false]);
  }

  /* ── G11. 事務所PCのまま（デグレ確認） ── */
  group('G11. 事務所PCのまま（デグレ確認）');
  {
    const L = load(SRC);
    L.set("curView='cm';");
    L.box.bkEnsure(false);
    await flush();
    L.last('apiGet:getBulk').resolve(bkResp(901));
    await flush();
    eq('bkEnsure: bkRows に入る・bkLoading false・bkErr ""・一覧を描き直す', [KINDS.bkEnsure.val(L), L.v('bkLoading'), L.v('bkErr'), L.cnt.renderRoster], [[901], false, '', 1]);
    L.box.bkEnsure(true);
    await flush();
    L.last('apiGet:getBulk').resolve({ rows: [] });
    await flush();
    eq('bkEnsure: 空応答は従来の文言', [L.v('bkErr'), L.v('bkLoading')], ['取得できませんでした（0件）', false]);
    L.box.bkEnsure(true);
    await flush();
    L.last('apiGet:getBulk').reject();
    await flush();
    eq('bkEnsure: 通信失敗は従来の文言', [L.v('bkErr'), L.v('bkLoading')], ['取得できませんでした（通信）', false]);
  }
  {
    const L = load(SRC);
    L.box.admEnsure();
    await flush();
    L.last('apiGet:getBulk').resolve(admResp(901));
    await flush();
    eq('admEnsure: admMap に入る・admLoading false・admErr ""', [L.v('admMap'), L.v('admLoading'), L.v('admErr')], [{ '901': '2020-04-01' }, false, '']);
  }
  {
    const L = load(SRC);
    L.box.admEnsure();
    await flush();
    L.last('apiGet:getBulk').reject();
    await flush();
    eq('admEnsure: 通信失敗は従来の文言', [L.v('admErr'), L.v('admLoading')], ['入居日を取得できませんでした（通信）', false]);
  }
  {
    const L = load(SRC);
    L.box.mealLoad(false);
    await flush();
    L.last('apiGetRetry:getMealList').resolve(mealResp(901));
    await flush();
    eq('mealLoad: mealRows に入る・mealLoading false・mealMsg ""', [KINDS.mealLoad.val(L), L.v('mealLoading'), L.v('mealMsg')], [[901], false, '']);
  }
  {
    const L = load(SRC);
    L.box.mealLoad(false);
    await flush();
    L.last('apiGetRetry:getMealList').reject(new Error('架空の通信失敗'));
    await flush();
    eq('mealLoad: 通信失敗は従来の文言・mealRows null・mealLoading false', [L.v('mealMsg'), L.v('mealRows'), L.v('mealLoading')], ['取得に失敗しました: 架空の通信失敗', null, false]);
  }
  {
    const L = load(SRC);
    const p = KINDS.a4EnsureDayMap.start(L);
    await flush();
    L.last('fetch').resolve(a4Resp(901, '架空A'));
    eq('a4EnsureDayMap: 戻り値 ""', await p, '');
    eq('a4EnsureDayMap: a4DayMap に入る・a4DayPromise null・a4DayFailAt 0', [a4Mids(L), L.v('a4DayPromise'), L.v('a4DayFailAt')], [['901'], null, 0]);
  }
  {
    const L = load(SRC);
    const p = KINDS.a4EnsureDayMap.start(L);
    await flush();
    L.last('fetch').reject(new Error('架空の通信失敗'));
    const msg = await p;
    eq('a4EnsureDayMap: 通信失敗は従来の文言・a4DayPromise null', [msg, L.v('a4DayPromise')], ['週間計画を取得できなかったため、デイ利用欄は「未確認」で印刷します', null]);
    t('a4EnsureDayMap: 通信失敗で失敗の印（a4DayFailAt）が立つ', L.v('a4DayFailAt') > 0, L.v('a4DayFailAt'));
  }
  {
    const L = load(SRC);
    L.box.openResident(901);
    await flush();
    L.last('apiGetRetry:getResident').resolve(recResp(901));
    await flush();
    eq('openResident: curResident に入る・renderView 1回・setViewActions(true)', [(L.v('curResident') || {}).id, L.cnt.renderView, L.cnt.setViewActions.slice(-1)[0]], [901, 1, true]);
  }
  {
    const L = load(SRC);
    L.box.openResident(901);
    await flush();
    L.last('apiGetRetry:getResident').reject(new Error('架空の通信失敗'));
    await flush();
    t('openResident: 通信失敗は従来の失敗表示（もう一度読み込むボタンつき）', String(L.els.viewBox.innerHTML).includes('取得に失敗しました: 架空の通信失敗') && String(L.els.viewBox.innerHTML).includes('viewRetry'), L.els.viewBox.innerHTML);
  }

  /* ── G12. 現場端末では取りに行かない ── */
  group('G12. 現場端末では取りに行かない');
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.bkEnsure(false); L.box.bkEnsure(true);
    L.box.admEnsure();
    L.box.mealLoad(false); L.box.mealLoad(true);
    await flush();
    eq('field: bkEnsure(false/true)・admEnsure()・mealLoad(false/true) の通信 0回', L.calls.map(c => c.tag), []);
    eq('field: 取得中の印も立たない', [L.v('bkLoading'), L.v('admLoading'), L.v('mealLoading')], [false, false, false]);
  }

  /* ── G13. 保存の応答が切り替え後に届く（N1）・食形態一覧の保存の確認（N2）・一括編集（N3）・openResident（N4） ── */
  group('G13-1. 詳細の保存（saveResident）の応答が、現場用への切り替え後に届く');
  /* 編集画面を開いた状態を作る（openEdit の代わり）。新規登録は editing.id=null */
  function openEditFake(L, id){ L.set('editing={id:' + (id == null ? 'null' : id) + ',active:true,family:[],rhythm:{}};'); L.box.showScreen('edit'); }
  const savedRec = (L, id) => ({ record: { id: id, name: '架空N', updatedAt: L.last('apiPost:saveResident').args.record.updatedAt } });
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    openEditFake(L, null);
    L.box.saveResident();
    await flush();
    L.toField();   // 編集画面が開いている＝未保存あり（読み込み直さずブロックだけの場面）
    const t0 = L.cnt.toast.length, ss0 = L.cnt.showScreen.length, rv0 = L.cnt.renderView, bm0 = L.cnt.bkMarkStale_;
    L.last('apiPost:saveResident').resolve({ record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } });
    await flush();
    eq('新規登録・ブロックのみ: トースト1回', L.cnt.toast.slice(t0).length, 1);
    eq('新規登録・ブロックのみ: 編集画面が閉じる（showScreen("list") 1回）', L.cnt.showScreen.slice(ss0), ['list']);
    t('新規登録・ブロックのみ: 編集画面の on が外れる', !L.els['sc-edit'].classList.contains('on'));
    eq('新規登録・ブロックのみ: curResident null・renderView 0回・roster に行を足さない', [L.v('curResident'), L.cnt.renderView - rv0, L.v('roster')], [null, 0, []]);
    eq('新規登録・ブロックのみ: bkMarkStale_ 1回', L.cnt.bkMarkStale_ - bm0, 1);
    eq('新規登録・ブロックのみ: 他に未保存が無いので reload 1回（ブロック表示 on・用途 field の時点で）', [L.cnt.reload, L.cnt.reloadAt], [1, [[true, 'field']]]);
    eq('新規登録・ブロックのみ: 保存ボタンは押せる状態へ戻る', L.els.saveBtn.disabled, false);
  }
  {
    const L = load(SRC);
    openEditFake(L, null);
    L.set('mealDirty={"901":{allergy:"架空の未保存"}};');
    L.box.saveResident();
    await flush();
    L.toField();
    const ss0 = L.cnt.showScreen.length;
    L.last('apiPost:saveResident').resolve({ record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } });
    await flush();
    eq('食形態一覧にも未保存がある: 編集画面は閉じる・reload 0回', [L.cnt.showScreen.slice(ss0), L.cnt.reload], [['list'], 0]);
  }
  {
    const L = load(SRC);
    L.store.set('su_residents_common', MARK);
    openEditFake(L, null);
    L.box.saveResident();
    await flush();
    L.toField();
    L.toOffice();
    const ss0 = L.cnt.showScreen.length;
    L.last('apiPost:saveResident').resolve({ record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } });
    await flush();
    eq('往復（field→office の後に応答）: 編集画面が閉じる・reload 0回', [L.cnt.showScreen.slice(ss0), L.cnt.reload], [['list'], 0]);
    eq('往復: rmaster_roster 無し・共有名簿は目印のまま・rosterPurged_ のまま', [L.store.has('rmaster_roster'), L.store.get('su_residents_common'), L.v('rosterPurged_')], [false, MARK, true]);
  }
  {
    const L = load(SRC);
    openEditFake(L, null);
    L.box.saveResident();
    await flush();
    L.toField();
    L.toOffice();
    openEditFake(L, 902);   // 保存を出した後に、別の方の編集画面を開いた（editing が別のオブジェクト）
    const ss0 = L.cnt.showScreen.length;
    L.last('apiPost:saveResident').resolve({ record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } });
    await flush();
    eq('保存の後に別の編集対象へ変わっている: showScreen を呼ばない・編集画面は開いたまま', [L.cnt.showScreen.slice(ss0), L.els['sc-edit'].classList.contains('on')], [[], true]);
  }
  {
    const L = load(SRC);
    L.set('roster=' + JSON.stringify(ROS) + ';');
    openEditFake(L, null);
    L.box.saveResident();
    await flush();
    const ss0 = L.cnt.showScreen.length;
    L.last('apiPost:saveResident').resolve({ record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } });
    await flush();
    eq('事務所PCのまま（デグレ確認）: 詳細画面へ移る・curResident が入る・roster に足す・保存ボタンが戻る・reload 0',
      [L.cnt.showScreen.slice(ss0), (L.v('curResident') || {}).id, L.v('roster').map(r => r.id), L.els.saveBtn.disabled, L.cnt.reload], [['view'], 950, [901, 902, 950], false, 0]);
  }
  {
    /* 失敗→取り直し確認で保存を確かめた側の呼び出し（afterSaveOk_(rec,got,dg,ed)）も dg と ed を渡していること */
    const L = load(SRC);
    openEditFake(L, 901);
    L.box.saveResident();
    await flush();
    const stamp = L.last('apiPost:saveResident').args.record.updatedAt;
    L.last('apiPost:saveResident').reject(new Error('架空の通信失敗'));
    await flush();
    const g = L.last('apiGet:getResident');
    t('失敗→取り直し確認: getResident を出す', !!g, L.calls.map(c => c.tag));
    L.toField();
    const ss0 = L.cnt.showScreen.length, rv0 = L.cnt.renderView;
    if(g) g.resolve({ record: { id: 901, name: '架空N', updatedAt: stamp } });
    await flush();
    eq('失敗→取り直し確認・ブロックのみ: 編集画面が閉じる（ed が渡っている）・curResident null・renderView 0（dg が渡っている）・reload 1',
      [L.cnt.showScreen.slice(ss0), L.v('curResident'), L.cnt.renderView - rv0, L.cnt.reload], [['list'], null, 0, 1]);
    t('失敗→取り直し確認: 保存を確かめた知らせが出る', L.cnt.toast.some(m => m.includes('保存されていることを確認しました')), L.cnt.toast);
  }

  /* P1: 古い世代の保存の応答で編集画面を閉じる時、「戻る」（history.back）を出さない */
  {
    const L = load(SRC);
    openEditFake(L, null);
    eq('（前提）編集画面を開くと履歴を1段積む（pushState 1回）', L.cnt.pushState, 1);
    L.box.saveResident();
    await flush();
    L.toField();
    const b0 = L.cnt.back;
    L.last('apiPost:saveResident').resolve({ record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } });
    await flush();
    eq('古い世代の応答で編集画面を閉じる: history.back 0回・sc-edit off・sc-list on',
      [L.cnt.back - b0, L.els['sc-edit'].classList.contains('on'), L.els['sc-list'].classList.contains('on')], [0, false, true]);
    eq('同期設定を開いていない時は従来どおり reload 1回', L.cnt.reload, 1);
  }
  {
    const L = load(SRC);
    openEditFake(L, null);
    L.box.saveResident();
    await flush();
    L.toField();
    /* 管理者がブロック画面の「管理者の方」から同期設定を開いた状態 */
    L.els.deviceBlock.classList.remove('on');
    L.box.$('mSync').classList.add('on');
    const cs0 = L.cnt.closeSync;
    L.last('apiPost:saveResident').resolve({ record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } });
    await flush();
    eq('同期設定を開いている最中に応答: mSync は on のまま・closeSync 0回・reload 0回・編集画面は閉じる',
      [L.box.$('mSync').classList.contains('on'), L.cnt.closeSync - cs0, L.cnt.reload, L.els['sc-edit'].classList.contains('on')], [true, 0, 0, false]);
  }
  /* Q1（2026-10-02）: 事務所PCへ戻した後に古い応答で編集画面を閉じる時は、従来どおり「戻る」で積んだ段を消費する。
     現場用のまま・ダイアログ（同期設定・一括編集など）を開いている最中だけ「戻る」を出さない */
  async function saveThenRoundTrip(L){
    openEditFake(L, null);
    L.box.saveResident();
    await flush();
    L.toField();
    L.toOffice();
  }
  const staleSaved = { record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } };
  {
    const L = load(SRC);
    await saveThenRoundTrip(L);
    eq('（前提）往復の後も積んだ段が残っている（_navPushed=true）', L.v('_navPushed'), true);
    const b0 = L.cnt.back, cs0 = L.cnt.closeSync, cb0 = L.cnt.closeBulk;
    L.last('apiPost:saveResident').resolve(staleSaved);
    await flush();
    eq('Q1 往復・ダイアログなし: 編集画面が閉じる・history.back 1回・popstate の後 _navPushed=false・sc-list on',
      [L.els['sc-edit'].classList.contains('on'), L.cnt.back - b0, L.v('_navPushed'), L.els['sc-list'].classList.contains('on')], [false, 1, false, true]);
    eq('Q1 往復・ダイアログなし: 同期設定・一括編集は触られない（closeSync・closeBulk 0回・mSync/mBulk off のまま）・reload 0回',
      [L.cnt.closeSync - cs0, L.cnt.closeBulk - cb0, L.box.$('mSync').classList.contains('on'), L.box.$('mBulk').classList.contains('on'), L.cnt.reload], [0, 0, false, false, 0]);
  }
  {
    const L = load(SRC);
    await saveThenRoundTrip(L);
    L.box.$('mSync').classList.add('on');   // office へ戻した後に、もう一度同期設定を開いた
    const b0 = L.cnt.back, cs0 = L.cnt.closeSync;
    L.last('apiPost:saveResident').resolve(staleSaved);
    await flush();
    eq('Q1 往復で同期設定を開いている最中: history.back 0回・mSync は on のまま・closeSync 0回・編集画面は閉じる',
      [L.cnt.back - b0, L.box.$('mSync').classList.contains('on'), L.cnt.closeSync - cs0, L.els['sc-edit'].classList.contains('on')], [0, true, 0, false]);
  }
  {
    const L = load(SRC);
    await saveThenRoundTrip(L);
    L.box.$('mBulk').classList.add('on');   // office へ戻した後に、一括編集を開いた
    const b0 = L.cnt.back, cb0 = L.cnt.closeBulk;
    L.last('apiPost:saveResident').resolve(staleSaved);
    await flush();
    eq('Q1 往復で一括編集を開いている最中: history.back 0回・mBulk は on のまま・closeBulk 0回・編集画面は閉じる',
      [L.cnt.back - b0, L.box.$('mBulk').classList.contains('on'), L.cnt.closeBulk - cb0, L.els['sc-edit'].classList.contains('on')], [0, true, 0, false]);
  }
  {
    const L = load(SRC);
    openEditFake(L, null);
    L.box.saveResident();
    await flush();
    L.toField();
    L.set('mealDirty={"901":{allergy:"架空の未保存"}};');   // 読み込み直さない場面にして、閉じた後の段を見る
    const b0 = L.cnt.back;
    L.last('apiPost:saveResident').resolve(staleSaved);
    await flush();
    eq('Q1 現場用のまま届く: history.back 0回のまま・_navPushed=true のまま（段は起動時の処理が消費する）・reload 0回',
      [L.cnt.back - b0, L.v('_navPushed'), L.cnt.reload], [0, true, 0]);
  }
  {
    const L = load(SRC);
    openEditFake(L, null);
    L.box.saveResident();
    await flush();
    const b0 = L.cnt.back;
    L.last('apiPost:saveResident').resolve(staleSaved);
    await flush();
    eq('Q1 事務所PCのまま（デグレ確認）: 従来どおり詳細画面へ移る・history.back 0回・_navPushed=true（詳細画面の段）',
      [L.cnt.showScreen.slice(-1)[0], L.cnt.back - b0, L.v('_navPushed'), (L.v('curResident') || {}).id], ['view', 0, true, 950]);
  }

  /* P2: editBaseUpdatedAt を別の方の編集画面へ書き込まない */
  for(const path of ['成功側', '失敗→取り直し確認側']){
    const L = load(SRC);
    openEditFake(L, 901);
    L.box.saveResident();
    await flush();
    const stamp = L.last('apiPost:saveResident').args.record.updatedAt;
    if(path === '失敗→取り直し確認側'){ L.last('apiPost:saveResident').reject(new Error('架空の通信失敗')); await flush(); }
    L.toField();
    L.toOffice();
    openEditFake(L, 902);   // 別の方の編集画面を開いた
    L.set('editBaseUpdatedAt="目印-別の方の照合時刻";');
    if(path === '成功側') L.last('apiPost:saveResident').resolve({ record: { id: 901, name: '架空N', updatedAt: stamp } });
    else L.last('apiGet:getResident').resolve({ record: { id: 901, name: '架空N', updatedAt: stamp } });
    await flush();
    eq('P2（' + path + '）: 別の方の編集を開いた後に古い応答 → editBaseUpdatedAt は目印のまま', L.v('editBaseUpdatedAt'), '目印-別の方の照合時刻');
  }
  for(const path of ['成功側', '失敗→取り直し確認側']){
    const L = load(SRC);
    openEditFake(L, 901);
    L.box.saveResident();
    await flush();
    const stamp = L.last('apiPost:saveResident').args.record.updatedAt;
    if(path === '失敗→取り直し確認側'){ L.last('apiPost:saveResident').reject(new Error('架空の通信失敗')); await flush(); }
    L.toField();
    L.toOffice();
    L.set('editBaseUpdatedAt="目印-保存前";');
    if(path === '成功側') L.last('apiPost:saveResident').resolve({ record: { id: 901, name: '架空N', updatedAt: stamp } });
    else L.last('apiGet:getResident').resolve({ record: { id: 901, name: '架空N', updatedAt: stamp } });
    await flush();
    eq('P2（' + path + '）: 同じ編集画面のまま古い応答 → editBaseUpdatedAt は更新される', L.v('editBaseUpdatedAt'), stamp);
  }
  for(const path of ['成功側', '失敗→取り直し確認側']){
    const L = load(SRC);
    openEditFake(L, 901);
    L.box.saveResident();
    await flush();
    const stamp = L.last('apiPost:saveResident').args.record.updatedAt;
    if(path === '失敗→取り直し確認側'){ L.last('apiPost:saveResident').reject(new Error('架空の通信失敗')); await flush(); }
    openEditFake(L, 902);   // 事務所PCのまま別の方を開いても、従来どおり更新される（dg===devGen）
    L.set('editBaseUpdatedAt="目印-保存前";');
    if(path === '成功側') L.last('apiPost:saveResident').resolve({ record: { id: 901, name: '架空N', updatedAt: stamp } });
    else L.last('apiGet:getResident').resolve({ record: { id: 901, name: '架空N', updatedAt: stamp } });
    await flush();
    eq('P2（' + path + '）: 事務所PCのまま → 従来どおり editBaseUpdatedAt を更新する', L.v('editBaseUpdatedAt'), stamp);
  }

  group('G13-2. 食形態一覧（mealSeq は進めない・mealLoad は devGen で捨てる・保存の確認は捨てない）');
  {
    const L = load(SRC);
    L.set('mealSeq=5;');
    L.toField();
    eq('applyDeviceGuard で mealSeq が進まない', L.v('mealSeq'), 5);
  }
  {
    const L = load(SRC);
    L.box.mealLoad(false);
    await flush();
    L.last('apiGetRetry:getMealList').resolve({ rows: [
      { id: 901, name: '架空A', room: '901', allergy: '旧A' }, { id: 902, name: '架空B', room: '902', allergy: '旧B' }] });
    await flush();
    L.set('mealDirty={"901":{allergy:"新A"},"902":{allergy:"新B"}};');
    L.box.mealSaveGo();
    await flush();
    const ps = L.last('apiPostRaw:saveMealList');
    t('mealSaveGo: saveMealList を送る・mealSaving=true', !!ps && L.v('mealSaving') === true, { 通信: L.calls.map(c => c.tag) });
    if(ps) ps.reject(new Error('架空の通信失敗'));
    await flush();
    const g = L.last('apiGet:getMealList');
    t('mealSaveGo: 失敗→getMealList で実物を確かめに行く', !!g, L.calls.map(c => c.tag));
    L.toField();   // 確認中にブロック（食形態一覧に未保存あり＝読み込み直さない場面）
    if(g) g.resolve({ rows: [{ id: 901, name: '架空A', room: '901', allergy: '新A' }, { id: 902, name: '架空B', room: '902', allergy: '旧B' }] });
    await flush();
    eq('確認中にブロックされても: 保存できた方（901）の未保存の印は消え、できなかった方（902）は残る', L.v('mealDirty'), { '902': { allergy: '新B' } });
    eq('確認中にブロックされても: mealSaving は false に戻る', L.v('mealSaving'), false);
  }

  group('G13-3. 一括編集の読み込み（openBulk）');
  for(const how of ['resolve', 'reject']){
    const L = load(SRC);
    L.box.openBulk();
    await flush();
    const c = L.last('apiGet:getBulk');
    eq('openBulk（' + how + '）: 読み込み中の印が立つ', L.v('bulkLoading'), true);
    L.toField();
    if(how === 'resolve') c.resolve(bkResp(909)); else c.reject(new Error('架空の通信失敗'));
    await flush();
    eq('openBulk（' + how + '）: 切り替え後に届いても bulkRows null・renderBulk 0回・bulkLoading=false',
      [L.v('bulkRows'), L.cnt.renderBulk, L.v('bulkLoading')], [null, 0, false]);
    t('openBulk（' + how + '）: 失敗表示を書かない', !String(L.els.bulkScroll.innerHTML || '').includes('取得に失敗'), L.els.bulkScroll.innerHTML);
  }
  {
    const L = load(SRC);
    L.box.openBulk();
    await flush();
    L.last('apiGet:getBulk').resolve({ rows: [{ id: 902, room: '902', kana: 'かくうびー' }, { id: 901, room: '901', kana: 'かくうえー' }] });
    await flush();
    eq('openBulk 事務所PCのまま（デグレ確認）: 居室順に並べて bulkRows へ・renderBulk 1回・bulkLoading=false',
      [(L.v('bulkRows') || []).map(r => r.id), L.cnt.renderBulk, L.v('bulkLoading')], [[901, 902], 1, false]);
  }
  {
    const L = load(SRC);
    L.box.openBulk();
    await flush();
    L.last('apiGet:getBulk').reject(new Error('架空の通信失敗'));
    await flush();
    t('openBulk 事務所PCのまま: 通信失敗は従来の失敗表示', String(L.els.bulkScroll.innerHTML).includes('取得に失敗しました: 架空の通信失敗') && L.v('bulkLoading') === false, L.els.bulkScroll.innerHTML);
  }

  /* P3: 開いたままの一括編集を「読み込み中…」のまま止めない */
  {
    const L = load(SRC);
    L.box.openBulk();
    await flush();
    const c = L.last('apiGet:getBulk');
    L.toField();
    c.resolve(bkResp(909));
    await flush();
    eq('P3: 読み込み中に field → 応答が届く: 中断の文言・bulkLoading=false・bulkRows null・getBulk は1本のまま',
      [L.els.bulkScroll.textContent, L.v('bulkLoading'), L.v('bulkRows'), L.calls.filter(x => x.tag === 'apiGet:getBulk').length],
      ['読み込みを中断しました。閉じて開き直してください', false, null, 1]);
  }
  for(const how of ['resolve', 'reject']){
    const L = load(SRC);
    L.box.openBulk();
    await flush();
    const c1 = L.last('apiGet:getBulk');
    L.toField();
    L.toOffice();
    if(how === 'resolve') c1.resolve(bkResp(909)); else c1.reject(new Error('架空の通信失敗'));
    await flush();
    const bulkCalls = L.calls.filter(x => x.tag === 'apiGet:getBulk');
    eq('P3（古い応答 ' + how + '）: field→office の後に届く → 新しい getBulk が1本出る・bulkLoading=true', [bulkCalls.length, L.v('bulkLoading')], [2, true]);
    if(bulkCalls[1]) bulkCalls[1].resolve({ rows: [{ id: 901, room: '901', kana: 'かくうえー' }] });
    await flush();
    eq('P3（古い応答 ' + how + '）: 新しい応答で bulkRows が入る・renderBulk 1回・bulkLoading=false',
      [(L.v('bulkRows') || []).map(r => r.id), L.cnt.renderBulk, L.v('bulkLoading')], [[901], 1, false]);
  }

  group('G13-4. openResident（現場端末では取りに行かない）');
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.openResident(901);
    await flush();
    eq('field: openResident の通信 0回', L.calls.map(c => c.tag), []);
  }

  /* ── G7. 直す前の版での再現 ── */
  group('G7. 直す前の版で穴が再現する（このテストが穴を検出できる証拠）');
  if(!OLD_PATH){
    say('  （省略: MASTER_HTML_OLD が渡されていない）');
  } else {
    say('  直す前の版: ' + OLD_PATH);
    const OLD = fs.readFileSync(OLD_PATH, 'utf8');
    let reproRan = 0;   // 旧版で実際に走らせた再現の数（0 なら旧版の取り違え＝✗ にする）
    /* G7-1: 名簿の書き戻し・縮み（23089f2 相当の旧版で再現する。devGen を持つ旧版＝006442b 以降は直し済みなので省く） */
    g7a: {
    if(hasVar(OLD, 'devGen')){ say('  （G7-1 省略: この旧版は devGen を持つ＝名簿の書き戻し・縮みは直し済み）'); break g7a; }
    say('  ─ G7-1 名簿の書き戻し・縮み');
    reproRan++;
    {
      const L = load(OLD, true);
      L.store.set('su_residents_common', MARK);
      const p = L.box.refreshRoster();
      await flush();
      L.toField();
      L.last('apiGet:getRoster').resolve({ roster: ROS, stateRev: 1 });
      await p; await flush();
      const c = L.store.get('rmaster_roster') || '';
      t('（直す前）切り替え後に rmaster_roster が書き戻る（氏名・生年月日入り）＝再現した', c.includes('架空A') && c.includes('1940-01-01'), { 文字数: c.length });
    }
    {
      const L = load(OLD, true);
      L.set('roster=' + JSON.stringify(ROS) + ';curResident={id:901,name:"架空A",hospitalized:false};');
      L.store.set('su_residents_common', MARK);
      L.box.toggleHosp();
      await flush();
      L.toField();
      L.last('apiPost:setState').resolve({ ok: true, hospitalized: true, hospitalizedAt: 'T1' });
      await flush();
      const c = L.common();
      eq('（直す前）入院トグルで共有名簿が0名＝再現した', c && c.residents && c.residents.length, 0);
    }
    {
      const L = load(OLD, true);
      L.set('roster=' + JSON.stringify(ROS) + ';');
      L.store.set('su_residents_common', MARK);
      L.toField();
      L.box.afterSaveOk_({ id: 901, name: '架空A' }, { id: 901, name: '架空A', birthDate: '1940-01-01' });
      await flush();
      const c = L.common();
      eq('（直す前）保存の後処理で共有名簿が1名＝再現した', c && c.residents && c.residents.length, 1);
    }
    {
      const L = load(OLD, true);
      L.set('roster=' + JSON.stringify(ROS) + ';');
      L.store.set('su_residents_common', MARK);
      L.toField();
      L.toOffice();
      L.box.afterSaveOk_({ id: 901, name: '架空A' }, { id: 901, name: '架空A', birthDate: '1940-01-01' });
      await flush();
      const c = L.common();
      eq('（直す前）field→office へ戻した後に届いた保存の応答で共有名簿が1名に縮む＝再現した', c && c.residents && c.residents.length, 1);
    }
    }
    /* G7-2: 薬効辞書の未保存の編集が、現場用への切り替えで黙って消える（applyDeviceGuard が無条件に mdClearPending_ を呼ぶ旧版）。
       006442b 相当は別タブの通知（storage）で、23089f2 相当は storage の受け口が無いので同期設定からの切り替えで再現する */
    if(!/\n\s*mdClearPending_\(\); mdShowHidden=false;/.test(grabFn(OLD, 'applyDeviceGuard'))){
      say('  （G7-2 省略: この旧版の applyDeviceGuard は薬効辞書の保留を無条件には捨てない＝直し済み）');
    } else if(hasFn(OLD, 'onDeviceRoleStorage_')){
      say('  ─ G7-2 薬効辞書の未保存（別タブの通知 storage）');
      reproRan++;
      const L = load(OLD, true);
      L.box.applyDeviceGuard();
      mdMarks(L);
      L.store.set('su_device_role', 'field');
      if(typeof L.listeners.storage === 'function') L.listeners.storage({ key: 'su_device_role' });
      else L.box.onDeviceRoleStorage_({ key: 'su_device_role' });
      const s = mdPending(L);
      eq('（直す前）storage の通知: ブロックのみ・reload 0回（未保存ありの扱い自体は動く）', [L.els.deviceBlock.classList.contains('on'), L.cnt.reload], [true, 0]);
      t('（直す前）storage の通知で薬効辞書の保留（5つ）と mdDirty が消える＝再現した', JSON.stringify(s) === JSON.stringify(MD_EMPTY), s);
    } else {
      say('  ─ G7-2 薬効辞書の未保存（同期設定から現場用へ）');
      reproRan++;
      const L = load(OLD, true);
      L.box.applyDeviceGuard();
      mdMarks(L);
      L.cfgForm('https://example.invalid/exec', '', 'field');
      L.box.saveSyncCfg();
      const s = mdPending(L);
      eq('（直す前）同期設定で現場用へ: 止めずに切り替わる（alert 0・用途 field）', [L.cnt.alert.length, L.box.getDeviceRole()], [0, 'field']);
      t('（直す前）同期設定の切り替えで薬効辞書の保留（5つ）と mdDirty が消える＝再現した', JSON.stringify(s) === JSON.stringify(MD_EMPTY), s);
    }
    /* G7-3: ブロック後に届いた応答で、捨てた控え（bkRows・admMap・mealRows・a4DayMap・curResident）がメモリに戻る
       （応答側で世代を見ない旧版＝df01048 以前で再現する。bkEnsure が devGen を見る旧版は直し済みなので省く） */
    if(/devGen/.test(grabFn(OLD, 'bkEnsure'))){
      say('  （G7-3 省略: この旧版の bkEnsure は世代 devGen を見る＝遅れて届く応答は直し済み）');
    } else {
      say('  ─ G7-3 ブロック後に届いた応答で控えが戻る');
      reproRan++;
      for(const name of Object.keys(KINDS)){
        const K = KINDS[name];
        const L = load(OLD, true);
        const p = K.start(L);
        await flush();
        const c = L.last(K.tag);
        L.toField();
        c.resolve(K.resp(909));
        await flush();
        if(p && p.then) await p;
        eq('（直す前）' + name + ': ブロック後に届いた応答で控えが戻る＝再現した', K.val(L), [909]);
      }
      {
        const L = load(OLD, true);
        L.box.openResident(901);
        await flush();
        const c = L.last('apiGetRetry:getResident');
        L.toField();
        c.resolve(recResp(901));
        await flush();
        const cur = L.v('curResident');
        t('（直す前）openResident: ブロック後に届いた応答で curResident（処方入り）が戻り、画面を描く＝再現した',
          !!(cur && cur.medsRegular) && L.cnt.renderView > 0, { curResident: cur ? Object.keys(cur) : null, renderView: L.cnt.renderView });
      }
    }
    /* G7-4（2026-10-02）: 事務所PCへ戻した後に古い保存の応答で編集画面を閉じても「戻る」を出さず、積んだ段が残る
       （afterSaveOk_ が無条件に _navInPop を立てる旧版＝9b60f5a で再現する。条件つきの旧版は直し済み、立てない旧版は対象外） */
    const asf = grabFn(OLD, 'afterSaveOk_');
    if(!/_navInPop=true/.test(asf)){
      say('  （G7-4 省略: この旧版の afterSaveOk_ は編集画面を閉じない（_navInPop を立てない）＝対象外）');
    } else if(/navTopModal\(\)/.test(asf)){
      say('  （G7-4 省略: この旧版の afterSaveOk_ は「戻る」を出すかを条件で分ける＝直し済み）');
    } else {
      say('  ─ G7-4 往復の後の古い保存の応答で、積んだ履歴の段が残る');
      reproRan++;
      const L = load(OLD, true);
      openEditFake(L, null);
      L.box.saveResident();
      await flush();
      L.toField();
      L.toOffice();
      const b0 = L.cnt.back;
      L.last('apiPost:saveResident').resolve({ record: { id: 950, name: '架空N', updatedAt: '2026-10-01T00:00:00.000Z' } });
      await flush();
      eq('（直す前）往復の後に届いた古い応答で編集画面を閉じても history.back 0回・_navPushed=true のまま＝再現した',
        [L.els['sc-edit'].classList.contains('on'), L.cnt.back - b0, L.v('_navPushed')], [false, 0, true]);
    }
    t('旧版で再現を少なくとも1つ走らせた（0 なら MASTER_HTML_OLD の取り違え）', reproRan > 0, { reproRan });
  }

  say('\nOK ' + ok + ' / NG ' + ng);
  if(ng > 0) process.exit(1);
}

main().catch(e => { say('例外: ' + (e && e.stack || e)); say('\nOK ' + ok + ' / NG ' + (ng + 1)); process.exit(1); });
