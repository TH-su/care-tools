/* 勤怠管理の2画面（kintai.html・kintai-clock.html）の入口と端末に残すものの試験（2026-11-18 新設・差分審査の指摘4）
   実行: node check/unit/kintai_page_test.js
   守りたいこと:
     1. 管理画面は「現場端末の止め → SUAppGate.run('kintai') → 読み込み」の順（CLAUDE.md §2-5・§2-7）。部品が無ければ開かない
     2. 打刻画面は SUAppGate.run('kintai-clock') を通ってから動く
     3. 打刻の控え（kintai_clock_queue）に入るのは 番号・種類・控えの番号・端末の時刻 だけ（名前を端末に残さない）
     4. 打刻の送信は打ち切りがあり、打ち切った時は控えに回す。送信中は最初の画面へ戻さない
     5. 管理画面が端末に残すのは UI の状態（kintai_tab・kintai_ym）だけ。読み戻しはホワイトリストで確かめる
     6. 両画面とも Cache-Control: no-store・インラインのスクリプトを持たない */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const K = read('kintai.js'), KC = read('kintai-clock.js'), H = read('kintai.html'), HC = read('kintai-clock.html');

console.log('\n— 1. 管理画面の入口 —');
const boot = K.slice(K.indexOf('function boot()'), K.indexOf('var go = function'));
const iField = boot.indexOf('isField()'), iGate = boot.indexOf("SUAppGate.run('kintai'"), iLoad = boot.indexOf('load(true)');
t('boot は 現場端末の止め → 門番 → 読み込み の順', iField >= 0 && iGate > iField && iLoad > iGate, [iField, iGate, iLoad]);
t('門番の部品が無ければ開かない', /if \(!window\.SUAppGate \|\| !C\)/.test(boot));
t('門番が開けないと言えば何も読まない（ok でなければ return）', /if \(!ok\) \{ view = 'gate'; return; \}/.test(boot));
t('門番の APPS に kintai（現場は既定で開けない）と kintai-clock（現場も開ける）', /key: 'kintai', href: 'kintai\.html'[^}]*def: \{ office: true, field: false \}/.test(read('su-app-gate.js')) && /key: 'kintai-clock', href: 'kintai-clock\.html'[^}]*def: \{ office: true, field: true \}/.test(read('su-app-gate.js')));

console.log('\n— 2. 打刻画面の入口 —');
const cboot = KC.slice(KC.indexOf('function boot()'));
t("SUAppGate.run('kintai-clock') を通ってから動く（bind・flush は門番の後）", cboot.indexOf("SUAppGate.run('kintai-clock'") >= 0 && cboot.indexOf('bind()') > cboot.indexOf("SUAppGate.run('kintai-clock'") && cboot.indexOf('flush()') > cboot.indexOf("SUAppGate.run('kintai-clock'"));

console.log('\n— 3. 打刻の控え —');
const m = /var my = \+\+gen, item = (\{[^}]*\})/.exec(KC);
t('控えの形は code・kind・id・at だけ', !!m && JSON.stringify(m[1].match(/(\w+):/g)) === JSON.stringify(['code:', 'kind:', 'id:', 'at:']), m && m[1]);
t('控えを読む時も形を確かめる（壊れた控えを送らない）', /function okItem\(x\) \{ return x && KintaiCalc\.isCode\(x\.code\)/.test(KC));
t('送れなかった控えに足すのは理由だけ（名前を足さない）', /f\.push\(\{ code: it\.code, kind: it\.kind, id: it\.id, at: it\.at, why: why \}\)/.test(KC));
t('localStorage に書くのは控えの2つの鍵だけ', (KC.match(/localStorage\.setItem\(/g) || []).length === 1 && /localStorage\.setItem\(key, JSON\.stringify\(list\)\)/.test(KC) && /Q_KEY = 'kintai_clock_queue', F_KEY = 'kintai_clock_failed'/.test(KC));

console.log('\n— 4. 送信の打ち切りと送信中の守り —');
t('打刻の送信は打ち切りつき（12秒）', /PUNCH_TIMEOUT_MS = 12000/.test(KC) && /withTimeout\(rpc\('kintai_clock_punch'/.test(KC));
t('打ち切り（timeout）は通信の失敗として控えに回す', /timeout\|fetch/.test(KC) || /\|timeout\|/.test(KC));
t('送信中は最初の画面へ戻さない', /function reset\(\) \{\s*if \(view === 'sending'\) return;/.test(KC));
t('戻す時に世代を進める（遅れて届いた前の人の名前を出さない）', /if \(view === 'sending'\) return;[^}]*gen\+\+;/.test(KC));

console.log('\n— 5. 管理画面が端末に残すもの —');
const sets = K.match(/lsSet\(([A-Z_]+),/g) || [];
t('lsSet で書く鍵は kintai_tab と kintai_ym だけ', sets.length && sets.every((x) => /LS_TAB|LS_YM/.test(x)) && /LS_TAB = 'kintai_tab', LS_YM = 'kintai_ym'/.test(K), sets);
t('localStorage.setItem を直に呼ばない（lsSet だけ）', (K.match(/localStorage\.setItem/g) || []).length === 1);
t('タブの読み戻しはホワイトリスト・月は形を確かめる', /tab = TABS\.indexOf\(t\) >= 0 \? t : 'day'/.test(K) && /ym = C\.isYm\(y\) \? y : todayYm\(\)/.test(K));

console.log('\n— 6. 画面の頭 —');
for (const [n, h] of [['kintai.html', H], ['kintai-clock.html', HC]]) {
  t(n + ': Cache-Control no-store', /<meta http-equiv="Cache-Control" content="no-store">/.test(h));
  t(n + ': インラインのスクリプトが無い（CSP は script-src self だけ）', !/<script(?![^>]*\bsrc=)[^>]*>/.test(h) && /script-src 'self';/.test(h));
  t(n + ': 拡大縮小を禁止しない', /<meta name="viewport" content="width=device-width,initial-scale=1">/.test(h));
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
