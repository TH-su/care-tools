/* 不具合報告（su-report.js）── ログインしている端末は Supabase の受け口へ送る（2026-10-14 新設・代表者の依頼）
   実行: node check/unit/su_report_login_test.js

   守ること:
     1 ログインしている（su-auth で ok）端末は、Edge Function su-report へ送る。本文に合言葉を付けない。届いて ok なら合言葉の受け口へは送らない
     2 ログインの記録が無い・ログインが切れている（ok 以外）・受け口に届かない・断られた（ok でない）時は、
       移行の間は合言葉の受け口へ送る（代表者の選択）。合言葉の受け口も無ければ送らずに失敗を返す
     3 ボタンを出す・自動で送る判定（canSend）は「ログインの記録がある」か「合言葉の受け口がある」
     4 自動報告・手動の送信・画面の指摘がすべて send を通る（合言葉の受け口へ直接送らない）
     5 画面の注意書きは「公開の場所」と言わない（Issue は非公開）・ログイン中はアカウントが残ると知らせる
   ★su-report.js の本物の関数を切り出して動かす。偽物にするのは SUAuth・localStorage・fetch だけ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RS = fs.readFileSync(path.join(ROOT, 'su-report.js'), 'utf8');
const cutF = (name) => { const h = RS.indexOf('function ' + name + '('); if (h < 0) throw new Error('関数が無い: ' + name); let i = RS.indexOf('{', h), d = 0; for (; i < RS.length; i++) { if (RS[i] === '{') d++; else if (RS[i] === '}') { d--; if (d === 0) return RS.slice(h, i + 1); } } };

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}

const URL0 = 'https://script.google.com/macros/s/X/exec';
/* opts: login＝ログインの記録のキーを置く／status＝SUAuth.check の結果／invoke＝受け口の応答（関数）／gas＝合言葉の受け口の設定 */
function mk(opts) {
  const store = {};
  if (opts.login) store['sb-abcdefgh-auth-token'] = '{}';
  if (opts.gas) { store.su_report_endpoint = URL0; store.su_report_token = 'tok-1'; }
  const calls = { invoke: [], fetch: [], check: 0 };
  const box = {
    String, Promise, JSON, Object,
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      key: i => Object.keys(store)[i] ?? null, get length() { return Object.keys(store).length; }
    },
    fetch: (u, o) => { calls.fetch.push([u, o]); return Promise.resolve({ ok: true, text: () => Promise.resolve('{"ok":true}') }); },
    loadAuth: () => (opts.noAuth ? Promise.reject(new Error('読み込めない')) : Promise.resolve()),
    window: {
      SUAuth: {
        STATUS: { OK: 'ok' },
        check: () => { calls.check++; return Promise.resolve({ status: opts.status || 'ok', role: 'field' }); },
        client: () => ({ functions: { invoke: (name, o) => { calls.invoke.push([name, o]); return Promise.resolve(opts.invoke ? opts.invoke() : { data: { ok: true, action: 'create' }, error: null }); } } })
      }
    }
  };
  vm.createContext(box);
  vm.runInContext(['var KEY_IN_URL = ' + /var KEY_IN_URL = ([^\n]*);/.exec(RS)[1] + ';', /var FN_NAME = [^\n]*/.exec(RS)[0],
    cutF('urlKey_'), cutF('reportToken'), cutF('endpoint'), cutF('post'), cutF('hasLogin'), cutF('viaLogin'), cutF('canSend'), cutF('send')].join('\n'), box);
  return { box, calls };
}

(async () => {
  console.log('\n— 1. ログインしている端末は Supabase の受け口へ —');
  {
    const a = mk({ login: true, gas: true });
    const r = await a.box.send('【不具合報告】見本');
    t('Edge Function su-report へ本文だけを送る（合言葉を付けない）', a.calls.invoke.length === 1 && a.calls.invoke[0][0] === 'su-report' && a.calls.invoke[0][1].body === '【不具合報告】見本', a.calls.invoke);
    t('届いて ok なら合言葉の受け口へは送らない', r.ok === true && r.via === 'login' && a.calls.fetch.length === 0, [r, a.calls.fetch.length]);
  }

  console.log('\n— 2. それ以外は、移行の間は合言葉の受け口へ —');
  for (const [label, opts] of [
    ['ログインの記録が無い', { login: false, gas: true }],
    ['ログインが切れている（ok 以外）', { login: true, gas: true, status: 'signed_out' }],
    ['受け口に届かない（関数が無い・通信できない）', { login: true, gas: true, invoke: () => ({ data: null, error: { name: 'FunctionsHttpError' } }) }],
    ['受け口が断った（ok でない）', { login: true, gas: true, invoke: () => ({ data: { ok: false, error: 'forbidden' }, error: null }) }],
    ['ログインの部品を読み込めない', { login: true, gas: true, noAuth: true }],
  ]) {
    const a = mk(opts);
    const r = await a.box.send('【自動報告】見本');
    t(label + ' → 合言葉の受け口へ（1行目に合言葉）', r.ok === true && a.calls.fetch.length === 1 && a.calls.fetch[0][1].body === 'SU-KEY-V1 tok-1\n【自動報告】見本', [r, a.calls.fetch]);
  }
  {
    const a = mk({ login: false, gas: false });
    const r = await a.box.send('【不具合報告】見本');
    t('ログインも合言葉の受け口も無ければ送らずに失敗を返す', r.ok === false && a.calls.fetch.length === 0 && a.calls.invoke.length === 0, r);
    const b = mk({ login: true, gas: false, status: 'signed_out' });
    const rb = await b.box.send('【不具合報告】見本');
    t('ログインが切れていて合言葉の受け口も無い → 失敗を返す（受け口へは送らない）', rb.ok === false && b.calls.invoke.length === 0 && b.calls.fetch.length === 0, rb);
    const c = mk({ login: false, gas: true });
    await c.box.send('x');
    t('ログインの記録が無い端末では、ログインの確かめもしない（部品を読み込まない）', c.calls.check === 0, c.calls.check);
  }

  console.log('\n— 3. ボタンを出す・自動で送るかの判定 —');
  t('ログインの記録だけでも送れる', mk({ login: true }).box.canSend() === true);
  t('合言葉の受け口だけでも送れる（移行の間）', mk({ gas: true }).box.canSend() === true);
  t('どちらも無ければ送らない', mk({}).box.canSend() === false);

  console.log('\n— 4. 送る道は send の1本 —');
  const body = (n) => cutF(n);
  t('自動報告は canSend で判定し send で送る', /if \(!canSend\(\)\) return;/.test(body('autoSend')) && /send\(composeAuto\(type, w\)\)/.test(body('autoSend')));
  t('手動の送信・画面の指摘も send で送る', /send\(payload\(dlg\.querySelector\('#sur-sym'\)\.value\.trim\(\)\)\)/.test(RS));
  t('post（合言葉の受け口）を直接呼ぶのは send の中だけ',
    (RS.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^.\w]post\(/g) || []).length === 2, (RS.match(/[^.\w]post\(/g) || []).length);   // 定義と send の中の1回

  console.log('\n— 5. 画面の言葉 —');
  t('注意書きは「公開の場所」と言わない', RS.indexOf('公開の場所に載ります') < 0 && RS.indexOf('直す担当が見る場所に載ります') > 0);
  t('ログイン中はアカウントが記録に残ると知らせる', RS.indexOf('ログインしている時は、送った人のアカウントが記録に残ります') > 0);

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
