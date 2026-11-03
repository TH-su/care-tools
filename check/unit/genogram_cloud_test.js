/* 家族構成図の絵を別の端末でも出す（統合 0056・代表者の決定 2026-11-03）の試験。
   対象:
     読む側  resident-master.html / facesheet.html の getGenogramRec・genoCloudKind・genoRemoteWins・genoCloudGet・genoPaintBoxes（2画面で逐語同一）と、
             画面ごとのつなぎ（fsGenoCloud_ / rmGenoCloud_）
     書く側  genogram.html の suGenoRpcKind・suGenoThumbTodo・suGenoMidsOfName・writeSuGenogram・sweepSuGenoThumbs・suGenoDelThumbs と、
             保存の後の知らせ・図を消した時の呼び出し
   実行: node check/unit/genogram_cloud_test.js
         MASTER_HTML=… FACESHEET_HTML=… GENO_HTML=… で別の版を当てられる（直す前の版では落ちる）
   守ること:
     1. 送るのは masterId のキーを書けた時だけ。氏名キーだけの保存・別人の図・名簿に無い id は送らない
     2. 読んだ絵は日時（時刻）で比べて新しい時だけ差し替える。差し替えるのは .geno-box の中身だけ・esc を通す
     3. 関数が無い（準備前）・ログインなし・断られた時は今までどおり（知らせ・記録を出さない）。それ以外の失敗は記録に残す
     4. 遅れて届いた応答（別の方を開いた・現場用へ変わった）は捨てる。現場用の画面（renderFieldView）は触らない
   実データは含まない。氏名・番号はすべて架空。
   ★出力に console を使わない（個人情報を出力に流さないための決まり）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = {
  master: fs.readFileSync(process.env.MASTER_HTML || path.join(ROOT, 'resident-master.html'), 'utf8'),
  face: fs.readFileSync(process.env.FACESHEET_HTML || path.join(ROOT, 'facesheet.html'), 'utf8'),
  geno: fs.readFileSync(process.env.GENO_HTML || path.join(ROOT, 'genogram.html'), 'utf8')
};

let ok = 0, ng = 0;
const say = m => process.stdout.write(m + '\n');
function group(n){ say('\n■ ' + n); }
function t(label, cond, info){ if(cond){ ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '\n    → ' + JSON.stringify(info) : '')); } }
function eq(label, got, want){ const g = JSON.stringify(got), w = JSON.stringify(want); t(label, g === w, g === w ? undefined : { 期待: want, 実際: got }); }

/* 関数を名前で切り出す（文字列・テンプレート文字列・正規表現の中のかっこは数えない程度の簡易版） */
function grabFn(src, name, prefix){
  const start = src.indexOf('\n' + (prefix || '') + 'function ' + name + '(');
  if(start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false, q = null;
  for(let i = start; i < src.length; i++){
    const c = src[i], p = src[i-1];
    if(q){ if(c === q && p !== '\\') q = null; continue; }
    if(c === "'" || c === '"' || c === '`'){ q = c; continue; }
    if(c === '{'){ depth++; seen = true; }
    else if(c === '}'){ depth--; if(seen && depth === 0) return src.slice(start + 1, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
function tryGrab(src, name, prefix){ try { return grabFn(src, name, prefix); } catch(e){ return ''; } }
function grabLine(src, head){ const i = src.indexOf('\n' + head); if(i < 0) throw new Error('行が見つかりません: ' + head); return src.slice(i + 1, src.indexOf('\n', i + 1)); }

function makeLS(init){
  const store = Object.assign({}, init || {});
  return {
    store,
    getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; },
    key(i){ return Object.keys(store)[i] == null ? null : Object.keys(store)[i]; },
    get length(){ return Object.keys(store).length; }
  };
}
const SESSION = { 'sb-fakeproj-auth-token': '{"x":1}' };
const IMG = (s) => 'data:image/jpeg;base64,' + s;
const flush = () => new Promise(r => setImmediate(r));
async function settle(){ for(let i = 0; i < 10; i++) await flush(); }

(async function main(){
try {
/* ═══ 1. 読む側は2画面で逐語同一 ═══ */
group('1. 読む側の関数は入居者マスタとフェイスシートで逐語同一');
const SHARED = ['getGenogramRec', 'getGenogram', 'genoCloudKind', 'genoRemoteWins', 'genoCloudGet', 'genoPaintBoxes'];
SHARED.forEach(n => {
  const a = tryGrab(SRC.master, n), b = tryGrab(SRC.face, n);
  t(n + ' が両画面にあり同一', a !== '' && a === b);
});

/* 読む側の純関数を入居者マスタの版で砂場に入れる */
function readerBox(src, ls){
  const sb = { localStorage: ls || makeLS(), window: {}, Promise, JSON, Date, String, Array, Object, isFinite, RegExp };
  vm.createContext(sb);
  vm.runInContext([grabLine(src, "var SU_GENO_KEY="), grabLine(src, 'function esc(s)')].concat(SHARED.map(n => grabFn(src, n))).join('\n'), sb);
  return sb;
}

/* ═══ 2. 応答の分け方 ═══ */
group('2. geno_thumb_get の応答の分け方（genoCloudKind）');
{
  const R = readerBox(SRC.master);
  const k = (r) => R.genoCloudKind(r);
  eq('関数が無い（PGRST202）→ nofunc', k({ error: { code: 'PGRST202', message: 'x' } }).kind, 'nofunc');
  eq('関数が無い（42883）→ nofunc', k({ error: { code: '42883', message: 'x' } }).kind, 'nofunc');
  eq('関数が無い（文言だけ）→ nofunc', k({ error: { code: 'XX000', message: 'Could not find the function public.geno_thumb_get' } }).kind, 'nofunc');
  eq('権限が無い（42501）→ denied', k({ error: { code: '42501', message: 'x' } }).kind, 'denied');
  eq('ログインの証明が古い（PGRST303）→ denied', k({ error: { code: 'PGRST303', message: 'x' } }).kind, 'denied');
  eq('番号の無い失敗（届かない）→ line', k({ error: { code: '', message: 'TypeError: Failed to fetch' } }).kind, 'line');
  eq('ほかの番号 → fail（番号を持つ）', k({ error: { code: 'XX000', message: 'boom' } }), { kind: 'fail', code: 'XX000' });
  eq('行なし → empty', k({ data: { ok: true, row: null } }).kind, 'empty');
  eq('形の違う番号（badid）→ empty（記録しない）', k({ data: { ok: false, error: 'badid' } }).kind, 'empty');
  eq('ok でない → fail', k({ data: { ok: false, error: 'other' } }), { kind: 'fail', code: 'other' });
  eq('中身が無い → fail', k({ data: null }), { kind: 'fail', code: 'shape' });
  const good = { data: { ok: true, row: { image: IMG('AAAA'), at: '2026-11-03T01:00:00+00:00' } } };
  eq('絵と日時がある → ok', k(good), { kind: 'ok', row: { image: IMG('AAAA'), at: '2026-11-03T01:00:00+00:00' } });
  eq('JPEG の data URL でない → fail', k({ data: { ok: true, row: { image: 'javascript:alert(1)', at: '2026-11-03T01:00:00Z' } } }).kind, 'fail');
  eq('PNG も受けない → fail', k({ data: { ok: true, row: { image: 'data:image/png;base64,AA', at: '2026-11-03T01:00:00Z' } } }).kind, 'fail');
  eq('100万字を超える → fail（共通 DB と同じ上限）', k({ data: { ok: true, row: { image: IMG('A'.repeat(1000000)), at: '2026-11-03T01:00:00Z' } } }).kind, 'fail');
  eq('ちょうど100万字 → ok', k({ data: { ok: true, row: { image: IMG('A'.repeat(1000000 - 23)), at: '2026-11-03T01:00:00Z' } } }).kind, 'ok');
  eq('大きな図の長さ（約60万字）→ ok（前の上限30万字では落ちていた）', k({ data: { ok: true, row: { image: IMG('A'.repeat(605447 - 23)), at: '2026-11-03T01:00:00Z' } } }).kind, 'ok');
  eq('日時が読めない → fail', k({ data: { ok: true, row: { image: IMG('A'), at: 'きのう' } } }).kind, 'fail');
  eq('日時が文字列でない → fail', k({ data: { ok: true, row: { image: IMG('A'), at: 123 } } }).kind, 'fail');
  eq('row が文字列 → fail', k({ data: { ok: true, row: 'x' } }).kind, 'fail');
}

/* ═══ 3. 差し替えるかの判定 ═══ */
group('3. 届いた絵で差し替えるか（genoRemoteWins・時刻で比べる）');
{
  const R = readerBox(SRC.master);
  const w = (l, r) => R.genoRemoteWins(l, r);
  const row = { image: IMG('NEW'), at: '2026-11-03T01:00:00+00:00' };   // = 10:00 +09:00
  eq('端末に無い → 差し替える', w(null, row), true);
  eq('端末の絵が空 → 差し替える', w({ image: '', at: '' }, row), true);
  eq('端末の絵が空（日時は新しい）→ 差し替える', w({ image: '', at: '2026-12-01T00:00:00+09:00' }, row), true);
  eq('端末の方が古い（09:59 +09:00）→ 差し替える', w({ image: IMG('OLD'), at: '2026-11-03T09:59:00+09:00' }, row), true);
  eq('同じ時刻（表し方が違うだけ）→ 差し替えない', w({ image: IMG('OLD'), at: '2026-11-03T10:00:00+09:00' }, row), false);
  eq('端末の方が新しい（10:01 +09:00・文字列では小さく見える）→ 差し替えない', w({ image: IMG('OLD'), at: '2026-11-03T10:01:00+09:00' }, row), false);
  eq('同じ絵 → 差し替えない', w({ image: IMG('NEW'), at: '2026-11-01T00:00:00+09:00' }, row), false);
  eq('端末の日時が読めない → 差し替える', w({ image: IMG('OLD'), at: '' }, row), true);
  eq('届いた日時が読めない → 差し替えない', w(null, { image: IMG('NEW'), at: 'x' }), false);
  eq('届いた絵が無い → 差し替えない', w(null, { image: '', at: '2026-11-03T01:00:00Z' }), false);
  eq('届いた行が無い → 差し替えない', w(null, null), false);
}

/* ═══ 4. 枠の差し替え（DOM の模型）═══ */
group('4. 枠の中身だけを差し替える（genoPaintBoxes）');
{
  const ls = makeLS();
  const R = readerBox(SRC.master, ls);
  const box = (geno) => ({ attrs: { 'data-geno': geno }, innerHTML: 'もとの中身', getAttribute(k){ return this.attrs[k] == null ? null : this.attrs[k]; } });
  const boxes = [box('R-1'), box('R-1'), box('R-2')];
  const root = { querySelectorAll: (sel) => (sel === '.geno-box' ? boxes : []) };
  const row = { image: IMG('A"><img src=x onerror=1>'), at: '2026-11-03T01:00:00Z' };
  const n = R.genoPaintBoxes(root, 'R-1', '架空 一郎', row);
  eq('その方の枠（2か所）だけ差し替える', n, 2);
  t('差し替えた中身は既存と同じ形の <img class="geno-img">', /^<img class="geno-img" src="[^"]*" alt="家族構成図">$/.test(boxes[0].innerHTML), boxes[0].innerHTML);
  t('絵の文字はエスケープする（" < > を生で入れない）', boxes[0].innerHTML.indexOf('&quot;&gt;&lt;img') > 0 && boxes[0].innerHTML.indexOf('"><img src=x') < 0, boxes[0].innerHTML);
  eq('別の方の枠は触らない', boxes[2].innerHTML, 'もとの中身');
  /* 端末の控えの方が新しい時は差し替えない */
  ls.setItem('su_genograms', JSON.stringify({ 'R-3': { image: IMG('LOCAL'), name: '架空 次郎', updatedAt: '2026-11-03T12:00:00+09:00' } }));
  const b3 = [box('R-3')];
  const root3 = { querySelectorAll: () => b3 };
  eq('端末の控えが新しい → 差し替えない', R.genoPaintBoxes(root3, 'R-3', '架空 次郎', { image: IMG('REMOTE'), at: '2026-11-03T02:00:00Z' }), 0);
  eq('端末の控えより新しい → 差し替える', R.genoPaintBoxes(root3, 'R-3', '架空 次郎', { image: IMG('REMOTE'), at: '2026-11-03T04:00:00Z' }), 1);
  /* 端末の控えが別人の記録（氏名が違う）なら、端末に無いのと同じ扱い */
  ls.setItem('su_genograms', JSON.stringify({ 'R-4': { image: IMG('OTHER'), name: '架空 別人', updatedAt: '2026-11-04T00:00:00+09:00' } }));
  const b4 = [box('R-4')];
  eq('端末の控えが別人の図 → 届いた絵で差し替える', R.genoPaintBoxes({ querySelectorAll: () => b4 }, 'R-4', '架空 三郎', { image: IMG('REMOTE'), at: '2026-11-01T00:00:00Z' }), 1);
  eq('getGenogramRec は {image, at} を返す', R.getGenogramRec('R-4', '架空 別人'), { image: IMG('OTHER'), at: '2026-11-04T00:00:00+09:00' });
  eq('getGenogram は今までどおり絵だけを返す', R.getGenogram('R-4', '架空 別人'), IMG('OTHER'));
}

/* ═══ 5. 読み込み（genoCloudGet）═══ */
group('5. ログインの控えがある時だけ読む（genoCloudGet）');
{
  const calls = [];
  const mk = (withSession, rpcReply, loadFails) => {
    const R = readerBox(SRC.master, makeLS(withSession ? SESSION : {}));
    R.window.SUAuth = { client: () => ({ rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve(rpcReply); } }) };
    return { R, load: () => (loadFails ? Promise.reject(new Error('load')) : Promise.resolve()) };
  };
  let x = mk(false, null);
  eq('ログインの控えが無い → nologin', (await x.R.genoCloudGet('R-1', x.load)).kind, 'nologin');
  eq('  └ 問い合わせない', calls.length, 0);
  x = mk(true, { data: { ok: true, row: { image: IMG('A'), at: '2026-11-03T01:00:00Z' } } });
  eq('ログインあり → geno_thumb_get を読む', (await x.R.genoCloudGet('R-1', x.load)).kind, 'ok');
  eq('  └ 呼ぶのは geno_thumb_get(p_resident_id) だけ', JSON.stringify(calls), JSON.stringify([['geno_thumb_get', { p_resident_id: 'R-1' }]]));
  x = mk(true, { error: { code: 'PGRST202', message: 'Could not find the function' } });
  eq('関数が無い → nofunc', (await x.R.genoCloudGet('R-1', x.load)).kind, 'nofunc');
  x = mk(true, null, true);
  eq('部品を読み込めない → line（例外を外に出さない）', (await x.R.genoCloudGet('R-1', x.load)).kind, 'line');
  x = mk(true, null);
  eq('id が空 → 読まない', (await x.R.genoCloudGet('', x.load)).kind, 'nologin');
}

/* ═══ 6. 画面ごとのつなぎ（遅れて届いた応答を捨てる）═══ */
group('6. 画面のつなぎ: 遅れた応答を捨てる・現場では読まない・失敗だけ記録する');
async function glue(page){
  const src = page === 'face' ? SRC.face : SRC.master;
  const fn = page === 'face' ? 'fsGenoCloud_' : 'rmGenoCloud_';
  const memVar = page === 'face' ? 'var fsGenoMem_=null;' : 'var rmGenoMem_=null;';
  const code = tryGrab(src, fn);
  if(!code){ t(page + ': つなぎの関数 ' + fn + ' がある', false); return; }
  const env = { field: false, seq: 1, dev: 0, curId: 'R-1', notes: [], painted: [], gets: [], replies: [] };
  const sb = {
    window: {}, Promise, String, JSON,
    $: () => ({ tag: 'viewBox' }),
    genoPaintBoxes: (root, id, name, row) => { env.painted.push([id, name, row.image]); return 1; },
    genoCloudGet: (id, load) => { env.gets.push(id); return new Promise(ok => env.replies.push(ok)); },
    fsAuthLoad_: () => Promise.resolve(), msAuthLoad_: () => Promise.resolve(),
    fsNoteAs_: (k, w, e) => env.notes.push([w, e]), rmNote_: (w, e) => env.notes.push([w, e])
  };
  vm.createContext(sb);
  vm.runInContext(memVar + '\n' + code + '\n' + (page === 'face'
    ? 'function isField(){return __env.field} function duCurId_(){return __env.curId} var curRec={name:"架空 一郎"};' +
      'Object.defineProperty(this,"openSeq",{get:function(){return __env.seq}}); Object.defineProperty(this,"devGen",{get:function(){return __env.dev}});'
    : 'function getDeviceRole(){return __env.field?"field":"office"} Object.defineProperty(this,"curResident",{get:function(){return __env.curId==null?null:{id:__env.curId,name:"架空 一郎"}}});' +
      'Object.defineProperty(this,"devGen",{get:function(){return __env.dev}});'), Object.assign(sb, { __env: env }));
  const call = (id) => vm.runInContext(fn + '({id:' + JSON.stringify(id) + ',name:"架空 一郎"})', sb);
  const row = { image: IMG('A'), at: '2026-11-03T01:00:00Z' };
  call('R-1');
  eq(page + ': 開いた方の絵を1回読む', env.gets, ['R-1']);
  env.replies[0]({ kind: 'ok', row }); await settle();
  eq(page + ': 届いたら枠を差し替える', env.painted.length, 1);
  call('R-1');
  eq(page + ': 同じ方の描き直しでは読み直さない（メモリの絵で差し替える）', [env.gets.length, env.painted.length], [1, 2]);
  /* 別の方へ移った後に届いた応答は捨てる */
  call('R-2'); env.curId = 'R-5'; if(page === 'face') env.seq = 2;
  env.replies[1]({ kind: 'ok', row }); await settle();
  eq(page + ': 別の方へ移った後に届いた応答は捨てる', env.painted.length, 2);
  /* 現場用へ変わった後に届いた応答は捨てる */
  env.curId = 'R-6'; call('R-6'); env.dev = 1;
  env.replies[2]({ kind: 'ok', row }); await settle();
  eq(page + ': 現場用へ変わった（世代が進んだ）後の応答は捨てる', env.painted.length, 2);
  /* 同じ方を開き直した（世代だけ進んだ）後に届いた古い応答は捨てる（フェイスシートは openSeq・入居者マスタは devGen で見る） */
  env.curId = 'R-11'; call('R-11');
  if(page === 'face') env.seq = 3; else env.dev = 2;
  env.replies[env.replies.length - 1]({ kind: 'ok', row }); await settle();
  eq(page + ': 同じ方でも世代が進んだ後の応答は捨てる', env.painted.length, 2);
  /* 世代は同じまま現場用へ変わった（読み込み直しの前）時に届いた応答も捨てる */
  env.curId = 'R-12'; call('R-12'); env.field = true;
  env.replies[env.replies.length - 1]({ kind: 'ok', row }); await settle();
  eq(page + ': 現場用へ変わった後に届いた応答は捨てる（世代が同じでも）', env.painted.length, 2);
  env.field = false;
  /* 現場端末では読まない */
  env.field = true; const before = env.gets.length; env.curId = 'R-7'; call('R-7');
  eq(page + ': 現場端末では読まない', env.gets.length, before);
  env.field = false;
  /* 失敗だけ記録する */
  env.curId = 'R-8'; call('R-8'); env.replies[env.replies.length - 1]({ kind: 'nofunc' }); await settle();
  env.curId = 'R-9'; call('R-9'); env.replies[env.replies.length - 1]({ kind: 'denied' }); await settle();
  env.curId = 'R-10'; call('R-10'); env.replies[env.replies.length - 1]({ kind: 'fail', code: 'XX000' }); await settle();
  eq(page + ': 関数が無い・断られたは記録せず、それ以外の失敗だけ記録する', env.notes.map(n => n[1]), ['XX000']);
}
await glue('face');
await glue('master');

group('6b. つなぎの呼び出し場所・捨てる場所');
{
  const office = tryGrab(SRC.face, 'renderOfficeView'), field = tryGrab(SRC.face, 'renderFieldView');
  t('フェイスシート: 事務所の画面（renderOfficeView）の最後で読む', /fsGenoCloud_\(r\);\s*\}$/.test(office));
  t('フェイスシート: 現場用の画面（renderFieldView）には枠も読み込みも足さない', field !== '' && !/geno/.test(field));
  t('フェイスシート: 別の方を開く時にメモリの絵を捨てる', /fsGenoMem_=null;/.test(tryGrab(SRC.face, 'openResident')));
  t('フェイスシート: 現場用へ変わる時にメモリの絵を捨てる', /if\(f\) fsGenoMem_=null;/.test(tryGrab(SRC.face, 'applyRoleBadge')));
  t('入居者マスタ: 詳細の画面（renderView）で読む', /rmGenoCloud_\(r\);/.test(tryGrab(SRC.master, 'renderView')));
  t('入居者マスタ: 別の方を開く時にメモリの絵を捨てる', /rmGenoMem_=null;/.test(tryGrab(SRC.master, 'openResident')));
  t('入居者マスタ: 現場用へ変わる時にメモリの絵を捨てる', /rmGenoMem_=null;/.test(tryGrab(SRC.master, 'applyDeviceGuard')));
  t('読む側は端末に絵を書かない（su_genograms へ setItem しない）', !/setItem\(SU_GENO_KEY|setItem\('su_genograms'/.test(SRC.face + SRC.master));
}

/* ═══ 7. 書く側（genogram.html）═══ */
group('7. 書く側: 応答の分け方（suGenoRpcKind）');
function genoBox(ls, extra){
  const sb = Object.assign({ localStorage: ls || makeLS(), window: {}, Promise, JSON, String, Object, Array, setTimeout, Date }, extra || {});
  vm.createContext(sb);
  const names = ['suGenoRpcKind', 'suGenoReadSent', 'suGenoMarkSent', 'suGenoFitImage', 'suGenoPutThumb', 'suGenoThumbTodo', 'sweepSuGenoThumbs', 'suGenoMidsOfName', 'suGenoDelTargets', 'suGenoDelThumbs', 'suGenoNameKey', 'suGenoMasterIdFor', 'writeSuGenogram'];
  vm.runInContext([grabLine(SRC.geno, 'var SU_GENO_SENT_KEY = '), grabLine(SRC.geno, 'var SU_GENO_IMG_MAX = '), grabLine(SRC.geno, 'var SU_GENO_DEL_MISS_MSG = '), grabLine(SRC.geno, 'var _suThumbSweepDone = ')].concat(names.map(n => grabFn(SRC.geno, n))).join('\n'), sb);
  return sb;
}
{
  const G = genoBox();
  const k = (r) => G.suGenoRpcKind(r).kind;
  eq('関数が無い → nofunc', [k({ error: { code: 'PGRST202' } }), k({ error: { code: '42883' } }), k({ error: { code: 'X', message: 'Could not find the function a' } })], ['nofunc', 'nofunc', 'nofunc']);
  eq('断られた → denied', [k({ error: { code: '42501' } }), k({ error: { code: 'PGRST301' } })], ['denied', 'denied']);
  eq('届かない → line', k({ error: { code: '', message: 'TypeError' } }), 'line');
  eq('ok:true → ok', k({ data: { ok: true, result: 'insert' } }), 'ok');
  eq('ok:false → fail（理由の名前を持つ）', G.suGenoRpcKind({ data: { ok: false, error: 'badimage' } }), { kind: 'fail', code: 'badimage' });
}

group('8. 書く側: 起動時に送る分（suGenoThumbTodo）');
{
  const G = genoBox();
  const roster = [{ masterId: 'R-1', name: '架空 一郎' }, { masterId: 'R-2', name: '架空 二郎' }, { masterId: 'R-3', name: '架空 三郎' }];
  const rec = (name, at, image) => ({ image: image === undefined ? IMG('X') : image, name, updatedAt: at === undefined ? '2026-11-03T10:00:00+09:00' : at });
  const base = { 'R-1': rec('架空　一郎'), 'name:架空一郎': rec('架空 一郎') };
  eq('名簿の氏名と一致する masterId のキーを送る（空白のゆれは吸収）', [...G.suGenoThumbTodo(base, roster, {})], ['R-1']);
  eq('氏名キーは送らない', [...G.suGenoThumbTodo({ 'name:架空一郎': rec('架空 一郎') }, roster, {})], []);
  eq('名簿に name: で始まる id があっても氏名キーは送らない', [...G.suGenoThumbTodo({ 'name:架空一郎': rec('架空 一郎') }, [{ masterId: 'name:架空一郎', name: '架空 一郎' }], {})], []);
  eq('別人の図（氏名が違う）は送らない', [...G.suGenoThumbTodo({ 'R-2': rec('架空 一郎') }, roster, {})], []);
  eq('記録に氏名が無い → 送らない', [...G.suGenoThumbTodo({ 'R-2': rec('') }, roster, {})], []);
  eq('名簿に無い id は送らない', [...G.suGenoThumbTodo({ 'R-9': rec('架空 九郎') }, roster, {})], []);
  eq('継承の名前（toString）を名簿の id と取り違えない', [...G.suGenoThumbTodo({ 'toString': rec('架空 一郎') }, roster, {})], []);
  eq('絵が無い → 送らない', [...G.suGenoThumbTodo({ 'R-1': rec('架空 一郎', undefined, '') }, roster, {})], []);
  eq('日時が無い → 送らない', [...G.suGenoThumbTodo({ 'R-1': rec('架空 一郎', '') }, roster, {})], []);
  eq('同じ版を送り済み → 送らない', [...G.suGenoThumbTodo(base, roster, { 'R-1': '2026-11-03T10:00:00+09:00' })], []);
  eq('送り済みより新しい版 → 送る', [...G.suGenoThumbTodo(base, roster, { 'R-1': '2026-11-02T10:00:00+09:00' })], ['R-1']);
  eq('名簿が無い → 何も送らない（判定できない）', [...G.suGenoThumbTodo(base, null, {})], []);
  eq('名簿が空 → 何も送らない', [...G.suGenoThumbTodo(base, [], {})], []);
}

group('9. 書く側: 保存の時に送るのは masterId を書けた時だけ（writeSuGenogram）');
async function writeCase(opts){
  const ls = makeLS(opts.session ? SESSION : {});
  const rpc = [];
  const notes = [];
  const G = genoBox(ls, {
    hasAnyContent: () => true,
    buildExportCanvas: (cb) => cb({ toDataURL: () => IMG('SAVED') }),
    nowISO: () => '2026-11-03T10:00:00+09:00',
    CloudSync: {
      hasLogin: () => !!opts.session,
      note: (w, e) => notes.push([w, e]),
      thumbRpc: (fn, args) => { rpc.push([fn, args]); return Promise.resolve(opts.session ? G.suGenoRpcKind(opts.reply) : { kind: 'nologin' }); }
    }
  });
  G.window._suMasterId = opts.mid; G.window._suMasterName = opts.mName;
  const got = [];
  const wo = { cloud: (s) => got.push(s), nameKeyOnly: !!opts.nameKeyOnly };
  if('gate' in opts) wo.gate = opts.gate;
  G.writeSuGenogram(opts.name, wo);
  await settle();
  return { got, rpc, notes, ls };
}
{
  let r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', reply: { data: { ok: true, result: 'insert' } } });
  eq('masterId を書けた → geno_thumb_put を1回送る', r.rpc.map(x => x[0]), ['geno_thumb_put']);
  eq('  └ 送るのは masterId・絵・保存した日時だけ（氏名は送らない）', r.rpc[0][1], { p_resident_id: 'R-1', p_image: IMG('SAVED'), p_at: '2026-11-03T10:00:00+09:00' });
  eq('  └ 結果は ok', r.got, ['ok']);
  eq('  └ 送れた版を控える（{masterId: 日時} だけ）', JSON.parse(r.ls.getItem('genogram:thumbSent')), { 'R-1': '2026-11-03T10:00:00+09:00' });
  r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 別人', reply: { data: { ok: true } } });
  eq('開いた方と違う文書の保存（氏名キーだけ）→ 送らない', [r.rpc.length, r.got], [0, ['skip']]);
  r = await writeCase({ session: true, mid: null, mName: '', name: '架空 一郎', reply: { data: { ok: true } } });
  eq('masterId の無い保存（アプリを直接開いた）→ 送らない', [r.rpc.length, r.got], [0, ['skip']]);
  r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', nameKeyOnly: true, reply: { data: { ok: true } } });
  eq('まとめ反映（nameKeyOnly）→ 送らない', [r.rpc.length, r.got], [0, ['skip']]);
  r = await writeCase({ session: false, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎' });
  eq('ログインなし → nologin（控えは書かない）', [r.got, r.ls.getItem('genogram:thumbSent')], [['nologin'], null]);
  r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', reply: { error: { code: 'PGRST202', message: 'x' } } });
  eq('関数が無い → nofunc（記録しない・控えない）', [r.got, r.notes.length, r.ls.getItem('genogram:thumbSent')], [['nofunc'], 0, null]);
  r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', reply: { data: { ok: false, error: 'badimage' } } });
  eq('形で断られた → fail（記録に残す・控えない）', [r.got, r.notes.map(n => n[1]), r.ls.getItem('genogram:thumbSent')], [['fail'], ['badimage'], null]);
  r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', reply: { error: { code: '42501' } } });
  eq('断られた（42501）→ denied（記録しない）', [r.got, r.notes.length], [['denied'], 0]);
  r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', reply: { data: { ok: true, result: 'stale', at: '2026-11-04T00:00:00+00:00' } } });
  eq('サーバーの方が新しい・消した印より前（stale）→ 送れたと数えて控える（送り直さない）', [r.got, JSON.parse(r.ls.getItem('genogram:thumbSent'))], [['ok'], { 'R-1': '2026-11-03T10:00:00+09:00' }]);
}

group('9b. 書く側: 保存が中止された版の絵は送らない（gate）');
{
  let r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', gate: Promise.resolve(false), reply: { data: { ok: true } } });
  eq('中止（gate=false）→ 送らない・結果は aborted', [r.rpc.length, r.got], [0, ['aborted']]);
  eq('  └ 端末の su_genograms には今までどおり書く', !!JSON.parse(r.ls.getItem('su_genograms'))['R-1'], true);
  eq('  └ 中止した版を「送らない版」として masterId と日時だけ控える', JSON.parse(r.ls.getItem('genogram:thumbSent')), { 'R-1': '2026-11-03T10:00:00+09:00' });
  {
    /* 読み込み直した後の起動時のまとめ送りでも送らない。保存し直した（新しい日時の）版は送る */
    const G = genoBox(r.ls, { CloudSync: { hasLogin: () => true, note: () => {}, thumbRpc: (fn, a) => { swept.push(a.p_at); return Promise.resolve({ kind: 'ok' }); } } });
    const swept = [];
    r.ls.setItem('su_residents_common', JSON.stringify({ residents: [{ masterId: 'R-1', name: '架空 一郎' }] }));
    G.sweepSuGenoThumbs(); await settle();
    eq('  └ 読み込み直した後のまとめ送りでも中止した版は送らない', swept, []);
    const m = JSON.parse(r.ls.getItem('su_genograms')); m['R-1'].updatedAt = '2026-11-03T11:00:00+09:00'; r.ls.setItem('su_genograms', JSON.stringify(m));
    eq('  └ 保存し直した新しい版はまとめ送りの対象になる', [...G.suGenoThumbTodo(m, [{ masterId: 'R-1', name: '架空 一郎' }], JSON.parse(r.ls.getItem('genogram:thumbSent')))], ['R-1']);
  }
  r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', gate: Promise.resolve(true), reply: { data: { ok: true } } });
  eq('中止されなかった（gate=true）→ 送る', [r.rpc.length, r.got], [1, ['ok']]);
  let open = null;
  const pending = new Promise(ok => { open = ok; });
  r = await writeCase({ session: true, mid: 'R-1', mName: '架空 一郎', name: '架空 一郎', gate: pending, reply: { data: { ok: true } } });
  eq('同期の結果が出るまでは送らない（端末には先に書く）', [r.rpc.length, r.got, !!JSON.parse(r.ls.getItem('su_genograms'))['R-1']], [0, [], true]);
  open(true); await settle();
  eq('  └ 中止されなかったと決まってから送る', [r.rpc.length, r.got], [1, ['ok']]);
}

group('9c. 書く側: 送る絵を上限（100万字）に収める（suGenoFitImage）');
{
  const mkFit = (shrinkLen) => {
    const drawn = [];
    const G = genoBox(makeLS(), {
      CloudSync: { note: () => {} },
      Image: function(){ const im = this; im.naturalWidth = 2000; im.naturalHeight = 1000; Object.defineProperty(im, 'src', { set(v){ im._src = v; setImmediate(() => im.onload()); } }); },
      document: { createElement: () => { const cv = { width: 0, height: 0, getContext: () => ({ fillRect(){}, drawImage(){}, set fillStyle(v){} }),
        toDataURL: (type, q) => { drawn.push([cv.width, cv.height, type, q]); return IMG('B'.repeat(shrinkLen(cv.width))); } }; return cv; } }
    });
    return { G, drawn };
  };
  let F = mkFit(() => 10);
  eq('上限以下はそのまま', await F.G.suGenoFitImage(IMG('small')), IMG('small'));
  eq('JPEG の data URL でない → 送らない', await F.G.suGenoFitImage('data:image/png;base64,AA'), '');
  eq('  └ 小さい絵は描き直さない', F.drawn.length, 0);
  eq('測った大きな図の長さ（約60万字）は描き直さずにそのまま送る', (await F.G.suGenoFitImage(IMG('A'.repeat(605447 - 23)))).length, 605447);
  eq('  └ 描き直していない', F.drawn.length, 0);
  const big = IMG('A'.repeat(1500000));
  F = mkFit((w) => w * 600);   // 幅に比例して長くなる模型（幅 2000 で 120万字）
  const got = await F.G.suGenoFitImage(big);
  t('上限を超える → 幅を落として JPEG 0.6 で描き直し、上限に収める', got.length <= 1000000 && got.length > 0 && F.drawn.length >= 1 && F.drawn.every(d => d[2] === 'image/jpeg' && d[3] === 0.6 && d[0] < 2000), F.drawn);
  F = mkFit(() => 1100000);
  eq('縮めても収まらない → 送らない', await F.G.suGenoFitImage(big), '');
  eq('  └ 8回で諦める', F.drawn.length, 8);
  /* 送る時に使う（端末の su_genograms の絵は変えない） */
  const ls = makeLS(Object.assign({ su_genograms: JSON.stringify({ 'R-1': { image: big, name: '架空 一郎', updatedAt: '2026-11-01T10:00:00+09:00' } }), su_residents_common: JSON.stringify({ residents: [{ masterId: 'R-1', name: '架空 一郎' }] }) }, SESSION));
  const sent = [], notes = [];
  const G = genoBox(ls, {
    CloudSync: { hasLogin: () => true, note: (w, e) => notes.push(e), thumbRpc: (fn, a) => { sent.push(a.p_image.length); return Promise.resolve({ kind: 'ok' }); } },
    Image: function(){ const im = this; im.naturalWidth = 2000; im.naturalHeight = 1000; Object.defineProperty(im, 'src', { set(v){ setImmediate(() => im.onload()); } }); },
    document: { createElement: () => { const cv = { width: 0, height: 0, getContext: () => ({ fillRect(){}, drawImage(){} }), toDataURL: () => IMG('C'.repeat(cv.width * 400)) }; return cv; } }
  });
  G.sweepSuGenoThumbs(); await settle();
  t('起動時の送りでも、送る絵だけ縮める', sent.length === 1 && sent[0] <= 1000000, sent);
  eq('  └ 端末の su_genograms の絵は今のまま', JSON.parse(ls.getItem('su_genograms'))['R-1'].image.length, big.length);
  const G2 = genoBox(makeLS(SESSION), { CloudSync: { hasLogin: () => true, note: (w, e) => notes.push(e), thumbRpc: () => { sent.push('x'); return Promise.resolve({ kind: 'ok' }); } },
    Image: function(){ const im = this; Object.defineProperty(im, 'src', { set(v){ setImmediate(() => im.onerror()); } }); } });
  eq('読めない絵 → 送らず fail・記録は toolarge', [await G2.suGenoPutThumb('R-1', { image: big, updatedAt: 'x' }), sent.length, notes.slice(-1)], ['fail', 1, ['toolarge']]);
}

group('10. 書く側: 起動時の送り（sweepSuGenoThumbs）');
{
  const roster = JSON.stringify({ residents: [{ masterId: 'R-1', name: '架空 一郎' }, { masterId: 'R-2', name: '架空 二郎' }] });
  const genos = JSON.stringify({
    'R-1': { image: IMG('1'), name: '架空 一郎', updatedAt: '2026-11-01T10:00:00+09:00' },
    'R-2': { image: IMG('2'), name: '架空 二郎', updatedAt: '2026-11-02T10:00:00+09:00' },
    'name:架空一郎': { image: IMG('1'), name: '架空 一郎', updatedAt: '2026-11-01T10:00:00+09:00' }
  });
  const run = async (session, replies) => {
    const ls = makeLS(Object.assign({ su_genograms: genos, su_residents_common: roster }, session ? SESSION : {}));
    const rpc = [];
    let i = 0;
    const G = genoBox(ls, { CloudSync: {
      hasLogin: () => session, note: () => {},
      thumbRpc: (fn, args) => { rpc.push(args.p_resident_id); return Promise.resolve(G.suGenoRpcKind(replies[i++] || { data: { ok: true } })); }
    } });
    G.sweepSuGenoThumbs(); G.sweepSuGenoThumbs();   // 2回呼んでも1回だけ
    await settle();
    return { rpc, ls };
  };
  let r = await run(true, []);
  eq('名簿と一致する masterId の分を1回だけ送る', r.rpc, ['R-1', 'R-2']);
  eq('  └ 送れた版を控える', JSON.parse(r.ls.getItem('genogram:thumbSent')), { 'R-1': '2026-11-01T10:00:00+09:00', 'R-2': '2026-11-02T10:00:00+09:00' });
  r = await run(false, []);
  eq('ログインなし → 送らない', r.rpc, []);
  r = await run(true, [{ error: { code: 'PGRST202', message: 'x' } }]);
  eq('関数が無い → 1件目で打ち切る（控えない）', [r.rpc, r.ls.getItem('genogram:thumbSent')], [['R-1'], null]);
}

group('11. 書く側: 図を消した時（suGenoDelThumbs）');
{
  const genos = JSON.stringify({
    'R-1': { image: IMG('1'), name: '架空 一郎', updatedAt: 'a' },
    'R-2': { image: IMG('2'), name: '架空 二郎', updatedAt: 'a' },
    'name:架空一郎': { image: IMG('1'), name: '架空 一郎', updatedAt: 'a' }
  });
  const run = async (admin, opt) => {
    opt = opt || {};
    const init = Object.assign({ su_genograms: opt.genos === undefined ? genos : opt.genos }, SESSION);
    if(opt.roster) init.su_residents_common = JSON.stringify({ residents: opt.roster });
    const ls = makeLS(init);
    const rpc = [], flashes = [], timers = [];
    const G = genoBox(ls, { CloudSync: {
      hasLogin: () => true, note: () => {}, thumbIsAdmin: () => Promise.resolve(admin),
      thumbRpc: (fn, args) => { rpc.push([fn, args.p_resident_id]); return Promise.resolve({ kind: 'ok' }); }
    }, flashStatus: (m) => flashes.push(m), setTimeout: (fn, ms) => { timers.push(ms); fn(); } });
    G.suGenoDelThumbs(opt.name || '架空　一郎');
    await settle();
    return { rpc, ls, flashes, timers };
  };
  let r = await run(true);
  eq('管理者 → その文書名の masterId だけ geno_thumb_del（氏名キーは送らない）', r.rpc, [['geno_thumb_del', 'R-1']]);
  eq('  └ 端末の su_genograms は今のまま', r.ls.getItem('su_genograms'), genos);
  eq('  └ 知らせは出ない', r.flashes, []);
  r = await run(false);
  eq('管理者でない → 送らない', r.rpc, []);
  const G = genoBox();
  eq('suGenoMidsOfName は氏名キーを含めない', [...G.suGenoMidsOfName(JSON.parse(genos), '架空 一郎')], ['R-1']);
  /* 端末に masterId のキーが無い（一覧から直接開いて作った図だけ）の時 */
  const onlyName = JSON.stringify({ 'name:架空一郎': { image: IMG('1'), name: '架空 一郎', updatedAt: 'a' } });
  const roster1 = [{ masterId: 'R-1', name: '架空　一郎' }, { masterId: 'R-2', name: '架空 二郎' }];
  r = await run(true, { genos: onlyName, roster: roster1 });
  eq('masterId のキーが無い → 名簿で1名にだけ一致したらその masterId を消す', [r.rpc, r.flashes], [[['geno_thumb_del', 'R-1']], []]);
  r = await run(true, { genos: onlyName, roster: roster1.concat([{ masterId: 'R-3', name: '架空一郎' }]) });
  eq('同姓同名（2名一致）→ 消さずに知らせる（決められなかった時だけ）', [r.rpc, r.flashes.length, r.timers], [[], 1, [2400]]);
  t('  └ 知らせの文（入居者マスタから開いて消す）', /^ほかの端末の絵は消せませんでした（入居者マスタから/.test(r.flashes[0] || ''), r.flashes);
  r = await run(true, { genos: onlyName, roster: [{ masterId: 'R-2', name: '架空 二郎' }] });
  eq('名簿に無い → 消さず、知らせも出さない', [r.rpc, r.flashes.length], [[], 0]);
  r = await run(true, { genos: onlyName });
  eq('名簿が無い → 消さず、知らせも出さない', [r.rpc, r.flashes.length], [[], 0]);
  r = await run(true, { genos: '{}', name: '架空 一郎（この端末の控え 2026-11-03 10:00）', roster: roster1 });
  eq('別名の控え（名簿に一致しない）→ 消さず、知らせも出さない', [r.rpc, r.flashes.length], [[], 0]);
  r = await run(false, { genos: onlyName });
  eq('管理者でない → 知らせも出さない', [r.rpc, r.flashes], [[], []]);
  const tg = (m, ro, n) => { const x = G.suGenoDelTargets(m, ro, n); return [[...x.mids], x.ambiguous]; };
  eq('suGenoDelTargets: 同じ masterId が名簿に2行あっても1名と数える', tg({}, [{ masterId: 'R-1', name: '架空 一郎' }, { masterId: 'R-1', name: '架空 一郎' }], '架空 一郎'), [['R-1'], false]);
  eq('suGenoDelTargets: 端末に masterId のキーがあれば名簿は見ない', tg(JSON.parse(genos), [{ masterId: 'R-9', name: '架空 一郎' }], '架空 一郎'), [['R-1'], false]);
  eq('suGenoDelTargets: 2名一致 → 決められない（ambiguous）', tg({}, [{ masterId: 'R-1', name: '架空 一郎' }, { masterId: 'R-3', name: '架空一郎' }], '架空 一郎'), [[], true]);
  eq('suGenoDelTargets: 1名も一致しない → ambiguous でない', tg({}, [{ masterId: 'R-2', name: '架空 二郎' }], '架空 一郎'), [[], false]);
}

group('12. 書く側: 画面の流れ');
{
  const save = tryGrab(SRC.geno, 'saveDoc', 'async ');
  const del = tryGrab(SRC.geno, 'deleteCurrentDoc', 'async ');
  t('保存の時に送った結果を受け取り、送るかは同期の結果で決める（writeSuGenogram に gate と cloud を渡す）', /writeSuGenogram\(name, \{ gate: thumbGate, cloud: /.test(save));
  t('食い違いで中止した分岐で送らないと決める（thumbGo(false)）', /if \(err && err\.conflict\) \{\s*\/\/[^\n]*\n\s*thumbGo\(false\);/.test(save));
  t('新しい保存先が断った分岐（err.refused・統合 0054）でも送らないと決める', /\} else if \(err && err\.refused\) \{\s*\/\*[\s\S]*?\*\/\s*thumbGo\(false\);/.test(save));
  t('中止されなかった時は最後に送ると決める（thumbGo(true) → thumbDone）', /thumbGo\(true\);[^\n]*\n\s*thumbDone\(\);/.test(save));
  t('ログインなしの時の知らせの文がある', /'ログインしていないため、この図はほかの端末のフェイスシート・入居者マスタには出ません'/.test(save));
  t('知らせは保存の知らせ（同期の結果まで）の後に出す', /thumbSaved\.then\(/.test(save) && /thumbDone\(\);[^\n]*\n\}$/.test(save));
  t('送った・送らなかった・関数が無い・中止した時は知らせない', /if \(st === 'ok' \|\| st === 'skip' \|\| st === 'nofunc' \|\| st === 'aborted'\) return;/.test(save));
  t('図を消した時に suGenoDelThumbs を呼ぶ', /suGenoDelThumbs\(name\)/.test(del));
  t('起動時に1回だけ送る（sweepSuGenoThumbs）', /sweepSuGenoThumbs\(\)/.test(tryGrab(SRC.geno, 'init')));
  t('ログインの部品の読み込み関数を2つ作らない（genoAuthLoad_ だけ）', (SRC.geno.match(/function \w*[Aa]uthLoad\w*\(/g) || []).length === 1);
  t('知らせの文に技術用語を出さない', !/Supabase|API|JSON|HTTP|トークン|geno_thumb_put/.test((save.match(/'[^']*ほかの端末[^']*'/g) || []).join('')));
}
} catch(e){ ng++; say('  ✗ 試験が途中で止まった: ' + (e && e.message)); }

say('\n' + (ng ? '✗' : '✓') + ' 合格 ' + ok + ' / 不合格 ' + ng);
process.exit(ng ? 1 : 0);
})();
