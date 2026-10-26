/* menu_sync_stale_test.js — メニューの「入居者マスタ」の、写しが止まっている時の札（2026-10-26 本人指示）
   実行: node check/unit/menu_sync_stale_test.js
   守ること:
     1. 成功＝failed が 0 の行。その中で at がいちばん新しい行が「最終」。今から24時間より前（ちょうど24時間は含めない）の時だけ出す
     2. 文は「写しが止まっています（最終 MM/DD HH:mm）」（日本時間・ゼロ埋め）。成功の行が無い時は「（最終 記録なし）」
     3. 出すのは管理者（SUAuth.check() が OK・role admin）の時だけ。現場端末・現場／事務所のアカウント・ログインなし・
        確かめられない（通信の失敗・時間切れ・例外）時は出さない。現場端末では読み込み・通信をしない
     4. 札に出すのは時刻だけ（行に氏名らしい値が入っていても出ない）。リンク先が resident-master.html のタイルだけに付ける
   ★日時・値はすべて架空。画面の動き（本物のブラウザ）は check/menu_sync_stale_e2e.mjs。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-sync-stale.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

/* 純関数だけを読む（画面の部品は読み込まない） */
const pureBox = { window: {} };
vm.createContext(pureBox);
vm.runInContext(SRC, pureBox);
const S = pureBox.window.SUSyncStale;
const H = 3600 * 1000, DAY = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse('2026-10-26T03:00:00Z');   // 日本時間 10/26 12:00

console.log('\n— 1. 24時間の境目 —');
t('23:59:59 前の成功は出さない', S.staleText([{ at: iso(NOW - DAY + 1000), failed: 0 }], NOW) === '', S.staleText([{ at: iso(NOW - DAY + 1000), failed: 0 }], NOW));
t('ちょうど24時間前は出さない（「前」に含めない）', S.staleText([{ at: iso(NOW - DAY), failed: 0 }], NOW) === '', '');
t('24:00:01 前の成功は出す', S.staleText([{ at: iso(NOW - DAY - 1000), failed: 0 }], NOW) === '写しが止まっています（最終 10/25 11:59）', S.staleText([{ at: iso(NOW - DAY - 1000), failed: 0 }], NOW));
t('1時間前の成功は出さない', S.staleText([{ at: iso(NOW - H), failed: 0 }], NOW) === '', '');
t('先の時刻（端末の時計が遅れている）は出さない', S.staleText([{ at: iso(NOW + H), failed: 0 }], NOW) === '', '');

console.log('\n— 2. 成功の行の選び方 —');
t('成功の行が無い（0件）時は「記録なし」', S.staleText([], NOW) === '写しが止まっています（最終 記録なし）', S.staleText([], NOW));
t('失敗の行しか無い時も「記録なし」', S.staleText([{ at: iso(NOW - H), failed: 2 }], NOW) === '写しが止まっています（最終 記録なし）', '');
t('新しい失敗の行（failed>0）と古い成功の行 → 古い成功の時刻で出す',
  S.staleText([{ at: iso(NOW - H), failed: 1 }, { at: '2026-10-20T00:05:00Z', failed: 0 }], NOW) === '写しが止まっています（最終 10/20 09:05）',
  S.staleText([{ at: iso(NOW - H), failed: 1 }, { at: '2026-10-20T00:05:00Z', failed: 0 }], NOW));
t('成功の行が複数なら at がいちばん新しい行（並び順に頼らない）',
  S.staleText([{ at: '2026-10-20T00:00:00Z', failed: 0 }, { at: iso(NOW - 2 * H), failed: 0 }, { at: '2026-10-21T00:00:00Z', failed: 0 }], NOW) === '', '');
t('care_failed は見ない（failed=0・care_failed>0 は成功）', S.staleText([{ at: iso(NOW - H), failed: 0, care_failed: 3 }], NOW) === '', '');
t('failed が文字・null の行は成功に数えない', S.staleText([{ at: iso(NOW - H), failed: '0' }, { at: iso(NOW - H), failed: null }], NOW) === '写しが止まっています（最終 記録なし）', '');
t('at が壊れている行は飛ばす', S.staleText([{ at: 'x', failed: 0 }, { at: '2026-10-24T00:00:00Z', failed: 0 }], NOW) === '写しが止まっています（最終 10/24 09:00）', '');
t('行の配列でない・今の時刻が数でない時は出さない', S.staleText(null, NOW) === '' && S.staleText({}, NOW) === '' && S.staleText([], NaN) === '' && S.staleText([], '1') === '', '');

console.log('\n— 3. 日本時間の表示 —');
t('日付またぎ: 2026-10-25T15:30Z → 10/26 00:30', S.jstStamp(Date.parse('2026-10-25T15:30:00Z')) === '10/26 00:30', S.jstStamp(Date.parse('2026-10-25T15:30:00Z')));
t('年またぎ: 2025-12-31T15:00Z → 01/01 00:00', S.jstStamp(Date.parse('2025-12-31T15:00:00Z')) === '01/01 00:00', S.jstStamp(Date.parse('2025-12-31T15:00:00Z')));
t('ゼロ埋め: 2026-03-04T23:07Z → 03/05 08:07', S.jstStamp(Date.parse('2026-03-04T23:07:00Z')) === '03/05 08:07', '');
t('+09:00 付きの時刻もそのまま日本時間', S.staleText([{ at: '2026-10-01T08:09:00+09:00', failed: 0 }], NOW) === '写しが止まっています（最終 10/01 08:09）', '');

console.log('\n— 4. 氏名らしい値が入っていても出ない —');
{
  const rows = [{ at: '2026-10-20T00:05:00Z', failed: 0, device_label: '架空 太郎', actor: '00000000-0000-4000-8000-000000000001', source_count: 16 }];
  const txt = S.staleText(rows, NOW);
  t('文は決まりの文言と時刻だけ', /^写しが止まっています（最終 \d\d\/\d\d \d\d:\d\d）$/.test(txt) && !/架空|太郎|0000|16/.test(txt), txt);
}

console.log('\n— 5. 確かめてよいか（allowed）—');
t('管理者（OK・admin）・事務所の端末は出す', S.allowed({ status: 'ok', role: 'admin' }, 'office', 'ok') === true, '');
t('事務所のアカウントは出さない', S.allowed({ status: 'ok', role: 'office' }, 'office', 'ok') === false, '');
t('現場のアカウントは出さない', S.allowed({ status: 'ok', role: 'field' }, 'office', 'ok') === false, '');
t('現場端末では管理者でも出さない', S.allowed({ status: 'ok', role: 'admin' }, 'field', 'ok') === false, '');
t('ログインなし・2段階認証の途中・確かめられない時は出さない',
  ['signed_out', 'denied', 'mfa_enroll', 'mfa_verify', 'error'].every((s) => S.allowed({ status: s, role: 'admin' }, 'office', 'ok') === false), '');
t('結果が無い・形が違う時は出さない', S.allowed(null, 'office', 'ok') === false && S.allowed('ok', 'office', 'ok') === false && S.allowed({ status: 'ok', role: 'admin' }, 'office', undefined) === false, '');

/* ── 6. 画面の部品の動き（偽の DOM・偽の SUMenu・偽の SUAuth）── */
function fakeTile(href) {
  const tile = { href, kids: [], getAttribute: (k) => (k === 'href' ? href : null),
    appendChild(c) { c.parentNode = tile; tile.kids.push(c); return c; },
    removeChild(c) { tile.kids = tile.kids.filter((x) => x !== c); return c; } };
  return tile;
}
function makeEnv(o) {
  o = Object.assign({ device: 'office', login: true, status: 'ok', role: 'admin', rows: [{ at: '2026-10-20T00:05:00Z', failed: 0 }], dbError: null, throwCheck: false, loadFail: false }, o);
  const log = { load: 0, check: 0, query: [] };
  const tiles = [fakeTile('resident-master.html'), fakeTile('resident-master.html?view=bday'), fakeTile('facesheet.html')];
  const root = { querySelectorAll(sel) {
    if (sel === 'a.tile') return tiles;
    if (sel === 'a.tile .stale') return [].concat(...tiles.map((x) => x.kids.filter((k) => k.className === 'stale')));
    return [];
  } };
  const listeners = {};
  const store = { su_device_role: o.device };
  const win = {
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    SUMenu: {
      hasLogin: () => o.login,
      loadAuth() {
        log.load++;
        if (o.loadFail) return Promise.reject(new Error('読み込めない'));
        win.SUAuth = {
          STATUS: { OK: 'ok' },
          check() { log.check++; if (o.throwCheck) return Promise.reject(new Error('通信できない')); return Promise.resolve({ status: o.status, role: o.role, email: 'kakuu@example.com', label: '架空 太郎' }); },
          client() {
            const q = { sel: '', eq: [], order: null, limit: 0 };
            log.query.push(q);
            const b = { select(c) { q.sel = c; return b; }, eq(k, v) { q.eq.push([k, v]); return b; }, order(k, op) { q.order = [k, op]; return b; },
              limit(n) { q.limit = n; return Promise.resolve(o.dbError ? { error: o.dbError, data: null } : { error: null, data: o.rows }); } };
            return { from(tb) { q.table = tb; return b; } };
          }
        };
        return Promise.resolve();
      }
    }
  };
  const doc = {
    readyState: 'complete',
    documentElement: { classList: { contains: (c) => c === 'is-field' && o.device === 'field' } },
    createElement: () => ({ className: '', textContent: '', parentNode: null })
  };
  const ctx = { window: win, document: doc, localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    setTimeout, Promise, Date };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { S: win.SUSyncStale, win, tiles, root, log, store, listeners, o };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const badges = (env) => env.tiles.map((x) => x.kids.filter((k) => k.className === 'stale').map((k) => k.textContent));

(async () => {
  console.log('\n— 6. 画面の部品の動き（偽物）—');
  {
    const e = makeEnv({});
    e.S.start(e.root); await tick();
    const b = badges(e);
    t('管理者＋古い成功 → 入居者マスタのタイルだけに札（誕生日一覧・ほかには付けない）', b[0].length === 1 && b[0][0] === '写しが止まっています（最終 10/20 09:05）' && b[1].length === 0 && b[2].length === 0, b);
    const q = e.log.query[0];
    t('読むのは写しの記録の at・failed だけ・成功（failed=0）をサーバー側で絞り、新しい順に1行', q && q.table === 'master_sync_runs' && q.sel === 'at,failed' && JSON.stringify(q.eq) === '[["failed",0]]' &&
      q.order[0] === 'at' && q.order[1].ascending === false && q.limit === 1, q);
    t('通信: 確かめ1回・読む1回', e.log.check === 1 && e.log.query.length === 1, e.log);
    e.S.apply(e.root);
    t('組み立て直しの後の付け直しは通信しない・札は1枚のまま', e.log.check === 1 && e.log.query.length === 1 && badges(e)[0].length === 1, e.log);
  }
  {
    const e = makeEnv({ rows: [{ at: new Date(Date.now() - H).toISOString(), failed: 0 }] });
    e.S.start(e.root); await tick();
    t('管理者＋新しい成功 → 出さない', badges(e)[0].length === 0, badges(e));
  }
  {
    const e = makeEnv({ rows: [] });
    e.S.start(e.root); await tick();
    t('管理者＋成功の記録なし → 「記録なし」', badges(e)[0][0] === '写しが止まっています（最終 記録なし）', badges(e));
  }
  for (const [name, o] of [['事務所のアカウント', { role: 'office' }], ['現場のアカウント', { role: 'field' }], ['2段階認証の途中の管理者', { status: 'mfa_verify' }],
    ['ログインなし（確かめた結果）', { status: 'signed_out' }], ['確かめられない（ERROR）', { status: 'error' }]]) {
    const e = makeEnv(o);
    e.S.start(e.root); await tick();
    t(name + ' → 出さない・写しの記録を読まない', badges(e)[0].length === 0 && e.log.query.length === 0, e.log);
  }
  {
    const e = makeEnv({ device: 'field' });
    e.S.start(e.root); await tick();
    t('現場端末 → 部品を読み込まない・確かめない・読まない', e.log.load === 0 && e.log.check === 0 && e.log.query.length === 0 && badges(e)[0].length === 0, e.log);
  }
  {
    const e = makeEnv({ login: false });
    e.S.start(e.root); await tick();
    t('ログインの記録なし → 部品を読み込まない', e.log.load === 0 && badges(e)[0].length === 0, e.log);
  }
  for (const [name, o] of [['通信の失敗（データベースのエラー）', { dbError: { code: '42501', message: 'x' } }], ['確かめで例外', { throwCheck: true }], ['部品を読み込めない', { loadFail: true }]]) {
    const e = makeEnv(o);
    let threw = false;
    try { e.S.start(e.root); await tick(); } catch (x) { threw = true; }
    t(name + ' → 出さない・例外を外に出さない', !threw && badges(e)[0].length === 0, e.log);
  }
  {
    // 遅れて届いた応答: 確かめの途中で端末の用途が現場へ変わったら捨てる
    const e = makeEnv({});
    let release;
    const gate = new Promise((r) => { release = r; });
    const orig = e.win.SUMenu.loadAuth;
    e.win.SUMenu.loadAuth = () => gate.then(() => orig());
    e.S.start(e.root);
    e.store.su_device_role = 'field';
    e.listeners.storage.forEach((fn) => fn({ key: 'su_device_role' }));
    release(); await tick();
    t('用途が現場へ変わった後に届いた応答は捨てる（札を出さない・読まない）', badges(e)[0].length === 0 && e.log.query.length === 0, e.log);
  }
  {
    // 札が出た後に用途が現場へ変わったら外す
    const e = makeEnv({});
    e.S.start(e.root); await tick();
    const before = badges(e)[0].length;
    e.store.su_device_role = 'field';
    e.listeners.storage.forEach((fn) => fn({ key: 'su_device_role' }));
    await tick();
    t('札が出た後に用途が現場へ変わったら外す', before === 1 && badges(e)[0].length === 0, badges(e));
  }

  console.log('\n— 7. メニューのつなぎ —');
  t('index.html は su-menu.js の後に su-sync-stale.js を読む', INDEX.indexOf('src="su-menu.js') > 0 && INDEX.indexOf('src="su-sync-stale.js') > INDEX.indexOf('src="su-menu.js'), '');
  t('index.html は su-auth.js・supabase-js を直接読まない（現場端末で読まない）', !/<script[^>]+src="(su-auth|supabase-js)/.test(INDEX), '');
  t('組み立て直しの後に札を付け直す（staleApply）', /drawBall\(\);\s*staleApply\(\);/.test(INDEX), '');

  console.log(`\n${pass} 件成功／${fail} 件失敗`);
  process.exit(fail ? 1 : 0);
})();
