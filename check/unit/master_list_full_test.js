/* 入居者マスタ（resident-master.html）の「家族情報一覧・病歴薬一覧の全件データを1回でまとめて読む」のテスト（2026-10-28 本人指示）。
   対象: fullEnsure・fullOf・getDeviceRole と var fullMap=… の行（実物のソースから切り出して vm に入れる。それ以外は偽物）
   実行: node check/unit/master_list_full_test.js
         MASTER_HTML=<別の版>/resident-master.html node check/unit/master_list_full_test.js（変異テスト＝直す前の版で赤くなるかの確認用）

   確かめること:
     1. 新しい GAS（getListFull がある）: 呼び出しは1回だけで getResident は0回。fullMap の5項目は1人ずつ取った時と同じ
     2. 古い GAS（不明なaction）: 1人ずつの道に戻り、同じ fullMap になる
     3. rows に欠けた id: その id だけを getResident で取る
     4. 通信の失敗: 1人ずつの道に戻る
     5. 世代が変わった後に届いた応答は捨てる
     6. 現場端末では1本も送らない
     7. rows の中に壊れた行（null・id なし・配列・文字）があっても落ちない
   架空データのみ（id・居室番号・薬剤名・家族の続柄はテスト用の作り物。人名は記号的な漢字だけ）。
   ★出力に console を使わない（個人情報を出力に流さない決まり。master_fullguard_test.js と同じ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');

let ok = 0, ng = 0;
const say = m => process.stdout.write(m + '\n');
function group(n){ say('\n■ ' + n); }
function t(label, cond, info){ if(cond){ ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '\n    → ' + JSON.stringify(info) : '')); } }
function eq(label, got, want){ const g = JSON.stringify(got), w = JSON.stringify(want); t(label, g === w, g === w ? undefined : { 期待: want, 実際: got }); }

/* 関数・var を名前で切り出す（master_fullguard_test.js と同じ作法） */
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
function grabVar(src, name){
  const start = src.indexOf('\nvar ' + name + '=');
  if(start < 0) throw new Error('変数が見つかりません: ' + name);
  const lines = src.slice(start + 1).split('\n'), out = [];
  for(const l of lines){ out.push(l); if(/;\s*(?:\/\*.*\*\/\s*)?$/.test(l)) break; }
  return out.join('\n');
}
async function flush(n){ for(let k = 0; k < (n || 8); k++) await new Promise(r => setImmediate(r)); }

/* 架空の在籍者 8 名（同時5本より多くする）。id は数値と文字の両方を混ぜる */
const KEYS = ['family', 'diseases', 'currentDiseases', 'pastHistory', 'medsRegular'];
const IDS = [201, 202, '203', 204, 205, 206, 207, 208];
const NAMES = ['甲 一', '乙 二', '丙 三', '丁 四', '戊 五', '己 六', '庚 七', '辛 八'];
/* シート側の架空の dataJson（正規化すると変わる値を混ぜる） */
function sheetData(){
  const D = {};
  IDS.forEach((id, i) => {
    const d = { medsRegular: '架空錠' + i + ' 1錠 朝食後\n架空錠X 2錠 夕食後', supportLog: [{ t: '返してはいけない記録' }], allergy: '架空' };
    if(i % 2 === 0) d.family = [{ name: NAMES[i] + 'の子', relation: '長女', phone: 1000 + i, emergency: '1' }, { name: '', relation: '' },
      { relation: '長男' }, { name: '四人目', address: '架空町' }];
    if(i % 3 === 0) d.diseases = [{ name: '架空病' + i }, { name: '' }];
    if(i !== 4) d.currentDiseases = i === 5 ? null : '架空の病名' + i;
    if(i === 6) d.pastHistory = '架空の既往';
    D[String(id)] = d;
  });
  return D;
}
/* 偽の GAS: getResident は dataJson 全部＋列の値、getListFull は5項目だけ（gas/master.gs と同じ形） */
function gasResident(D, id){
  const i = IDS.map(String).indexOf(String(id));
  if(i < 0) return null;
  const r = JSON.parse(JSON.stringify(D[String(id)]));
  r.id = IDS[i]; r.name = NAMES[i]; r.room = String(300 + i); r.active = true;
  return r;
}
function gasListFull(D, skip){
  return IDS.filter(id => !(skip || []).includes(String(id))).map(id => {
    const d = D[String(id)], o = { id: id };
    KEYS.forEach(k => { if(Object.prototype.hasOwnProperty.call(d, k)) o[k] = JSON.parse(JSON.stringify(d[k])); });
    return o;
  });
}

/* ソースと「偽の GAS の応え方」を受け取り、vm の箱を返す。
   mode: 'new'（getListFull あり）・'old'（不明なaction）・'net'（getListFull だけ通信失敗）・'hold'（getListFull を保留）
   opt.rows を渡すと getListFull の rows をそれにする */
function load(src, mode, opt){
  opt = opt || {};
  const D = sheetData();
  const store = new Map();
  const calls = [];
  const held = [];
  const notes = [];
  const cnt = { paintShBars: 0, renderRoster: 0, fitHistSheet: 0 };
  const box = {
    window: { SUErrors: { note(kind, detail, where){ notes.push([kind, detail, where]); } } },
    localStorage: {
      getItem(k){ return store.has(k) ? store.get(k) : null; },
      setItem(k, v){ store.set(k, String(v)); },
      removeItem(k){ store.delete(k); }
    },
    DEVICE_KEY: 'su_device_role',
    CFG: { url: 'https://example.invalid/exec', token: '' },
    curView: 'fam',
    shBase(){ return IDS.map((id, i) => ({ id: id, room: String(300 + i) })); },
    apiGet(args, timeout){
      calls.push({ action: args && args.action, id: args && args.id, timeout });
      /* 本物の parseJson と同じく、error のある応答は throw する */
      const answer = d => (d && d.error) ? Promise.reject(new Error(d.error)) : Promise.resolve(d);
      if(args.action === 'getListFull'){
        if(mode === 'old') return answer({ error: '不明なaction' });
        if(mode === 'net') return Promise.reject(new Error('タイムアウト'));
        if(mode === 'norows') return answer({ ok: true });
        const body = { rows: opt.rows || gasListFull(D, opt.skip), stateRev: 7 };
        if(mode === 'hold') return new Promise(res => held.push(() => res(JSON.parse(JSON.stringify(body)))));
        return answer(JSON.parse(JSON.stringify(body)));
      }
      if(args.action === 'getResident'){
        if((opt.failIds || []).includes(String(args.id))) return Promise.reject(new Error('タイムアウト'));
        return answer({ record: gasResident(D, args.id) });
      }
      return answer({ error: '不明なaction' });
    },
    paintShBars(){ cnt.paintShBars++; },
    renderRoster(){ cnt.renderRoster++; },
    fitHistSheet(){ cnt.fitHistSheet++; }
  };
  vm.createContext(box);
  const code = [grabVar(src, 'fullMap'), grabFn(src, 'getDeviceRole'), grabFn(src, 'fullEnsure'), grabFn(src, 'fullOf')].join('\n');
  vm.runInContext(code, box, { filename: 'resident-master.html(list-full)' });
  const v = name => vm.runInContext(name, box);
  return { box, v, calls, held, cnt, store, D, notes };
}
/* fullMap を「id と5項目」だけに絞った形（読む側は5項目しか見ない）。キーが無い項目は付けない */
function project(fm){
  if(!fm) return fm;
  const out = {};
  Object.keys(fm).sort().forEach(k => {
    const r = fm[k], o = { id: r.id };
    KEYS.forEach(x => { if(Object.prototype.hasOwnProperty.call(r, x)) o[x] = r[x]; });
    out[k] = o;
  });
  return out;
}
const count = (L, a) => L.calls.filter(c => c.action === a).length;
function st(L){ return { loading: L.v('fullLoading'), err: L.v('fullErr'), done: L.v('fullDone'), total: L.v('fullTotal'), bad: L.v('fullBad') }; }

async function main(){
  const SRC = fs.readFileSync(HTML_PATH, 'utf8');
  say('対象: ' + HTML_PATH);
  const ALL = IDS.map(String).sort();

  /* 比べる相手＝古い GAS の時の道（1人ずつ getResident で取った fullMap） */
  const REF = load(SRC, 'old');
  REF.box.fullEnsure(false); await flush(20);
  const refMap = project(REF.v('fullMap'));

  group('1. 新しい GAS: 1回だけ呼び、getResident は0回');
  {
    const L = load(SRC, 'new');
    L.box.fullEnsure(false);
    eq('最初の呼び出しは getListFull・60秒', L.calls.slice(0, 1).map(c => [c.action, c.timeout]), [['getListFull', 60000]]);
    eq('まとめ読みの間は fullDone=0・fullTotal=8・fullLoading=true', [L.v('fullDone'), L.v('fullTotal'), L.v('fullLoading')], [0, 8, true]);
    await flush(20);
    eq('呼び出しは全部で1本', L.calls.length, 1);
    eq('getResident は0回', count(L, 'getResident'), 0);
    const s = st(L);
    eq('終わると fullLoading=false・fullErr=""・fullDone=fullTotal・fullBad=[]', [s.loading, s.err, s.done === s.total, s.bad], [false, '', true, []]);
    eq('fullMap に在籍者8名ぶん', Object.keys(L.v('fullMap') || {}).sort(), ALL);
    eq('★fullMap の5項目が、1人ずつ取った時と JSON で一致', project(L.v('fullMap')), refMap);
    t('比べる相手が空でない（1人ずつの道で8名取れている）', refMap && Object.keys(refMap).length === 8);
    eq('fullOf が定期薬を返す', (L.box.fullOf({ id: '201' }) || {}).medsRegular, L.D['201'].medsRegular);
    eq('fullOf は数値の id でも引ける', (L.box.fullOf({ id: 203 }) || {}).medsRegular, L.D['203'].medsRegular);
    t('終わった時に一覧を描き直す（curView=fam）', L.cnt.renderRoster === 1, L.cnt);
    /* 6720・7167行で fullMap[id].medsRegular を書き換える。行のオブジェクトが他と共有されていないこと */
    const fm = L.v('fullMap'); fm['201'].medsRegular = '書き換え';
    t('行を書き換えても他の方の行は変わらない', fm['202'].medsRegular === L.D['202'].medsRegular);
    L.box.fullEnsure(false); await flush(20);
    eq('fullMap がある時 fullEnsure(false) は取りに行かない', L.calls.length, 1);
    L.box.fullEnsure(true); await flush(20);
    eq('fullEnsure(true) は取り直す（getListFull がもう1本）', [L.calls.length, count(L, 'getListFull')], [2, 2]);
    eq('取り直した fullMap は新しい応答（書き換えは消える）', (L.box.fullOf({ id: '201' }) || {}).medsRegular, L.D['201'].medsRegular);
  }

  group('2. 古い GAS（不明なaction）: 1人ずつの道に戻る');
  {
    const L = load(SRC, 'old');
    L.box.fullEnsure(false); await flush(20);
    eq('getListFull 1本＋getResident 8本', [count(L, 'getListFull'), count(L, 'getResident')], [1, 8]);
    eq('getResident は在籍者全員を1回ずつ', L.calls.filter(c => c.action === 'getResident').map(c => String(c.id)).sort(), ALL);
    const s = st(L);
    eq('fullLoading=false・fullErr=""・fullDone=8・fullBad=[]', [s.loading, s.err, s.done, s.bad], [false, '', 8, []]);
    eq('fullMap は1人ずつの道と同じ', project(L.v('fullMap')), refMap);
    eq('この時 fullMap は getResident の全項目を持つ（今までと同じ）', (L.box.fullOf({ id: '201' }) || {}).name, NAMES[0]);
    eq('古い GAS の「不明なaction」は記録に残さない（配る前は毎回これになるため）', L.notes.length, 0);
  }
  {
    const L = load(SRC, 'norows');
    L.box.fullEnsure(false); await flush(20);
    eq('rows の無い応答も1人ずつの道に戻る', [count(L, 'getResident'), project(L.v('fullMap'))], [8, refMap]);
  }

  group('3. rows に欠けた id だけを getResident で取る');
  {
    const L = load(SRC, 'new', { skip: ['204', '207'] });
    L.box.fullEnsure(false); await flush(20);
    eq('getResident は欠けた2名だけ', L.calls.filter(c => c.action === 'getResident').map(c => String(c.id)).sort(), ['204', '207']);
    eq('fullMap は8名・1人ずつの道と5項目が一致', project(L.v('fullMap')), refMap);
    eq('fullDone=8・fullBad=[]', [L.v('fullDone'), L.v('fullBad')], [8, []]);
  }
  {
    const L = load(SRC, 'new', { skip: ['204'], failIds: ['204'] });
    L.box.fullEnsure(false); await flush(20);
    eq('欠けた方の getResident も失敗したら fullBad に入る（名簿の id のまま・今までと同じ）', (L.v('fullBad') || []).map(String), ['204']);
    eq('残り7名は fullMap にある・fullErr=""', [Object.keys(L.v('fullMap') || {}).length, L.v('fullErr')], [7, '']);
    eq('fullOf はその方に null（取得できずと出る）', L.box.fullOf({ id: '204' }), null);
  }

  group('4. 通信の失敗: 1人ずつの道に戻る');
  {
    const L = load(SRC, 'net');
    L.box.fullEnsure(false); await flush(20);
    eq('getListFull 1本＋getResident 8本', [count(L, 'getListFull'), count(L, 'getResident')], [1, 8]);
    eq('fullMap は1人ずつの道と同じ・fullErr=""', [project(L.v('fullMap')), L.v('fullErr')], [refMap, '']);
    eq('まとめ読みの失敗は種類だけを記録に1行残す', L.notes, [['まとめ読みの失敗', 'タイムアウト', 'master:listFull']]);
  }
  {
    const L = load(SRC, 'net', { failIds: IDS.map(String) });
    L.box.fullEnsure(false); await flush(20);
    eq('1人ずつの道も全員失敗なら「取得できませんでした」・fullMap=null', [L.v('fullErr'), L.v('fullMap'), L.v('fullLoading')], ['取得できませんでした', null, false]);
  }

  group('5. 世代が変わった後に届いた応答は捨てる');
  {
    const L = load(SRC, 'hold');
    L.box.fullEnsure(false); await flush();
    eq('getListFull が保留中', [L.held.length, L.v('fullLoading')], [1, true]);
    /* 端末の用途を「現場」へ切り替えた時と同じ（applyDeviceGuard が世代を進めて印を下ろす） */
    vm.runInContext("fullGen++; fullLoading=false; fullErr=''; fullDone=0; fullTotal=0; fullMap=null; fullBad=null;", L.box);
    const p0 = L.cnt.paintShBars, r0 = L.cnt.renderRoster;
    L.held.forEach(f => f()); await flush(20);
    eq('届いても fullMap は null のまま', L.v('fullMap'), null);
    eq('fullLoading=false・fullDone=0・fullBad=null', [L.v('fullLoading'), L.v('fullDone'), L.v('fullBad')], [false, 0, null]);
    eq('getResident を取りに行かない', count(L, 'getResident'), 0);
    eq('描き直しも呼ばない', [L.cnt.paintShBars - p0, L.cnt.renderRoster - r0], [0, 0]);
  }
  {
    /* 取り直し（fullEnsure(true)）に追い越された古い応答も捨てる */
    const L = load(SRC, 'hold');
    L.box.fullEnsure(false); await flush();
    vm.runInContext('fullLoading=false;', L.box);   // 取り直しを起こせるように（実際は fullMap がある時の再取得の場面）
    L.box.fullEnsure(true); await flush();
    eq('2本が保留中', L.held.length, 2);
    L.held[1](); await flush(20);
    const after = JSON.stringify(project(L.v('fullMap')));
    eq('新しい世代の応答で fullMap ができる', project(L.v('fullMap')), refMap);
    L.held[0](); await flush(20);
    eq('古い世代の応答が後から届いても fullMap は入れ替わらない', JSON.stringify(project(L.v('fullMap'))) === after && L.v('fullDone') === 8, true);
    eq('getResident は0回', count(L, 'getResident'), 0);
  }

  group('6. 現場端末では1本も送らない');
  {
    const L = load(SRC, 'new');
    L.store.set('su_device_role', 'field');
    L.box.fullEnsure(false); L.box.fullEnsure(true); await flush(20);
    eq('呼び出し0本・fullLoading=false・fullMap=null', [L.calls.length, L.v('fullLoading'), L.v('fullMap')], [0, false, null]);
  }

  group('7. rows の中に壊れた行があっても落ちない');
  {
    const good = gasListFull(sheetData()).filter(r => String(r.id) !== '205' && String(r.id) !== '206');
    const rows = [null, undefined, 0, '文字', [], ['205'], {}, { id: null }, { medsRegular: 'id のない行' }].concat(good)
      .concat([{ id: 201, medsRegular: '同じ id の2行目（使わない）' }, { id: 999, medsRegular: '名簿に居ない方' }]);
    const L = load(SRC, 'new', { rows });
    L.box.fullEnsure(false); await flush(20);
    eq('fullErr=""・fullLoading=false', [L.v('fullErr'), L.v('fullLoading')], ['', false]);
    eq('使えない行の方（205・206）だけを getResident で取る', L.calls.filter(c => c.action === 'getResident').map(c => String(c.id)).sort(), ['205', '206']);
    eq('fullMap は在籍者8名だけ（名簿に居ない 999 は入れない）', Object.keys(L.v('fullMap') || {}).sort(), ALL);
    eq('同じ id は先の行を使う', (L.box.fullOf({ id: '201' }) || {}).medsRegular, L.D['201'].medsRegular);
    eq('fullMap の5項目は1人ずつの道と一致', project(L.v('fullMap')), refMap);
  }
  {
    const L = load(SRC, 'new', { rows: [null, {}, { id: null }] });
    L.box.fullEnsure(false); await flush(20);
    eq('使える行が1つも無ければ全員を1人ずつ取る', [count(L, 'getResident'), project(L.v('fullMap'))], [8, refMap]);
  }

  say('\nOK ' + ok + ' / NG ' + ng);
  if(ng > 0) process.exit(1);
}

main().catch(e => { say('例外: ' + (e && e.stack || e)); say('\nOK ' + ok + ' / NG ' + (ng + 1)); process.exit(1); });
