/* 勤怠管理の2画面（kintai.html・kintai-clock.html）の入口と端末に残すものの試験（2026-11-18 新設・差分審査の指摘4）
   実行: node check/unit/kintai_page_test.js
   守りたいこと:
     1. 管理画面は「現場端末の止め → SUAppGate.run('kintai') → 読み込み」の順（CLAUDE.md §2-5・§2-7）。部品が無ければ開かない
     2. 打刻画面は SUAppGate.run('kintai-clock') を通ってから動く
     3. 打刻の控え（kintai_clock_queue）に入るのは 番号・種類・控えの番号・端末の時刻 だけ（名前を端末に残さない）
     4. 打刻の送信は打ち切りがあり、打ち切った時は控えに回す。送信中は最初の画面へ戻さない
     5. 管理画面が端末に残すのは UI の状態（kintai_tab・kintai_ym）だけ。読み戻しはホワイトリストで確かめる
     6. 両画面とも Cache-Control: no-store・インラインのスクリプトを持たない
   v2（2026-11-19・凍結仕様 ROOT-v2-polish.md の C）で足したこと:
     7. 管理画面の v2 の形（要確認のタブ・要確認は needsReview にそろえる・CSV の新しい列・今の時刻で数える・
        早出/残業の「全部」と時刻を組で送る・締めの前の読み直しと当月の止め・休止の職員・暗い表示・短い知らせ・読み込みの ?v=） */
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

console.log('\n— 7. 管理画面の v2 の形 —');
t('タブのホワイトリストに要確認（日ごとの次）', /var TABS = \['day', 'review', 'grid', 'person', 'staff', 'close', 'settings'\]/.test(K) && /data-tab="day">日ごと<\/button>\s*<button type="button" role="tab" data-tab="review">要確認/.test(H));
t('要確認の色・件数は needsReview・reviewList・totals にそろえる（印と C.REVIEW で数えない）', /C\.needsReview\(/.test(K) && /C\.reviewList\(month\)/.test(K) && /month\.totals\.reviewCount/.test(K) && !/flags\.some\(function \(f\) \{ return C\.REVIEW\[f\]; \}\)/.test(K));
t('CSV は新しい列つき（extraCols: true）', /C\.buildCsv\(src, \{ nameOf: nameOfOffice, extraCols: true \}\)/.test(K));
t('月の計算に今の時刻を渡し、日ごと・要確認は1分ごとに手元で数え直す', /C\.computeMonth\(\{[^}]*now: Date\.now\(\) \}\)/.test(K) && /recompute\(\); paint\(\);\s*\}, 60000\)/.test(K));
t('早出・残業は「全部認める」と時刻を組で送る（両方が有効にならない）', /patch\.early_ok = em === 'all'; if \(ef != null \|\| dn\.early_from != null\) patch\.early_from = ef;/.test(K) && /patch\.overtime_ok = om === 'all'; if \(ou != null \|\| dn\.ot_until != null\) patch\.ot_until = ou;/.test(K));
t('窓が開いただけでは未保存にしない（開いた時の値と比べる）', /dlgCtx\.init = formState\(\)/.test(K) && /return formState\(\) !== dlgCtx\.init;/.test(K));
const lockFn = K.slice(K.indexOf('function lockMonth('), K.indexOf('function lockGo('));
const goFn = K.slice(K.indexOf('function lockGo('), K.indexOf('function unlockMonth('));
t('締める直前に月を読み直し、その数字を控えにする・当月は止める', /if \(notYet\(\)\)/.test(lockFn) && lockFn.indexOf("rpc('kintai_month_get'") >= 0 && /notyet: '月末を過ぎてから締められます。'/.test(K));
t('「締める」を押した時にもう一度読み直して数え直し、窓の数字と違えば締めずに描き直す・同じ時だけその数字を控えにする（審査の指摘2）',
  goFn.indexOf("rpc('kintai_month_get'") >= 0 && goFn.indexOf('recompute()') > goFn.indexOf("rpc('kintai_month_get'") && goFn.indexOf('sameFigures(shown, now)') > goFn.indexOf('recompute()') &&
  goFn.indexOf('openLock(now, diff.join') > goFn.indexOf('sameFigures(shown, now)') && goFn.indexOf("rpc('kintai_month_lock', { p_ym: ym, p_snapshot: C.snapshotOf(month) })") > goFn.indexOf('openLock(now, diff.join') && !/snap: C\.snapshotOf/.test(K));
t('保存中は Esc でも窓を閉じない・窓が閉じていたら失敗を画面の下で知らせる（審査の指摘1）', /addEventListener\('cancel', function \(e\) \{ if \(busy\) \{ e\.preventDefault\(\); return; \}/.test(K) && /else toast\('保存できませんでした: ' \+ msgOf\(e\)\)/.test(K));
const ptFn = K.slice(K.indexOf('function printThen('), K.indexOf('function printAllPeople('));
const paFn = K.slice(K.indexOf('function printAllPeople('), K.indexOf('function printEdits('));
const peFn = K.slice(K.indexOf('function printEdits('), K.indexOf('/* ── 操作 ── */'));
t('印刷して戻すのは afterprint（print の直後に戻さない）・保険は最初の操作か30秒（審査の指摘3）', /window\.addEventListener\('afterprint', endPrint\)/.test(K) && !/finally/.test(ptFn) && /setTimeout\(endPrint, 30000\)/.test(ptFn) && /addEventListener\('pointerdown', paArm, true\)/.test(ptFn));
t('全員分の印刷と直しの履歴の印刷は、どちらも同じ printThen で戻す（直後に戻さない）', /printThen\(function \(\) \{ printAll = false; paint\(\); \}\)/.test(paFn) && /printThen\(function \(\) \{ document\.body\.classList\.remove\('pr-edits'\)/.test(peFn) && !/finally|doPrint\(\)/.test(paFn + peFn));
t('シフトを取り込めていない間は締めるボタンを止める', /shiftInfo && !shiftInfo\.ok \? 'シフトを取り込めていないため/.test(K));
t('締めた月の月の集計は控えから（ファイル名に「締めた時の数字」）', /suffix = '_月の集計_締めた時の数字'/.test(K) && /function snapMonth\(\)/.test(K));
t('休止の職員は名簿にいる人だけ送る（名簿に無い人に番号を振らない）', /if \(!kn \|\| vis\[st\.id\]\) return;/.test(K) && /active: act \}\);/.test(K));
t('active は今月（日本時間）の表示の状態で決め、今月のシフトが読めない・空の時は送らない', /if \(activeOk\) row\.active = C\.staffVisible\(byId\[r\.staff_id\], cur\);/.test(K) && /var act = C\.staffVisible\(st, cur\);/.test(K) && /if \(!activeOk\) return out;/.test(K) && /var activeOk = Array\.isArray\(sl\) && sl\.length > 0 && !!\(cp && cp\.cells && Object\.keys\(cp\.cells\)\.length\);/.test(K) && /for \(k in r\) if \(k !== 'active'\) row\[k\] = r\[k\];/.test(K));
t('予定の無い日の打刻は prompt でなく窓の日付の入力欄', !/prompt\('打刻を足す日/.test(K) && /id="e-pick"/.test(K));
t('暗い表示に対応（画面だけ・紙は白地）', /<meta name="color-scheme" content="light dark">/.test(H) && /@media screen and \(prefers-color-scheme: dark\)\{/.test(H) && /@media print\{[^]*body\{background:#fff/.test(H) && !/@media print\{[^}]*prefers-color-scheme/.test(H));
t('保存の後の短い知らせは aria-live', /<div class="toast no-print" id="g-toast" role="status" aria-live="polite" hidden><\/div>/.test(H));
t('印刷の時だけの見出し（.ph は画面で出さない）', /\.ph\{display:none\}/.test(H) && /function printHead\(sub\)/.test(K));
t('kintai.js・kintai-calc.js の読み込みは ?v=2026-11-19', /kintai\.js\?v=2026-11-19/.test(H) && /kintai-calc\.js\?v=2026-11-19/.test(H) && /kintai-calc\.js\?v=2026-11-19/.test(HC));

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
