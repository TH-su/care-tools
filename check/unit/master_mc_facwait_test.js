/* 入居者マスタ画面（resident-master.html）の薬の変更候補で、施設情報（su-facility.js）が読めてから候補を作る（mcFacReady_）ことの試験（2026-10-11）。
   デイの見分け（mcIsDayFacility_）は通所の名前・別名で行うため、読む前に候補を作ると、事業所欄が通所の名前だけの行をデイとして外せない。
   ★読み込みが止まっても候補を出せなくしないよう、決めた時間で待つのをやめる。
   実行: node check/unit/master_mc_facwait_test.js（MASTER_HTML で別の resident-master.html を当てられる） */
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
/* 試験では待ちの上限を短くする（本物の値は下で別に確かめる） */
function load(F, waitMs) {
  const sb = { Promise, setTimeout, window: F ? { SUFacility: F } : {}, MC_FAC_WAIT_MS: waitMs };
  if (F) sb.SUFacility = F;
  vm.createContext(sb); vm.runInContext(cut('mcFacReady_'), sb);
  return sb;
}
/* 決まった時間の中で約束が済んだか */
function settledWithin(p, ms) { return Promise.race([p.then(() => true), new Promise(r => setTimeout(() => r(false), ms))]); }

(async () => {
  console.log('\n— 1. 待ち方 —');
  {
    let cb = null;
    const F = { onReady: fn => { cb = fn; } };
    const p = load(F, 5000).mcFacReady_();
    t('★施設情報がまだ読めていない間は進まない', !(await settledWithin(p, 50)));
    cb();
    t('★読めた（読めないと分かった）知らせで進む', await settledWithin(p, 50));
  }
  {
    const F = { onReady: () => {} };   // 知らせが来ない（読み込みが止まった）
    const p = load(F, 80).mcFacReady_();
    t('★知らせが来なくても、上限の時間で待つのをやめる（候補を出せなくしない）', await settledWithin(p, 400));
  }
  {
    const F = { onReady: fn => fn() };   // 読み終わった後は直ちに呼ばれる
    t('読み終わった後なら直ちに進む', await settledWithin(load(F, 5000).mcFacReady_(), 50));
  }
  t('su-facility.js が無い画面でも直ちに進む', await settledWithin(load(null, 5000).mcFacReady_(), 50));
  {
    const F = { onReady: () => { throw new Error('x'); } };
    t('知らせの登録で例外が出ても止まらない', await settledWithin(load(F, 5000).mcFacReady_(), 50));
  }
  {
    let cb = null, n = 0;
    const F = { onReady: fn => { cb = fn; } };
    const p = load(F, 60).mcFacReady_().then(() => { n++; });
    await settledWithin(p, 300); cb(); await new Promise(r => setTimeout(r, 20));
    t('上限の後に知らせが来ても、進むのは1回だけ', n === 1, n);
  }

  console.log('\n— 2. 候補の組み立てで使われている —');
  const L = cut('mcLoad_');
  t('★mcLoad_ は申送・判断の一覧と一緒に施設情報を待ってから候補を作る', /Promise\.all\(\[pList,pEv,mcFacReady_\(\)\]\)/.test(L));
  t('候補は r[1]（申送）から作る（並びを変えていない）', /mcBuild_\(r\[1\]\.d\)/.test(L));
  const m = /var MC_FAC_WAIT_MS=(\d+);/.exec(src);
  t('待ちの上限は 10 秒', m && Number(m[1]) === 10000, m && m[1]);

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
