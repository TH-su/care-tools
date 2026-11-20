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
        早出/残業の「全部」と時刻を組で送る・締めの前の読み直しと当月の止め・休止の職員・暗い表示・短い知らせ・読み込みの ?v=）
   v3（2026-11-19・凍結仕様 ROOT-v3-clock-flow.md）で足したこと:
     8. 打刻画面の「出勤を押す → 氏名 → パスコード」の流れ（待受の特大ボタン・名簿の読み直し・照合 kintai_clock_check・
        パスコード違い3回・busy は控えない・通信できない時は同じ形で控える・選んだ事業所だけ端末に残す・重ね押しの守り・寸法）。
        3 の「localStorage に書く鍵」は、仕様が許した kintai_clock_office（UI の状態・ホワイトリスト）を足して2か所ちょうどに締め直した
   0101（2026-11-19・凍結仕様 ROOT-payroll.md「A.」）で足したこと:
     11. 月は「○月分」＝DB の期間・2つのカレンダー月の取り込み・締め日の設定・新しい断りの言葉・?v=
   v4（2026-11-20・凍結した仕様書 ROOT-v4-master-leave.md）で足したこと:
     12. 有給のタブ・職員マスタの関数（名前と引数）・勤務時間を手で入れる窓（今の関数を順に呼ぶ・理由必須・締めた月分）・読み込みの鎖に入れない・端末に残さない */
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
/* ★総点検（2026-11-20）: 名前で選んで照合できなかった時だけ sid（選んだ人の staff_id）を足す形にしたので題を改めた（氏名は入れない） */
t('控えの形は code・kind・id・at（名前で選んで照合できなかった時だけ sid を足す・氏名は入れない）', !!m && JSON.stringify(m[1].match(/(\w+):/g)) === JSON.stringify(['code:', 'kind:', 'id:', 'at:']) && /item\.sid = who\.sid;/.test(KC) && !/item\.name\s*=/.test(KC), m && m[1]);
t('控えを読む時も形を確かめる（壊れた控えを送らない）', /function okItem\(x\) \{ return x && KintaiCalc\.isCode\(x\.code\)/.test(KC));
/* ★総点検（2026-11-20）: 名前で選んだ控えの照合のため、送れなかった控えにも選んだ人の staff_id（sid）を足す形にした。名前を足さない点は変えない */
t('送れなかった控えに足すのは理由と、名前で選んだ時の staff_id だけ（名前を足さない）', /var fi = \{ code: it\.code, kind: it\.kind, id: it\.id, at: it\.at, why: why \};\s*if \(it\.sid\) fi\.sid = it\.sid;\s*var f = readList\(F_KEY\); f\.push\(fi\);/.test(KC) && !/fi\.name|item\.name|label:/.test(KC.slice(KC.indexOf('function flush('), KC.indexOf('function bind('))));
t('localStorage に書くのは控えの2つの鍵と、選んだ事業所（UI の状態）だけ（書く所はちょうど2か所）', (KC.match(/localStorage\.setItem\(/g) || []).length === 2 && /localStorage\.setItem\(key, JSON\.stringify\(list\)\)/.test(KC) &&
  /Q_KEY = 'kintai_clock_queue', F_KEY = 'kintai_clock_failed', O_KEY = 'kintai_clock_office'/.test(KC) &&
  /function saveOffice\(v\) \{ if \(!isOffice\(v\)\) return; try \{ localStorage\.setItem\(O_KEY, v\); \} catch \(_\) \{\} \}/.test(KC));
t('事業所の読み戻しはホワイトリスト（決まった4つ以外は「全部」）', /var OFFICES = \[\['all', '全部'\], \['facility', '施設'\], \['visit', '訪問介護'\], \['day', '通所介護'\]\]/.test(KC) && /return isOffice\(v\) \? v : 'all';/.test(KC));
t('控えに書くのは打刻の1か所だけ（名前の流れも同じ item を使う）', (KC.match(/enqueue\(/g) || []).length === 2 && (KC.match(/var my = \+\+gen, item = /g) || []).length === 1);

console.log('\n— 4. 送信の打ち切りと送信中の守り —');
t('打刻の送信は打ち切りつき（12秒）', /PUNCH_TIMEOUT_MS = 12000/.test(KC) && /withTimeout\(rpc\('kintai_clock_punch'/.test(KC));
t('打ち切り（timeout）は通信の失敗として控えに回す', /timeout\|fetch/.test(KC) || /\|timeout\|/.test(KC));
t('送信中は最初の画面へ戻さない', /function reset\(\) \{\s*if \(view === 'sending'\) return;/.test(KC));
t('戻す時に世代を進める（遅れて届いた前の人の名前を出さない）', /if \(view === 'sending'\) return;[^}]*gen\+\+;/.test(KC));

console.log('\n— 5. 管理画面が端末に残すもの —');
const sets = K.match(/lsSet\(([A-Z_]+),/g) || [];
t('lsSet で書く鍵は kintai_tab と kintai_ym だけ', sets.length && sets.every((x) => /LS_TAB|LS_YM/.test(x)) && /LS_TAB = 'kintai_tab', LS_YM = 'kintai_ym'/.test(K), sets);
t('localStorage.setItem を直に呼ばない（lsSet だけ）', (K.match(/localStorage\.setItem/g) || []).length === 1);
/* ★v5 段2（2026-11-20・仕様書 ROOT-v5-freee.md）: 既定のタブをホーム（home）にした（仕様の仮置き）ので、知らない値の戻り先の期待を 'home' に改めた（ホワイトリストで確かめるのは同じ） */
t('タブの読み戻しはホワイトリスト・月は形を確かめる', /tab = TABS\.indexOf\(t\) >= 0 \? t : 'home'/.test(K) && /ym = C\.isYm\(y\) \? y : todayYm\(\)/.test(K));

console.log('\n— 6. 画面の頭 —');
for (const [n, h] of [['kintai.html', H], ['kintai-clock.html', HC]]) {
  t(n + ': Cache-Control no-store', /<meta http-equiv="Cache-Control" content="no-store">/.test(h));
  t(n + ': インラインのスクリプトが無い（CSP は script-src self だけ）', !/<script(?![^>]*\bsrc=)[^>]*>/.test(h) && /script-src 'self';/.test(h));
  t(n + ': 拡大縮小を禁止しない', /<meta name="viewport" content="width=device-width,initial-scale=1">/.test(h));
}

console.log('\n— 7. 管理画面の v2 の形 —');
/* ★v4（2026-11-20）: 依頼で「有給」のタブ（leave・職員と番号の次）を足したので、ホワイトリストの期待をその並びの完全一致に改めた（緩めていない） */
/* ★v5 段2（2026-11-20）: 仕様で先頭に「ホーム」（home）のタブを足したので、ホワイトリストの期待をその並びの完全一致に改め、HTML でもホームが日ごとの前にあるかを足した（緩めていない） */
t('タブのホワイトリストに要確認（日ごとの次）・先頭はホーム', /var TABS = \['home', 'day', 'review', 'grid', 'person', 'staff', 'leave', 'close', 'settings'\]/.test(K) && /data-tab="home">ホーム<\/button>\s*<button type="button" role="tab" data-tab="day">日ごと<\/button>\s*<button type="button" role="tab" data-tab="review">要確認/.test(H));
t('要確認の色・件数は needsReview・reviewList・totals にそろえる（印と C.REVIEW で数えない）', /C\.needsReview\(/.test(K) && /C\.reviewList\(month\)/.test(K) && /month\.totals\.reviewCount/.test(K) && !/flags\.some\(function \(f\) \{ return C\.REVIEW\[f\]; \}\)/.test(K));
t('CSV は新しい列つき（extraCols: true）', /C\.buildCsv\(src, \{ nameOf: nameOfOffice, extraCols: true \}\)/.test(K));
/* 2026-11-20 の6回目（代表者の指示）: 1分ごとの手元だけの数え直しを、30秒ごとの読み直し＋数え直しに変えた（読めない時も手元で数え直す・下の 14） */
t('月の計算に今の時刻を渡し、日ごと・要確認は30秒ごとに読み直して数え直す（読めない時も手元で数え直す）', /C\.computeMonth\(\{[^}]*now: Date\.now\(\) \}\)/.test(K) && /setInterval\(function \(\) \{ quietReload\(\); \}, 30000\)/.test(K) && /data = d;\s*recompute\(\); paint\(\);/.test(K) && /if \(my === gen && atYm === ym && quietOk\(\)\) \{ recompute\(\); paint\(\); \}/.test(K));
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
/* ★v4（2026-11-20）: 中身を変えたので ?v= を 2026-11-20 に上げた（CLAUDE.md の決まり）。期待をその版に改めた */
t('kintai.js・kintai-calc.js の読み込みは ?v=2026-11-20', /kintai\.js\?v=2026-11-20/.test(H) && /kintai-calc\.js\?v=2026-11-20/.test(H) && /kintai-calc\.js\?v=2026-11-20/.test(HC));

console.log('\n— 8. 打刻画面の v3（出勤を押す → 氏名 → パスコード） —');
const pendClock = [];
const fn = (name, next) => KC.slice(KC.indexOf('function ' + name + '('), KC.indexOf('function ' + next + '('));
const homeFn = fn('paintHome', 'startPick'), rosterFn = fn('loadRoster', 'paintPick'), pickFn = fn('paintPick', 'pickStaff'), passFn = fn('paintPass', 'check'), checkFn = fn('check', 'whoOf');
const punchFn = fn('punch', 'showDone'), resetFn = fn('reset', 'homeWith');
t('待受は「出勤」（左）「退勤」（右）と「番号で打刻」（v2 の番号の流れへ）。出勤/退勤は HTML に固定（v3.1）', /<button type="button" class="kd kd-in" data-g="in" aria-pressed="false">出勤<\/button>\s*<button type="button" class="kd kd-out" data-g="out" aria-pressed="false">退勤<\/button>/.test(HC) && /data-k="bycode">名前が出ない時は 番号で打刻</.test(homeFn) && /if \(k === 'bycode'\) \{ if \(!tooSoon\(\)\) toCode\(\); return; \}/.test(KC));
t('待受では I・O のキーを使わない（キーが効くのはテンキーの画面と完了だけ）', /if \(view === 'code' \|\| view === 'pass'\) \{/.test(KC) && !/e\.key === '[iIoO]'/.test(KC));
t('最初の画面（reset）は待受で、最後に読みに行ってから1分以上なら名簿を読み直す', /paintHome\(/.test(resetFn) && /if \(Date\.now\(\) - rosterTry >= ROSTER_STALE_MS\) loadRoster\(\);/.test(resetFn) && /ROSTER_MS = 5 \* 60000, ROSTER_STALE_MS = 60000, PASS_TRIES = 3/.test(KC));
t('名簿は門番の後に読み、5分ごとに読み直す', cboot.indexOf('setInterval(loadRoster, ROSTER_MS)') > cboot.indexOf("SUAppGate.run('kintai-clock'") && cboot.indexOf('reset()') > cboot.indexOf("SUAppGate.run('kintai-clock'"));
t('名簿は kintai_clock_roster（打ち切りつき）・名前順（ja の localeCompare）・形を確かめる・事業所はホワイトリスト', /withTimeout\(rpc\('kintai_clock_roster', \{\}\), ROSTER_TIMEOUT_MS\)/.test(rosterFn) && /a\.name\.localeCompare\(b\.name, 'ja'\)/.test(rosterFn) && /typeof s\.id === 'string'/.test(rosterFn) && /isOffice\(s\.office\)/.test(rosterFn));
t('名簿が読めない時は前に読めた名簿を残す（失敗の時に roster を消さない）・関数が無い／通信できない時は記録しない', !/roster = null/.test(rosterFn) && /if \(!isNet\(e\) && c !== 'PGRST202'/.test(rosterFn));
t('名簿が使えない時は「名簿を読めません。番号で打刻してください」で番号の流れへ', /var m = '名簿を読めません。番号で打刻してください。';\s*toCode\(/.test(KC));
t('名簿・選んだ人・パスコードは localStorage に書かない（名簿の関数・照合の関数の中に localStorage が無い）', !/localStorage/.test(rosterFn + pickFn + passFn + checkFn + fn('pickStaff', 'paintPass')));
t('氏名ボタンは id（esc を通す）で引き、名簿に無い id は選べない', /data-sid="' \+ esc\(s\.id\) \+ '">' \+ esc\(s\.name\)/.test(pickFn) && /if \(!st\) \{ paintPick\(\); return; \}/.test(KC));
t('パスコードは●で隠す（数字を画面に出さない）', /\(code \? code\.replace\(\/\.\/g, '●'\) : '4〜6桁の番号'\)/.test(passFn));
t('照合は kintai_clock_check(p_staff_id, p_code)・合えば v2 と同じ逆押しの確かめ → punch', /rpc\('kintai_clock_check', \{ p_staff_id: st\.id, p_code: c \}\)/.test(checkFn) && /who = whoOf\(c, r\.staff\); who\.flow = 'name';/.test(checkFn) && /if \(needAsk\(kind\)\) paintAsk\(kind\); else punch\(kind\);/.test(checkFn));
t('パスコード違いは3回まで画面に残り、その後は待受へ', /passFails\+\+; code = '';/.test(checkFn) && /if \(passFails >= PASS_TRIES\) \{ homeWith\(/.test(checkFn) && /パスコードが違います。/.test(checkFn));
t('照合の止め（busy）は控えずに待受へ「しばらくしてから」', /if \(r && r\.error === 'busy'\) \{ homeWith\('[^']*しばらくしてから[^']*'\); return; \}/.test(checkFn) && !/enqueue|punch\(kind\);[^}]*busy/.test(checkFn.slice(checkFn.indexOf("r.error === 'busy'"), checkFn.indexOf("r.error === 'busy'") + 160)));
/* ★総点検（2026-11-20）: 選んだ人の staff_id（sid）を who に持たせる形にした（送る前の照合に使う）。名前を確かめていない点は変えない */
t('通信できない時は番号の流れと同じく控える（名前は確かめていないので who.name を空にし、選んだ人の staff_id を持つ）', /if \(isNet\(e\)\) \{ who = \{ code: c, name: null, label: st\.name, sid: st\.id, state: null, why: 'net', flow: 'name' \}; view = 'who'; punch\(kind\); return; \}/.test(checkFn) &&
  /if \(who\.flow === 'name' && !who\.name && isSid\(who\.sid\)\) item\.sid = who\.sid;/.test(punchFn));
/* 総点検（2026-11-20）: 名前で選んで控えた打刻は、送る前に選んだ人と番号を照合し、合わなければ送らない（打ち間違いがほかの人の番号に当たった時にその人の打刻にしない） */
{
  const flushFn = fn('flush', 'bind');
  const runFlush = (queue, checkOk, busy) => {
    const store = { kintai_clock_queue: JSON.stringify(queue), kintai_clock_failed: '[]' }, calls = [];
    const f = new Function('STORE', 'CALLS', 'CHECK_OK', 'BUSY', `
      var Q_KEY = 'kintai_clock_queue', F_KEY = 'kintai_clock_failed', PUNCH_TIMEOUT_MS = 12000, flushing = false, chkTO = {};
      var navigator = { onLine: true };
      function readList(k) { return JSON.parse(STORE[k] || '[]'); }
      function writeList(k, l) { STORE[k] = JSON.stringify(l); return true; }
      function withTimeout(p) { return p; }
      function isNet() { return false; }
      function note() {}
      function paintFoot() {}
      function loadRecent() {}
      function deviceKey() { return null; }
      function rpc(n, a) { CALLS.push([n, a.p_staff_id || null, a.p_code]); if (n === 'kintai_clock_check') return Promise.resolve(BUSY ? { ok: false, error: 'busy' } : CHECK_OK ? { ok: true, staff: { name: 'x' } } : { ok: false, error: 'mismatch' }); return Promise.resolve({ ok: true }); }
      ${flushFn}
      return flush();`);
    return f(store, calls, checkOk, busy).then(() => ({ calls, q: JSON.parse(store.kintai_clock_queue), f: JSON.parse(store.kintai_clock_failed) }));
  };
  const it1 = { code: '0007', kind: 'in', id: 'c1', at: 1, sid: 'sA' }, it2 = { code: '0003', kind: 'out', id: 'c2', at: 2 };
  pendClock.push(runFlush([it1, it2], false, false).then((r) => t('名前で選んだ控えは、番号が選んだ人と合わない時は送らず「送れなかった打刻」へ（番号の流れの控えはそのまま送る）',
    r.calls.length === 2 && r.calls[0][0] === 'kintai_clock_check' && r.calls[0][1] === 'sA' && r.calls[1][0] === 'kintai_clock_punch' && r.calls[1][2] === '0003' &&
    r.q.length === 0 && r.f.length === 1 && r.f[0].sid === 'sA' && r.f[0].why === 'パスコードが選んだ名前と合わない' && !('name' in r.f[0]), r)));
  pendClock.push(runFlush([it1], true, false).then((r) => t('合う時は照合の後に送る（送信待ちから消える）', r.calls.map((c) => c[0]).join() === 'kintai_clock_check,kintai_clock_punch' && r.q.length === 0 && r.f.length === 0, r)));
  {
    /* 照合の返事が毎回打ち切られる控えは、この画面では3回で照合をやめる（打ち切られてもサーバーは失敗を数えるため・反証レビュー 2026-11-20） */
    const store = { kintai_clock_queue: JSON.stringify([it1]), kintai_clock_failed: '[]' }, calls = [];
    const f = new Function('STORE', 'CALLS', `
      var Q_KEY = 'kintai_clock_queue', F_KEY = 'kintai_clock_failed', PUNCH_TIMEOUT_MS = 12000, flushing = false, chkTO = {};
      var navigator = { onLine: true };
      function readList(k) { return JSON.parse(STORE[k] || '[]'); }
      function writeList(k, l) { STORE[k] = JSON.stringify(l); return true; }
      function withTimeout(p) { return p; }
      function isNet() { return true; }
      function note() {} function paintFoot() {} function loadRecent() {} function deviceKey() { return null; }
      function rpc(n) { CALLS.push(n); return Promise.reject(new Error('timeout')); }
      ${flushFn}
      return flush().then(flush).then(flush).then(flush).then(flush);`);
    pendClock.push(f(store, calls).then(() => t('照合が打ち切られ続ける控えは3回で照合をやめ、送信待ちには残す', calls.length === 3 && JSON.parse(store.kintai_clock_queue).length === 1, calls)));
  }
  pendClock.push(runFlush([it1], false, true).then((r) => t('照合が止め（busy）の時は送らず送信待ちに残す', r.calls.length === 1 && r.q.length === 1 && r.f.length === 0, r)));
}
t('控えの送信も打ち切りつき（照合・打刻とも12秒）', /withTimeout\(rpc\('kintai_clock_check', \{ p_staff_id: it\.sid, p_code: it\.code \}\), PUNCH_TIMEOUT_MS\)/.test(KC) && /return withTimeout\(rpc\('kintai_clock_punch', \{ p_code: it\.code/.test(KC));
t('送れなかった打刻の一覧は、名前で選んだ控えのパスコードを出さず選んだ名前を出す', /var who1 = x\.sid \? \(st \? '選んだ名前 ' \+ esc\(st\.name\) : '名前で選んだ打刻（番号 ' \+ esc\(x\.code\) \+ '）'\) : '番号 ' \+ esc\(x\.code\);/.test(KC));
t('今日の打刻は、今日でない打刻に日付を添える', /var day = jstDayNo\(ms0\) === jstDayNo\(Date\.now\(\)\) \? '' :/.test(KC));
t('名前の流れの控えの完了画面にパスコードを出さず、名前を出す（照合が合った後に送れなかった時も）', /sub: \(byName \? '' : '番号 ' \+ item\.code \+ '・'\)/.test(punchFn) && /shown = who\.label \|\| who\.name;/.test(punchFn));
t('名前の流れの「やめる」と送れなかった時は待受へ', /if \(who\.flow === 'name'\) reset\(\); else paintWho\(false\);/.test(KC) && /if \(byName\) homeWith\(m\); else paintCode\(/.test(punchFn));
t('画面が入れ替わった直後の重ね押しを無視する（待受・氏名・パスコード）', /function tooSoon\(\) \{ return Date\.now\(\) - paintAt < TAP_GUARD_MS; \}/.test(KC) && /if \(g\) \{\s*if \(tooSoon\(\)\) return;/.test(KC) && /if \(view === 'pick' && !tooSoon\(\)\) pickStaff\(sid\)/.test(KC) && /if \(view === 'pass' && tooSoon\(\)\) return;/.test(KC));
t('30秒触らなければ待受へ（待受では何もしない）', /function armIdle\(\) \{ clearTimeout\(idleT\); if \(view !== 'home'\) idleT = setTimeout\(reset, IDLE_MS\); \}/.test(KC));
t('寸法: 待受の出勤/退勤は高さ 120px 以上・文字 48px 以上、氏名は高さ 72px 以上・文字 24px（su-theme の button の 44px より強い #k-kinds・#k-panel つき）',
  /#k-kinds \.kd\{flex:1 1 0;min-width:0;min-height:(\d+)px;font-size:clamp\((\d+)px/.test(HC) && +RegExp.$1 >= 120 && +RegExp.$2 >= 48 &&
  /#k-panel \.nm\{min-height:(\d+)px;padding:[^;]+;font-size:(\d+)px/.test(HC) && +RegExp.$1 >= 72 && +RegExp.$2 >= 24);
t('幅 899px 以下でもテンキー 72px・出勤/退勤と はい/やめる 120px・下のボタン 56px（#k-panel つきで su-theme の 44px より強く）', /#k-panel \.keys button\{min-height:72px\}/.test(HC) && /#k-panel \.acts button\{min-height:120px\}/.test(HC) && /#k-panel \.back\{min-height:56px\}/.test(HC));
const pressFn = fn('press', 'updCode'), updFn = fn('updCode', 'lookup');
t('数字・消すを押した時はテンキーを描き直さない（●の欄と決定だけ・textContent で書く。速い連打を落とさない）', /code \+= k;\s*updCode\(\);\s*\}/.test(pressFn) && !/paint(Pass|Code)\(\)/.test(pressFn) && /box\.textContent = /.test(updFn) && /ok\.disabled = !KintaiCalc\.isCode\(code\)/.test(updFn) && !/innerHTML/.test(updFn));
t('重ね押しの守りは画面が入れ替わった時だけ（同じ画面の中では paintAt を進めない）', /function mark\(\) \{ if \(\$\('k-main'\)\.getAttribute\('data-v'\) !== view\) paintAt = Date\.now\(\);/.test(KC));
/* ★総点検（2026-11-20）: 名前で選んだ控えの照合を足したので ?v= を 2026-11-20 に上げた（CLAUDE.md の決まり）。期待をその版に改めた */
t('kintai-clock.js の読み込みは ?v=2026-11-20', /<script src="kintai-clock\.js\?v=2026-11-20"><\/script>/.test(HC));

console.log('\n— 9. 打刻画面の v3.1（画面の並び・今日の打刻） —');
const recentFn = fn('loadRecent', 'paintRecent'), paintRecentFn = fn('paintRecent', 'paintFoot');
t('上に日付と時計・左（約70%）と右（約30%）・幅 899px 以下は履歴を下へ', /\.k-body\{width:100%;display:grid;grid-template-columns:minmax\(0,7fr\) minmax\(0,3fr\)/.test(HC) && /@media screen and \(max-width: 899px\)\{\.k-body\{grid-template-columns:minmax\(0,1fr\)\}\}/.test(HC) && HC.indexOf('id="k-clock"') < HC.indexOf('id="k-body"'));
t('出勤は青・退勤は赤（完了・確かめ・履歴の字もこの色）', /--fill-in:#1d4ed8;--fill-out:#b91c1c;--in:#1d4ed8;[^;]*;--out:#b91c1c;/.test(HC));
t('押した方を大きく（押された印 aria-pressed）・同じ方をもう一度押すと待受・もう片方は切り替え', /#k-kinds\.sel \.kd\.on\{flex-grow:1\.86;/.test(HC) && /b\.setAttribute\('aria-pressed', on \? 'true' : 'false'\)/.test(KC) && /if \(g === pickKind\) \{ reset\(\); return; \}/.test(KC));
t('hidden が display の指定に負けない（ログイン前に中身を出さない）', /\.kinds\[hidden\],\.k-body\[hidden\]\{display:none\}/.test(HC) && /<div class="k-body" id="k-body" hidden>/.test(HC) && cboot.indexOf("$('k-body').hidden = false") > cboot.indexOf("SUAppGate.run('kintai-clock'"));
t('今日の打刻は kintai_clock_recent（打ち切りつき）・開いた時と30秒ごと・打刻が終わった時に読む', /withTimeout\(rpc\('kintai_clock_recent', \{\}\), ROSTER_TIMEOUT_MS\)/.test(recentFn) && /var RECENT_MS = 30000/.test(KC) && /setInterval\(loadRecent, RECENT_MS\)/.test(cboot) && cboot.indexOf('loadRecent()') > cboot.indexOf("SUAppGate.run('kintai-clock'") && /chime\(o\.tone\); loadRecent\(\);/.test(KC));
t('履歴の名前は esc を通し、種類は出勤/退勤の2つだけ・形を確かめる・50件まで', /esc\(x\.name\)/.test(paintRecentFn) && /var k = x\.kind === 'in' \? 'in' : 'out';/.test(paintRecentFn) && /x\.kind === 'in' \|\| x\.kind === 'out'/.test(recentFn) && /\.slice\(0, 50\)/.test(recentFn));
t('履歴は端末に保存しない（localStorage を使わない）', !/localStorage/.test(recentFn + paintRecentFn));
t('履歴が読めない時は「履歴を読めません」（打刻はそのまま）・送信待ちの件数は履歴の上', /履歴を読めません（打刻はできます）/.test(recentFn) && HC.indexOf('id="k-foot"') > HC.indexOf('id="k-hist-h"') && HC.indexOf('id="k-foot"') < HC.indexOf('id="k-hist"'));
t('氏名・パスコードの間は時計を1行44px・出勤/退勤を72px、横の氏名は6列・56px以上・文字22px以上（Safari の見える高さ 1194×700 に31人）', /main\.sel \.clock\{height:44px;/.test(HC) && /#k-kinds\.sel \.kd\{min-height:72px;font-size:28px\}/.test(HC) && /main\.sel'?, sel\)|\$\('k-main'\)\.classList\.toggle\('sel', sel\)/.test(KC) &&
  /main\[data-v="pick"\] #k-panel \.names\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\);/.test(HC) && /main\[data-v="pick"\] #k-panel \.names \.nm\{min-height:(\d+)px;[^}]*font-size:(\d+)px/.test(HC) && +RegExp.$1 >= 44 && +RegExp.$2 >= 22 && /main\[data-v="pick"\] #k-panel \.off\{min-height:44px;/.test(HC));
console.log('\n— 10. 審査の指摘（照合できない時の完了画面・照合の打ち切り・照合中/送信中の押せない見た目） —');
t('照合できずに控えた時は名前を確定のように出さない（大きな名前を出さず「選んだ名前: 」を小さく添える・確かめの説明つき）・控えの形は同じ',
  /if \(byName && !name\) \{\s*showDone\(\{ tone: 'save', kind: kind, big: label \+ 'を控えました（端末の時刻 ' \+ hm\(item\.at\) \+ '）',/.test(punchFn) &&
  /sub: '名前とパスコードは、通信が戻ってから確かめます。合わない時は記録されないので、事務所へ伝えてください。', small: shown \? '選んだ名前: ' \+ shown : '' \}\);/.test(punchFn) &&
  !/if \(byName && !name\) \{[^}]*name:/.test(punchFn) && /\(o\.small \? '<p class="d-small">' \+ esc\(o\.small\) \+ '<\/p>' : ''\)/.test(KC) && (KC.match(/var my = \+\+gen, item = /g) || []).length === 1);
t('照合（kintai_clock_check）は打ち切りつき・打ち切りは通信の失敗として控える道へ', /withTimeout\(rpc\('kintai_clock_check', \{ p_staff_id: st\.id, p_code: c \}\), PUNCH_TIMEOUT_MS\)/.test(checkFn) && /if \(isNet\(e\)\) \{ who = \{ code: c, name: null,/.test(checkFn) && /timeout/.test(fn('isNet', 'friendly')));
t('照合中・送信中は出勤/退勤を押せない見た目（disabled・aria-disabled）', /function busyView\(\) \{ return view === 'wait' \|\| view === 'sending'; \}/.test(KC) && /b\.disabled = busy; b\.setAttribute\('aria-disabled', busy \? 'true' : 'false'\);/.test(KC) && /#k-kinds \.kd:disabled,\.chip:disabled\{opacity:\.5;/.test(HC));
t('照合中・送信中は「送れなかった打刻」を開かない（押せない見た目にもする）', /if \(k === 'failed'\) \{ if \(!busyView\(\)\) paintFailed\(\); return; \}/.test(KC) && /data-k="failed"' \+ \(busyView\(\) \? ' disabled aria-disabled="true"' : ''\)/.test(KC) && /if \(fb\) \{ fb\.disabled = busy;/.test(KC));
t('休憩の打刻（休始・休終）は作らない', !/休始|休終|break_start|break_end/.test(KC + HC));

console.log('\n— 11. 0101 月を締め日で切る（○月分・期間・2つのカレンダー月の取り込み・締め日の設定） —');
const impFn = K.slice(K.indexOf('function importShift('), K.indexOf('/* ── 読み込みと計算 ── */'));
t('期間は DB の period から（読む前・形が違う時はその月の1日〜末日）・日の一覧・締められるかも期間で決める',
  /function per\(\) \{ return C\.periodOf\(ym, data && data\.period\); \}/.test(K) && /function dateList\(\) \{ var p = per\(\)/.test(K) &&
  /function notYet\(\) \{ return !!ym && C\.jstDate\(Date\.now\(\)\) <= per\(\)\.to; \}/.test(K) && /C\.computeMonth\(\{ ym: ym, period: data\.period,/.test(K));
t('カレンダー月で比べる所が残っていない（d.slice(0, 7) !== ym を使わない）', !/slice\(0, 7\) !== ym/.test(K));
t('シフトの取り込みは期間にかかるカレンダー月ごとに buildSchedule と kintai_schedule_put（その月の ym）・職員は和集合・全部締めた月は locked を飛ばす',
  /cms = \[p0\.from\.slice\(0, 7\)\]/.test(impFn) && /if \(p0\.to\.slice\(0, 7\) !== cms\[0\]\) cms\.push\(p0\.to\.slice\(0, 7\)\);/.test(impFn) &&
  /C\.buildSchedule\(\{ ym: cm,/.test(impFn) && /rpc\('kintai_schedule_put', \{ p_ym: bt\.cm, p_rows: bt\.rows \}\)/.test(impFn) &&
  /if \(!seen\[x\.staff_id\]\)/.test(impFn) && /res\.error === 'locked'\) return true;/.test(impFn) && /if \(!go \|\| my !== gen\) return false;/.test(impFn));
t('見出し・締めの窓・解除の確かめ・直しの履歴の印刷は「○月分（期間）」', /esc\(perLabel\(\)\)/.test(K) && /openDlg\(perLabel\(\) \+ 'を締めます'/.test(K) && /prompt\(perLabel\(\) \+ ' の締めを解除します。/.test(K) && /corpName\(\) \+ '　勤怠 ' \+ perLabel\(\)/.test(K));
t('月の選びは「月分」・横に期間（textContent で入れる）', /<label>月分 <input type="month" id="g-ym"/.test(H) && /<span id="g-period" class="raw"><\/span>/.test(H) && /function paintPer\(\) \{ var el = \$\('g-period'\); if \(el\) el\.textContent = /.test(K));
t('設定に締め日（月末・1〜28日）・保存で close_day を送る（落とさない）・欄は今の設定から（締めた月分の控えから出さない）・片方の月のシフトが無くてもある月は取り込む', /var cdNow = C\.fillConfig\(\(data && data\.settings && data\.settings\.config\) \|\| \{\}\)\.close_day;/.test(K) && /if \(!have\.length\) \{ shiftInfo = \{ ok: false/.test(impFn) && /id="s-closeDay"/.test(K) && /cfg\.close_day = \+\$\('s-closeDay'\)\.value;/.test(K) && /Array\(28\)/.test(K));
/* ★見直し2（2026-11-19）: autoYm を真偽から「向けた月」に変え、その月を読んだ時だけ使う形に直したので、この試験の形の期待を改めた */
t('前に開いた月分が無い時だけ、期間が今日を過ぎていれば次の月分へ（読み戻しの形は今までどおり）・向けた月を読んだ時だけ使い、手で月を選んだら消す',
  /autoYm = C\.isYm\(y\) \? null : ym;/.test(K) && /if \(autoYm && autoYm === ym\) \{ autoYm = null; if \(C\.jstDate\(Date\.now\(\)\) > per\(\)\.to\)/.test(K) &&
  /function setYm\(v, keepAuto\) \{ if \(!C\.isYm\(v\) \|\| v === ym\) return; if \(!keepAuto\) autoYm = null;/.test(K));
t('DB の新しい断り（badperiod・overlap・closeday・periodchanged）を職員の言葉で出す', /badperiod: '/.test(K) && /overlap: '/.test(K) && /closeday: '/.test(K) && /periodchanged: '/.test(K));
const todayFn = K.slice(K.indexOf('function goToday('), K.indexOf('function moveDay('));
t('反証レビューの指摘1:「今日」は今日のカレンダー月へ移り（ymFor を使わない）、期間に入っていなければ読んだ後に次の月分へ', /a === 'day-today'\) goToday\(\)/.test(K) &&
  /ty = td\.slice\(0, 7\)/.test(todayFn) && !/ymFor/.test(todayFn) && /autoYm = ty; setYm\(ty, true\);/.test(todayFn) && /if \(ty === ym\) \{ setYm\(C\.nextYm\(ym\)\); return; \}/.test(todayFn));
/* 動きの確かめ: 画面の goToday・per・inPer と、読み込みの後の autoYm の決め方を取り出して、偽の setYm と期間で動かす（2か月以上離れた月分から押す） */
{
  const loadFn = K.slice(K.indexOf('function load('), K.indexOf('function recompute('));
  const autoLine = /if \(autoYm && autoYm === ym\) \{[^\n]*\}/.exec(loadFn)[0];
  const setYmFn = /function setYm\(v, keepAuto\) \{[^\n]*\}/.exec(K)[0];   /* 画面の setYm をそのまま使う（読み込みは偽物・順番に流す） */
  const C = require(path.join(ROOT, 'kintai-calc.js'));
  const periodFor = (close) => (y) => { if (!close) return null; const yy = +y.slice(0, 4), mm = +y.slice(5, 7); const f = (d) => d.toISOString().slice(0, 10);
    return { from: f(new Date(Date.UTC(yy, mm - 2, close + 1))), to: f(new Date(Date.UTC(yy, mm - 1, close))) }; };
  /* steps: 'today'（「今日」を押す）・'pick:YYYY-MM'（手で月を選ぶ）・'run'（待っている読み込みを1つ終える・追い越されたものは捨てる）・'fail'（1つ失敗させる） */
  const play = (startYm, todayIso, close, steps) => {
    const st = { visits: [] };
    const fn = new Function('C', 'st', 'PF', 'NOW', 'Date0', 'STEPS', `
      var Date = function () { return new Date0(NOW); }; Date.now = function () { return NOW; }; Date.parse = Date0.parse; Date.UTC = Date0.UTC;
      var selDate = null, busy = false, ym = '${startYm}', data = { period: PF('${startYm}') }, autoYm = null, gen = 0, queue = [];
      var shiftInfo, editsCache, month, LS_YM = 'kintai_ym';
      function lsSet() {} function paintPer() {} function paint() {}
      function $() { return {}; }
      function per() { return C.periodOf(ym, data && data.period); }
      function inPer(d) { var p = per(); return d >= p.from && d <= p.to; }
      function load() { var my = ++gen, want = ym; st.visits.push(want); queue.push(function (ok) {
        if (my !== gen) return;
        if (!ok) return;
        data = { period: PF(want) };
        (function () { ${autoLine} })();
      }); }
      ${setYmFn}
      ${todayFn}
      function drain() { while (queue.length) queue.shift()(true); }
      STEPS.forEach(function (s) {
        if (s === 'today') goToday();
        else if (s === 'run') { if (queue.length) queue.shift()(true); }
        else if (s === 'fail') { if (queue.length) queue.shift()(false); }
        else if (s === 'drain') drain();
        else if (s.indexOf('pick:') === 0) setYm(s.slice(5));
      });
      drain();
      return ym;`);
    return { end: fn(C, st, periodFor(close), Date.parse(todayIso), Date, steps), visits: st.visits };
  };
  const sim = (startYm, todayIso, close) => play(startYm, todayIso, close, ['today']);
  const a1 = sim('2026-09', '2026-11-19T10:00:00+09:00', 15);
  t('15日締め・9月分から 11/19 に「今日」→ 11月を読んで期間（10/16〜11/15）の後なので12月分へ（1か月だけ進まない）', a1.end === '2026-12' && a1.visits.join() === '2026-11,2026-12', a1);
  const a2 = sim('2027-03', '2026-11-10T10:00:00+09:00', 15);
  t('15日締め・先の3月分から 11/10 に「今日」→ 11月分（10/16〜11/15）', a2.end === '2026-11' && a2.visits.join() === '2026-11', a2);
  const a3 = sim('2026-11', '2026-11-19T10:00:00+09:00', 15);
  t('15日締め・今日の月の11月分を開いている時 11/19 に「今日」→ 次の12月分', a3.end === '2026-12', a3);
  const a4 = sim('2026-08', '2026-11-19T10:00:00+09:00', 0);
  t('月末締め・8月分から「今日」→ 11月分', a4.end === '2026-11' && a4.visits.join() === '2026-11', a4);
  const b1 = play('2026-09', '2026-11-19T10:00:00+09:00', 15, ['today', 'pick:2026-05', 'drain']);
  t('見直し2:「今日」の読み込みが終わる前に手で5月分を選ぶ → 追い越された読み込みは捨て、5月分から勝手に進まない', b1.end === '2026-05', b1);
  const b2 = play('2026-09', '2026-11-19T10:00:00+09:00', 15, ['today', 'fail', 'pick:2026-05', 'drain']);
  t('見直し2:「今日」の読み込みが失敗した後に手で5月分を選ぶ → 5月分のまま（向けた月の印は手で選んだ時に消える）', b2.end === '2026-05', b2);
  const b3 = play('2026-09', '2026-11-19T10:00:00+09:00', 15, ['today', 'fail', 'today', 'drain']);
  t('見直し2: 失敗の後にもう一度「今日」→ 今日の月分（12月分）へ', b3.end === '2026-12', b3);
}
/* ★v4（2026-11-20）: 版を上げたので期待を新しい版の完全一致に改め、kintai-calc.js を読む給与の画面（payroll.html）も同じ版かを足した */
/* ★反証レビューの直し（2026-11-20 の2回目）で kintai.js を ?v=2026-11-20.2、iPhone の幅の見た目の直し（2026-11-20 の3回目）で ?v=2026-11-20.3、職員の入職順の並び（4回目）で ?v=2026-11-20.4、表示名と入職順の並びの残り（5回目）で ?v=2026-11-20.5、打刻の番号と従業員コードの順・日ごとの読み直し（6回目）で ?v=2026-11-20.6、出勤予定の手直し・前提（7回目・0111）で ?v=2026-11-20.7 に上げた（kintai-calc.js は従業員コードの A を抜く直しで 2026-11-20.1）。
   v5 段1（8回目・0112・所定内（法定内）の名前・直しの履歴の言い方・勤怠の管理者の欄）で kintai.js を ?v=2026-11-20.8 に上げた（kintai-calc.js は変えていないので 2026-11-20.1 のまま）。
   v5 段2・3（9回目・ホーム・36協定・反証A5／A6 の計算の直し・丸める前の値）で kintai.js を ?v=2026-11-20.9、kintai-calc.js を ?v=2026-11-20.2 に上げた（給与・打刻の画面も版だけ上げた）。
   v5 段4（10回目・休暇の種類・丸めの単位・管理簿の印刷）で kintai.js を ?v=2026-11-20.10、kintai-calc.js を ?v=2026-11-20.3 に上げた（給与・打刻の画面も版だけ上げた）。
   v5 段4 の積み残しと反証レビューの直し（11回目・ホームの期限の近い残りの書き方・締めの比べる鍵・振替の注意・丸めで実働を短くしない・人ごとの1日の時間）で
   kintai.js を ?v=2026-11-20.11、kintai-calc.js を ?v=2026-11-20.4 に上げた（給与・打刻の画面も版だけ上げた） */
/* ★勤怠 v5 段4 の給与の側（2026-11-20）: kintai-calc.js（時間単位の有休の時間を遅刻・早退に数えない）を ?v=2026-11-20.5 に上げた（kintai.js は変えていない） */
/* ★来月分の線を暦の月にそろえた直し（2026-11-20）で kintai.js を ?v=2026-11-20.12 に上げた */
/* ★給与の側の反証レビューの直し（2026-11-20）で kintai.js を ?v=2026-11-20.13、kintai-calc.js を ?v=2026-11-20.6 に上げた */
/* ★再確認の反証の直し（2026-11-20・欠勤の印と部分の休暇）で kintai.js を ?v=2026-11-20.14、kintai-calc.js を ?v=2026-11-20.7 に上げた */
t('kintai.js・kintai-calc.js の読み込みは ?v=2026-11-20.14・2026-11-20.7（両画面と給与の画面でそろえる）', /kintai\.js\?v=2026-11-20\.14"/.test(H) && /kintai-calc\.js\?v=2026-11-20\.7"/.test(H) && /kintai-calc\.js\?v=2026-11-20\.7"/.test(HC) && /kintai-calc\.js\?v=2026-11-20\.7"/.test(read('payroll.html')));

const await_pending = [];   /* 動かして確かめる試験（Promise）を最後に待つ */
console.log('\n— 12. v4 職員マスタ・勤務時間の手入力・有給（2026-11-20・凍結した仕様書 ROOT-v4-master-leave.md） —');
{
  const between = (a, b) => { const i = K.indexOf(a), j = K.indexOf(b, i + 1); return i >= 0 && j > i ? K.slice(i, j) : ''; };
  const loadFn = between('function load(', 'function recompute(');
  const workFn = between('function saveWork(', '/* ── v4: 職員マスタの突き合わせ');
  const openWorkFn = between('function openWork(', 'function saveWork(');
  const leaveActFn = between('function leaveAct(', '/* ── 職員・締め・出力・設定 ── */');
  const loadLeaveFn = between('function loadLeave(', 'function leaveOf(');
  const leaveMonthsFn = between('function loadLeaveMonths(', 'function loadLeave(');
  t('「有給」のタブは「職員と番号」の次（HTML の並び）・パネルの関数は paintLeave', /data-tab="staff">職員と番号<\/button>\s*<button type="button" role="tab" data-tab="leave">有給<\/button>/.test(H) && /leave: paintLeave/.test(K));
  /* ★v5 段2・3（2026-11-20）: kintai-calc.js の版を上げたので、並びの確かめの kintai-calc.js の版の期待を 2026-11-20.2 に改めた */
  /* ★v5 段4（2026-11-20）: kintai-calc.js・kintai-leave.js の中身を変えて版を 2026-11-20.3 に上げたので、期待の版を改めた（並びの確かめは同じ） */
  /* ★反証レビューの直し（2026-11-20）: 同じ2つの部品の中身を変えて版を 2026-11-20.4 に上げたので、期待の版を改めた（並びの確かめは同じ） */
  /* ★勤怠 v5 段4 の給与の側（2026-11-20）: kintai-calc.js だけ版を 2026-11-20.5 に上げたので、その期待の版を改めた（kintai-leave.js は .4 のまま・並びの確かめは同じ） */
  /* ★給与の側の反証レビューの直し（2026-11-20）: kintai-calc.js を 2026-11-20.6 に上げたので、その期待の版を改めた */
  /* ★再確認の反証の直し（2026-11-20）: kintai-calc.js を 2026-11-20.7 に上げたので、その期待の版を改めた */
  t('kintai-leave.js は kintai-calc.js の後・kintai.js の前に読む（?v=2026-11-20.4・反証レビューの直しで上げた）', H.indexOf('<script src="kintai-calc.js?v=2026-11-20.7"></script>') >= 0 && H.indexOf('<script src="kintai-leave.js?v=2026-11-20.4"></script>') > H.indexOf('kintai-calc.js?v=') && H.indexOf('kintai-leave.js?v=') < H.indexOf('kintai.js?v='));
  /* iPhone の幅（640px 以下）だけの見た目の直し（2026-11-20）: 窓の欄の見出しを縦1字にしない・枠（fieldset）を窓の外へ広げない・突き合わせの表は1人ずつの並び */
  {
    const mq = (H.match(/@media \(max-width:640px\)\{[\s\S]*?\n\s*table\.mt td\.empty\{display:block\}\}/) || [''])[0];
    t('640px 以下だけ: .row > label を折り返し（ラジオ・チェックの欄は除く・直書きの最小幅も外す・隠した見出しは値の前に出す）・入力と選ぶ欄は幅100%まで・fieldset{min-width:0}・table.mt を1人ずつの並びに', /\.row > label:not\(:has\(> input\[type=radio\]\)\):not\(:has\(> input\[type=checkbox\]\)\)\{flex-wrap:wrap;max-width:100%\}/.test(mq) && /min-width:0!important/.test(mq) && /td\[data-l\]::before/.test(mq) && /fieldset\{min-width:0\}/.test(mq) && /table\.mt thead th:not\(:first-child\)\{display:none\}/.test(mq));
    t('突き合わせの2つの表に class="mt"・雇用区分は職員マスタの呼び名（パート・臨時など）', (K.match(/<table class="mt">/g) || []).length === 2 && /EMP_JA\[m\.employment_type\]/.test(K) && /part: 'パート'/.test(K));
  }
  t('.gitignore に !/kintai-leave.js（公開の opt-in）', /^!\/kintai-leave\.js$/m.test(read('.gitignore')));
  t('月の計算に手で入れた有休（data.leave_uses）を渡す（L8）', /C\.computeMonth\(\{ ym: ym, period: data\.period, [^}]*leave_uses: data\.leave_uses, config: cfg,/.test(K));
  t('職員マスタ・有給の関数は読み込み（load）の鎖に入れない（0106 の前の DB でも月の画面は止まらない）', !/kintai_master_list|kintai_leave_get|kintai_master_import/.test(loadFn) && loadFn.length > 0);
  const linkFn = between('function saveLink(', 'function openAdd(');
  t('職員マスタの関数名と引数: kintai_master_list・kintai_master_import(p_reason)・kintai_staff_link(p_staff_id, p_master_id, p_reason)・kintai_master_add(p_master_ids, p_reason)・kintai_staff_clock_visible(p_staff_id, p_visible, p_reason)',
    /rpc\('kintai_master_list', \{\}\)/.test(K) && /rpc\('kintai_master_import', \{ p_reason: reason \}\)/.test(K) &&
    /ops\.push\(\{ p_staff_id: sid, p_master_id: v, p_reason: reason \}\)/.test(linkFn) && /rpc\('kintai_staff_link', ops\[done\]\)/.test(linkFn) &&
    /rpc\('kintai_master_add', \{ p_master_ids: \[ctx\.mid\], p_reason: reason \}\)/.test(K) && /rpc\('kintai_staff_clock_visible', \{ p_staff_id: ctx\.sid, p_visible: ctx\.to, p_reason: reason \}\)/.test(K));
  t('突き合わせの結果は linked・deactivated・unmatched_staff・unmatched_master（足すのは別の kintai_master_add・足した人は打刻画面に出る旨を足す前に出す）', /r\.linked/.test(K) && /r\.deactivated/.test(K) && /r\.unmatched_staff/.test(K) && /r\.unmatched_master/.test(K) && !/r\.added \|\| 0/.test(K) && /足した人は打刻画面の名簿に出ます/.test(between('function openAdd(', 'function saveAdd(')));
  t('結べていない職員マスタの人ごとに「シフトの職員に結ぶ」「新しい職員として足す」', /data-act="m-link-m" data-mid="/.test(K) && /data-act="m-add" data-mid="/.test(K));
  t('結んであるかは DB の master_id だけで見る（外した m_ の行を結んであると数えない）', /function masterIdOf\(s\) \{ return s && s\.master_id \? String\(s\.master_id\) : null; \}/.test(K));
  t('m_ の人をシフトの職員に寄せる時は、m_ の行を外して（null）からシフトの職員に結ぶ', /if \(o && o\.staff_id !== sid && srcOf\(o\) === 'master' && o\.master_id === v\) ops\.push\(\{ p_staff_id: o\.staff_id, p_master_id: null, p_reason: reason \}\);/.test(linkFn) && linkFn.indexOf('p_master_id: null') < linkFn.indexOf('p_master_id: v'));
  t('有給の関数名と引数（kintai_leave_get・profile_put・grant_add/void・use_add/void）', /rpc\('kintai_leave_get', \{\}\)/.test(loadLeaveFn) &&
    /'kintai_leave_use_add', \{ p_staff_id: ctx\.sid, p_use_date: ud, p_days: un === 0\.5 \? 0\.5 : 1, p_note: /.test(leaveActFn) && /'kintai_leave_use_void', \{ p_id: btn\.getAttribute\('data-id'\), p_reason: reason \}/.test(leaveActFn) &&
    /'kintai_leave_grant_add', \{ p_staff_id: ctx\.sid, p_grant_date: gd, p_days: gn, p_kind: [^,]+, p_note: /.test(leaveActFn) && /'kintai_leave_grant_void', \{ p_id: btn\.getAttribute\('data-id'\), p_reason: reason \}/.test(leaveActFn) &&
    /'kintai_leave_profile_put', \{ p_staff_id: ctx\.sid, p_patch: patch, p_rev: ctx\.rev, p_reason: reason \}/.test(leaveActFn));
  t('設定で送るのは hire_date・weekly_days・weekly_hours・opening_date・skip_grants だけ', (leaveActFn.match(/patch\.(\w+) =/g) || []).map((x) => x.slice(6, -2)).sort().join() === 'hire_date,opening_date,skip_grants,weekly_days,weekly_hours');
  t('取り消しと設定の保存は理由が要る（needR を通る）', /'lv-use-void'\) \{\s*if \(!needR\(\)\) return;/.test(leaveActFn) && /'lv-grant-void'\) \{\s*if \(!needR\(\)\) return;/.test(leaveActFn) && /if \(!needR\(\)\) return;\s*call = \['kintai_leave_profile_put'/.test(leaveActFn));
  /* ★反証レビュー（2026-11-20）: 空の月分1つで止まっていたのを、入職日（分からなければ24か月前）まで・空が3つ続いたら止める形に直したので期待を改めた
     ★総点検（2026-11-20）: 速さのため同時に読む形にしたので、本文の形の確かめを新しい形にした（読む月分の並びは下の動きの試験が今までと同じ期待のまま確かめる） */
  t('シフトの有休の日は月分ごとに kintai_month_get を読み、KintaiLeave.usesFromMonth で手入力と合わせる（下限は入職日か24か月前・最大24か月分・空の月分が3つ続いたら止める）', /rpc\('kintai_month_get', \{ p_ym: y \}\)/.test(leaveMonthsFn) && /if \(!\(n < 24 && n \+ 1 < ys\.length && \(n < 1 \|\| emptyRun < 3\)\)\) stop = true;/.test(leaveMonthsFn) && /ys\.slice\(i, i \+ \(3 - emptyRun\)\)/.test(leaveMonthsFn) && /L\.usesFromMonth\(x\.months, manual\)/.test(loadLeaveFn) && /mp\.then\(function \(\) \{ return loadLeaveMonths\(my, lg\); \}\)/.test(loadLeaveFn));
  t('反証レビュー: 移行の残りを足す時に移行日が空なら、移行日（既定は今日）も設定に入れる（付与の後に profile_put）', /if \(call\[1\]\.p_kind === 'opening' && !\(ctx\.prof && ctx\.prof\.opening_date\)\)/.test(leaveActFn) && /then2 = \['kintai_leave_profile_put', \{ p_staff_id: ctx\.sid, p_patch: \{ opening_date: od \}, p_rev: ctx\.rev,/.test(leaveActFn) && /rpc\(call\[0\], call\[1\]\)\.then\(okOr\)\.then\(function \(\) \{ return then2 \? rpc\(then2\[0\], then2\[1\]\)\.then\(okOr\) : null; \}\)/.test(leaveActFn) && /id="lv-g-open" value="' \+ esc\(td\) \+ '"/.test(K));
  t('反証レビュー: 移行日が未設定の人は一覧と窓に注意（移行の残りからみなした日を出す）', /if \(sm\.openingMissing\) hire \+= '<span class="tag rv">移行日が未設定<\/span>';/.test(K) && /sm\.openingMissing \? '<div class="band warn"[^>]*>移行日が未設定です。/.test(K));
  t('反証レビュー: 打刻（実働）がある日に手入力の有休を足す時は確かめる（止めはしない）', /var wm = workedMin\(ctx\.sid, ud\);\s*if \(wm > 0 && !confirm\([^;]*この日を有休にしますか？'\)\) return;/.test(leaveActFn));
  /* 下限の月と止め方を、画面の関数をそのまま取り出して偽の月分で動かす */
  {
    const floorFn = between('function leaveFloorYm(', 'function loadLeaveMonths(');
    const sim = (hires, emptyFrom) => {
      const asked = [];
      const f = new Function('C', 'L', 'NOW', 'HIRES', 'EMPTY', 'ASKED', `
        var leaveGen = 1, data = { staff: HIRES.map(function (h, i) { return { staff_id: 's' + i, active: true, master_id: h ? 'M' + i : null }; }) };
        function masterOf(s) { var i = +s.staff_id.slice(1); return HIRES[i] ? { hire_date: HIRES[i] } : null; }
        function todayYm() { return NOW; }
        function okOr(r) { return r; }
        function monthFor() { return {}; }
        function rpc(n, a) { ASKED.push(a.p_ym); return Promise.resolve({ ok: true, schedule: a.p_ym < EMPTY ? [] : [{}], leave_uses: [] }); }
        ${floorFn}
        ${leaveMonthsFn}
        return loadLeaveMonths(1, { profiles: [] });`);
      return f(require(path.join(ROOT, 'kintai-calc.js')), require(path.join(ROOT, 'kintai-leave.js')), '2026-11', hires, emptyFrom, asked).then(() => asked);
    };
    const pend = [
      sim(['2019-04-01'], '2026-10').then((a) => t('空の月分が3つ続いたら止める（9月分から空 → 9・8・7月分まで読んで止める）', a.join() === '2026-12,2026-11,2026-10,2026-09,2026-08,2026-07', a)),
      sim(['2026-09-15'], '0000-00').then((a) => t('入職日の月より前は読まない（入職 2026/9 → 9月分まで）', a.join() === '2026-12,2026-11,2026-10,2026-09', a)),
      sim(['2019-04-01', null], '0000-00').then((a) => t('入職日が分からない人がいれば24か月前の月分まで（来月分＋今月分＋前の24か月分＝26件・最後は 2024/11）', a.length === 26 && a[a.length - 1] === '2024-11', [a.length, a[a.length - 1]]))
    ];
    await_pending.push(...pend);
  }
  t('勤務時間を手で入れる窓: 職員は全員（data.staff）から・日付はこの月分の中・理由は必ず', /staffSorted\(\)/.test(openWorkFn) && /min="' \+ ds\[0\] \+ '" max="' \+ ds\[ds\.length - 1\] \+ '"/.test(openWorkFn) && /if \(!reason\) \{ msg\.textContent = '理由を書いてください/.test(workFn) && /!inPer\(d\)/.test(workFn));
  t('勤務時間は今の関数で入れる（kintai_punch_add の出勤・退勤 → 休憩を入れた時だけ kintai_day_put）・終業が始業より前なら翌日', /\{ f: 'kintai_punch_add', a: \{ p_staff_id: sid, p_kind: 'in', p_at: inAt, p_reason: reason \} \}, \{ f: 'kintai_punch_add', a: \{ p_staff_id: sid, p_kind: 'out', p_at: outAt, p_reason: reason \} \}/.test(workFn) &&
    /if \(br != null && [^)]*\)\) ops\.push\(\{ f: 'kintai_day_put', a: \{ p_staff_id: sid, p_date: d, p_patch: \{ break_min: br \}, p_rev: dn \? dn\.rev : 0, p_reason: reason \} \}\)/.test(workFn) && /var d1 = t1 < t0 \? C\.addDays\(d, 1\) : d;/.test(workFn));
  t('勤務時間の途中で断られたら窓を閉じて読み直す（もう一度押して打刻を二重に足さない）', /if \(done\) \{ closeDlg\(\); load\(false\);/.test(workFn));
  t('締めた月分は窓に出し、保存のボタンを出さない・締めた期間は断られる旨を書く', /openDlg\('勤務時間を手で入れる（' \+ perLabel\(\) \+ '）', b, lk, '入れる', 'work-save'\)/.test(openWorkFn) && /締めた月分の日は断られます/.test(openWorkFn));
  t('「勤務時間を手で入れる」のボタン（日ごと・個人の月）', (K.match(/data-act="work-open">勤務時間を手で入れる</g) || []).length === 2 && /a === 'work-open'\) openWork\(\)/.test(K));
  /* 0111（2026-11-20）で予定の手直し・前提の窓を後ろに足したので、今までの窓が全部あることを確かめ、後ろに足した窓は許す */
  t('保存していない入力を確かめる窓に、手入力・有給・結び付けを足した', /var DIRTY_MODES = \{ edit: 1, work: 1, leave: 1, link: 1, mimport: 1, clockvis: 1, madd: 1, dname: 1(, [a-z]+: 1)* \}/.test(K) && /if \(!dlgCtx \|\| !DIRTY_MODES\[dlgCtx\.mode\] \|\| dlgCtx\.init == null\) return false;/.test(K));
  t('職員マスタ・有給の記録を端末に残さない（v4 の関数の中に localStorage が無い）', !/localStorage/.test(between('/* ── v4: 職員マスタとの結び付け', '/* ── 締めた時の控え') + between('/* ── v4: 勤務時間を手で入れる', '/* ── 職員・締め・出力・設定 ── */')));
  t('v4 で innerHTML の代入を増やしていない（描くのは paint と openDlg の2か所のまま）', !/innerHTML/.test(between('/* ── v4: 職員マスタとの結び付け', '/* ── 締めた時の控え') + between('/* ── v4: 勤務時間を手で入れる', '/* ── 職員・締め・出力・設定 ── */')));
  t('入職日は職員マスタ（hire_date）から・有給の設定の hire_date があればそちら（KintaiLeave.summary の hireOf）', /L\.summary\(\{ hireDate: m && m\.hire_date, profile: prof,/.test(K) && /if \(profile && isDate\(profile\.hire_date\)\) return profile\.hire_date;/.test(read('kintai-leave.js')));
  t('DB の断りの語（nomaster・masterrow・dup・locked・already・badkind・badvalue・baddate・badkey・badshape・reason・conflict・notfound）に文がある', ['nomaster', 'masterrow', 'dup', 'locked', 'already', 'badkind', 'badvalue', 'baddate', 'badkey', 'badshape', 'reason', 'conflict', 'notfound'].every((w) => new RegExp('[{ ]' + w + ": '").test(K)));
  /* 2026-11-20 代表者の指示: 職員の並びを、事業所は無視して入職順に（入職日の分からない人は最後に番号の順）。画面の関数をそのまま取り出して動かす */
  {
    const sortFn = between('function hireDateOf(', 'function srcOf(') || between('function hireDateOf(', '/* 結んだ職員マスタの id');
    const run = (staff, hires, profs) => new Function('L', 'STAFF', 'HIRES', 'PROFS', `
      var data = { staff: STAFF }, leaveSt = PROFS ? { profiles: PROFS } : null;
      function masterOf(s) { return HIRES[s.staff_id] ? { hire_date: HIRES[s.staff_id] } : null; }
      ${sortFn}
      return staffSorted().map(function (s) { return s.staff_id; }).join();`)(require(path.join(ROOT, 'kintai-leave.js')), staff, hires, profs);
    const st = [
      { staff_id: 'a', office: 'day', code: '1000' }, { staff_id: 'b', office: 'day', code: '2000' }, { staff_id: 'c', office: 'day', code: '0500' },
      { staff_id: 'd', office: 'day', code: '0100' }, { staff_id: 'e', office: 'facility', code: '9000' }, { staff_id: 'f', office: 'facility', code: '8000' }];
    const h = { a: '2020-04-01', b: '2015-07-01', c: '2022-06-03', e: '2018-01-01', f: '2019-01-01' };
    t('職員は事業所に関係なく入職日の古い順・入職日の分からない人（d）は最後', run(st, h, null) === 'b,e,f,a,c,d', run(st, h, null));
    t('有給の設定の入職日は並びに使わない（有給の記録を読んだかで並びが変わらない・c を 2010 に上書きしても同じ並び）', run(st, h, { c: { hire_date: '2010-01-01' } }) === 'b,e,f,a,c,d', run(st, h, { c: { hire_date: '2010-01-01' } }));
    t('入職日の分からない人どうしは打刻の番号の順', run([{ staff_id: 'x', office: 'day', code: '3000' }, { staff_id: 'y', office: 'day', code: '0300' }], {}, null) === 'y,x');
    /* 2026-11-20 の6回目（代表者の指示）で「職員と番号」の表だけ従業員コードの順に変えた（下の 14） */
    t('「職員と番号」の表は従業員コードの順（paintStaff は staffByEmp を使い、staffByEmp は staffSorted の並びを土台にする）', /function paintStaff\(\) \{\s*var list = staffByEmp\(\);/.test(K) && /function staffByEmp\(\) \{\s*return staffSorted\(\)/.test(K));
  }
  console.log('\n— 13. 職員の並び（入職順）と表示名（2026-11-20 代表者の指示・統合 0107）—');
  {
    const recFn = between('function recompute()', '/* ── 描画 ── */');
    t('月の計算に渡す職員は staffSorted の並び（日ごと・要確認・月の一覧・個人の月の選択肢がこの並び）', /staff: staffSorted\(\),/.test(recFn) && !/staff: data\.staff \|\| \[\]/.test(recFn));
    t('番号の表（印刷）は「職員と番号」の表と同じ従業員コードの順・「結べていないシフトの職員」は入職順', /var printable = list\.filter\(/.test(K) && /var unS0 = staffSorted\(\)\.filter\(/.test(K));
    t('勤務時間を手で入れる窓の職員は名前の順のまま（表示名で並べる）', /staffSorted\(\)\.sort\(function \(a, b\) \{ return dispName\(a\)\.localeCompare\(dispName\(b\), 'ja'\); \}\)/.test(K));
    t('読み込んだ後に職員マスタをまだ読んでいなければ裏で読み、読めたら数え直す（描き直すのは並びを出すタブだけ・締めと設定のタブは描き直さない）', /if \(!masterSt && !masterBusy\) loadMaster\(\);/.test(K) && /if \(!busy && data && !\(masterSt && masterSt\.err\)\) recompute\(\);/.test(K) && /if \(view === 'app' && !busy && REORDER_TABS\[tab\]\) paint\(\);/.test(K) && /var REORDER_TABS = \{ home: 1, day: 1, review: 1, grid: 1, person: 1, staff: 1, leave: 1 \};/.test(K));
    const dnSrc = between('function dispName(', '\n');
    const dn = dnSrc ? new Function(dnSrc + '\nreturn dispName;')() : null;
    t('表示名があれば表示名・無ければシフトの名前・どちらも無ければ職員ID',
      !!dn && dn({ name: '予定 架空', display_name: '架空' }) === '架空' && dn({ name: '架空 二', display_name: null }) === '架空 二' && dn({ staff_id: 'x1' }) === 'x1' && dn(null) === '');
    t('画面に出す職員の名前は表示名（esc(s.name)・p.staff.name を出す所は「シフトの名前」の注記と表示名の窓の説明の2か所だけ）',
      (K.match(/esc\(s\.name\)/g) || []).length === 2 && /シフトの名前：' \+ esc\(s\.name\)/.test(K) && !/p\.staff\.name/.test(K) && !/esc\(st\.name\)/.test(K));
    t('シフトの取り込みに送り返す名前は name のまま（表示名を送らない）', /name: String\(kn\.name \|\| st\.name \|\| st\.id\)\.slice\(0, 60\)/.test(K));
    t('「職員と番号」の表に「表示名を変える」のボタンと、表示名のある人はシフトの名前を小さく出す', /data-act="dname" data-sid="' \+ esc\(s\.staff_id\) \+ '">表示名を変える<\/button>/.test(K) && /\(s\.display_name \? '<br><span class="raw">シフトの名前：' \+ esc\(s\.name\) \+ '<\/span>' : ''\)/.test(K));
    const saveFn = between('function saveDispName(', '/* ── v4: 有給の窓');
    t('表示名は kintai_staff_display_name_put（職員ID・名前・理由）で送る・60字まで・理由は必ず・保存したら読み直す',
      /rpc\('kintai_staff_display_name_put', \{ p_staff_id: ctx\.sid, p_name: v, p_reason: reason \}\)/.test(saveFn) && /if \(v\.length > 60\)/.test(saveFn) && /needReason\(msg\); if \(!reason\) return;/.test(saveFn) && /return load\(false\);/.test(saveFn)
      && /id="e-dname" maxlength="60"/.test(K) && /a === 'dname'\) openDispName/.test(K) && /a === 'dname-go'\) saveDispName\(b\)/.test(K));
    t('表示名の断り（toolong）に職員向けの文がある', /toolong: '/.test(K));
    /* 反証レビュー（2026-11-20）の指摘1: CSV の氏名の列と書き出しの後の注意も表示名。画面の writeCsv と同じ形で写しを作り、本物の buildCsv に通して確かめる */
    {
      const csvFn = between('function writeCsv(', 'var res = C.buildCsv(');
      const C2 = require(path.join(ROOT, 'kintai-calc.js'));
      t('CSV に渡す写しは、職員の名前を表示名に替えてから buildCsv に渡す', /src = Object\.assign\(\{\}, src, \{ people: \(src\.people \|\| \[\]\)\.map\(function \(p\) \{ return Object\.assign\(\{\}, p, \{ staff: Object\.assign\(\{\}, p\.staff, \{ name: dispName\(p\.staff\) \}\) \}\); \}\) \}\);/.test(csvFn));
      const mon = C2.computeMonth({ ym: '2026-10', staff: [{ staff_id: 'x1', code: '0101', name: '予定 架空', display_name: '架空', office: 'facility', emp_code: '9901', active: true }], schedule: [], punches: [{ id: 'p1', staff_id: 'x1', kind: 'in', at: '2026-10-05T00:00:00Z' }, { id: 'p2', staff_id: 'x1', kind: 'out', at: '2026-10-05T08:00:00Z' }], days: [], config: {} });
      const dnSrc2 = between('function dispName(', '\n');
      const copy = new Function('src', dnSrc2 + '\n' + "src = Object.assign({}, src, { people: (src.people || []).map(function (p) { return Object.assign({}, p, { staff: Object.assign({}, p.staff, { name: dispName(p.staff) }) }); }) });\nreturn src;")(mon);
      const out = C2.buildCsv(copy, { nameOf: (d) => d, extraCols: true });
      t('写しの CSV の氏名は表示名・元の月の計算の職員の名前は変えない', /架空/.test(out.summary) && !/予定 架空/.test(out.summary) && mon.people[0].staff.name === '予定 架空', out.summary.split('\n').slice(0, 2));
    }
    t('表示名を空にして保存した時の知らせは、戻した先のシフトの名前を出す（読み直す前の古い表示名を出さない）', /'表示名を消しました（シフトの名前「' \+ \(s0 \? s0\.name : ctx\.sid\) \+ '」に戻しました）'/.test(K));
    t('直しの記録の操作の名前に「表示名を変えた」', /display_name: '表示名を変えた'/.test(K));
  }
  t('打刻画面に出さない人は「結べていないシフトの職員」に出さず、件数だけ添える', /var unS = unS0\.filter\(function \(s\) \{ return s\.clock_visible !== false; \}\)/.test(K) && /打刻画面に出さない ' \+ unHid \+ ' 人/.test(K));
}

console.log('\n— 14. 打刻の番号と従業員コードの順・日ごとの読み直し（2026-11-20 代表者の指示・統合 0108）—');
{
  const between = (a, b) => { const i = K.indexOf(a), j = K.indexOf(b, i + 1); return i >= 0 && j > i ? K.slice(i, j) : ''; };
  const byEmpSrc = between('function staffByEmp(', 'function paintStaff(');
  const run = (staff) => new Function('STAFF', `
    function staffSorted() { return STAFF.slice(); }
    ${byEmpSrc}
    return { order: staffByEmp().map(function (s) { return s.staff_id; }).join(), fixed: fixedCode };`)(staff);
  /* 架空の職員。staffSorted（入職順）の並びは e,c,a,d,b のつもりで渡す */
  const st = [{ staff_id: 'e', emp_code: null, code: '4100' }, { staff_id: 'c', emp_code: '0003', code: '0003', master_id: 'S3' },
    { staff_id: 'a', emp_code: '0001', code: '0001', master_id: 'S1' }, { staff_id: 'd', emp_code: '0010', code: '5100' }, { staff_id: 'b', emp_code: '0002', code: '0002', master_id: 'S2' }];
  const r = run(st);
  t('従業員コードの順（0001・0002・0003・0010）・従業員コードの無い人は後ろ', r.order === 'a,b,c,d,e', r.order);
  t('従業員コードの無い人どうし・同じ従業員コードの人どうしは入職順のまま', run([{ staff_id: 'y', emp_code: null }, { staff_id: 'x', emp_code: null }, { staff_id: 'q', emp_code: '0005' }, { staff_id: 'p', emp_code: '0005' }]).order === 'q,p,y,x');
  t('数字の長さが違っても数の順（0009 の後に 0010・100 の後に 1000）', run([{ staff_id: 'm', emp_code: '1000' }, { staff_id: 'n', emp_code: '0010' }, { staff_id: 'o', emp_code: '0009' }]).order === 'o,n,m');
  t('職員マスタと結んで 0 で始まる番号の人は「番号を振り直す」を出さない（結んでいない人・乱数の番号の人は出す）',
    r.fixed({ master_id: 'S1', code: '0001' }) === true && r.fixed({ master_id: null, code: '0001' }) === false && r.fixed({ master_id: 'S1', code: '4100' }) === false && r.fixed(null) === false
    && /\(fixedCode\(s\) \? '' : '<button type="button" class="btn sm" data-act="recode"/.test(K));
  t('直しの記録の名前に「打刻の番号を職員No に合わせた」（DB の code_fixed）', /code_fixed: '打刻の番号を職員No に合わせた'/.test(K));
  t('説明文に「職員No の頭に 0」と「頭の A を抜いた4桁」と「従業員コードの順」', /職員マスタの職員No の頭に 0 を付けた番号（職員No 001 なら 0001）/.test(K) && /頭の A を抜いた4桁（A001 なら 0001）/.test(K) && /この表は従業員コードの順です。/.test(K));
  const q = between('var quietBusy = 0, quietSeq = 0;', '\n  function showField(');
  /* ★v5 段2（2026-11-20）: 仕様「30秒ごとの読み直しは日ごと・要確認と同じ道に乗せる」でホーム（home）を足したので、タブを移った時・読み直す条件の期待を改めた。
     タブを移る時は保存していない設定の変更を確かめる（C4）ので、その呼び出しも期待に入れた。描き直す並びのタブ（REORDER_TABS）にもホームを足した */
  t('ホーム・日ごと・要確認は30秒ごとに打刻を読み直す（kintai_month_get）・画面が見えた時とタブを移った時もすぐ読む',
    /setInterval\(function \(\) \{ quietReload\(\); \}, 30000\);/.test(K) && /visibilitychange', function \(\) \{ if \(document\.visibilityState === 'visible'\) quietReload\(\); \}/.test(K)
    && /if \(TABS\.indexOf\(t\) < 0\) t = 'home'; if \(!settingsLeaveOk\(\)\) return; tab = t; lsSet\(LS_TAB, t\); paint\(\); if \(t === 'home' \|\| t === 'day' \|\| t === 'review'\) quietReload\(\);/.test(K) && /rpc\('kintai_month_get', \{ p_ym: ym \}\)/.test(q));
  t('読み直しは窓・保存中・印刷中・選ぶ欄の操作中・隠れている時・ほかのタブではしない（入力を消さない）',
    /if \(view !== 'app' \|\| busy \|\| !month \|\| !data \|\| dlgCtx \|\| printAll \|\| \(tab !== 'home' && tab !== 'day' && tab !== 'review'\)\) return false;/.test(q) && /visibilityState === 'hidden'\) return false;/.test(q) && /ae\.tagName === 'SELECT'/.test(q));
  t('届いた時に読み込みの世代・月・状態が変わっていれば捨てる・答えを待つ間は手元で数え直す・20秒で諦めて古い答えは番号で捨てる・失敗は記録して手元で数え直すだけ',
    /if \(my !== gen \|\| atYm !== ym \|\| !quietOk\(\)\) return;/.test(q) && /if \(!quietOk\(\)\) return;/.test(q) && /if \(quietBusy && Date\.now\(\) - quietBusy < 20000\) \{ recompute\(\); paint\(\); return; \}/.test(q) && /if \(seq !== quietSeq\) return;\s*quietBusy = 0;/.test(q) && /note\('自動の読み直し', e\);/.test(q) && !/alert\(/.test(q));
}

Promise.all(await_pending.concat(pendClock)).catch((e) => { fail++; console.log('  ✗ 動かして確かめる試験が止まった  → ' + e.message); }).then(() => {
  console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
  process.exit(fail ? 1 : 0);
});
