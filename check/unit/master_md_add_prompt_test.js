/* 入居者マスタ：薬効辞書の「足す」の2つの入力を、ブラウザの prompt から画面の中の窓（SUDialog.prompt）にする（2026-11-14 第6段 RM-01）の試験。
 * 架空の薬剤名だけで動かす（通信しない・端末に書かない）。
 * 確かめること: 文は一字一句そのまま・2つ目の初めの値は空／キャンセル（null）で何もしない／答えを待つ間に表示・辞書・端末の用途の世代が変わったら何もしない／
 *   重なりの判定と足す順番は今までどおり／ブラウザの prompt を直接呼ばない／読めない時の受け口に prompt がある
 * 実行: node check/unit/master_md_add_prompt_test.js */
'use strict';
const path = require('path');
const vm = require('vm');
const { readMaster } = require('../master-page.cjs');
const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = readMaster(HTML);

function grabFn(name){
  let start = src.indexOf('\nfunction ' + name + '(');
  if(start < 0) start = src.indexOf('\nasync function ' + name + '(');
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

let ok = 0, ng = 0;
function t(name, cond, extra){ if(cond){ ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } }

const FN = grabFn('mdAddDrug');
const Q1 = '足す薬剤名を入れてください（用量は付けても構いません。末尾の用量は自動で外します）';

/* answers: 順に返す答え。hook: 窓の答えを返す直前に呼ぶ（待つ間の変化を作る） */
function makeCtx(answers, hook){
  const asked = [], toasts = [];
  let renders = 0;
  const c = {
    curView: 'md', mdDict: [{ name: 'アルファ錠' }], mdMap: Object.create(null), mdGen: 3,
    mdNew: [], mdEdits: {}, mdDirty: false,
    asked, toasts,
    $: () => ({ disabled: true }),
    toast: (m, good) => toasts.push([m, good]),
    renderRoster: () => { renders++; },
    renders: () => renders,
    mdDrugName: (s) => String(s || '').trim().replace(/\s*\d+(\.\d+)?\s*(mg|g)$/i, ''),
    mdCollect: () => [{ name: 'アルファ錠', n: 1 }],
    mdIsHidden: () => false,
    SUDialog: { prompt: (m, d) => { asked.push([m, d]); const i = asked.length - 1; if(hook) hook(c, i); return Promise.resolve(answers[i]); } },
    prompt: () => { throw new Error('ブラウザの prompt を呼んだ'); }
  };
  c.mdMap['アルファ錠'] = { effect: '', hidden: false };
  vm.createContext(c);
  vm.runInContext(FN, c);
  return c;
}

(async () => {
  console.log('入居者マスタ 薬効辞書の「足す」（mdAddDrug）');
  t('ブラウザの prompt を直接呼ばない（SUDialog.prompt を await する）', !/(^|[^.\w])prompt\(/.test(FN.replace(/\/\*[\s\S]*?\*\//g, '')) && (FN.match(/await SUDialog\.prompt\(/g) || []).length === 2);
  {
    const c = makeCtx(['ベータ錠 5mg', '血圧']);
    await c.mdAddDrug();
    t('1つ目の文は一字一句そのまま・初めの値は無し', c.asked[0][0] === Q1 && c.asked[0][1] === undefined, c.asked[0]);
    t('2つ目の文は一字一句そのまま（用量を外した名前）・初めの値は空', c.asked[1][0] === '「ベータ錠」の効能（8文字以内が目安・後から直せます）' && c.asked[1][1] === '', c.asked[1]);
    t('2つ答えると足す（効能・未確認・未保存の印・描き直し・知らせ）', c.mdNew.join() === 'ベータ錠' && c.mdEdits['ベータ錠'].effect === '血圧' && c.mdEdits['ベータ錠'].ok === false
      && c.mdDirty === true && c.renders() === 1 && /「ベータ錠」を足しました/.test(c.toasts[0][0]), { n: c.mdNew, e: c.mdEdits, t: c.toasts });
  }
  {
    const c = makeCtx([null]);
    await c.mdAddDrug();
    t('1つ目をキャンセル（null）すると何もしない（2つ目を聞かない）', c.asked.length === 1 && c.mdNew.length === 0 && c.toasts.length === 0);
    const c2 = makeCtx(['ベータ錠', null]);
    await c2.mdAddDrug();
    t('2つ目をキャンセル（null）すると足さない', c2.asked.length === 2 && c2.mdNew.length === 0 && c2.mdDirty === false && c2.renders() === 0);
    const c3 = makeCtx(['ベータ錠', '']);
    await c3.mdAddDrug();
    t('2つ目を空のまま OK（空の文字）なら、効能は空で足す（今までどおり）', c3.mdNew.join() === 'ベータ錠' && c3.mdEdits['ベータ錠'].effect === '');
  }
  {
    const c = makeCtx(['アルファ錠']);
    await c.mdAddDrug();
    t('一覧にある名前は今までどおり足さずに知らせる（2つ目を聞かない）', c.asked.length === 1 && c.mdNew.length === 0 && /既に一覧にあります/.test(c.toasts[0][0]));
    const c2 = makeCtx(['  ']);
    await c2.mdAddDrug();
    t('名前が読み取れない時は今までどおり知らせる', c2.asked.length === 1 && /読み取れませんでした/.test(c2.toasts[0][0]));
  }
  {
    /* 待つ間の変化: 1つ目・2つ目のそれぞれで */
    const cases = [
      ['表示が変わった', (c) => { c.curView = 'list'; }],
      ['辞書が取り直された（別の物）', (c) => { c.mdDict = [{ name: 'アルファ錠' }]; }],
      ['辞書が無くなった', (c) => { c.mdDict = null; }],
      ['端末の用途が変わった（世代が進んだ）', (c) => { c.mdGen++; }]
    ];
    for(const [label, fn] of cases){
      const c1 = makeCtx(['ベータ錠', '血圧'], (c, i) => { if(i === 0) fn(c); });
      await c1.mdAddDrug();
      t('1つ目の窓の間に' + label + '時は何もしない（2つ目を聞かない・知らせない）', c1.asked.length === 1 && c1.mdNew.length === 0 && c1.toasts.length === 0 && c1.renders() === 0);
      const c2 = makeCtx(['ベータ錠', '血圧'], (c, i) => { if(i === 1) fn(c); });
      await c2.mdAddDrug();
      t('2つ目の窓の間に' + label + '時は何もしない（足さない）', c2.asked.length === 2 && c2.mdNew.length === 0 && c2.mdDirty === false && c2.toasts.length === 0 && c2.renders() === 0);
    }
  }
  {
    const c = makeCtx([]); c.mdDict = null;
    await c.mdAddDrug();
    t('辞書が取れていない間は今までどおり窓を出さずに断る', c.asked.length === 0 && /追加できません/.test(c.toasts[0][0]));
  }
  t('読めない時の受け口（resident-master.html）に prompt がある（ブラウザの prompt に落とし、約束で答える）',
    /prompt: function\(m, d\)\{ var r = null; try\{ r = window\.prompt\(m, d == null \? '' : String\(d\)\); \}catch\(_\)\{\} return Promise\.resolve\(r == null \? null : String\(r\)\); \},/.test(src));
  console.log('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
})().catch((e) => { console.log('  ✗ 試験の途中で例外 ' + (e && e.stack)); process.exit(1); });
