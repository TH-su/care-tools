/* 入居者マスタ（resident-master.html）の「全件データ（fullMap）の取得」と「端末の用途ガード」のテスト。
   対象: fullEnsure・fullOf・applyDeviceGuard・setDeviceRole・getDeviceRole と var fullMap=… の行
         （HTML 全体は評価せず、実物のソースから切り出して vm に入れる。それ以外は偽物）
   実行: node "…/check/unit/master_fullguard_test.js"
         MASTER_HTML=<直した版>/resident-master.html MASTER_HTML_OLD=<直す前の版>/resident-master.html node "…/check/unit/master_fullguard_test.js"
         （MASTER_HTML_OLD を渡した時だけ「直す前は穴が再現する」群を実行する）

   背景（壊れうること）:
     fullMap は fullEnsure が getResident を在籍者ぶん取って作る全件の控えで、処方（medsRegular）などの
     要配慮情報を持つ。端末を「現場」（su_device_role=field）へ切り替えると applyDeviceGuard が捨てる。
     直す前は fullMap=null にするだけで世代 fullGen を進めず fullLoading も下ろさなかったため、
       ①読み込み中に切り替えると、あとから届いた応答で fullMap がメモリに戻る（処方が現場端末に残る）
       ②残りの在籍者を取りに行き続ける
       ③事務所PCへ戻しても「取得中」のまま二度と取りに行かない
     を起こしうる。このテストは①〜③と、事務所PCでの通常の取得（同時5本・取れなかった方の扱い）を確かめる。

   実データは含まない。値は全て架空（id・居室番号・薬剤名はテスト用の作り物で、人名は1つも書かない）。
   ★出力に console を使わない（write-guard が gas/ 配下での追加を禁じているため）。 */
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

/* 関数を名前で切り出す（HTML ごと評価すると DOM 依存の初期化まで走る）。meds_picker_test.js と同じ作法。
   新旧2つのソースで回すので、ソース文字列を引数で受け取る */
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
/* var を切り出す（行末が ; の行まで） */
function grabVar(src, name){
  const start = src.indexOf('\nvar ' + name + '=');
  if(start < 0) throw new Error('変数が見つかりません: ' + name);
  const lines = src.slice(start + 1).split('\n'), out = [];
  for(const l of lines){ out.push(l); if(/;\s*(?:\/\*.*\*\/\s*)?$/.test(l)) break; }
  return out.join('\n');
}

/* 非同期の待ち（保留中の Promise の連鎖を流し切る） */
async function flush(n){ for(let k = 0; k < (n || 5); k++) await new Promise(r => setImmediate(r)); }

/* 架空の在籍者 7 名（同時5本より多くする）。id と居室番号だけ */
const IDS = ['m101','m102','m103','m104','m105','m106','m107'];
const rec = (id, meds) => ({ id: id, room: id.slice(1), medsRegular: meds || ('架空薬A 1錠 朝（' + id + '）') });
const OLD_MARK = '旧世代の目印 架空薬Z 1錠 夕';

/* ソースを受け取り、vm の箱と操作用の口を返す */
function load(src){
  const store = new Map();
  const calls = [];        // apiGet の呼び出し記録 {id, args, timeout, resolve, reject, done}
  const cnt = { paintShBars: 0, renderRoster: 0, fitHistSheet: 0, saveOpenId: [], mdClearPending_: 0 };
  const els = {};
  function fakeEl(id){
    if(!els[id]){
      const cls = new Set();
      els[id] = { id, classList: {
        toggle(c, on){ if(on === undefined) on = !cls.has(c); if(on) cls.add(c); else cls.delete(c); return on; },
        remove(c){ cls.delete(c); }, add(c){ cls.add(c); }, contains(c){ return cls.has(c); } } };
    }
    return els[id];
  }
  const box = {
    localStorage: {
      getItem(k){ return store.has(k) ? store.get(k) : null; },
      setItem(k, v){ store.set(k, String(v)); },
      removeItem(k){ store.delete(k); }
    },
    DEVICE_KEY: 'su_device_role',
    ROSTER_KEY: 'rmaster_roster',
    CFG: { url: 'https://example.invalid/exec', token: '', vmaUrl: '' },
    $: fakeEl,
    saveOpenId(v){ cnt.saveOpenId.push(v); },
    roster: [{ id: 'm101', room: '101' }],
    curView: 'hist',
    shBase(){ return IDS.map(id => ({ id: id, room: id.slice(1) })); },
    apiGet(args, timeout){
      let res, rej;
      const p = new Promise((a, b) => { res = a; rej = b; });
      const c = { id: args && args.id, args, timeout, done: false,
        resolve(v){ c.done = true; res(v); }, reject(e){ c.done = true; rej(e || new Error('架空の通信失敗')); } };
      calls.push(c);
      return p;
    },
    paintShBars(){ cnt.paintShBars++; },
    renderRoster(){ cnt.renderRoster++; },
    fitHistSheet(){ cnt.fitHistSheet++; },
    bkRows: [{ id: 'm101' }], mdDict: {}, mdMap: {}, mdGen: 0, mdPromise: null, mdPromiseRetry: false,
    mdLoading: false, mdErr: '', mdShowHidden: true,
    mdClearPending_(){ cnt.mdClearPending_++; },
    msGen: 0, msRows: [], msRemote: {}, msAuthSt: {}, msBusy: false,
    a4DayMap: {}, a4DayPromise: null, a4DayFailAt: 0, a4DayFailMsg: '',
    /* applyDeviceGuard が 2026-10-01 から触る名前（中身は master_deviceguard_test.js で確かめる） */
    devGen: 0, devBlocked_: false, rosterPurged_: false, admMap: null, mealRows: null, curResident: null,
    setViewActions(){}, paintHospBtn(){},
    bkLoading: false, bkErr: '', admLoading: false, admErr: '', mealSeq: 0, mealLoading: false, mealMsg: '',
    /* 2026-10-06 から applyDeviceGuard が薬の変更候補も捨てる（mcPurge_。中身は master_deviceguard_test.js で確かめる） */
    mcPurge_(){ cnt.mcPurge_ = (cnt.mcPurge_ || 0) + 1; }
  };
  vm.createContext(box);
  const code = [
    grabVar(src, 'fullMap'),
    grabFn(src, 'getDeviceRole'),
    grabFn(src, 'setDeviceRole'),
    grabFn(src, 'fullEnsure'),
    grabFn(src, 'fullOf'),
    grabFn(src, 'applyDeviceGuard')
  ].join('\n');
  vm.runInContext(code, box, { filename: 'resident-master.html(fullguard)' });
  const v = name => vm.runInContext(name, box);
  const pending = () => calls.filter(c => !c.done);
  /* 保留中を全部 resolve して流す。新たに出たものも続けて流す（上限つき） */
  async function drain(make){
    for(let round = 0; round < 20; round++){
      const p = pending();
      if(!p.length) return;
      p.forEach(c => c.resolve({ record: make ? make(c.id) : rec(c.id) }));
      await flush();
    }
  }
  return { box, v, calls, pending, cnt, store, els, drain };
}

function state(L){
  return { fullMap: L.v('fullMap'), fullLoading: L.v('fullLoading'), fullErr: L.v('fullErr'),
    fullDone: L.v('fullDone'), fullTotal: L.v('fullTotal'), fullBad: L.v('fullBad') };
}

/* 2・3・7 で共用: 事務所PCで読み込み開始 → 5本保留中に「現場」へ切り替える */
async function startThenSwitch(L, direct){
  L.box.fullEnsure(false);
  await flush();
  const first = L.pending().slice();
  let blocked;
  if(direct){ L.store.set('su_device_role', 'field'); blocked = L.box.applyDeviceGuard(); }
  else { L.box.setDeviceRole('field'); blocked = L.box.applyDeviceGuard(); }
  return { first, blocked };
}

async function main(){
  const SRC = fs.readFileSync(HTML_PATH, 'utf8');
  say('対象: ' + HTML_PATH);

  /* ── 1. 事務所PCの通常動作（デグレ確認） ── */
  group('1. 事務所PCの通常動作（デグレ確認）');
  {
    const L = load(SRC);
    eq('用途が未設定なら office', L.box.getDeviceRole(), 'office');
    L.box.fullEnsure(false);
    await flush();
    eq('最初に apiGet が5本だけ出る', L.calls.length, 5);
    eq('最初の5本は在籍者の先頭5名', L.calls.map(c => c.id), IDS.slice(0, 5));
    eq('呼び出しは getResident・30秒', [L.calls[0].args.action, L.calls[0].timeout], ['getResident', 30000]);
    eq('取得中の印（fullLoading=true・fullTotal=7・fullDone=0）', [L.v('fullLoading'), L.v('fullTotal'), L.v('fullDone')], [true, 7, 0]);
    L.calls[0].resolve({ record: rec('m101') });
    await flush();
    eq('1本終わると6本目が出る', L.calls.length, 6);
    eq('fullDone=1', L.v('fullDone'), 1);
    L.calls[1].resolve({ record: rec('m102') });
    await flush();
    eq('2本終わると7本目が出る', L.calls.length, 7);
    await L.drain();
    eq('呼び出しは全部で7本（同じ方を二度取らない）', L.calls.map(c => c.id), IDS);
    const s = state(L);
    eq('fullMap に7名ぶん', s.fullMap ? Object.keys(s.fullMap).sort() : null, IDS);
    eq('fullLoading=false・fullErr=""・fullBad=[]・fullDone=7', [s.fullLoading, s.fullErr, s.fullBad, s.fullDone], [false, '', [], 7]);
    eq('fullOf が処方入りの record を返す', (L.box.fullOf({ id: 'm103' }) || {}).medsRegular, '架空薬A 1錠 朝（m103）');
    t('完了時に renderRoster・fitHistSheet が呼ばれる（curView=hist。2 の「呼ばれない」判定の前提）', L.cnt.renderRoster === 1 && L.cnt.fitHistSheet === 1, L.cnt);
    L.box.fullEnsure(false);
    await flush();
    eq('fullMap がある時 fullEnsure(false) は取りに行かない', L.calls.length, 7);
    L.box.fullEnsure(true);
    await flush();
    eq('fullEnsure(true) は取り直す（新たに5本）', L.calls.length, 12);
    await L.drain();
    eq('取り直し後も7名ぶん・fullLoading=false', [Object.keys(L.v('fullMap')).length, L.v('fullLoading')], [7, false]);
  }
  {
    const L = load(SRC);
    L.box.fullEnsure(false);
    await flush();
    L.calls[2].reject();          // m103 だけ失敗
    await flush();
    await L.drain();
    const s = state(L);
    eq('1名だけ reject → fullBad にその id', s.fullBad, ['m103']);
    eq('その時 fullMap は残り6名・fullErr=""・fullLoading=false', [s.fullMap ? Object.keys(s.fullMap).sort() : null, s.fullErr, s.fullLoading], [IDS.filter(x => x !== 'm103'), '', false]);
    eq('fullOf は取れなかった方に null', L.box.fullOf({ id: 'm103' }), null);
  }
  {
    const L = load(SRC);
    L.box.fullEnsure(false);
    await flush();
    for(let round = 0; round < 20 && L.pending().length; round++){ L.pending().forEach(c => c.reject()); await flush(); }
    const s = state(L);
    eq('全員 reject → 呼び出しは7本', L.calls.length, 7);
    eq('全員 reject → fullMap=null・fullErr="取得できませんでした"・fullLoading=false', [s.fullMap, s.fullErr, s.fullLoading], [null, '取得できませんでした', false]);
  }

  /* ── 2. 読み込み中に「現場」へ切り替え（本題） ── */
  group('2. 読み込み中に setDeviceRole("field") → applyDeviceGuard()（本題）');
  {
    const L = load(SRC);
    const { first, blocked } = await startThenSwitch(L, false);
    eq('切り替え前に5本が保留中', first.length, 5);
    eq('applyDeviceGuard の戻り値は true', blocked, true);
    eq('用途は field', L.box.getDeviceRole(), 'field');
    let s = state(L);
    eq('直後: fullMap=null・fullLoading=false・fullErr=""・fullDone=0・fullTotal=0', [s.fullMap, s.fullLoading, s.fullErr, s.fullDone, s.fullTotal], [null, false, '', 0, 0]);
    t('直後: 一覧キャッシュのキーが無い・画面はブロック表示', !L.store.has('rmaster_roster') && L.els.deviceBlock.classList.contains('on'));
    const p0 = L.cnt.paintShBars, r0 = L.cnt.renderRoster, f0 = L.cnt.fitHistSheet;
    first.forEach(c => c.resolve({ record: rec(c.id) }));
    await flush();
    eq('保留中の5本が届いた後も apiGet は5本のまま（残り2名を取りに行かない）', L.calls.length, 5);
    await L.drain();   // 万一新たに出た分も流してから見る（直す前の版で fullMap が埋まるのを確かめるため）
    s = state(L);
    eq('流した後も fullMap は null のまま', s.fullMap, null);
    eq('fullBad も null・fullLoading=false・fullDone=0・fullErr=""', [s.fullBad, s.fullLoading, s.fullDone, s.fullErr], [null, false, 0, '']);
    eq('fullOf は null（処方がメモリに戻っていない）', L.box.fullOf({ id: 'm101' }), null);
    eq('切り替え後に paintShBars・renderRoster・fitHistSheet が呼ばれない', [L.cnt.paintShBars - p0, L.cnt.renderRoster - r0, L.cnt.fitHistSheet - f0], [0, 0, 0]);
  }

  /* ── 2-A. 何件か届いた後に切り替える（fullDone=0 の初期化が効いていること） ── */
  group('2-A. 2本届いた後に「現場」へ切り替え → 進み具合の数字も下ろす');
  {
    const L = load(SRC);
    L.box.fullEnsure(false);
    await flush();
    const first = L.pending().slice();
    eq('切り替え前に5本が保留中', first.length, 5);
    first[0].resolve({ record: rec(first[0].id) });
    first[1].resolve({ record: rec(first[1].id) });
    await flush();
    eq('2本届いて fullDone=2（6・7本目が出て保留は5本）', [L.v('fullDone'), L.pending().length], [2, 5]);
    L.box.setDeviceRole('field');
    eq('applyDeviceGuard の戻り値は true', L.box.applyDeviceGuard(), true);
    let s = state(L);
    eq('直後: fullDone=0・fullTotal=0・fullLoading=false・fullMap=null', [s.fullDone, s.fullTotal, s.fullLoading, s.fullMap], [0, 0, false, null]);
    const n0 = L.calls.length;
    await L.drain();
    s = state(L);
    eq('残りを流した後も fullDone=0・fullTotal=0・fullLoading=false・fullMap=null', [s.fullDone, s.fullTotal, s.fullLoading, s.fullMap], [0, 0, false, null]);
    eq('残りを流しても apiGet は増えない', L.calls.length, n0);
  }

  /* ── 2-B. 前の取得が失敗して fullErr が入っている状態で切り替える（fullErr='' の初期化が効いていること） ── */
  group('2-B. 前の取得の失敗表示（fullErr）が残った状態で「現場」へ切り替え → 失敗表示も下ろす');
  {
    const L = load(SRC);
    L.box.fullEnsure(false);
    await flush();
    for(let round = 0; round < 20 && L.pending().length; round++){ L.pending().forEach(c => c.reject()); await flush(); }
    eq('全員 reject で fullErr="取得できませんでした"・fullLoading=false', [L.v('fullErr'), L.v('fullLoading')], ['取得できませんでした', false]);
    L.box.setDeviceRole('field');
    eq('applyDeviceGuard の戻り値は true', L.box.applyDeviceGuard(), true);
    eq('切り替え後 fullErr=""', L.v('fullErr'), '');
  }

  /* ── 3. 同じ場面で保留中の応答が reject で届く ── */
  group('3. 読み込み中に「現場」へ切り替え → 保留中の応答が reject で届く');
  {
    const L = load(SRC);
    const { first, blocked } = await startThenSwitch(L, false);
    eq('applyDeviceGuard の戻り値は true', blocked, true);
    first.forEach(c => c.reject());
    await flush();
    for(let round = 0; round < 20 && L.pending().length; round++){ L.pending().forEach(c => c.reject()); await flush(); }
    const s = state(L);
    eq('fullErr は "" のまま', s.fullErr, '');
    eq('fullMap は null・fullBad は null・fullLoading=false', [s.fullMap, s.fullBad, s.fullLoading], [null, null, false]);
    eq('apiGet は5本のまま', L.calls.length, 5);
  }

  /* ── 4. 他アプリの設定画面から切り替えられた端末（setDeviceRole を通らない） ── */
  group('4. localStorage の su_device_role を直接 field にしてから applyDeviceGuard()');
  {
    const L = load(SRC);
    const { first, blocked } = await startThenSwitch(L, true);
    eq('applyDeviceGuard の戻り値は true', blocked, true);
    let s = state(L);
    eq('直後: fullMap=null・fullLoading=false・fullErr=""・fullDone=0・fullTotal=0', [s.fullMap, s.fullLoading, s.fullErr, s.fullDone, s.fullTotal], [null, false, '', 0, 0]);
    const p0 = L.cnt.paintShBars, r0 = L.cnt.renderRoster;
    first.forEach(c => c.resolve({ record: rec(c.id) }));
    await flush();
    eq('apiGet は5本のまま', L.calls.length, 5);
    await L.drain();
    s = state(L);
    eq('流した後も fullMap は null・fullBad は null・fullLoading=false・fullDone=0', [s.fullMap, s.fullBad, s.fullLoading, s.fullDone], [null, null, false, 0]);
    eq('切り替え後に paintShBars・renderRoster が呼ばれない', [L.cnt.paintShBars - p0, L.cnt.renderRoster - r0], [0, 0]);
  }

  /* ── 5. 現場端末では取りに行かない ── */
  group('5. 用途が field の端末では fullEnsure が取りに行かない');
  {
    const L = load(SRC);
    L.store.set('su_device_role', 'field');
    L.box.fullEnsure(false);
    await flush();
    eq('fullEnsure(false): apiGet 0回・fullLoading=false', [L.calls.length, L.v('fullLoading')], [0, false]);
    L.box.fullEnsure(true);
    await flush();
    eq('fullEnsure(true): apiGet 0回・fullLoading=false', [L.calls.length, L.v('fullLoading')], [0, false]);
    eq('fullMap は null のまま', L.v('fullMap'), null);
  }

  /* ── 6. 事務所PCへ戻した時に取り直せる（古い世代の応答は混ざらない） ── */
  group('6. 「現場」へ切り替えた後 office へ戻す → 取り直せる・古い世代の応答が混ざらない');
  g6: {
    const L = load(SRC);
    const { first } = await startThenSwitch(L, false);
    eq('古い世代の5本が保留のまま残っている', first.filter(c => !c.done).length, 5);
    L.box.setDeviceRole('office');
    eq('office へ戻すと applyDeviceGuard の戻り値は false', L.box.applyDeviceGuard(), false);
    t('ブロック表示が外れる', !L.els.deviceBlock.classList.contains('on'));
    L.box.fullEnsure(false);
    await flush();
    const fresh = L.calls.slice(5);
    eq('新しい読み込みが始まる（apiGet が新たに5本）', fresh.map(c => c.id), IDS.slice(0, 5));
    eq('fullLoading=true・fullTotal=7・fullDone=0', [L.v('fullLoading'), L.v('fullTotal'), L.v('fullDone')], [true, 7, 0]);
    /* 新しい読み込みが始まらなかった（直す前の版＝取得中の印が残ったまま）時は、以降を確かめようがないので ✗ にして打ち切る */
    if(!fresh.length){ t('新しい読み込みが始まらないため以降の確認を打ち切り', false); break g6; }
    fresh[0].resolve({ record: rec(fresh[0].id) });
    await flush();
    eq('新しい世代の1本目で fullDone=1', L.v('fullDone'), 1);
    const callsBefore = L.calls.length;
    first.forEach(c => c.resolve({ record: rec(c.id, OLD_MARK) }));   // 古い世代の応答（目印つき）をこの途中で届ける
    await flush();
    eq('古い世代の応答が届いても fullDone は増えない', L.v('fullDone'), 1);
    eq('古い世代の応答で apiGet が増えない', L.calls.length, callsBefore);
    await L.drain();
    const s = state(L);
    eq('新しい世代を全部流すと fullMap に7名ぶん・fullLoading=false', [s.fullMap ? Object.keys(s.fullMap).sort() : null, s.fullLoading], [IDS, false]);
    const mixed = s.fullMap ? Object.keys(s.fullMap).filter(k => s.fullMap[k].medsRegular === OLD_MARK) : ['(fullMap なし)'];
    eq('新しい fullMap に古い世代の record が混ざらない', mixed, []);
    eq('fullDone=7・fullBad=[]', [s.fullDone, s.fullBad], [7, []]);
  }

  /* ── 7. 直す前の版での再現 ── */
  group('7. 直す前の版で穴が再現する（このテストが穴を検出できる証拠）');
  if(!OLD_PATH){
    say('  （省略: MASTER_HTML_OLD が渡されていない）');
  } else {
    say('  直す前の版: ' + OLD_PATH);
    const L = load(fs.readFileSync(OLD_PATH, 'utf8'));
    const { first, blocked } = await startThenSwitch(L, false);
    eq('（直す前）applyDeviceGuard の戻り値は true', blocked, true);
    t('（直す前）切り替え直後に fullLoading が true のまま残る＝再現した', L.v('fullLoading') === true, { fullLoading: L.v('fullLoading') });
    first.forEach(c => c.resolve({ record: rec(c.id) }));
    await flush();
    t('（直す前）保留中の応答が届くと残りの在籍者を取りに行く＝再現した', L.calls.length > 5, { apiGet回数: L.calls.length });
    await L.drain();
    const fm = L.v('fullMap');
    t('（直す前）切り替えた後なのに fullMap が null でなくなる＝再現した', fm !== null, { fullMap: fm });
    t('（直す前）戻った fullMap が処方（medsRegular）を持つ＝再現した', !!(fm && fm.m101 && fm.m101.medsRegular), fm ? Object.keys(fm) : null);
  }

  say('\nOK ' + ok + ' / NG ' + ng);
  if(ng > 0) process.exit(1);
}

main().catch(e => { say('例外: ' + (e && e.stack || e)); say('\nOK ' + ok + ' / NG ' + (ng + 1)); process.exit(1); });
