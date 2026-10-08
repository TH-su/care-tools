/* training_plan_aiproxy_client_test.js — 個別機能訓練計画書（training-plan.html）の AI 中継の受け手側
   （aiFetch・aiErrText・aiErrFatal）を実物のまま切り出して Node で動かす。2026-09-24〜
   キーは計画書の専用GAS（training-plan-api.gs の action:'ai'）にだけ置き、画面は GAS に頼むだけになった。
   守りたいこと:
   1. 画面から Anthropic へ直接送らない（fetch を使わない・キーを送らない）
   2. GAS の断り（キー無し・上限・古い版・合言葉）を、次に何をすればよいかが分かる文言に読み分ける
   3. Anthropic の断り（4xx/5xx）は今までどおり AI_HTTP_<状態> として扱い、fallbacks の取りこぼしは1回だけ送り直す
   4. 設定や版の問題（直すまで何度やっても同じ）では一括作成を止める（aiErrFatal）
   対象HTMLは環境変数 TP_HTML で差し替えられる。
     TP_HTML=/path/to/training-plan.html node check/unit/training_plan_aiproxy_client_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.TP_HTML || path.join(__dirname, '..', '..', 'training-plan.html');
const src = fs.readFileSync(HTML, 'utf8');

/* tp-aiproxy（AI 中継）が main に合流するまでの扱い（2026-10-08）。
   main の training-plan.html・resident-master.html はまだ端末のキーで直接送る版で、この試験の対象の関数が無い。
   合流前は「省略」と大きく出して終了コード0で抜ける（毎回赤のままだと、ほかの本物の失敗が埋もれる）。
   ★合流したら MERGED を true にする。true なのに中継の印（action:'ai'）が無ければ失敗にする＝合流後に消えたら気づける。
   TP_HTML・RM_HTML を渡した時（ブランチの版を試す時）は省略しない。ブランチの版では 65件。 */
const MERGED = false;
{
  const RM0 = process.env.RM_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
  const hasRelay = (s) => /action:\s*'ai'/.test(s);
  const relayHere = hasRelay(src) && hasRelay(fs.readFileSync(RM0, 'utf8'));
  if (!relayHere) {
    if (MERGED || process.env.TP_HTML || process.env.RM_HTML) {
      console.log('  ✗ AI 中継（action:\'ai\'）が対象のファイルに無い（MERGED=' + MERGED + '）');
      process.exit(1);
    }
    console.log('\n⏸ 省略: training-plan.html / resident-master.html に AI 中継（tp-aiproxy）がまだ入っていない。');
    console.log('   合流したらこの試験の MERGED を true にする。ブランチの版は TP_HTML・RM_HTML を渡して試す。');
    process.exit(0);
  }
}

/* function 名(…) { … } を波かっこの数で切り出す（文字列・コメント中のかっこは対で書かれている前提） */
function cut(name) {
  const head = src.indexOf('function ' + name + '(');
  if (head < 0) throw new Error('not found: ' + name);
  let depth = 0, i = src.indexOf('{', head);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

let pass = 0, fail = 0;
function t(n, c, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); }
}

function makeEnv() {
  const calls = [];
  const sb = {
    calls: calls,
    resp: null,
    SU_READY: true,
    CFG: { url: 'https://script.google.com/macros/s/TEST/exec', token: 'tok-test' },
    AI_TIMEOUT_MS: 200,
    fetch: () => { throw new Error('画面から直接 fetch してはいけない'); },
    aiNoticeOk: () => true,
    tpTarget: () => ({ endpoint: sb.CFG.url, token: sb.CFG.token }),
    s_: (v) => (v == null ? '' : String(v)),
    withTimeout: (p, ms) => new Promise((res, rej) => {
      let done = false;
      const tm = setTimeout(() => { if (!done) { done = true; rej(new Error('タイムアウト')); } }, ms);
      p.then((v) => { if (!done) { done = true; clearTimeout(tm); res(v); } },
             (e) => { if (!done) { done = true; clearTimeout(tm); rej(e); } });
    }),
    SU: { data: { kvRaw: (payload, target) => {
      calls.push({ payload: JSON.parse(JSON.stringify(payload)), target: target });
      const r = typeof sb.resp === 'function' ? sb.resp(payload, calls.length) : sb.resp;
      if (r instanceof Error) return Promise.reject(r);
      if (r === 'hang') return new Promise(() => {});
      return Promise.resolve(r);
    } } },
    Promise, JSON, Object, Number, String, Error, setTimeout, clearTimeout
  };
  vm.createContext(sb);
  vm.runInContext(cut('aiFetch') + '\n' + cut('aiErrText') + '\n' + cut('aiErrFatal'), sb);
  return sb;
}
const BODY = () => ({ model: 'claude-sonnet-5', max_tokens: 4096, system: 's', messages: [{ role: 'user', content: 'x' }] });
async function msgOf(sb, body) {
  try { await sb.aiFetch(body || BODY()); return 'OK'; } catch (e) { return String(e && e.message); }
}

(async () => {
  console.log('\n【1】画面から Anthropic へ直接送らない・GAS へ頼む');
  {
    const sb = makeEnv();
    sb.resp = { ok: true, status: 200, data: { content: [{ type: 'text', text: '{}' }] } };
    const j = await sb.aiFetch(BODY());
    t('成功は GAS が返した Anthropic の応答（data）をそのまま返す', j && Array.isArray(j.content), j);
    t('★GAS へ action:"ai" で頼む', sb.calls.length === 1 && sb.calls[0].payload.action === 'ai', sb.calls);
    t('★本文（body）はそのまま GAS に渡す', sb.calls[0].payload.body.model === 'claude-sonnet-5');
    t('★計画書の専用GASの接続先へ送る', sb.calls[0].target.endpoint === sb.CFG.url && sb.calls[0].target.token === 'tok-test');
    t('★要求に API キーを載せない', JSON.stringify(sb.calls[0]).indexOf('sk-ant') < 0 && !('x-api-key' in sb.calls[0].payload));
    t('★画面のコードに Anthropic の URL・キー置き場が残っていない',
      src.indexOf('api.anthropic.com') < 0 && src.indexOf("getItem('tp_ai_key')") < 0 &&
      src.indexOf('anthropic-dangerous-direct-browser-access') < 0);
    t('★古い端末に残ったキーは起動時に消す', /function aiDropLocalKey\(\)[\s\S]*?removeItem\('tp_ai_key'\)[\s\S]*?\}\s*aiDropLocalKey\(\);/.test(src));
  }

  console.log('\n【2】接続先が無い・送信を断った時は GAS にも送らない');
  {
    const sb = makeEnv(); sb.CFG.url = '';
    t('接続先未設定は AI_NO_PROXY', (await msgOf(sb)) === 'AI_NO_PROXY');
    t('★GAS へも送らない', sb.calls.length === 0);
    const sb2 = makeEnv(); sb2.aiNoticeOk = () => false;
    t('送信の説明で断ったら AI_DECLINED', (await msgOf(sb2)) === 'AI_DECLINED');
    t('★断ったら GAS へも送らない', sb2.calls.length === 0);
  }

  console.log('\n【3】GAS の断りを読み分ける');
  const map = [['ai_no_key', 'AI_NO_KEY'], ['ai_limit', 'AI_LIMIT'], ['ai_bad_request', 'AI_BAD_REQUEST'],
    ['ai_fetch', 'AI_FETCH'], ['ai_busy', 'AI_BUSY'], ['unauthorized', 'AI_PROXY_AUTH'], ['unknown action', 'AI_PROXY_OLD'], ['何か別', 'AI_PROXY']];
  for (const [ge, code] of map) {
    const sb = makeEnv(); sb.resp = { ok: false, error: ge };
    const m = await msgOf(sb);
    t(ge + ' → ' + code, m === code, m);
    const txt = sb.aiErrText(new Error(code));
    t(code + ' の文言は具体的（汎用の「失敗しました」にしない）', code === 'AI_PROXY' || txt.indexOf('AIの呼び出しに失敗しました') < 0, txt);
  }
  {
    const sb = makeEnv(); sb.resp = null;
    t('応答が空なら AI_BAD_JSON', (await msgOf(sb)) === 'AI_BAD_JSON');
    sb.resp = { ok: true, status: 200 };
    t('成功なのに data が無ければ AI_BAD_JSON', (await msgOf(sb)) === 'AI_BAD_JSON');
    sb.resp = new Error('HTTP 500');
    t('GAS まで届かなければ AI_NETWORK', (await msgOf(sb)) === 'AI_NETWORK');
    sb.resp = 'hang';
    t('返事が無ければ AI_TIMEOUT', (await msgOf(sb)) === 'AI_TIMEOUT');
  }

  console.log('\n【4】Anthropic の断りは今までどおり');
  {
    const sb = makeEnv(); sb.resp = { ok: true, status: 429, detail: 'rate' };
    t('429 は AI_HTTP_429', (await msgOf(sb)) === 'AI_HTTP_429');
    sb.resp = { ok: true, status: 401, detail: 'invalid x-api-key' };
    let e1 = null; try { await sb.aiFetch(BODY()); } catch (e) { e1 = e; }
    t('401 は AI_HTTP_401・理由を detail に持つ', e1 && e1.message === 'AI_HTTP_401' && e1.detail === 'invalid x-api-key', e1 && e1.detail);
    t('★401 の文言はサーバーのキーを確かめるよう案内する（端末で入れ直させない）',
      /サーバー/.test(sb.aiErrText(e1)) && !/設定画面でキーを入れ直/.test(sb.aiErrText(e1)), sb.aiErrText(e1));
  }
  {
    const sb = makeEnv();
    sb.resp = (p, n) => (n === 1 ? { ok: true, status: 400, detail: 'does not support the `fallbacks` parameter' }
      : { ok: true, status: 200, data: { content: [] } });
    const body = Object.assign(BODY(), { model: 'claude-opus-5', fallbacks: 'default' });
    const j = await sb.aiFetch(body);
    t('fallbacks の拒否は外して1回だけ送り直す', !!j && sb.calls.length === 2 && !('fallbacks' in sb.calls[1].payload.body), sb.calls.map((c) => Object.keys(c.payload.body)));
    const sb2 = makeEnv(); sb2.resp = { ok: true, status: 400, detail: 'other' };
    t('ほかの 400 は送り直さない', (await msgOf(sb2, Object.assign(BODY(), { fallbacks: 'default' }))) === 'AI_HTTP_400' && sb2.calls.length === 1);
  }

  console.log('\n【5】直すまで同じ結果になる失敗では一括作成を止める');
  {
    const sb = makeEnv();
    ['AI_NO_KEY', 'AI_NO_PROXY', 'AI_LIMIT', 'AI_PROXY_OLD', 'AI_PROXY_AUTH', 'AI_BAD_REQUEST', 'AI_HTTP_401'].forEach((c) =>
      t('★' + c + ' は止める', sb.aiErrFatal(new Error(c)) === true));
    ['AI_FETCH', 'AI_BUSY', 'AI_TIMEOUT', 'AI_HTTP_429', 'AI_HTTP_529', 'AI_NETWORK'].forEach((c) =>
      t(c + ' は一時的なので止めない（やり直しに回す）', sb.aiErrFatal(new Error(c)) === false));
  }

  console.log('\n【6】キーが無い・古い版と分かったら「依頼」として記録する側へ戻す／時間切れはやり直さない');
  {
    const sb = makeEnv(); sb.renderSample = () => { sb.painted = (sb.painted || 0) + 1; }; sb.syncBatchAiVisibility = () => {};
    sb.resp = { ok: false, error: 'ai_no_key' };
    await msgOf(sb);
    t('★キー無しの応答で AI_SRV.key=false にする（次から依頼の側へ）', sb.AI_SRV && sb.AI_SRV.key === false, sb.AI_SRV);
    t('ボタンの表示を取り直す', sb.painted === 1, sb.painted);
    t('★aiReady はサーバーのキー無しを見る', /function aiReady\(\)[^\n]*AI_SRV\.key === false/.test(src));
    t('★一括作成は時間切れをやり直さない（二重に払わない）', /var again = \/AI_HTTP_\(429\|500\|502\|503\|529\)\/\.test\(m\);/.test(src));
    t('★待ち時間は 150 秒（GAS 起動・ロック待ち・応答の合計を待つ）', /var AI_TIMEOUT_MS = 150000;/.test(src));
    t('★起動時の ping の後でも AI のボタン表示を取り直す', /noteAiSrv\(j\);\s*\/\*[^*]*\*\/\s*try \{ syncBatchAiVisibility\(\); renderSample\(\);/.test(src));
    t('★キーが無いと分かった時の案内は理由を言う', /function aiUnreadyWhy\(\)[\s\S]*?AI_SRV\.key === false\) return 'サーバー/.test(src));
    t('接続設定の保存で AI のボタン表示も取り直す', /refreshAll\(\)\.then\(function \(\) \{ renderSettings\(\); try \{ renderSample\(\); syncBatchAiVisibility\(\);/.test(src));
  }

  console.log('\n【7】入居者マスタの薬効の下書きも中継を使う（RM_HTML で差し替え可）');
  {
    const RM = process.env.RM_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
    const rsrc = fs.readFileSync(RM, 'utf8');
    const cutR = (name) => { const h = rsrc.indexOf('function ' + name + '('); let d = 0, i = rsrc.indexOf('{', h);
      for (; i < rsrc.length; i++) { if (rsrc[i] === '{') d++; else if (rsrc[i] === '}') { d--; if (d === 0) return rsrc.slice(h, i + 1); } } };
    const store = { tp_cfg: JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', token: 'tok-test' }), tp_ai_key: 'sk-ant-OLD' };
    const sent = [];
    let reply = { ok: true, status: 200, data: { content: [{ type: 'text', text: '[{"name":"アムロジピン","effect":"高血圧"}]' }] } };
    const rb = { localStorage: { getItem: (k) => (k in store ? store[k] : null) },
      fetch: (url, opt) => { sent.push({ url: url, opt: opt }); return Promise.resolve({ ok: true, json: () => Promise.resolve(reply) }); },
      mdKey: (x) => String(x || '').trim(), MD_AI_MODEL: 'claude-sonnet-5', MD_AI_MAXTOK: 8000, MD_AI_TIMEOUT: 500,
      Promise, JSON, Object, String, Number, Error, setTimeout, clearTimeout };
    vm.createContext(rb);
    vm.runInContext(cutR('mdAiCfg') + '\n' + cutR('mdAiAsk') + '\n' + cutR('mdAiParse'), rb);
    const o = await rb.mdAiAsk(['アムロジピン']);
    t('中継の応答から薬効を読める', o['アムロジピン'] === '高血圧', o);
    t('★送り先は訓練計画の専用GAS（tp_cfg）', sent[0].url === 'https://script.google.com/macros/s/TEST/exec');
    const bodyR = JSON.parse(sent[0].opt.body);
    t('★action:"ai" と合言葉を本文で送る', bodyR.action === 'ai' && bodyR.token === 'tok-test' && bodyR.body.max_tokens === 8000, bodyR.action);
    t('★古いキー（tp_ai_key）を読まない・送らない', sent[0].opt.body.indexOf('sk-ant') < 0 && !('x-api-key' in (sent[0].opt.headers || {})));
    t('★Anthropic へ直接送らない', rsrc.indexOf('api.anthropic.com') < 0 && rsrc.indexOf("getItem('tp_ai_key')") < 0);
    reply = { ok: false, error: 'ai_no_key' };
    let em = ''; try { await rb.mdAiAsk(['x']); } catch (e) { em = e.message; }
    t('キー無しは AI_NO_KEY', em === 'AI_NO_KEY', em);
    delete store.tp_cfg;
    em = ''; try { await rb.mdAiAsk(['x']); } catch (e) { em = e.message; }
    t('★接続先の無い端末は AI_NO_PROXY（送らない）', em === 'AI_NO_PROXY' && sent.length === 2, em);
    t('★設定や版の問題・時間切れは割って尋ね直さずに止める（二重に払わない）', /AI_NO_KEY\|AI_NO_PROXY\|AI_LIMIT\|AI_PROXY_OLD\|AI_PROXY_AUTH\|AI_BAD_REQUEST\|AI_TIMEOUT\)\$\/\.test/.test(rsrc));
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  console.log('対象: ' + HTML);
  process.exit(fail ? 1 : 0);
})();
