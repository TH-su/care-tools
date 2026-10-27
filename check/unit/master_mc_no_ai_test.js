/* 入居者マスタ画面（resident-master.html）の薬の変更候補で、外部の AI へ何も送らないことの試験（2026-10-27）。
   代表者の決定 2026-10-27: 薬の変更候補の AI の下書きは止める。外部 AI へ処方（今の定期薬）を送らない。
   守りたいこと:
     A 変更候補の区間に、AI の中継（mdAiProxy_・mdAiAsk・action:'ai'）を呼ぶ所が無い。旧 AI の処理（mcAiAsk_ ほか）も無い
     B 画面の AI の中継を呼ぶのは薬効の下書き（mdAiAsk・薬剤名だけ）だけ
     C 案内の文言が決定どおり（「定期薬と記録は外部の AI へ送りません。直し案は手で書きます。」）で、AI のボタンが無い
     D 本物の変更候補の流れ（開く→候補を選ぶ→直し案→各ボタンを押す）を動かしても、AI の中継が1回も呼ばれない
   実行: node check/unit/master_mc_no_ai_test.js（MASTER_HTML で別の resident-master.html を当てられる）
   架空データのみ。実在の入居者は登場しない。 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('unbalanced: ' + name);
}
const s0 = src.indexOf('/* ═══════════ 薬の変更候補'), s1 = src.indexOf('/* ═══════════ 薬情の取り込み');
if (s0 < 0 || s1 < 0 || s1 < s0) throw new Error('薬の変更候補の区間の目印が見つかりません');
const MC = src.slice(s0, s1);

console.log('\n— A. 変更候補の区間に AI の中継を呼ぶ所が無い —');
{
  t('★mdAiProxy_ を呼ばない', MC.indexOf('mdAiProxy_(') < 0);
  t('★mdAiAsk を呼ばない', MC.indexOf('mdAiAsk(') < 0);
  t('★action:\'ai\' を組まない', !/action\s*:\s*['"]ai['"]/.test(MC));
  t('★fetch を直接呼ばない（送るのは入居者マスタGAS の medCand・getResident だけ）', !/\bfetch\(/.test(MC));
  t('★旧 AI の処理（mcAiAsk_・mcAiRun_・mcAiParse_・mcKeepLines_・mcMask_）が画面に無い',
    !/function mc(AiAsk_|AiRun_|AiParse_|KeepLines_|Mask_)\(/.test(src));
  const j0 = src.indexOf('MC-JUDGE-BEGIN'), j1 = src.indexOf('MC-JUDGE-END');
  t('判定の区間（MC-JUDGE）は残っていて、AI を呼ばない', j0 > 0 && j1 > j0 && src.slice(j0, j1).indexOf('mdAiProxy_') < 0);
}

console.log('\n— B. AI の中継を呼ぶのは薬効の下書きだけ —');
{
  const ask = cut('mdAiAsk');
  const def = src.indexOf('function mdAiProxy_(');
  const calls = [];
  let i = -1;
  while ((i = src.indexOf('mdAiProxy_(', i + 1)) >= 0) if (i !== def + 'function '.length) calls.push(i);
  const askAt = src.indexOf(ask);
  t('★mdAiProxy_ を呼ぶのは mdAiAsk の中の1か所だけ', calls.length === 1 && calls[0] > askAt && calls[0] < askAt + ask.length, calls.length);
  t('薬効の下書きが送るのは薬剤名の並び（names）だけ', /names\.join\('\\n'\)/.test(ask) && !/medsRegular|mcCur|before/.test(ask));
}

console.log('\n— C. 文言とボタン —');
{
  t('★案内の文言が決定どおり', src.indexOf('定期薬と記録は外部の AI へ送りません。直し案は手で書きます。</p>') > 0);
  t('★「AI に送るのは今の定期薬…」の案内が残っていない', src.indexOf('AI に送るのは今の定期薬') < 0);
  t('★「🤖 AIで直し案を作る」のボタンが無い', src.indexOf('AIで直し案を作る') < 0 && !/id=\\?"mcAi\\?"/.test(src));
  t('AI 要約（参考）の見出しは残している（サーバーで作った要約を出すだけ）', MC.indexOf('AI 要約（参考・他の方の内容が混ざることがあります）') > 0);
}

console.log('\n— D. 変更候補の流れを動かしても AI の中継を呼ばない —');
(async () => {
  const net = [];   /* 外へ出た全部の呼び出し {via, body} */
  const els = {};
  function el(id) {
    if (!els[id]) {
      const h = {};
      els[id] = { id, value: '', disabled: false, innerHTML: '', textContent: '', checked: false, style: {}, hidden: false,
        classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; }, contains(c) { return !!this._s[c]; } },
        addEventListener(type, fn) { (h[type] = h[type] || []).push(fn); }, _h: h,
        focus() {}, querySelectorAll() { return []; }, getAttribute() { return null; } };
    }
    return els[id];
  }
  const REC = { id: '101', name: '架空 一郎', medsRegular: '架空薬A 5mg 1錠 朝食後\n架空薬B 10mg 1錠 夕食後', medsHistory: [] };
  const sb = {
    console, Promise, JSON, Object, String, Number, Array, RegExp, Error, Math, Date, setTimeout, clearTimeout,
    window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
    document: { activeElement: null, contains: () => false },
    $: el, esc: s => String(s == null ? '' : s), fmtJDate: s => String(s || ''), mhAt_: s => String(s || ''),
    getDeviceRole: () => 'office', navEnter() {}, navLeave() {}, toast() {}, confirm: () => true,
    devGen: 0, fullMap: {}, curResident: null, refreshRoster() {}, openResident() {},
    roster: [{ id: '101', name: '架空 一郎', room: '201', active: true }],
    fetch: (url, opt) => { net.push({ via: 'fetch', body: String(opt && opt.body || '') }); return Promise.reject(new Error('NO_NET')); },
    apiGetRetry: (b) => { net.push({ via: 'apiGetRetry', body: JSON.stringify(b) }); return Promise.resolve({ record: REC }); },
    apiPostRaw: (b) => { net.push({ via: 'apiPostRaw', body: JSON.stringify(b) }); return Promise.resolve({ ok: true }); },
    apiGet: (b) => { net.push({ via: 'apiGet', body: JSON.stringify(b) }); return Promise.reject(new Error('NO_NET')); },
    mdAiProxy_: (b) => { net.push({ via: 'mdAiProxy_', body: JSON.stringify(b) }); return Promise.reject(new Error('AI_NO_PROXY')); },
    mdAiAsk: (n) => { net.push({ via: 'mdAiAsk', body: JSON.stringify(n) }); return Promise.reject(new Error('AI_NO_PROXY')); }
  };
  vm.createContext(sb);
  vm.runInContext(MC, sb, { filename: '薬の変更候補(取り出し)' });
  const flush = () => new Promise(r => setImmediate(r));
  const C = { id: '101', name: '架空 一郎', room: '201', srcKey: 'S|101|2026-10-08|0a1b2c3d', srcDate: '2026-10-08',
    rawKey: '2026-10-08|架空一郎', text: '架空薬A 5mg 中止、架空薬C 2mg 1錠 朝食後 開始', shift: '日勤', time: '10:00', sums: [], many: 1 };
  sb.mcSt = { cands: [C], others: [], decided: {}, server: 'ok', raw: { '2026-10-08|架空一郎': [{ body: C.text, shift: '日勤', time: '10:00' }] }, by: 'admin' };
  const click = (id, item) => {
    const target = { id: id || '', closest: (sel) => (item && sel === '.mc-item') ? { getAttribute: () => C.srcKey } : null };
    (el('mMedCand')._h.click || []).forEach(fn => fn({ target }));
  };
  sb.mcWire_();
  sb.mcOpen_('');
  click('', true);                       /* 候補を選ぶ（今の定期薬を読む） */
  await flush(); await flush();
  const work = el('mcWork').innerHTML;
  t('候補を開くと今の定期薬を読み、直し案の欄を出す', /id="mcAfter"/.test(work) && !!sb.mcCur && sb.mcCur.loaded === true, sb.mcCur && sb.mcCur.msg);
  t('★開いた候補の画面に AI のボタンが無い', !/mcAi"/.test(work) && work.indexOf('AIで直し案') < 0);
  /* 人が直し案を書く */
  sb.mcCur.after = '架空薬B 10mg 1錠 夕食後\n架空薬C 2mg 1錠 朝食後'; sb.mcCur.edited = true;
  click('mcAi');                         /* 古い画面のボタンの id を押されても何もしない */
  await flush();
  /* 「反映しない」を選んで残す */
  el('mcNoteSel').value = '定期薬の変更ではない';
  click('mcSkip'); await flush(); await flush();
  /* もう一度開いて、直し案で「反映する」 */
  sb.mcSt.cands = [C]; sb.mcCur = null; click('', true); await flush(); await flush();
  sb.mcCur.after = '架空薬B 10mg 1錠 夕食後\n架空薬C 2mg 1錠 朝食後'; sb.mcCur.edited = true;
  click('mcApply'); await flush(); await flush();
  click('mcReload'); await flush(); await flush();
  const ai = net.filter(n => n.via === 'mdAiProxy_' || n.via === 'mdAiAsk' || /"action":"ai"/.test(n.body));
  t('★流れの中で AI の中継（mdAiProxy_・mdAiAsk・action:"ai"）が1回も呼ばれない', ai.length === 0, ai.map(n => n.via));
  t('流れは本当に動いた（今の定期薬の読み込みと、入居者マスタGAS への判断・反映を送った）',
    net.some(n => n.via === 'apiGetRetry') && net.some(n => n.via === 'apiPostRaw' && /"op":"apply"/.test(n.body)) &&
    net.some(n => n.via === 'apiPostRaw' && /"op":"decide"/.test(n.body)), net.map(n => n.via));
  t('★今の定期薬は入居者マスタGAS（medCand）にだけ送る',
    net.filter(n => n.body.indexOf('架空薬A') >= 0).every(n => n.via === 'apiPostRaw' && /"action":"medCand"/.test(n.body)), net.map(n => n.via));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  console.log('対象: ' + HTML);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
