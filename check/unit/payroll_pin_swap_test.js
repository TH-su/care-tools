/* 給与の画面（payroll.js）の暗証番号の予告と、別のタブでアカウントが替わった時の守りの試験（2026-11-28 新設・反証レビューの指摘）
   実行: node check/unit/payroll_pin_swap_test.js
   守ること:
     1. 違えた時の予告は分数を書かない（止める長さは回ごとに延び、DB は次の長さを返さない＝0110）
     2. 別のタブでログアウト・別のアカウントでログイン（ログインの印 sb-…-auth-token の変化）を受けたら、答えを待たずにすぐ鍵の画面
        （暗証番号の無い DB では金額を隠す）。同じ人の印の更新では何もしない。ほかの人に替わったら読み込み直す（離れる時の確かめは出さない）
     3. 鍵を開ける時・隠した金額を出す時に、ほかの人に替わっていたら読み込み直す（前の人の計算を見せない）
     4. ログインの印は読むだけ（書かない）
   ★データはすべて架空。出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const J = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
const fnBody = (name, next) => { const i = J.indexOf('function ' + name + '('); return i < 0 ? '' : J.slice(i, J.indexOf(next, i + 1)); };
const session = (id) => JSON.stringify({ access_token: 'x', user: id ? { id } : undefined });
function fakeLs(o) {
  const keys = Object.keys(o);
  return { get length() { return keys.length; }, key: (i) => keys[i], getItem: (k) => (k in o ? o[k] : null), setItem() { throw new Error('書かない'); } };
}

say('\n— 1. 違えた時の予告 —');
{
  const src = J.slice(J.indexOf('var PIN_NG = {'), J.indexOf('function pinStart('));
  const ctx = {}; vm.createContext(ctx);
  let ok = true;
  try { vm.runInContext(src, ctx); } catch (e) { ok = false; }
  t('予告の部品を動かせる', ok && typeof ctx.pinErr === 'function');
  if (ok) {
    const w = ctx.pinErr({ error: 'wrong', left: 2 }), o = ctx.pinErr({ error: 'oldpin', left: 1 });
    t('「あと n 回間違えるとしばらく止めます」と出し、分数を書かない', /あと 2 回間違えるとしばらく止めます/.test(w) && /あと 1 回間違えるとしばらく止めます/.test(o) && !/分/.test(w + o), [w, o]);
    t('止めている時は今までどおり何時まで（DB が返す時刻）', /5回続けて間違えたため、/.test(ctx.pinErr({ error: 'locked', until: '2026-11-28T10:30:00+09:00' })));
  }
}

say('\n— 2. ログインの印の読み取り —');
{
  const src = J.slice(J.indexOf('var SESS_KEY ='), J.indexOf('function swapReload('));
  const ctx = { localStorage: fakeLs({ su_device_role: 'office', 'sb-jhbernqawjrzqwrmqrih-auth-token': session('u-a') }) }; vm.createContext(ctx);
  let ok = J.indexOf('var SESS_KEY =') >= 0; try { if (ok) vm.runInContext(src, ctx); } catch (e) { ok = false; }
  ok = ok && typeof ctx.sessUid === 'function';
  t('sessUid がある', ok);
  if (ok) {
    t('印の利用者 id を読む', ctx.sessUid() === 'u-a');
    ctx.localStorage = fakeLs({ su_device_role: 'office' });
    t('印が無い（ログアウト）時は空', ctx.sessUid() === '');
    ctx.localStorage = fakeLs({ 'sb-jhbernqawjrzqwrmqrih-auth-token': '{壊れた' });
    t('壊れた印は空（落ちない）', ctx.sessUid() === '');
    ctx.localStorage = fakeLs({ 'sb-gaurbzkjdpypxnehrnth-auth-token': session('u-k'), 'sb-jhbernqawjrzqwrmqrih-auth-token': session('u-a') });
    t('同じ公開元のほかのアプリ（別の Supabase）の印が先に並んでいても、給与の接続先の印だけを読む（反証レビュー）', ctx.sessUid() === 'u-a');
    ctx.localStorage = fakeLs({ 'sb-gaurbzkjdpypxnehrnth-auth-token': session('u-k') });
    t('ほかのアプリの印しか無い時は空（給与はログアウトとみなす）', ctx.sessUid() === '');
  }
  t('印は読むだけ（setItem・removeItem で触らない）', !/localStorage\.(setItem|removeItem)\([^)]*auth-token/.test(J) && !/SESS_KEY[^\n]*setItem/.test(J));
}

say('\n— 3. 別のタブでアカウントが替わった時 —');
{
  const a = J.indexOf("window.addEventListener('storage', function (e) {\n      if (!e ||");
  const b = a < 0 ? -1 : J.indexOf('});', a);
  const listener = a < 0 ? '' : J.slice(a, b + 3);
  t('ログインの印の変化を受ける storage の聞き手がある', !!listener);
  const run = (o) => {
    const log = [];
    const ctx = {
      view: o.view || 'app', pinOn: o.pinOn !== false, bootUid: 'u-a', SESS_KEY: 'sb-jhbernqawjrzqwrmqrih-auth-token',
      sessUid: () => o.now, swapped: () => !!o.now && o.now !== 'u-a',
      pinLockNow: (w) => log.push('lock:' + w), mask: () => log.push('mask'), swapReload: () => log.push('reload'),
      window: { addEventListener: (ev, fn) => { if (ev === 'storage') ctx.fn = fn; } },
    };
    vm.createContext(ctx);
    try { vm.runInContext(listener, ctx); ctx.fn({ key: o.key === undefined ? 'sb-jhbernqawjrzqwrmqrih-auth-token' : o.key }); } catch (e) { log.push('error:' + e.message); }
    return log;
  };
  if (listener) {
    t('ログアウトしたら、すぐ鍵の画面（暗証番号のある DB）', run({ now: '' }).join() === 'lock:account', run({ now: '' }));
    t('別のアカウントでログインしたら、鍵の画面にしてから読み込み直す', run({ now: 'u-b' }).join() === 'lock:account,reload', run({ now: 'u-b' }));
    t('暗証番号の無い DB では金額を隠す', run({ now: '', pinOn: false }).join() === 'mask');
    t('同じ人の印の更新では何もしない', run({ now: 'u-a' }).length === 0);
    t('ほかの鍵の変化では何もしない', run({ now: 'u-b', key: 'payroll_tab' }).length === 0);
    t('ほかのアプリ（別の Supabase）のログインの印の変化では何もしない（反証レビュー）', run({ now: 'u-b', key: 'sb-gaurbzkjdpypxnehrnth-auth-token' }).length === 0);
    t('全部消された（key が null）時も鍵の画面', run({ now: '', key: null }).join() === 'lock:account');
    t('鍵の画面の間（app でない）にほかの人へ替わったら読み込み直すだけ', run({ now: 'u-b', view: 'lock' }).join() === 'reload');
  }
  t('起動の時にアカウントを覚える', /role = st\.role; bootUid = sessUid\(\);/.test(J));
  t('鍵の画面の文に「ほかのタブでログインが変わった」を出す（理由の語をそのまま画面に出さない）',
    /msg === 'account' \? 'ほかのタブでログインが変わったため、鍵をかけました。'/.test(J) && /\(idle\|manual\|manual-other\|expired\|account\)/.test(J));
  t('読み込み直しでは離れる時の確かめを出さない（leaving）', /if \(!leaving && \(isDirty\(\) \|\| bonusDirty\(\)\)\)/.test(J) && /function swapReload\(\) \{ leaving = true; location\.reload\(\); \}/.test(J));
}

say('\n— 4. 鍵を開ける・金額を出す時 —');
t('鍵を開けた時、ほかの人に替わっていたら中身を読まずに読み込み直す', /function pinOpened\(\) \{\s*if \(swapped\(\)\) \{ swapReload\(\); return Promise\.resolve\(null\); \}/.test(J));
t('隠した金額を出す時、ほかの人に替わっていたら読み込み直す', /if \(swapped\(\)\) \{ swapReload\(\); return; \}/.test(fnBody('unmask', 'function idleCheck')));

say('\n合計: ' + pass + ' 通過 / ' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
