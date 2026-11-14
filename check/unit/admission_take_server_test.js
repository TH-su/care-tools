/* 入居調整（admission-flow.html）：保存をサーバーが一括消失の守りで断った時の上書きの確かめに、
   「この端末の変更を捨てて、サーバーの内容に合わせる」道を足す（代表者の決定 2026-11-14・文は仮置き）。
   守りたいこと:
     1. 1段目で「キャンセル」した後に2段目（サーバーの内容に合わせますか）を聞く。2段目もキャンセルなら今までどおり（送らず・取り直さず・待つ）
     2. 2段目で「OK」なら、捨てる前にこの端末の台帳を別の鍵へ1世代だけ控え（いつ・何件が分かる形）、サーバーの内容を取り直して表示し、送信待ちの印を外す
     3. 窓の間・取り直しの間に台帳が変わったら捨てない。控えを書けない・取り直せない・サーバーの台帳が無い時も捨てない
     4. 1段目の「OK」は今までどおり上書き（force）
     5. 現場端末への切り替えでは、合わせる前の控えも消す（相談者の情報を現場端末に残さない）
     6. 合わせる前の控えは同期とバックアップの窓から統合で戻せ、使い方に戻し方が1行ある
   画面の実関数を名前で切り出して vm で動かす。外部ライブラリなし・実データなし（架空の案件だけ）。
   実行: node check/unit/admission_take_server_test.js（読む HTML は環境変数 ADM_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.ADM_HTML || path.join(__dirname, '..', '..', 'admission-flow.html');   // 直す前の HTML で落ちることを確かめる時に差し替える
const HELP = process.env.HELP_HTML || path.join(__dirname, '..', '..', 'help.html');
const src = fs.readFileSync(HTML, 'utf8');
const help = fs.readFileSync(HELP, 'utf8');
let ok = 0, ng = 0;
function t(name, cond, info) {
  if (cond) { ok++; process.stdout.write('  ✓ ' + name + '\n'); }
  else { ng++; process.stdout.write('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info)) + '\n'); }
}
function grabFn(name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) return 'function ' + name + '() { throw new Error("関数が見つかりません: ' + name + '"); }';
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) { if (src[i] === '\\') i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = (e < 0) ? src.length : e + 1; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = (e < 0) ? src.length : e; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start + 1, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
function grabVar(name) {
  const m = src.match(new RegExp('\\nvar ' + name + " = '[^']*';"));
  return m ? m[0].trim() : 'var ' + name + " = '__無い__';";
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 12; i++) await tick(); }

function makeStorage(failKey) {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (k === failKey) throw new Error('容量不足'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  };
}
const LOCAL = { v: 1, updatedAt: '2026-11-14T00:00:00.000Z', candidates: [{ id: 'c1', name: '架空 一郎' }, { id: 'c2', name: '架空 花子' }] };
const SERVER = { v: 1, updatedAt: '2026-11-14T00:00:01.000Z', candidates: [{ id: 'c1', name: '架空 一郎' }, { id: 'c2', name: '架空 花子' }, { id: 'c3', name: '架空 三郎' }, { id: 'c4', name: '架空 四郎' }] };
const WIPE = { ok: false, error: 'admwipe', was: 4, now: 2 };

/* answers: 窓ごとの答え（順に使う）。before: 窓ごとに答える前に起きること。getBefore: サーバーの取り直しが返る前に起きること */
function mk(opt) {
  opt = opt || {};
  const log = { puts: [], sync: [], toasts: [], gets: 0, scheduled: 0, renders: 0, notes: [], asked: [], timers: [] };
  const answers = (opt.answers || []).slice();
  const befores = (opt.before || []).slice();
  const ls = makeStorage(opt.failKey);
  const b = {
    Promise, String, Number, Object, Array, JSON,
    setTimeout: opt.fakeTimers ? (fn, ms) => { if (ms >= 1000) { log.timers.push({ fn, ms }); return log.timers.length; } return setTimeout(fn, ms); } : setTimeout,
    clearTimeout: opt.fakeTimers ? (id) => { if (log.timers[id - 1]) log.timers[id - 1].cleared = true; clearTimeout(id); } : clearTimeout,
    localStorage: ls,
    SUDialog: {
      confirm(m) {
        log.asked.push(String(m));
        const a = answers.length ? answers.shift() : false;
        const bf = befores.length ? befores.shift() : null;
        return new Promise((res) => setTimeout(() => { if (bf) bf(b); res(a); }, 0));
      },
      alert(m) { log.asked.push(String(m)); return Promise.resolve(); },
      busy: () => false, idle: () => Promise.resolve()
    },
    SU: { data: { admission: { get: () => {
      log.gets++;
      if (opt.getHold) return new Promise((res) => { b.__resolveGet = () => res({ ok: true, rev: 7, data: JSON.parse(JSON.stringify(SERVER)) }); });
      return new Promise((res, rej) => setTimeout(() => {
        if (opt.getBefore) opt.getBefore(b);
        if (opt.getFail) rej(new Error('Failed to fetch')); else res(opt.getAns || { ok: true, rev: 7, data: JSON.parse(JSON.stringify(SERVER)) });
      }, 0));
    } } } },
    KV_KEY: 'admission_db',
    afDlgNote_: (w) => log.notes.push(w), afNote_: (w) => log.notes.push(w),
    afErrWords_: () => '通信がうまくいきませんでした',
    nowIso: () => '2026-11-14T00:00:09.000Z',
    syncTarget: () => ({ endpoint: 'x', token: '' }),
    setSync: (m, c) => log.sync.push([m, c || '']),
    toast: (m) => log.toasts.push(m),
    renderAll: () => { log.renders++; },
    busyEditing: () => !!b.__editing,
    normalizeDb: (d) => JSON.parse(JSON.stringify(d)),
    liveCount: (db) => db.candidates.filter((c) => c && !c.deleted).length,
    schedulePushRetry() {},
    kvPutWithOpts: (db, rev, o) => { log.puts.push(o); return Promise.resolve(b.__answers.length ? b.__answers.shift() : { ok: true, rev: 4 }); },
    __answers: (opt.putAnswers || [WIPE]).slice(), __editing: false, __log: log
  };
  vm.createContext(b);
  vm.runInContext([
    'var DB = ' + JSON.stringify(opt.db || LOCAL) + ';',
    'var kvRev = 3, dirty = true, pushing = false, afWipeHold_ = false, SU_DATA_READY = true, AF_LIVE = true, retryWait = 0, pushTimer = null;',
    (src.match(/\nvar afTaking_ = false;/) || ['var afTaking_ = false;'])[0].trim(),
    (src.match(/\nvar afTakeGen_ = 0;/) || ['var afTakeGen_ = 0;'])[0].trim(),
    (src.match(/\nvar AF_TAKE_TIMEOUT_MS = [^;]*;/) || ['var AF_TAKE_TIMEOUT_MS = 0;'])[0].trim(),
    'this.taking = function () { return afTaking_; };',
    grabVar('CACHE_KEY'), grabVar('CACHE_BAK'), grabVar('CACHE_BAK2'), grabVar('CACHE_DISCARD'),
    grabVar('DEVICE_KEY'), grabFn('afFieldNow_'), grabFn('serverLooksLost'), grabFn('cachePayload'), grabFn('saveCache'), grabFn('push'), grabFn('afTakeServer_'),
    'function schedulePush() { __log.scheduled++; }',
    'this.st = function () { return { DB: DB, dirty: dirty, kvRev: kvRev, hold: afWipeHold_ }; };',
    'this.setDB = function (u) { DB.updatedAt = u; };',
    'this.keys = { discard: CACHE_DISCARD, cache: CACHE_KEY };'
  ].join('\n'), b);
  return { b, log, ls };
}

async function run() {
  console.log('— 1. 2段の確かめ —');
  {
    const p = mk({ answers: [false, false] });
    p.b.push(); await settle();
    const s = p.b.st();
    t('1-1 1段目「キャンセル」の後に2段目を聞く（サーバーの内容に合わせますか・件数つき）', p.log.asked.length === 2
      && /^この端末の変更を捨てて、サーバーの内容に合わせますか？/.test(p.log.asked[1]) && /この端末の内容（2件）/.test(p.log.asked[1]) && /「合わせる前の控え」に残します/.test(p.log.asked[1]), p.log.asked);
    t('1-2 2段目も「キャンセル」なら今までどおり（送らない・取り直さない・未送信のまま・送らない印）', p.log.puts.length === 1 && p.log.gets === 0 && s.dirty === true && s.hold === true
      && p.ls.getItem(p.b.keys.discard) === null && JSON.stringify(p.log.sync[p.log.sync.length - 1]) === '["未送信あり","err"]', [p.log, s]);
  }
  {
    const p = mk({ answers: [true], putAnswers: [WIPE, { ok: true, rev: 9 }] });
    p.b.push(); await settle();
    t('1-3 1段目「OK」は今までどおり上書きする（force）・2段目は聞かない', p.log.asked.length === 1 && p.log.puts.length === 2 && p.log.puts[1] && p.log.puts[1].force === true && p.log.gets === 0, p.log);
  }

  console.log('— 2. サーバーの内容に合わせる —');
  {
    const p = mk({ answers: [false, true] });
    p.b.push(); await settle();
    const s = p.b.st();
    let bak = null; try { bak = JSON.parse(p.ls.getItem(p.b.keys.discard)); } catch (e) { bak = null; }
    t('2-1 捨てる前に、この端末の台帳を別の鍵へ控える（いつ・何件・中身）', !!bak && bak.at === '2026-11-14T00:00:09.000Z' && bak.n === 2
      && bak.db && JSON.stringify(bak.db.candidates) === JSON.stringify(LOCAL.candidates), bak);
    t('2-2 サーバーの内容を取り直して表示する（台帳・版）', p.log.gets === 1 && s.DB.candidates.length === 4 && s.kvRev === 7 && p.log.renders >= 1, [p.log.gets, s.DB.candidates.length, s.kvRev]);
    t('2-3 合わせた後は送信待ちの印を外し、送らない印も下ろす・上書きは送らない', s.dirty === false && s.hold === false && p.log.puts.length === 1
      && JSON.stringify(p.log.sync[p.log.sync.length - 1]) === '["同期OK",""]', [s, p.log.puts]);
    let cache = null; try { cache = JSON.parse(p.ls.getItem(p.b.keys.cache)); } catch (e) { cache = null; }
    t('2-4 端末の控え（いまの保存）もサーバーの内容・未送信なしになる', !!cache && cache.dirty === false && cache.db.candidates.length === 4, cache);
  }

  {
    const p = mk({ answers: [false, true], failKey: 'admf_cache' });
    p.b.push(); await settle();
    t('2-5 合わせた後に端末の控え（いまの保存）へ書けなかった時は「合わせました」と出さず、書けなかった知らせを出す（合わせる前の控えは残る）',
      !p.log.toasts.some((m) => /サーバーの内容に合わせました/.test(m)) && p.log.toasts.some((m) => /端末に保存できませんでした/.test(m)) && p.ls.getItem(p.b.keys.discard) !== null, p.log.toasts);
  }
  {
    const p = mk({ answers: [false, true] });
    p.b.push(); await settle();
    t('2-6 書けた時は「サーバーの内容に合わせました」と知らせる', p.log.toasts.some((m) => /^サーバーの内容に合わせました（この端末の変更は「合わせる前の控え」に残しています）$/.test(m)), p.log.toasts);
  }

  console.log('— 3. 聞いた時と違う状態では捨てない —');
  {
    const p = mk({ answers: [false, true], before: [(b) => b.setDB('2026-11-14T00:00:05.000Z')] });
    p.b.push(); await settle();
    const s = p.b.st();
    t('3-1 1段目の窓の間に台帳が変わったら、2段目を聞かず捨てない', p.log.asked.length === 1 && p.log.gets === 0 && s.dirty === true && s.DB.candidates.length === 2 && p.ls.getItem(p.b.keys.discard) === null, [p.log.asked.length, p.log.gets, s]);
  }
  {
    const p = mk({ answers: [false, true], before: [null, (b) => b.setDB('2026-11-14T00:00:05.000Z')] });
    p.b.push(); await settle();
    const s = p.b.st();
    t('3-2 2段目の窓の間に台帳が変わったら、取り直さず捨てない', p.log.asked.length === 2 && p.log.gets === 0 && s.dirty === true && s.DB.candidates.length === 2 && p.ls.getItem(p.b.keys.discard) === null, [p.log.gets, s]);
  }
  {
    const p = mk({ answers: [false, true], getBefore: (b) => b.setDB('2026-11-14T00:00:06.000Z') });
    p.b.push(); await settle();
    const s = p.b.st();
    t('3-3 取り直しの間に台帳が変わったら捨てない（控えも書かない）', p.log.gets === 1 && s.dirty === true && s.DB.candidates.length === 2 && s.hold === true && p.ls.getItem(p.b.keys.discard) === null, [s, p.log.toasts]);
  }
  {
    const p = mk({ answers: [false, true], before: [null, (b) => { b.__editing = true; }] });
    p.b.push(); await settle();
    const s = p.b.st();
    t('3-4 編集中なら捨てない', p.log.gets === 0 && s.dirty === true && s.DB.candidates.length === 2, s);
  }

  console.log('— 4. 控えられない・取り直せない時は捨てない —');
  {
    const p = mk({ answers: [false, true], failKey: null });
    p.b.localStorage.setItem = function (k, v) { if (k === p.b.keys.discard) throw new Error('容量不足'); p.ls.m.set(k, String(v)); };
    p.b.push(); await settle();
    const s = p.b.st();
    t('4-1 控えを書けなければ捨てない（台帳・未送信の印はそのまま）', s.dirty === true && s.DB.candidates.length === 2 && s.hold === true && p.log.notes.indexOf('合わせる前の控え') >= 0, [s, p.log.notes]);
  }
  {
    const p = mk({ answers: [false, true], getFail: true });
    p.b.push(); await settle();
    const s = p.b.st();
    t('4-2 サーバーを読めなければ捨てない', s.dirty === true && s.DB.candidates.length === 2 && p.ls.getItem(p.b.keys.discard) === null && /読み込めませんでした/.test(p.log.toasts.join()), [s, p.log.toasts]);
  }
  {
    const p = mk({ answers: [false, true], getAns: { ok: true, rev: 8, data: null } });
    p.b.push(); await settle();
    const s = p.b.st();
    t('4-3 サーバーに台帳が無ければ捨てない', s.dirty === true && s.DB.candidates.length === 2 && p.ls.getItem(p.b.keys.discard) === null, s);
  }
  {
    const big = { v: 1, updatedAt: '2026-11-14T00:00:00.000Z', candidates: [1, 2, 3, 4, 5, 6].map((i) => ({ id: 'c' + i, name: '架空 ' + i })) };
    const p = mk({ db: big, answers: [false, true], getAns: { ok: true, rev: 8, data: { v: 1, candidates: [{ id: 'c1', name: '架空 1' }] } } });
    p.b.push(); await settle();
    const s = p.b.st();
    t('4-4 サーバーの台帳がこの端末より大きく減っていたら捨てない', s.dirty === true && s.DB.candidates.length === 6 && p.ls.getItem(p.b.keys.discard) === null, s);
  }

  console.log('— 5. 現場端末・戻し方・使い方 —');
  {
    const ls = makeStorage();
    const b = { localStorage: ls, JSON, $: () => ({ classList: { toggle() {} } }) };
    vm.createContext(b);
    vm.runInContext([grabVar('DEVICE_KEY'), grabVar('CACHE_KEY'), grabVar('CACHE_BAK'), grabVar('CACHE_BAK2'), grabVar('CACHE_DISCARD'), grabFn('applyDeviceGuard'), 'this.k = CACHE_DISCARD;'].join('\n'), b);
    ls.setItem('su_device_role', 'field');
    ls.setItem(b.k, JSON.stringify({ db: LOCAL, at: 'x', n: 2 }));
    b.applyDeviceGuard();
    t('5-1 現場端末へ切り替わったら、合わせる前の控えも消す', b.k !== '__無い__' && ls.getItem(b.k) === null, b.k);
  }
  /* 戻す・消す・片づけ・容量不足の書き直しを動かす箱（#579 の反証レビュー） */
  const mkR = (opt) => {
    opt = opt || {};
    const log = { merged: null, asked: [], toasts: [], scheduled: 0, notes: [] };
    const ls = makeStorage();
    const answers = (opt.answers || [true]).slice();
    const b = { localStorage: ls, JSON, Promise, String, Array, Number, Date: opt.Date || Date,
      SUDialog: { confirm(m) { log.asked.push(m); const a = answers.length ? answers.shift() : false; return new Promise((r) => setTimeout(() => { if (opt.before) opt.before(b); r(a); }, 0)); } },
      toast: (m) => log.toasts.push(m), afDlgNote_() {}, afNote_: (w) => log.notes.push(w), renderAll() {}, setSync() {}, fmtDt: (x) => x,
      asStr: (v) => (v == null ? '' : String(v)), asArr: (a) => (Array.isArray(a) ? a : []),
      nowIso: () => '2026-11-14T00:00:20.000Z',
      normalizeDb: (d) => JSON.parse(JSON.stringify(d)),
      mergeDb: (a, x, o) => { log.merged = { a: a.candidates.length, x: x.candidates.length, keep: !!(o && o.keepFilled) }; return { candidates: a.candidates.concat(x.candidates) }; },
      __log: log };
    vm.createContext(b);
    vm.runInContext(['var DB = ' + JSON.stringify(SERVER) + ';', 'var kvRev = 7, dirty = false, afWipeHold_ = true;',
      grabVar('CACHE_KEY'), grabVar('CACHE_BAK'), grabVar('CACHE_BAK2'), grabVar('CACHE_DISCARD'),
      (src.match(/\nvar DISCARD_KEEP_MS = [^;]*;/) || ['var DISCARD_KEEP_MS = 0;'])[0].trim(),
      (src.match(/\nvar afTaking_ = false;/) || ['var afTaking_ = false;'])[0].trim(), grabVar('AF_TAKING_MSG'),
      grabFn('readCacheSlot'), grabFn('cachePayload'), grabFn('saveCache'), grabFn('restoreDiscarded_'), grabFn('deleteDiscarded_'), grabFn('afDiscardSweep_'),
      'function schedulePush() { __log.scheduled++; }',
      'this.k = CACHE_DISCARD; this.ck = CACHE_KEY; this.st = function () { return { DB: DB, dirty: dirty, hold: afWipeHold_ }; };',
      'this.setTaking = function (v) { afTaking_ = v; };'].join('\n'), b);
    return { b, log, ls };
  };
  const BAK = JSON.stringify({ db: LOCAL, rev: 3, dirty: true, at: '2026-11-14T00:00:09.000Z', n: 2 });
  {
    const p = mkR();
    p.ls.setItem(p.b.k, BAK);
    p.b.restoreDiscarded_(); await settle();
    const s = p.b.st();
    t('5-2 合わせる前の控えは、件数を聞いてから今の台帳へ統合で戻す（消した印を効かせない・送信待ちにする）',
      p.log.asked.length === 1 && /合わせる前の控え（2026-11-14T00:00:09\.000Z・案件2件）/.test(p.log.asked[0]) && p.log.merged && p.log.merged.a === 4 && p.log.merged.x === 2 && p.log.merged.keep
      && s.dirty === true && s.hold === false && p.log.scheduled === 1, [p.log, s]);
    t('5-2b 戻す確かめの窓に「控えの日時より後にほかの端末で消した内容が戻ることがあります」「控えより後に直された欄は、新しい方が残ります（控えは7日間残ります）」と出す',
      /控えの日時より後にほかの端末で消した内容が戻ることがあります。\n控えより後に直された欄は、新しい方が残ります（控えは7日間残ります）。よろしいですか？$/.test(p.log.asked[0] || ''), p.log.asked);
    /* #579 の2回目の反証: 統合なので新しい値に負けて戻らない欄がある。戻した後も控えは消さない（7日の期限か［消す］でだけ消える） */
    t('5-2c 戻した後も、合わせる前の控えは消さない（端末の控えにも書く）', p.ls.getItem(p.b.k) === BAK && !!p.ls.getItem(p.b.ck), p.ls.getItem(p.b.k));
  }
  {
    const p = mkR();
    p.ls.setItem(p.b.k, BAK);
    const orig = p.ls.setItem;
    p.b.localStorage.setItem = function (k, v) { if (k === p.b.ck) throw new Error('容量不足'); orig(k, v); };
    p.b.restoreDiscarded_(); await settle();
    t('5-2d 戻した後に端末の控えへ書けなかった時は、合わせる前の控えを消さない', p.ls.getItem(p.b.k) === BAK, p.log.toasts);
    t('5-2j 書けなかった時は「戻しました」を出さず、保存できなかった警告に「控えは残っているので、容量をあけてからもう一度戻せます」を添える',
      p.log.toasts.indexOf('合わせる前の控えから戻しました') < 0 && p.log.toasts[p.log.toasts.length - 1] === '⚠️ 端末に保存できませんでした（容量不足の可能性）。控えは残っているので、容量をあけてからもう一度戻せます', p.log.toasts);
  }
  {
    const p = mkR({ answers: [false] });
    p.ls.setItem(p.b.k, BAK);
    p.b.restoreDiscarded_(); await settle();
    t('5-2e 戻す確かめで「キャンセル」なら何も変えない', p.log.merged === null && p.ls.getItem(p.b.k) === BAK && p.b.st().dirty === false);
  }
  {
    const p = mkR({ answers: [true], before: (b) => b.localStorage.setItem(b.k, JSON.stringify({ db: SERVER, at: '2026-11-14T00:00:30.000Z', n: 4 })) });
    p.ls.setItem(p.b.k, BAK);
    p.b.restoreDiscarded_(); await settle();
    t('5-2f 戻す窓の間に控えが変わっていたら（新しく合わせた）戻さない', p.log.merged === null && p.b.st().dirty === false && p.log.toasts.indexOf('控えが変わったため、戻すのをやめました') >= 0, p.log.toasts);
  }
  {
    const p = mkR({ answers: [true], before: (b) => b.localStorage.removeItem(b.k) });
    p.ls.setItem(p.b.k, BAK);
    p.b.restoreDiscarded_(); await settle();
    t('5-2g 戻す窓の間に控えが消されていたら戻さない', p.log.merged === null && p.log.toasts.indexOf('控えが変わったため、戻すのをやめました') >= 0, p.log.toasts);
  }
  {
    let p = mkR({ answers: [true] });
    p.ls.setItem(p.b.k, BAK); p.b.setTaking(true);
    p.b.restoreDiscarded_(); p.b.deleteDiscarded_(); await settle();
    t('5-2h サーバーの内容に合わせる取り直しを待つ間は、［復元］［消す］を始めない（窓も出さない）', p.log.asked.length === 0 && p.log.merged === null && p.ls.getItem(p.b.k) === BAK
      && p.log.toasts.filter((m) => m === 'サーバーの内容に合わせている最中です。終わってからもう一度押してください').length === 2, p.log.toasts);
    p = mkR({ answers: [true, true], before: (b) => b.setTaking(true) });
    p.ls.setItem(p.b.k, BAK);
    p.b.restoreDiscarded_(); await settle();
    p.b.deleteDiscarded_(); await settle();
    t('5-2i 窓の間に取り直しが始まっていたら、戻さない・消さない', p.log.merged === null && p.ls.getItem(p.b.k) === BAK, [p.log.asked.length, p.log.toasts]);
  }
  t('5-3 同期とバックアップの窓に、控えがある時だけ「合わせる前の控え」の行と復元・消すのボタンを出す',
    src.indexOf("(bd ? '<dt>合わせる前の控え</dt><dd>' + bd.n + '件（' + esc(fmtDt(bd.at)) + '）<button class=\"btn sm\" id=\"syRD\" type=\"button\" style=\"margin-left:6px\">復元</button><button class=\"btn sm\" id=\"syRDdel\" type=\"button\" style=\"margin-left:6px\">消す</button></dd>' : '')") >= 0
    && src.indexOf("if ($('syRD')) $('syRD').addEventListener('click', function () { restoreDiscarded_(); closeModal('mk-sync'); });") >= 0
    && src.indexOf("if ($('syRDdel')) $('syRDdel').addEventListener('click', function () { deleteDiscarded_(); closeModal('mk-sync'); });") >= 0);

  console.log('— 6. 控えの期限・消す・容量不足（#579 の反証） —');
  {
    const now = Date.parse('2026-11-21T00:00:10.000Z');
    const FakeDate = { now: () => now, parse: Date.parse };
    let p = mkR({ Date: FakeDate });
    p.ls.setItem(p.b.k, JSON.stringify({ db: LOCAL, at: '2026-11-14T00:00:09.000Z', n: 2 }));   // 7日と1秒前
    p.b.afDiscardSweep_();
    t('6-1 7日を過ぎた合わせる前の控えは、起動時の片づけで消す', p.ls.getItem(p.b.k) === null);
    p = mkR({ Date: FakeDate });
    p.ls.setItem(p.b.k, JSON.stringify({ db: LOCAL, at: '2026-11-15T00:00:00.000Z', n: 2 }));
    p.b.afDiscardSweep_();
    t('6-2 7日の内の控えは残す', p.ls.getItem(p.b.k) !== null);
    p = mkR({ Date: FakeDate });
    p.ls.setItem(p.b.k, '{壊れた');
    p.b.afDiscardSweep_();
    t('6-3 読めない控え（日時が分からない）は消す', p.ls.getItem(p.b.k) === null);
    t('6-4 起動の時に、端末の控えを読んだすぐ後で片づける', /\n  loadCache\(\);\n  afDiscardSweep_\(\);\n/.test(src));
  }
  {
    let p = mkR({ answers: [true] });
    p.ls.setItem(p.b.k, BAK);
    p.b.deleteDiscarded_(); await settle();
    t('6-5 ［消す］は確かめの窓の後に消す', p.log.asked.length === 1 && /^合わせる前の控え（2026-11-14T00:00:09\.000Z・案件2件）を消しますか？/.test(p.log.asked[0]) && p.ls.getItem(p.b.k) === null, p.log.asked);
    p = mkR({ answers: [false] });
    p.ls.setItem(p.b.k, BAK);
    p.b.deleteDiscarded_(); await settle();
    t('6-6 ［消す］の確かめで「キャンセル」なら消さない', p.ls.getItem(p.b.k) === BAK);
    p = mkR({ answers: [true], before: (b) => b.localStorage.setItem(b.k, JSON.stringify({ db: SERVER, at: '2026-11-14T00:00:30.000Z', n: 4 })) });
    p.ls.setItem(p.b.k, BAK);
    p.b.deleteDiscarded_(); await settle();
    t('6-7 窓の間に控えが変わっていたら（新しく合わせた）消さない', p.ls.getItem(p.b.k) !== null && JSON.parse(p.ls.getItem(p.b.k)).n === 4, p.log.toasts);
  }
  {
    /* 端末の控え（いまの保存）が1回だけ容量不足で落ちる */
    const once = (p) => { let n = 0; const orig = p.ls.setItem; p.b.localStorage.setItem = function (k, v) { if (k === p.b.ck && n++ === 0) throw new Error('容量不足'); orig(k, v); }; };
    let p = mkR();
    p.ls.setItem(p.b.k, BAK); once(p);
    let r = vm.runInContext('saveCache()', p.b);
    t('6-8 容量不足で落ちた時は、合わせる前の控えを先に消して1回だけ書き直す', r === true && p.ls.getItem(p.b.k) === null && !!p.ls.getItem(p.b.ck), [r, p.log.toasts]);
    p = mkR();
    p.ls.setItem(p.b.k, BAK); once(p);
    r = vm.runInContext('saveCache(true)', p.b);
    t('6-9 合わせた直後・戻した時（keepDiscard）は控えを消さず、今の知らせのまま失敗にする', r === false && p.ls.getItem(p.b.k) === BAK && p.log.toasts.some((m) => /端末に保存できませんでした/.test(m)), [r, p.log.toasts]);
    p = mkR();
    p.b.localStorage.setItem = function (k) { if (k === p.b.ck) throw new Error('容量不足'); };
    p.ls.m.set(p.b.k, BAK);
    r = vm.runInContext('saveCache()', p.b);
    t('6-10 控えを消して書き直しても落ちたら、今の知らせのまま失敗にする', r === false && p.log.toasts.some((m) => /端末に保存できませんでした/.test(m)), [r, p.log.toasts]);
  }
  {
    const p = mk({ answers: [false, true], getBefore: (b) => b.localStorage.setItem('su_device_role', 'field') });
    p.b.push(); await settle();
    const s = p.b.st();
    t('6-11 取り直しの応答を待つ間に端末の用途が現場へ変わったら、台帳も控えも書かずに捨てる', p.log.gets === 1 && s.DB.candidates.length === 2 && s.dirty === true
      && p.ls.getItem(p.b.keys.discard) === null && p.ls.getItem(p.b.keys.cache) === null, [s, p.log.toasts]);
    t('6-11b その時は見出しの札を「未送信あり」に戻し、「この端末は現場の端末になったため、合わせるのをやめました」と出す',
      JSON.stringify(p.log.sync[p.log.sync.length - 1]) === '["未送信あり","err"]' && p.log.toasts.indexOf('この端末は現場の端末になったため、合わせるのをやめました') >= 0, [p.log.sync, p.log.toasts]);
    t('6-11c 取り直しが終われば、取り直し中の印は下りる', p.b.taking() === false);
  }
  {
    const p = mk({ answers: [false, true], before: [null, (b) => b.localStorage.setItem('su_device_role', 'field')] });
    p.b.push(); await settle();
    t('6-12 2段目の答えの時に現場の端末なら、取り直さず「この端末は現場の端末になったため、合わせるのをやめました」と出す', p.log.gets === 0 && p.ls.getItem(p.b.keys.discard) === null
      && p.log.toasts.indexOf('この端末は現場の端末になったため、合わせるのをやめました') >= 0, p.log);
  }
  {
    let seen = null;
    const p = mk({ answers: [false, true], getBefore: (b) => { seen = vm.runInContext('afTaking_', b); } });
    p.b.push(); await settle();
    t('6-13 取り直しの応答を待つ間は取り直し中の印が立ち、終われば下りる', seen === true && p.b.taking() === false, [seen, p.b.taking()]);
    const q = mk({ answers: [false, true], getFail: true });
    q.b.push(); await settle();
    t('6-14 取り直しが失敗しても、取り直し中の印は下りる', q.b.taking() === false);
  }
  {
    /* 取り直しが返らない: 30秒の時間切れで印を下ろし、札を戻して知らせる。後から届いた答えでは何も書かない */
    const p = mk({ answers: [false, true], getHold: true, fakeTimers: true });
    p.b.push(); await settle();
    const tmo = p.log.timers.find((x) => x.ms === 30000);
    t('6-15 取り直しの時間切れは30秒', !!tmo, p.log.timers.map((x) => x.ms));
    t('6-15b 答えが返るまでは取り直し中の印が立っている', p.b.taking() === true);
    if (tmo) tmo.fn();
    t('6-16 時間切れで印を下ろし、札を「未送信あり」に戻し、「サーバーの内容を読み込めませんでした」と出す', p.b.taking() === false
      && JSON.stringify(p.log.sync[p.log.sync.length - 1]) === '["未送信あり","err"]' && p.log.toasts.indexOf('サーバーの内容を読み込めませんでした') >= 0, [p.log.sync, p.log.toasts]);
    const syncN = p.log.sync.length;
    if (p.b.__resolveGet) p.b.__resolveGet();
    await settle();
    const s = p.b.st();
    t('6-17 時間切れの後に届いた答えは捨てる（台帳も控えも書かない・札も変えない）', s.DB.candidates.length === 2 && s.dirty === true
      && p.ls.getItem(p.b.keys.discard) === null && p.ls.getItem(p.b.keys.cache) === null && p.log.sync.length === syncN, [s, p.log.sync.slice(syncN)]);
  }
  {
    const p = mk({ answers: [false, true], fakeTimers: true });
    p.b.push(); await settle();
    const tmo = p.log.timers.find((x) => x.ms === 30000);
    t('6-18 時間内に答えが届いたら、時間切れの見張りを止める', !!tmo && tmo.cleared === true && p.b.st().DB.candidates.length === 4, p.log.timers);
  }
  {
    const at = help.indexOf('id="sec-admission-flow"');
    const sec = at >= 0 ? help.slice(at, help.indexOf('</section>', at)) : '';
    t('5-4 使い方の入居調整の節に、合わせる前の控えからの戻し方が1行ある', /<dt>「サーバーの内容に合わせました」の後で、捨てた変更を戻したい<\/dt>\n\s*<dd>[^<]*「合わせる前の控え」の <span class="key">復元<\/span> を押すと/.test(sec));
  }
}

run().then(() => {
  console.log('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
}, (e) => { console.log('  ✗ 試験が最後まで動かなかった: ' + (e && e.stack)); process.exit(1); });
