/* 担当者会議の記録（care-meeting.html）：接続先の無い端末でも、ログインして入居者マスタの新しい保存先で使える時は開く（2026-11-16）
   実行: node check/unit/care_meeting_live_test.js
   やり方: 画面のスクリプトから cmProbeLive_・startApp_・openStart_ を切り出し、ほかは偽物で vm で動かす。
   確かめること:
     1. 接続先があれば確かめずにそのまま開く（今までどおり）
     2. 接続先が無く、SUResRead.liveReady が true なら開き、接続先の案内の帯を止める（SUCfgHint.quiet）
     3. liveReady が false・失敗・部品が無い時は「接続先を入れてください」の案内（今までどおり）
     4. 現場の端末では確かめずに案内（今までどおり）・確かめている間に現場へ変わったら開かない
     6. 途中で Google に戻った時（NO_URL）は、英語を出さず、保存は「届いたか分からない」にせず送っていないと出す
     5. 過去の記録の取り込み（impGate_・impScan_）は今までどおり接続先がある時だけ
   ★出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'care-meeting.html'), 'utf8');
let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok) { if (ok) { pass++; say('  ✓ ' + name); } else { fail++; say('  ✗ ' + name); } }
function cutF(src, name) {
  const h = src.indexOf('\nfunction ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h + 1, i + 1); } }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
const CODE = ['cmProbeLive_', 'startApp_', 'openStart_'].map((n) => cutF(HTML, n)).join('\n');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

function make(opt) {
  const log = [];
  const ctx = {
    log, role: opt.role || 'office',
    window: {}, Promise,
    readCfg_: () => ({ url: opt.url || '', token: opt.url ? 'x' : '' }),
    CFG: { url: '', token: '' },
    definePrint_: () => {}, bindEvents_: () => {},
    isField: () => ctx.role === 'field',
    setSync: (s) => log.push('sync:' + s),
    showGate_: (k) => log.push('gate:' + k),
    readMasterIdParam_: () => ({ id: '', bad: false }),
    openPerson_: () => log.push('person'),
    showPicker_: () => log.push('picker'),
    toast: () => {}
  };
  if (opt.live !== undefined) {
    ctx.window.SUResRead = { liveReady: () => { log.push('probe'); if (opt.onProbe) opt.onProbe(ctx); return opt.live === 'throw' ? Promise.reject(new Error('x')) : Promise.resolve(opt.live); } };
  }
  ctx.window.SUCfgHint = { quiet: () => log.push('quiet') };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}
(async () => {
  say('担当者会議の記録：ログインだけで開く');
  let c = make({ url: 'https://script.google.com/macros/s/KAKUU/exec', live: true });
  c.startApp_(); await settle();
  t('1 接続先があれば確かめずに開く', c.log.join(',') === 'picker');
  c = make({ live: true }); c.startApp_(); await settle();
  t('2 接続先なし・使える時は開いて帯を止める', c.log.includes('probe') && c.log.includes('quiet') && c.log.includes('picker') && !c.log.some((x) => /^gate/.test(x)));
  for (const v of [false, 'throw', 'yes']) {
    c = make({ live: v }); c.startApp_(); await settle();
    t('3 liveReady=' + v + ' は案内', c.log.includes('gate:nocfg') && !c.log.includes('picker') && !c.log.includes('quiet'));
  }
  c = make({}); c.startApp_(); await settle();
  t('3 部品が無い時は案内', c.log.includes('gate:nocfg') && !c.log.includes('picker'));
  c = make({ live: true, role: 'field' }); c.startApp_(); await settle();
  t('4 現場の端末は確かめずに案内', !c.log.includes('probe') && c.log.includes('gate:nocfg'));
  c = make({ live: true, onProbe: (x) => { x.role = 'field'; } }); c.startApp_(); await settle();
  t('4 確かめている間に現場へ変わったら開かない', !c.log.includes('picker') && !c.log.includes('person'));
  t('5 取り込みの入口は接続先がある時だけ', /function impGate_\(\)\{[\s\S]*?\|\|!CFG\.url\|\|/.test(HTML) && /function impScan_\(\)\{\s*if\(!impAdmin\|\|isField\(\)\|\|!CFG\.url\)/.test(HTML));
  t('5 画面は su-res-read.js を読む', /<script src="su-res-read\.js\?v=/.test(HTML));
  /* 6 */
  t('6 読めない理由は cmExMsg_ を通す（3か所）', (HTML.match(/読めませんでした（'\+cmExMsg_\(/g) || []).length === 3 && !/読めませんでした（'\+String\(/.test(HTML));
  const w = vm.createContext({});
  vm.runInContext(cutF(HTML, 'cmExMsg_'), w);
  t('6 NO_URL は職員向けの語', /^接続先が入っていません/.test(w.cmExMsg_(new Error('NO_URL'))) && !/NO_URL/.test(w.cmExMsg_(new Error('NO_URL'))));
  t('6 ほかの理由は今までどおり', w.cmExMsg_(new Error('タイムアウト')) === 'タイムアウト' && w.cmExMsg_('x') === 'x');
  const wo = cutF(HTML, 'writeOp_');
  const iNo = wo.indexOf("==='NO_URL'"), iUn = wo.indexOf("if(r.err) return unsure_(");
  t('6 保存の NO_URL は確かめの道（unsure_）より先に止める', iNo > 0 && iUn > iNo && /何も送っていません/.test(wo));
  say(`\n成功 ${pass}・失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
