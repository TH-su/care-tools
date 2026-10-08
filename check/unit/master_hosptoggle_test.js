/* 入居者マスタ（resident-master.html）の「入院／退院」ボタン（toggleHosp）のテスト。
   対象: toggleHosp・saveRosterCache・writeCommonRoster・refreshRoster・normRosterRow ほか
         （HTML 全体は評価せず、実物のソースから切り出して vm に入れる。通信・画面は偽物）
   実行: node "…/check/unit/master_hosptoggle_test.js"
         MASTER_HTML=<直した版>/resident-master.html MASTER_HTML_OLD=<直す前の版>/resident-master.html node "…/check/unit/master_hosptoggle_test.js"
         （MASTER_HTML_OLD を渡した時だけ「直す前は取り違えが再現する」群を実行する）

   背景（壊れうること）:
     toggleHosp は setState の応答を待つ。直す前の成功側は、ボタンを押した時に控えた番号（sid）ではなく
     【応答が届いた時点で開いている方（curResident）】に結果を書いていた。そのため
       A さんのボタンを押す → 応答の前に B さんを開く → A さんの応答が届く
     の順になると、押していない B さんに入院の印が付き（退院なら B さんの印が消え）、
     一覧の控え（rmaster_roster）と共有名簿（su_residents_common）にもそのまま書かれる。
     共有名簿は排泄記録・週間計画・体重が読む（入院の印は「マスタ常勝」で反映される）。
     サーバーには A さんで正しく書けているので、次の名簿の取り直しで名簿は直るが、
     開いている B さんの画面は開き直すまで直らない。
   失敗側（.catch）は元から sid で照合しており取り違えない。このテストはそれが変わらないことも確かめる。

   ★openResident は画面の部品に強く依存するため切り出さない。別の方を開く動きは
     「curResident を null にする →（取得できたら）その方の記録を入れる」という同じ順で代用する。

   実データは含まない。値は全て架空（id・居室番号はテスト用の作り物で、人名は1つも書かない）。
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

/* 非同期の待ち（保留中の Promise の連鎖を流し切る） */
async function flush(n){ for(let k = 0; k < (n || 6); k++) await new Promise(r => setImmediate(r)); }

/* 架空の3名。A=在籍 / B=在籍 / C=入院中。id・居室番号と、案内の文言を見るための作り物の氏名（実在しない） */
const A = 'm101', B = 'm102', C = 'm103';
const AT_OLD = '2026-01-01T00:00:00.000Z', AT_NEW = '2026-01-02T03:04:05.000Z';
const rosterRow = (id, hosp) => ({ id: id, name: '', kana: '', room: id.slice(1), gender: '', careLevel: '', active: true,
  updatedAt: '', birthDate: '', height: '', dischargeDate: '', hospitalized: hosp });
const NAME = { m101: 'テスト甲', m102: 'テスト乙', m103: 'テスト丙' };
const WHO = id => id.slice(1) + '号室 ' + NAME[id] + ' 様';   // 案内に添える「どなたの」
const rec = (id, hosp) => ({ id: id, name: NAME[id], room: id.slice(1), hospitalized: hosp, hospitalizedAt: hosp ? AT_OLD : '' });

/* ソースを受け取り、vm の箱と操作用の口を返す */
function load(src){
  const store = new Map();
  const posts = [], gets = [];   // 通信の記録 {args, resolve, reject, done}
  const log = { toast: [], sync: [], renderView: [], renderRoster: 0 };
  const btn = { disabled: false, hidden: false };
  const list = { on: false, classList: { contains: c => c === 'on' && list.on } };   // 一覧画面（sc-list）の表示中の印
  function deferred(list){
    return function(args, timeout){
      let res, rej;
      const p = new Promise((a, b) => { res = a; rej = b; });
      const c = { args, timeout, done: false,
        resolve(v){ c.done = true; res(v); }, reject(e){ c.done = true; rej(e || new Error('架空の通信失敗')); } };
      list.push(c);
      return p;
    };
  }
  const box = {
    localStorage: {
      getItem(k){ return store.has(k) ? store.get(k) : null; },
      setItem(k, v){ store.set(k, String(v)); },
      removeItem(k){ store.delete(k); }
    },
    ROSTER_KEY: 'rmaster_roster',
    COMMON_KEY: 'su_residents_common',
    CFG: { url: 'https://example.invalid/exec', token: '' },
    window: {},
    $: id => (id === 'hospBtn' ? btn : id === 'sc-list' ? list : null),
    roster: [rosterRow(A, false), rosterRow(B, false), rosterRow(C, true)],
    curResident: null,
    /* 別セッションで入る予定の「端末が現場用へ切り替わった」判定（devGen）があっても無くても動くように置く */
    devGen: 0, devBlocked_: false, rosterPurged_: false,
    srevLast: null, srevMetaLast: null,
    getDeviceRole(){ return 'office'; },
    apiPost: deferred(posts),
    apiGet: deferred(gets),
    setSync(m, k){ log.sync.push(m); },
    toast(m){ log.toast.push(m); },
    renderView(r){ log.renderView.push(r && r.id); },
    renderRoster(){ log.renderRoster++; }
  };
  vm.createContext(box);
  /* 案内の文言の関数（hospWho_・hospDoneMsg_）は直した版にだけある。直す前の版では無いまま読み込む */
  const opt = ['hospWho_', 'hospDoneMsg_', 'hospOnList_', 'hospNote_', 'hospApplyPend_'].filter(n => src.indexOf('\nfunction ' + n + '(') >= 0);
  const code = ['_toTargetArr', '_ymd', 'normRosterRow', 'saveRosterCache', 'writeCommonRoster',
    'srevPickMeta', 'srevSeen', 'refreshRoster'].concat(opt, ['toggleHosp']).map(n => grabFn(src, n)).join('\n')
    + (src.indexOf('\nvar hospPend_=') >= 0 ? '\n' + src.slice(src.indexOf('\nvar hospPend_=') + 1).split('\n')[0] : '');
  vm.runInContext(code, box, { filename: 'resident-master.html(hosptoggle)' });
  /* 起動時と同じく、最初の名簿を控えと共有名簿へ書いておく */
  box.saveRosterCache(); box.writeCommonRoster();
  const hospOf = list => { const o = {}; list.forEach(r => { o[r.id != null ? r.id : r.masterId] = r.hospitalized; }); return o; };
  return {
    box, posts, gets, log, btn, list, store,
    /* 別の方を開く動き（openResident と同じ順）: まず前の方を捨てる → 取得できたら入れる */
    leave(){ box.curResident = null; },
    /* 開き直しの始まり（openResident の冒頭と同じ: 控えを捨てる → 開く番号を控える → 記録を空にする） */
    reopen(id){ if('hospPend_' in box){ vm.runInContext("hospPend_={}; hospOpening_=" + JSON.stringify(String(id)) + ";", box); } box.curResident = null; },
    pend(){ return 'hospPend_' in box ? JSON.parse(JSON.stringify(vm.runInContext('hospPend_', box))) : null; },
    arrive(r){ box.curResident = r; },
    mem(){ return hospOf(box.roster); },                                              // メモリの名簿
    cache(){ return hospOf(JSON.parse(store.get('rmaster_roster'))); },               // 一覧の控え
    common(){ return hospOf(JSON.parse(store.get('su_residents_common')).residents); } // 共有名簿
  };
}
const okRes = hosp => ({ ok: true, hospitalized: hosp, hospitalizedAt: AT_NEW });
const noWrong = (L, label) => t(label, !L.log.toast.some(m => /応答は届きませんでした/.test(m)), L.log.toast);

/* ═══════════ 直した版に求める動き ═══════════ */
async function main(src){
  group('1. 同じ方を開いたまま応答が届く（いままでどおり）');
  {
    const L = load(src), a = rec(A, false);
    L.arrive(a); L.box.toggleHosp();
    eq('setState を1回だけ送る（id・入院=true・src=master）', L.posts.map(c => c.args),
      [{ action: 'setState', id: A, hospitalized: true, src: 'master' }]);
    t('応答を待つ間はボタンを押せない', L.btn.disabled === true);
    L.posts[0].resolve(okRes(true)); await flush();
    eq('開いている方の記録が入院中になる', [a.hospitalized, a.hospitalizedAt], [true, AT_NEW]);
    eq('メモリの名簿', L.mem(), { [A]: true, [B]: false, [C]: true });
    eq('一覧の控え', L.cache(), { [A]: true, [B]: false, [C]: true });
    eq('共有名簿', L.common(), { [A]: true, [B]: false, [C]: true });
    eq('その方の画面を描き直す', L.log.renderView, [A]);
    eq('案内', L.log.toast, ['🏥 入院中にしました']);
    eq('同期の表示', L.log.sync, ['保存中…', '保存OK']);
    eq('取り直しの通信は出さない', L.gets.length, 0);
  }

  group('2. 応答の前に別の方を開いた（入院にする）');
  {
    const L = load(src), a = rec(A, false), b = rec(B, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave(); L.arrive(b);                       // 一覧へ戻って B を開き、B の読み込みが先に終わる
    L.posts[0].resolve(okRes(true)); await flush();
    eq('メモリの名簿: 押した A だけが入院中', L.mem(), { [A]: true, [B]: false, [C]: true });
    eq('一覧の控え', L.cache(), { [A]: true, [B]: false, [C]: true });
    eq('共有名簿: B に入院の印を付けない', L.common(), { [A]: true, [B]: false, [C]: true });
    eq('開いている B の記録は変えない', [b.hospitalized, b.hospitalizedAt], [false, '']);
    eq('B の画面を描き直さない', L.log.renderView, []);
    t('一覧は描き直す', L.log.renderRoster >= 1);
    eq('同期の表示', L.log.sync, ['保存中…', '保存OK']);
    eq('案内は押した A の居室・氏名を添える', L.log.toast, ['🏥 ' + WHO(A) + 'を入院中にしました']);
    noWrong(L, '「応答は届きませんでした」とは言わない');
    eq('取り直しの通信は出さない', L.gets.length, 0);
  }

  group('3. 応答の前に別の方を開いた（退院・開いた方は入院中）');
  {
    const L = load(src), c0 = rec(C, true), a = rec(A, false);
    L.box.roster[0].hospitalized = true;           // A も入院中にしておく（退院の応答が A に付かないことも見る）
    a.hospitalized = true; a.hospitalizedAt = AT_OLD;
    L.arrive(c0); L.box.toggleHosp();              // C を退院にする
    eq('送る内容', L.posts[0].args, { action: 'setState', id: C, hospitalized: false, src: 'master' });
    L.leave(); L.arrive(a);
    L.posts[0].resolve(okRes(false)); await flush();
    eq('メモリの名簿: C だけが退院', L.mem(), { [A]: true, [B]: false, [C]: false });
    eq('共有名簿: 開いている A の入院の印を消さない', L.common(), { [A]: true, [B]: false, [C]: false });
    eq('開いている A の記録は変えない', [a.hospitalized, a.hospitalizedAt], [true, AT_OLD]);
    eq('A の画面を描き直さない', L.log.renderView, []);
    eq('案内は退院させた C の居室・氏名を添える', L.log.toast, ['🏠 ' + WHO(C) + 'の入院を解除しました']);
  }

  group('4. 別の方の読み込み中（誰も開いていない間）に応答が届く');
  {
    const L = load(src), a = rec(A, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave();                                      // 一覧へ戻った／B を読み込み中
    L.posts[0].resolve(okRes(true)); await flush();
    eq('メモリの名簿', L.mem(), { [A]: true, [B]: false, [C]: true });
    eq('共有名簿', L.common(), { [A]: true, [B]: false, [C]: true });
    eq('取り直しの通信は出さない（成功の応答は届いている）', L.gets.length, 0);
    noWrong(L, '「応答は届きませんでした」とは言わない');
    eq('同期の表示', L.log.sync, ['保存中…', '保存OK']);
    eq('画面は描き直さない', L.log.renderView, []);
    eq('案内は A の居室・氏名を添える（誰も開いていない）', L.log.toast, ['🏥 ' + WHO(A) + 'を入院中にしました']);
  }

  group('5. 一覧へ戻って同じ方を開き直した後に応答が届く');
  {
    const L = load(src), a1 = rec(A, false), a2 = rec(A, false);
    L.arrive(a1); L.box.toggleHosp();
    L.leave(); L.arrive(a2);                        // 同じ番号・取り直した別の記録（まだ古い値）
    L.posts[0].resolve(okRes(true)); await flush();
    eq('開き直した記録が入院中になる', [a2.hospitalized, a2.hospitalizedAt], [true, AT_NEW]);
    eq('その方の画面を描き直す', L.log.renderView, [A]);
    eq('共有名簿', L.common(), { [A]: true, [B]: false, [C]: true });
    eq('案内', L.log.toast, ['🏥 入院中にしました']);
  }

  group('6. 2人続けて押し、応答が逆の順で届く');
  {
    const L = load(src), a = rec(A, false), b = rec(B, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave(); L.arrive(b); L.box.toggleHosp();     // B も入院にする（A の応答はまだ）
    eq('2回送る', L.posts.map(c => c.args.id), [A, B]);
    L.posts[1].resolve(okRes(true)); await flush();
    eq('B の応答: B だけ', L.mem(), { [A]: false, [B]: true, [C]: true });
    eq('開いている B の記録', b.hospitalized, true);
    L.posts[0].resolve(okRes(true)); await flush();
    eq('A の応答: A も入院中', L.mem(), { [A]: true, [B]: true, [C]: true });
    eq('共有名簿', L.common(), { [A]: true, [B]: true, [C]: true });
    eq('B の画面だけを描く（A の応答では描かない）', L.log.renderView, [B]);
    eq('案内: 開いている B は従来どおり・A には居室・氏名を添える', L.log.toast,
      ['🏥 入院中にしました', '🏥 ' + WHO(A) + 'を入院中にしました']);
  }

  group('7. 失敗の応答 → 取り直して現物で判定（いままでどおり・番号で照合）');
  {
    const L = load(src), a = rec(A, false), b = rec(B, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave(); L.arrive(b);
    L.posts[0].resolve({ ok: false, error: '架空の失敗' }); await flush();
    eq('控えた番号で取り直す', L.gets.map(c => [c.args, c.timeout]), [[{ action: 'getResident', id: A }, 25000]]);
    L.gets[0].resolve({ record: { id: A, hospitalized: true, hospitalizedAt: AT_NEW } }); await flush();
    eq('メモリの名簿: A だけ', L.mem(), { [A]: true, [B]: false, [C]: true });
    eq('共有名簿', L.common(), { [A]: true, [B]: false, [C]: true });
    eq('開いている B の記録は変えない', b.hospitalized, false);
    eq('案内（別の方を開いているので居室・氏名を添える）', L.log.toast, ['🏥 ' + WHO(A) + 'を入院中にしました（応答は届きませんでしたが、反映を確認しました）']);
    t('ボタンを押せる状態へ戻す', L.btn.disabled === false);
  }
  {
    const L = load(src), a = rec(A, false);
    L.arrive(a); L.box.toggleHosp();
    L.posts[0].resolve({ ok: false, error: '架空の失敗' }); await flush();
    L.gets[0].resolve({ record: { id: A, hospitalized: true, hospitalizedAt: AT_NEW } }); await flush();
    eq('同じ方を開いたまま: 案内は従来どおり', L.log.toast, ['🏥 入院中にしました（応答は届きませんでしたが、反映を確認しました）']);
    eq('開いている A の記録と画面', [a.hospitalized, a.hospitalizedAt, L.log.renderView], [true, AT_NEW, [A]]);
  }
  {
    const L = load(src), a = rec(A, false), b = rec(B, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave(); L.arrive(b);
    L.posts[0].reject(new Error('架空の通信失敗')); await flush();
    L.gets[0].resolve({ record: { id: A, hospitalized: false, hospitalizedAt: '' } }); await flush();
    eq('書けていない＋別の方を開いている: 居室・氏名を添えて知らせる', L.log.toast,
      ['⚠️ ' + WHO(A) + 'の入院・退院を変更できていません: 架空の通信失敗。もう一度お試しください']);
    eq('何も変えない', [L.mem(), b.hospitalized], [{ [A]: false, [B]: false, [C]: true }, false]);
  }
  {
    const L = load(src), a = rec(A, false), b = rec(B, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave(); L.arrive(b);
    L.posts[0].reject(new Error('架空の通信失敗')); await flush();
    L.gets[0].reject(new Error('架空の通信失敗')); await flush();
    eq('確かめられない＋別の方を開いている: 居室・氏名を添えて知らせる', L.log.toast,
      ['⚠️ ' + WHO(A) + 'の入院・退院を変更できたか確認できませんでした。画面を再読み込みして、入院の表示を確かめてください']);
    eq('同期の表示', L.log.sync, ['保存中…', '確認中…', '確認できず']);
    t('ボタンを押せる状態へ戻す', L.btn.disabled === false);
  }
  {
    const L = load(src), a = rec(A, false);
    L.arrive(a); L.box.toggleHosp();
    L.posts[0].reject(new Error('架空の通信失敗')); await flush();
    L.gets[0].reject(new Error('架空の通信失敗')); await flush();
    eq('確かめられない＋同じ方: 案内は従来どおり', L.log.toast,
      ['⚠️ 変更できたか確認できませんでした。画面を再読み込みして、入院の表示を確かめてください']);
  }
  {
    const L = load(src), a = rec(A, false);
    L.arrive(a); L.box.toggleHosp();
    L.posts[0].reject(new Error('架空の通信失敗')); await flush();
    L.gets[0].resolve({ record: { id: A, hospitalized: false, hospitalizedAt: '' } }); await flush();
    eq('書けていなければ何も変えない', [L.mem(), L.common(), a.hospitalized],
      [{ [A]: false, [B]: false, [C]: true }, { [A]: false, [B]: false, [C]: true }, false]);
    eq('案内', L.log.toast, ['⚠️ 変更できていません: 架空の通信失敗。もう一度お試しください']);
    eq('同期の表示', L.log.sync, ['保存中…', '確認中…', '保存失敗']);
  }

  group('8. 名簿に押した方の行が無い（落ちない・他の方へ書かない）');
  {
    const L = load(src), a = rec(A, false), b = rec(B, false);
    L.arrive(a); L.box.toggleHosp();
    L.box.roster = L.box.roster.filter(r => r.id !== A);
    L.leave(); L.arrive(b);
    L.posts[0].resolve(okRes(true)); await flush();
    eq('メモリの名簿は他の方のまま', L.mem(), { [B]: false, [C]: true });
    eq('開いている B の記録は変えない', b.hospitalized, false);
    eq('取り直しの通信は出さない', L.gets.length, 0);
    eq('同期の表示', L.log.sync, ['保存中…', '保存OK']);
  }

  group('9. 「端末が現場用へ切り替わった」判定（devGen）との同居');
  if(/dg!==devGen/.test(grabFn(src, 'toggleHosp'))){
    const L = load(src), a = rec(A, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave(); L.box.devGen++;                      // 応答を待つ間に現場用へ切り替わった
    L.posts[0].resolve(okRes(true)); await flush();
    eq('名簿・共有名簿には触れない', [L.mem(), L.common()],
      [{ [A]: false, [B]: false, [C]: true }, { [A]: false, [B]: false, [C]: true }]);
    eq('案内も取り直しも出さない', [L.log.toast, L.gets.length], [[], 0]);
  }
  if(/function hospWho_\(/.test(src)){
    /* 失敗→取り直しを待つ間に現場用へ切り替わった（未保存があってブロックだけの場面）。
       案内には氏名が載りうるので、取り直しの応答が届いても出さない */
    for(const kind of ['届いた（書けていた）', '届いた（書けていない）', '通信失敗']){
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.posts[0].reject(new Error('架空の通信失敗')); await flush();
      L.leave(); L.box.devGen++;
      if(kind === '通信失敗') L.gets[0].reject(new Error('架空の通信失敗'));
      else L.gets[0].resolve({ record: { id: A, hospitalized: kind === '届いた（書けていた）', hospitalizedAt: AT_NEW } });
      await flush();
      eq('取り直しの応答が切り替え後に' + kind + ': 案内・名簿・同期の表示を変えない',
        [L.log.toast, L.mem(), L.log.sync], [[], { [A]: false, [B]: false, [C]: true }, ['保存中…', '確認中…']]);
      t('取り直しの応答が切り替え後に' + kind + ': ボタンは押せる状態へ戻す', L.btn.disabled === false);
    }
  }else{
    say('  －（このソースの toggleHosp に devGen の判定は無い＝対象外）');
  }

  group('11. 一覧へ戻っている間に応答が届く（開いていた方は同じでも「どなたの」を添える）');
  if(/function hospOnList_\(/.test(src)){
    {
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.list.on = true;                              // 一覧へ戻った（curResident は A のまま）
      L.posts[0].resolve(okRes(true)); await flush();
      eq('案内に居室・氏名を添える', L.log.toast, ['🏥 ' + WHO(A) + 'を入院中にしました']);
      eq('開いていた A の記録は更新する（同じ方）', [a.hospitalized, L.log.renderView], [true, [A]]);
      eq('名簿・共有名簿', [L.mem(), L.common()], [{ [A]: true, [B]: false, [C]: true }, { [A]: true, [B]: false, [C]: true }]);
    }
    {
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.list.on = true;
      L.posts[0].reject(new Error('架空の通信失敗')); await flush();
      L.gets[0].resolve({ record: { id: A, hospitalized: false, hospitalizedAt: '' } }); await flush();
      eq('失敗の案内にも添える', L.log.toast, ['⚠️ ' + WHO(A) + 'の入院・退院を変更できていません: 架空の通信失敗。もう一度お試しください']);
    }
  }else{
    say('  －（このソースには無い＝対象外）');
  }

  group('12. 同じ方を開き直している最中に応答が届く（開き直しの記録が古い時だけ当て直す・控えは開き直しの間だけ）');
  if(/function hospApplyPend_\(/.test(src)){
    const AT_SRV = '2026-01-02T03:04:05.000Z', AT_AFTER = '2026-01-02T03:04:06.000Z';
    {
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.reopen(A);                                    // A を開き直している最中
      L.posts[0].resolve(okRes(true)); await flush();
      eq('案内は居室・氏名つき（誰も開いていない）', L.log.toast, ['🏥 ' + WHO(A) + 'を入院中にしました']);
      const stale = { id: A, hospitalized: false, hospitalizedAt: '' };   // 書き込みより先に読んだ古い記録
      L.box.hospApplyPend_(stale);
      eq('古い記録には控えの値を当て直す', [stale.hospitalized, stale.hospitalizedAt], [true, AT_SRV]);
      const again = { id: A, hospitalized: false, hospitalizedAt: '' };
      L.box.hospApplyPend_(again);
      eq('控えは1回使ったら消える', again.hospitalized, false);
    }
    {
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.reopen(A);
      L.posts[0].resolve(okRes(true)); await flush();
      const newer = { id: A, hospitalized: false, hospitalizedAt: AT_AFTER };   // 他端末が後から退院にした
      L.box.hospApplyPend_(newer);
      eq('記録の方が新しければ記録のまま（他端末の変更を潰さない）', newer.hospitalized, false);
    }
    {
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.reopen(B);                                    // B を開いている最中に A の応答
      L.posts[0].resolve(okRes(true)); await flush();
      eq('別の方を開いている最中は控えない', L.pend(), {});
      L.arrive(rec(B, false));
      L.reopen(A);                                    // 後で A を開く
      const later = { id: A, hospitalized: false, hospitalizedAt: '2026-01-01T09:00:00.000Z' };   // 他端末の古い編集画面からの保存で過去へ戻った記録
      L.box.hospApplyPend_(later);
      eq('後で A を開いても控えで上書きしない（審査 2回目の low）', later.hospitalized, false);
    }
    {
      const L = load(src), a = rec(A, false), b = rec(B, false);
      L.arrive(a); L.box.toggleHosp();
      L.leave(); L.arrive(b);                         // B を開き終えている
      L.posts[0].resolve(okRes(true)); await flush();
      eq('別の方を開き終えている時は控えない', L.pend(), {});
    }
    {
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.reopen(A);
      L.posts[0].resolve(okRes(true)); await flush();
      t('開き直し中に届いた分は控える', !!(L.pend() || {})[A]);
      L.reopen(B);                                    // 開き直しが終わる前に B を開いた
      eq('次に openResident を呼んだら控えを捨てる', L.pend(), {});
    }
    {
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.posts[0].resolve(okRes(true)); await flush();      // 同じ方を開いたまま＝控えない
      eq('同じ方を開いたまま届いた時は控えない', L.pend(), {});
    }
    {
      const L = load(src), a = rec(A, false);
      L.arrive(a); L.box.toggleHosp();
      L.reopen(A);
      L.posts[0].reject(new Error('架空の通信失敗')); await flush();
      L.gets[0].resolve({ record: { id: A, hospitalized: true, hospitalizedAt: AT_SRV } }); await flush();
      const stale = { id: A, hospitalized: false, hospitalizedAt: '' };
      L.box.hospApplyPend_(stale);
      eq('失敗→取り直しで確認できた時も控える', [stale.hospitalized, stale.hospitalizedAt], [true, AT_SRV]);
    }
    /* openResident: 冒頭で控えを捨てて開く番号を控え、取得した記録を curResident に入れる直前に hospApplyPend_ を通す
       （openResident は画面依存が強いのでソースで見る） */
    const OR = grabFn(src, 'openResident');
    t('openResident: 冒頭で控えを捨て、開く番号を控える', /curResident=null;[^\n]*\n\s*hospPend_=\{\}; hospOpening_=String\(id\);/.test(OR));
    t('openResident: 取得した記録を curResident に入れる直前に hospApplyPend_(rec) を通す',
      /hospApplyPend_\(rec\);[^\n]*\n\s*curResident=rec;/.test(OR));
    /* applyDeviceGuard のブロックで案内（居室・氏名が載りうる）を消すこと */
    const AG = grabFn(src, 'applyDeviceGuard');
    t('applyDeviceGuard: ブロックした時に案内の文字を消し、表示も下ろす',
      /\$\('toast'\)\.textContent='';\s*\$\('toast'\)\.classList\.remove\('on'\);/.test(AG));
  }else{
    say('  －（このソースには無い＝対象外）');
  }

  group('10. 案内に添える「どなたの」（hospWho_・hospDoneMsg_）');
  if(/function hospWho_\(/.test(src)){
    const L = load(src), w = L.box.hospWho_, m = L.box.hospDoneMsg_;
    eq('居室と氏名', w({ room: '101', name: 'テスト甲' }), '101号室 テスト甲 様');
    eq('居室だけ', w({ room: '101', name: '' }), '101号室の方');
    eq('氏名だけ', w({ room: '', name: 'テスト甲' }), 'テスト甲 様');
    eq('どちらも無い → 添えない', [w({ room: '', name: '' }), w({}), w(null)], ['', '', '']);
    eq('前後の空白だけ落とし、中の空白は残す', w({ room: ' 101 ', name: ' テスト 甲 ' }), '101号室 テスト 甲 様');
    eq('居室が数値でも読める', w({ room: 101, name: 'テスト甲' }), '101号室 テスト甲 様');
    eq('成功の案内（添えない＝従来の文言のまま）', [m(true, ''), m(false, '')], ['🏥 入院中にしました', '🏠 入院を解除しました']);
    eq('成功の案内（添える）', [m(true, 'X'), m(false, 'X')], ['🏥 Xを入院中にしました', '🏠 Xの入院を解除しました']);
  }else{
    say('  －（このソースには無い＝対象外）');
  }
}

/* ═══════════ 直す前は取り違えが再現する ═══════════ */
async function old(src){
  group('旧1. 直す前: 押していない方に入院の印が付き、共有名簿にも書かれる');
  {
    const L = load(src), a = rec(A, false), b = rec(B, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave(); L.arrive(b);
    L.posts[0].resolve(okRes(true)); await flush();
    eq('メモリの名簿: A=false / B=true（取り違え）', L.mem(), { [A]: false, [B]: true, [C]: true });
    eq('共有名簿にも B=true で書かれる', L.common(), { [A]: false, [B]: true, [C]: true });
    eq('開いている B の記録が入院中になる', b.hospitalized, true);

    /* 次の名簿の取り直し（サーバーは A に正しく書けている）で直る範囲を確かめる */
    L.box.refreshRoster();
    L.gets[0].resolve({ roster: [rosterRow(A, true), rosterRow(B, false), rosterRow(C, true)], stateRev: 2 });
    await flush();
    eq('名簿の取り直しで、名簿は直る', L.mem(), { [A]: true, [B]: false, [C]: true });
    eq('共有名簿も直る', L.common(), { [A]: true, [B]: false, [C]: true });
    eq('開いている B の記録は直らない（開き直すまで入院中の表示のまま）', b.hospitalized, true);
  }

  group('旧2. 直す前: 退院の応答で、開いている別の方の入院の印が消える');
  {
    const L = load(src), c0 = rec(C, true), a = rec(A, true);
    L.box.roster[0].hospitalized = true;
    L.arrive(c0); L.box.toggleHosp();
    L.leave(); L.arrive(a);
    L.posts[0].resolve(okRes(false)); await flush();
    eq('共有名簿: 入院中の A が在籍に、退院させた C は入院中のまま', L.common(), { [A]: false, [B]: false, [C]: true });
  }

  group('旧3. 直す前: 誰も開いていない間に届くと、例外から取り直しへ回り「応答は届きませんでした」と案内する');
  {
    const L = load(src), a = rec(A, false);
    L.arrive(a); L.box.toggleHosp();
    L.leave();
    L.posts[0].resolve(okRes(true)); await flush();
    eq('余分な取り直しの通信が1回出る', L.gets.map(c => c.args), [{ action: 'getResident', id: A }]);
    L.gets[0].resolve({ record: { id: A, hospitalized: true, hospitalizedAt: AT_NEW } }); await flush();
    eq('名簿は番号で正しく付く', L.mem(), { [A]: true, [B]: false, [C]: true });
    eq('案内（応答は届いているのに、届かなかったと言う）', L.log.toast,
      ['🏥 入院中にしました（応答は届きませんでしたが、反映を確認しました）']);
  }
}

(async function(){
  say('対象: ' + HTML_PATH);
  await main(fs.readFileSync(HTML_PATH, 'utf8'));
  if(OLD_PATH){
    say('\n直す前の版: ' + OLD_PATH);
    await old(fs.readFileSync(OLD_PATH, 'utf8'));
  }else{
    say('\n（MASTER_HTML_OLD 未指定のため「直す前は再現する」群は実行していない）');
  }
  say('\n結果: ' + ok + ' 件成功 / ' + ng + ' 件失敗');
  process.exit(ng ? 1 : 0);
})().catch(e => { say('テスト自体が落ちました: ' + (e && e.stack || e)); process.exit(2); });
