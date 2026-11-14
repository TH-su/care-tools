/* 「未送信の一覧」への入口の試験（2026-11-14 代表者「推奨どおり」・文は仮置き）
   実行: node check/unit/unsent_entry_test.js
   守ること:
     1. 消耗品管理: 送信待ちの出庫の文（mvPending）の隣に「未送信の一覧を見る」があり、行き先は unsent.html（同じタブ・target なし）。
        初めは隠れていて、送信待ちがある時だけ出る（updatePendingLabel を切り出して動かす）
     2. 入居調整: 同期の窓の「状態」で、未送信の変更がある時だけ unsent.html へのリンクを出す
     3. 使い方: 送信待ちを持つ6画面の節（週間計画・体重管理・家族構成図・貼り薬カレンダー・入居調整・消耗品管理）に、未送信の一覧への案内が1つずつある
   画面のコードは書き換えず、ソースを読んで切り出して動かすだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const raw = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function fnSrc(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return '';
}

/* 1 消耗品管理 */
const sp = raw('supplies.html');
const link = (sp.match(/<a [^>]*id="mvPendingList"[^>]*>([^<]*)<\/a>/) || []);
t('消耗品管理: 入口がある', !!link[0], null);
t('消耗品管理: 文は「未送信の一覧を見る」', link[1] === '未送信の一覧を見る', link[1]);
t('消耗品管理: 行き先は unsent.html・同じタブ', /href="unsent\.html"/.test(link[0] || '') && !/target=/.test(link[0] || ''), link[0]);
t('消耗品管理: 初めは隠れている', /\shidden[\s>]/.test(link[0] || ''), link[0]);
t('消耗品管理: 入口は送信待ちの文の隣', /id="mvPending"><\/span>\s*<a [^>]*id="mvPendingList"/.test(sp));
const fn = fnSrc(sp, 'updatePendingLabel');
t('消耗品管理: updatePendingLabel を切り出せる', !!fn);
function runLabel(n) {
  const els = { mvPending: { textContent: '' }, mvPendingList: { hidden: true } };
  const ctx = { $: (id) => els[id], readPending: () => new Array(n).fill({ id: 'x' }) };
  vm.runInNewContext(fn + '\nupdatePendingLabel();', ctx);
  return els;
}
let e0 = runLabel(0), e2 = runLabel(2);
t('消耗品管理: 送信待ち0件の時は入口を隠す', e0.mvPendingList.hidden === true && e0.mvPending.textContent === '');
t('消耗品管理: 送信待ちがある時は入口を出す', e2.mvPendingList.hidden === false && /未送信の出庫 2件/.test(e2.mvPending.textContent));
t('消耗品管理: 送り終えたらまた隠す', (function () {
  const els = { mvPending: { textContent: 'x' }, mvPendingList: { hidden: false } };
  vm.runInNewContext(fn + '\nupdatePendingLabel();', { $: (id) => els[id], readPending: () => [] });
  return els.mvPendingList.hidden === true;
})());

/* 2 入居調整 */
const af = raw('admission-flow.html');
const rs = fnSrc(af, 'renderSyncModal');
t('入居調整: 同期の窓の状態に、未送信がある時だけ一覧へのリンク',
  /\(dirty \? '（未送信の変更あり・<a href="unsent\.html">未送信の一覧<\/a>）' : ''\)/.test(rs));

/* 3 使い方 */
const hp = raw('help.html');
['care-schedule', 'weight-record', 'genogram', 'patch-calendar', 'admission-flow', 'supplies'].forEach(function (s) {
  const i = hp.indexOf('id="sec-' + s + '"');
  const sec = i < 0 ? '' : hp.slice(i, hp.indexOf('</section>', i));
  const n = (sec.match(/<a href="unsent\.html">未送信の一覧<\/a>/g) || []).length;
  t('使い方 ' + s + ': 未送信の一覧への案内が1つ', n === 1, n);
});

/* 4 離れる時の確かめ（反証レビュー 2026-11-14）: 消耗品管理の入口も「← メニュー」と同じ判定で聞き、beforeunload の印を共有する */
const guard = sp.match(/closest\('a#mvPendingList'\)[\s\S]{0,600}?\}\);/);
t('消耗品管理: 入口を押した時に保存していない入力を確かめる', !!guard && /supUnsaved\(\)/.test(guard[0]) && /SUP_LEAVE_OK = true/.test(guard[0]) && /e\.preventDefault\(\)/.test(guard[0]));
/* 5 家族構成図は開いただけでは送らない（unsent-calc.js の文とそろえる） */
const gi = hp.indexOf('id="sec-genogram"');
const gsec = hp.slice(gi, hp.indexOf('</section>', gi));
t('使い方 genogram: ［↻ 同期］で送ると書き、「この画面が行います」と書かない', /↻ 同期/.test(gsec) && /開いただけでは送りません/.test(gsec) && !/送り直しはこの画面が行います/.test(gsec));

console.log('\n' + pass + ' 合格 / ' + fail + ' 不合格');
process.exit(fail ? 1 : 0);
