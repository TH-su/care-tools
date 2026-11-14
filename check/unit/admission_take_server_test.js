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
  const log = { puts: [], sync: [], toasts: [], gets: 0, scheduled: 0, renders: 0, notes: [], asked: [] };
  const answers = (opt.answers || []).slice();
  const befores = (opt.before || []).slice();
  const ls = makeStorage(opt.failKey);
  const b = {
    Promise, String, Number, Object, Array, JSON, setTimeout, clearTimeout,
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
    grabVar('CACHE_KEY'), grabVar('CACHE_BAK'), grabVar('CACHE_BAK2'), grabVar('CACHE_DISCARD'),
    grabFn('serverLooksLost'), grabFn('cachePayload'), grabFn('saveCache'), grabFn('push'), grabFn('afTakeServer_'),
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
  {
    const log = { merged: null, dirtied: 0, asked: [] };
    const ls = makeStorage();
    const b = { localStorage: ls, JSON, Promise, String, Array,
      SUDialog: { confirm(m) { log.asked.push(m); return Promise.resolve(true); } },
      toast() {}, afDlgNote_() {}, afNote_() {}, renderAll() {}, fmtDt: (s) => s, asStr: (v) => (v == null ? '' : String(v)),
      normalizeDb: (d) => JSON.parse(JSON.stringify(d)),
      mergeDb: (a, x, o) => { log.merged = { a: a.candidates.length, x: x.candidates.length, keep: !!(o && o.keepFilled) }; return { candidates: a.candidates.concat(x.candidates) }; },
      markDirty: () => { log.dirtied++; } };
    vm.createContext(b);
    vm.runInContext(['var DB = ' + JSON.stringify(SERVER) + ';', grabVar('CACHE_DISCARD'), grabFn('readCacheSlot'), grabFn('restoreDiscarded_'), 'this.k = CACHE_DISCARD;'].join('\n'), b);
    ls.setItem(b.k, JSON.stringify({ db: LOCAL, rev: 3, dirty: true, at: '2026-11-14T00:00:09.000Z', n: 2 }));
    b.restoreDiscarded_(); await settle();
    t('5-2 合わせる前の控えは、件数を聞いてから今の台帳へ統合で戻す（消した印を効かせない・送信待ちにする）',
      log.asked.length === 1 && /合わせる前の控え（2026-11-14T00:00:09\.000Z・案件2件）/.test(log.asked[0]) && log.merged && log.merged.a === 4 && log.merged.x === 2 && log.merged.keep && log.dirtied === 1, log);
  }
  t('5-3 同期とバックアップの窓に、控えがある時だけ「合わせる前の控え」の行と復元のボタンを出す',
    src.indexOf("(bd ? '<dt>合わせる前の控え</dt><dd>' + bd.n + '件（' + esc(fmtDt(bd.at)) + '）<button class=\"btn sm\" id=\"syRD\" type=\"button\" style=\"margin-left:6px\">復元</button></dd>' : '')") >= 0
    && src.indexOf("if ($('syRD')) $('syRD').addEventListener('click', function () { restoreDiscarded_(); closeModal('mk-sync'); });") >= 0);
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
