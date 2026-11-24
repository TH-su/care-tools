/* 給与の画面（payroll.html・payroll.js）の試験（2026-11-19 新設・凍結仕様 給与/ROOT-payroll.md の D・契約 CONTRACT-payroll-v1.md §5）
   実行: node check/unit/payroll_page_test.js
   守りたいこと:
     1. 入口: 「現場端末の止め → SUAppGate.run('payroll') → 二段階のログイン（aal2）の確かめ → payroll_bootstrap」の順。部品が無ければ開かない。
        門番の APPS の既定は管理者だけ（事務所・現場は開けない）。メニューは管理者専用・事務所専用
     2. 権限の覆い: bootstrap が 42501 なら覆いの画面（給与の名簿に入っていない）、aal2 の断りなら二段階のログインへ案内。覆う時は読んだ物を捨てる
     3. 端末に残さない: localStorage に書くのは payroll_tab だけ（月分・金額・氏名・口座なし）。console に出さない。10分操作が無ければ描いた金額を捨てる
     4. タブの復元: ホワイトリストで確かめ、設定のタブは管理者だけ（そうでなければ今月の給与）
     5. 確定の窓: 件数・総額・警告の残り・今月変わった設定と調整を出し、「確定する」で読み直して数え直し、同じ時だけ payroll_run_confirm
     6. stale: 読み直して計算し直すだけで、確定し直さない
     7. 画面の頭: no-store・CSP（インラインのスクリプトなし）・su-errors が先・su-report・su-shell・全銀はスイッチの裏・口座の全桁は書き出しの時だけ
     8. 純関数（normBoot・figures・parseCsv・missingOf）を架空の値で確かめる */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const fnBody = (src, name, next) => src.slice(src.indexOf('function ' + name + '('), next ? src.indexOf(next, src.indexOf('function ' + name + '(') + 1) : undefined);

const J = read('payroll.js'), H = read('payroll.html'), G = read('su-app-gate.js'), IDX = read('index.html');

console.log('\n— 1. 入口 —');
const boot = J.slice(J.indexOf('function boot()'), J.indexOf('var go = function () { try { boot()'));
const iField = boot.indexOf('isField()'), iGate = boot.indexOf("SUAppGate.run('payroll'"), iAal = boot.indexOf("st.aal !== 'aal2'"), iLoad = boot.indexOf('pinStart()');   /* 0110: 読み込みは暗証番号の確かめ（pinStart）を通る */
t('boot は 現場端末の止め → 門番 → 二段階のログインの確かめ → 暗証番号 → 読み込み の順', iField >= 0 && iGate > iField && iAal > iGate && iLoad > iAal, [iField, iGate, iAal, iLoad]);
t('門番の部品が無ければ開かない', /if \(!window\.SUAppGate\) \{ showGate\('nocalc'\); return; \}/.test(boot));
t('門番が開けないと言えば何も読まない', /if \(!ok\) \{ view = 'gate'; return null; \}/.test(boot));
t('aal2 で無ければ二段階のログインの覆い（読み込まない）', /if \(st\.aal !== 'aal2'\) \{ showGate\('mfa'\); return null; \}/.test(boot));
t("門番の APPS に payroll（既定は事務所も現場も開けない＝管理者だけ）", /key: 'payroll', href: 'payroll\.html'[^}]*def: \{ office: false, field: false \}/.test(G));
const m = /<script type="application\/json" id="menuDef">([\s\S]*?)<\/script>/.exec(IDX);
const tiles = [].concat.apply([], JSON.parse(m[1]).sections.map((s) => s.tiles));
const tile = tiles.find((x) => x.href === 'payroll.html');
t('メニューの職員の区分に「給与」（管理者専用・事務所専用・勤怠管理の次）', !!tile && tile.adminOnly === true && tile.officeOnly === true && tiles[tiles.indexOf(tile) - 1].href === 'kintai.html', tile);
t('現場端末の止めは何も読まずに案内だけ', /function showField\(\) \{\s*view = 'field';/.test(J) && !/rpc\(/.test(fnBody(J, 'showField', 'function boot')));

console.log('\n— 2. 権限の覆い —');
const load = fnBody(J, 'load', 'function handleStale');
t('bootstrap の 42501 は覆い（aal2 の断りは二段階のログインへ）', /e\.code === '42501'/.test(load) && /showGate\(isAal\(e\) \? 'mfa' : 'denied'\)/.test(load));
t('覆いの文: 給与の名簿に入っていない／二段階のログイン', /このアカウントは給与の名簿に入っていません/.test(J) && /二段階のログイン（認証アプリの6桁）を済ませた時だけ開けます/.test(J));
const sg = fnBody(J, 'showGate', 'function showField');
t('覆う時は読んだ物（bs・計算・取り込み・紙）を捨て、画面を隠す', /bs = null; calc = null; importRows = null;/.test(sg) && /\$\('p-app'\)\.hidden = true;/.test(sg) && /put\(\$\('p-print'\), ''\)/.test(sg));
t('ログインの画面へ戻り先つきで案内', /login\.html\?next=payroll\.html/.test(sg));

console.log('\n— 3. 端末に残さない —');
t('localStorage.setItem は lsSet の1か所だけ', (J.match(/localStorage\.setItem/g) || []).length === 1 && /function lsSet\(k, v\) \{ try \{ localStorage\.setItem\(k, v\); \} catch \(_\) \{\} \}/.test(J));
const sets = J.match(/lsSet\(([^,]+),/g) || [];
t('lsSet で書くのは payroll_tab（LS_TAB）だけ', sets.length >= 1 && sets.filter((x) => x !== 'lsSet(k,').every((x) => /lsSet\(LS_TAB,/.test(x)) && /var LS_TAB = 'payroll_tab';/.test(J), sets);
t('sessionStorage・indexedDB・Cache を使わない', !/sessionStorage|indexedDB|caches\./.test(J));
t('console に出さない', !/console\./.test(J));
t('10分（IDLE_MS）操作が無ければ mask で描いた金額・窓・紙・取り込みを捨て、窓の答えを無効にする（maskGen）', /var IDLE_MS = 10 \* 60 \* 1000;/.test(J) && /masked = true; maskGen\+\+; closeDlg\(\); importRows = null; printList = null; audit = null; put\(\$\('p-print'\), ''\);/.test(J));
t('裏のタブから戻った時・窓に戻った時にも時間を確かめる', /visibilitychange', function \(\) \{ if \(!document\.hidden\) idleCheck\(\); \}/.test(J) && /addEventListener\('focus', idleCheck\)/.test(J));
t('金額を戻す時はログインを確かめ直す（役割・aal2 が違えば読み込み直す）', /SUAuth\.check\(\{ fresh: true \}\)/.test(fnBody(J, 'unmask', 'function idleCheck')) && /st\.aal !== 'aal2'\) \{ location\.reload\(\)/.test(J));
/* 統合 0102 に合わせた（2026-11-19 結びの段）: 全桁は payroll_bank_export の rows で受ける・全銀のスイッチは su-backend.json の payroll_zengin（設定の鍵 zengin_enabled は DB が断る）・
   記録の種類は zengin・journal・ledger・payslip・csv */
t('口座の全桁は全銀の時だけ payroll_bank_export で受け、作ったら捨てる', (J.match(/rpc\('payroll_bank_export'/g) || []).length === 1 && /r\.rows = null; r = null;/.test(J) && /download\(res\); res = null;/.test(J));
/* 全銀のスイッチは給与の設定 zengin_enabled（2026-11-19 反証レビュー 10・既定は使わない・DB も zengin_off で断る） */
t('全銀のボタンは給与の設定 zengin_enabled が true の時だけ・DB の断り zengin_off は別の知らせ', /function zenginOn\(\) \{ return cfg\(\)\.zengin_enabled === true; \}/.test(J) && /if \(zenginOn\(\)\) h \+= '<button[^']*data-k="zengin"/.test(J) && /if \(kind === 'zengin' && !zenginOn\(\)\) return;/.test(J)
  && /r\.error === 'zengin_off'/.test(J) && /c\.zengin_enabled = on\('s-zen'\);/.test(J) && !/su-backend\.json/.test(J));
/* ★統合 0118（2026-11-21）: 書き出し済みの月の振込データだけ、記録の種類を zengin_again にする（確かめの窓で「はい」の時）。記録が通ってから書き出す決まりは同じ */
t('書き出し・印刷は記録（payroll_export_log）が通ってから・種類の名前は統合 0102 の5つ（もう一度の振込は 0118 の zengin_again）', /rpc\('payroll_export_log', \{ p_ym: ym, p_kind: again \? 'zengin_again' : EXP_LOG\[kind\] \}\)\.then\(okOr\)\.then/.test(J) && /rpc\('payroll_export_log', \{ p_ym: ym, p_kind: 'payslip' \}\)\.then\(okOr\)\.then/.test(J)
  && /var EXP_LOG = \{ zengin: 'zengin', journal: 'journal', ledger: 'ledger', list: 'csv' \};/.test(J));
t('書き出しの部品が作れないと言った時（ok が false）はファイルを落とさない', /if \(res\.ok === false\) \{[\s\S]{0,400}?return load\(true\);\s*\}\s*download\(res\)/.test(J));
t('確定の後に口座が直された（bank_export の stale）は計算し直しの stale と別の知らせ', /r\.error === 'stale'\) \{ var e = new Error\('bankstale'\); e\.payroll = 'bankstale'; throw e; \}/.test(J) && /bankstale: '確定した後に振込先の口座が直されました/.test(J));
t('取り込みの CSV はメモリだけ（読んだらファイルの選びを空にする）・違いの表は口座を下4桁だけ', /e\.target\.value = '';/.test(J) && /ch\.push\('口座：＊＊＊' \+ no\.slice\(-4\)\)/.test(J));
t('HTML を入れるのは put の1か所だけ', (J.match(/\.innerHTML/g) || []).length === 1);

console.log('\n— 4. タブの復元 —');
/* ★賞与のタブ（2026-11-23・設計 CONTRACT-bonus-v1.md §4「payroll_tab に 'bonus' を足す」）と、年末調整のタブ（2026-11-23・凍結仕様 ROOT-yearend.md の C）を
   両方足したので、ホワイトリストとタブの数の期待を7つに改めた（並びは賞与を振込と書き出しの次・年末調整を職員の給与設定の次・設定を最後。ほかの決まりは同じ） */
t('タブのホワイトリスト7つ（賞与と年末調整を足した・設定は最後）', /var TABS = \['run', 'slip', 'export', 'bonus', 'profile', 'yearend', 'settings'\];/.test(J));
t('読み戻しはホワイトリスト・設定は管理者だけ・それ以外は今月の給与', /tab = TABS\.indexOf\(t\) >= 0 && \(t !== 'settings' \|\| isAdmin\(\)\) \? t : 'run';/.test(boot));
t('切り替えも同じ決まり', /if \(TABS\.indexOf\(t\) < 0 \|\| \(t === 'settings' && !isAdmin\(\)\)\) t = 'run';/.test(J));
t('月分は端末に残さない（今日の月分から始める）', /ym = todayYm\(\); \$\('p-ym'\)\.value = ym;/.test(boot) && !/lsSet\([^)]*ym/.test(J));
t('画面のタブは7つ（賞与と年末調整を足した・設定は初めは隠す）', (H.match(/role="tab" data-tab="/g) || []).length === 7 && /data-tab="bonus">賞与</.test(H) && /data-tab="yearend">年末調整</.test(H) && /data-tab="settings" hidden>設定</.test(H));

console.log('\n— 5. 確定の窓 —');
const oc = fnBody(J, 'openConfirm', 'function confirmGo');
t('確定の窓に人数・総額・控除・差引・支給日', /人数/.test(oc) && /総支給の合計/.test(oc) && /控除の合計/.test(oc) && /差引の合計/.test(oc) && /支給日/.test(oc));
t('確定の窓に警告の残りと「今月変わった設定と調整」', /残っている警告/.test(oc) && /今月変わった設定と調整/.test(oc) && /changedList\(\)/.test(oc));
t('警告がある時は「確かめました」の印が要る', /c-ack/.test(oc) && /dlgCtx\.warn && !\(\$\('c-ack'\) && \$\('c-ack'\)\.checked\)/.test(J));
t('保存していない計算がある時・下書きでない時は窓を開かない', /if \(busy \|\| !bs \|\| status\(\) !== 'draft' \|\| dirty\) return;/.test(oc));
const cg = fnBody(J, 'confirmGo', 'function openUnconfirm');
const iBoot = cg.indexOf("rpc('payroll_bootstrap'"), iCmp = cg.indexOf('figures(now) !== shown'), iConf = cg.indexOf("rpc('payroll_run_confirm'");
t('「確定する」は 読み直し → 数え直し → 窓の数字と比べる → 同じ時だけ確定', iBoot >= 0 && iCmp > iBoot && iConf > iCmp, [iBoot, iCmp, iConf]);
t('数字が違えば確定せずに描き直す（下書き保存からやり直す）', /読み直したら数字が変わっていました。確定していません。/.test(cg) && /dirty = true;/.test(cg));
t('確定の取り消しは管理者だけ・理由が要る・書き出し後は強い知らせ', /if \(!isAdmin\(\) \|\| !frozen\(\)\) return;/.test(J) && /if \(!r\) \{ say\(NG\.reason\); return; \}/.test(J) && /もう振込データを書き出しています/.test(J));
t('確定済みの月は保存した（凍結した）明細を見せる', /function items\(\) \{ if \(frozen\(\)\) return bs\.items;/.test(J));

console.log('\n— 6. stale の扱い —');
const hs = fnBody(J, 'handleStale', 'function fail');
t('stale は読み直して計算し直す（payroll_run_confirm・payroll_run_save を呼ばない）', /load\(true\)/.test(hs) && /computeAll\(\)/.test(hs) && !/payroll_run_confirm|payroll_run_save/.test(hs));
t('保存・確定・取り消しの失敗は fail に通し、stale はそこで handleStale', /if \(e && e\.payroll === 'stale'\) return handleStale\(\);/.test(J) && (J.match(/fail\(e, '/g) || []).length >= 8);
t('下書き保存は指紋と run の版を送る', /rpc\('payroll_run_save', \{ p_ym: ym, p_items: calc\.items\.map\(toSave\), p_fingerprint: calc\.fp, p_rev: bs\.run \? bs\.run\.rev : 0 \}\)/.test(J));
t('勤怠が未締めなら保存しない', /if \(!bs\.kintai\.locked\) \{ say\(NG\.notlocked\); return; \}/.test(J));

console.log('\n— 7. 画面の頭 —');
t('Cache-Control: no-store', /<meta http-equiv="Cache-Control" content="no-store">/.test(H));
t('インラインのスクリプトが無い・CSP は script-src self', !/<script(?![^>]*\bsrc=)[^>]*>/.test(H) && /data-su-csp content="default-src 'self'; script-src 'self';/.test(H));
t('su-errors.js がいちばん先', H.indexOf('<script src="su-errors.js') >= 0 && H.indexOf('<script src="su-errors.js') < H.indexOf('<script src="su-app-gate.js'));
t('su-report・su-shell・su-net を他の画面と同じく最後に読む', /<script src="su-shell\.js\?v=2026-11-19"><\/script>/.test(H) && /<script src="su-report\.js\?v=[^"]+" data-tool="給与"><\/script>/.test(H) && /<script src="su-net\.js/.test(H));
t('計算と書き出しの部品は本物の名前で読む（偽の部品の名前を画面に書かない）', /<script src="payroll-calc\.js\?v=/.test(H) && /<script src="payroll-export\.js\?v=/.test(H) && !/stub/.test(H));
t('拡大縮小を禁止しない', /<meta name="viewport" content="width=device-width,initial-scale=1">/.test(H));
t('ボタンを通らない印刷（Cmd/Ctrl+P）は金額を紙に出さない', /body:not\(\.su-printing\) #p-app/.test(H) && /給与の金額は、この印刷では出しません/.test(H));
t('明細の紙に施設名と印刷日の印・SUPrint の facGate を通す', /data-su-print-head="name date"/.test(J) && /SUPrint\.facGate\(go,/.test(J) && /define\('slips', \{ label: '給与明細', paper: 'A4 portrait'/.test(J));

console.log('\n— 8. 純関数（架空の値） —');
const els = {};
const el = () => ({ hidden: true, textContent: '', value: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {} });
const doc = { getElementById: (id) => (els[id] = els[id] || el()), addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], body: { classList: { contains: () => false } } };
const store = { su_device_role: 'field' };
const win = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } }, addEventListener() {}, document: doc };
win.window = win;
vm.runInNewContext(J, Object.assign(win, { setInterval() {}, setTimeout() {}, clearTimeout() {}, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN, isFinite, parseInt }));
const P = win.__payrollTest;
t('現場端末では案内だけ出す（読み込まない）', /事務所のパソコンで使います/.test(els['p-gate'].innerHTML) && els['p-gate'].hidden === false && Object.keys(store).join() === 'su_device_role');
const nb = P.normBoot({ settings: 'x', profiles: [{ staff_id: 's-1', name: '見本 一', rev: 2, data: null, effective_from: 'bad' }, { name: 'IDなし' }, null], kintai: { locked: 'yes', period: { from: '2025-12-16', to: '2026-01-15' } }, items: [{ staff_id: 's-1', net: 1 }, 7], run: 'x' });
t('normBoot: 崩れた形は空にそろえる（ID の無い職員・壊れた行は捨て、locked は真偽の true だけ）', nb.profiles.length === 1 && JSON.stringify(nb.profiles[0].data) === '{}' && nb.profiles[0].effective_from === null && nb.kintai.locked === false && nb.items.length === 1 && nb.run === null && JSON.stringify(nb.settings.config) === '{}', nb);
t('figures: 並びに依らず同じ値なら同じ', P.figures([{ staff_id: 'b', gross: 2, deduct: 1, net: 1 }, { staff_id: 'a', gross: 3, deduct: 1, net: 2 }]) === P.figures([{ staff_id: 'a', gross: 3, deduct: 1, net: 2 }, { staff_id: 'b', gross: 2, deduct: 1, net: 1 }]));
t('figures: 1円違えば違う', P.figures([{ staff_id: 'a', gross: 3, deduct: 1, net: 2 }]) !== P.figures([{ staff_id: 'a', gross: 3, deduct: 1, net: 3 }]));
const rows = P.parseCsv('氏名,基本給\r\n"見本, 一","200,000"\r\n"見本""二",1\n\n');
t('parseCsv: 引用符・中の読点・二重の引用符・CRLF・空行', rows.length === 3 && rows[1][0] === '見本, 一' && rows[1][1] === '200,000' && rows[2][0] === '見本"二', rows);
const miss = P.missingOf({ data: { pay_type: 'monthly', base: 0, ins: { health: { on: true } }, tax: {} }, bank_last4: null });
t('missingOf: 基本給・生年月日・健保の標準報酬・源泉の区分・口座の抜けを出す', ['基本給', '生年月日', '健保の標準報酬', '源泉の区分', '口座'].every((x) => miss.indexOf(x) >= 0), miss);
t('missingOf: 計算から外す人は抜けを出さない', P.missingOf({ data: { exclude: true }, bank_last4: null }).length === 0);

console.log('\n— 9. データベース（統合 0102）の形との結び —');
const nb2 = P.normBoot({ ok: true, ym: '2026-11', period: { from: '2026-10-16', to: '2026-11-15' }, fingerprint: { kintai_locked_at: '1', settings_rev: 3, allowances: 'x', profiles: {} },
  settings: { config: { pay_day: 27 }, rev: 3 }, allowances: [{ code: 'qual', def: { code: 'qual', name: '見本の手当', sec: 'pay', calc: 'fixed', order: 1 }, rev: 2 }, { def: {} }],
  staff: [{ staff_id: 's-1', name: '見本 一', active: true }, { staff_id: 's-2', name: '見本 二', active: true }, { staff_id: 's-3', name: '見本 三', active: false }],
  profiles: [{ staff_id: 's-1', name: '見本 一', effective_from: '2026-10-16', rev: 1, data: { pay_type: 'monthly' }, versions: [{ effective_from: '2026-10-16', rev: 1 }], bank_last4: [{ bank_code: '9999', last4: '1234', amount_or_rest: 'rest' }] }],
  kintai: { locked: true, locked_at: '2026-11-16T09:00:00+09:00', period: { from: '2026-10-16', to: '2026-11-15' }, summary_by_staff: { v: 1, rows: [{ staff_id: 's-1', workDays: 20, workMin: 9600, schedInMin: 9600, counts: { '早': 3 } }] } },
  run: { status: 'draft', rev: 2, saved_at: '2026-11-17T10:00:00+09:00', stale: false, totals: { count: 1 } },
  items: [{ staff_id: 's-1', name: '見本 一', item: { gross: 10, deduct: 1, net: 9, lines: [{ sec: 'pay', amount: 10 }], pay_date: '2026-11-27' }, adjustments: [], gross: 10, deduct: 1, net: 9 }] });
t('bootstrap の手当は {code, def, rev} を平らにして計算の部品へ渡す形にする', nb2.allowances.length === 1 && nb2.allowances[0].name === '見本の手当' && nb2.allowances[0].rev === 2 && nb2.allowances[0].sec === 'pay', nb2.allowances);
t('bootstrap の明細は item の中身＋staff_id・氏名（DB が写した氏名）・調整にする', nb2.items[0].lines.length === 1 && nb2.items[0].name === '見本 一' && nb2.items[0].pay_date === '2026-11-27' && nb2.items[0].net === 9);
t('給与の設定が無い在籍の職員も「設定なし」で並べる（止めた人は出さない）', nb2.profiles.length === 2 && nb2.profiles[1].staff_id === 's-2' && nb2.profiles[1].none === true && nb2.profiles[1].rev === 0);
t('勤怠の締めの控え（snapshot の rows）を staff_id ごとの att にする', nb2.kintai.summary_by_staff['s-1'].workMin === 9600 && nb2.kintai.summary_by_staff['s-1'].counts['早'] === 3);
t('指紋は bootstrap の値を持つ・run は saved_at（calc_at ではない）', nb2.fingerprint.settings_rev === 3 && nb2.run.saved_at === '2026-11-17T10:00:00+09:00');
const missOk = P.missingOf(nb2.profiles[1]);
t('missingOf: 給与の設定が無い人は「給与の設定」の抜け', missOk.length === 1 && missOk[0] === '給与の設定');
const sv = P.toSave({ staff_id: 's-1', name: '見本 一', bank_last4: [{ last4: '1234' }], adjustments: [{ kind: 'pay', name: '見本', amount: 1, reason: '見本' }], gross: 1, deduct: 0, net: 1, lines: [], warnings: [{ code: 'x', msg: 'y' }], pay_date: '2026-11-27', error: true, att: { a: 1 } });
t('toSave: {staff_id, item, adjustments} だけ・item に氏名・口座・知らない鍵を入れない', Object.keys(sv).sort().join() === 'adjustments,item,staff_id' && !('name' in sv.item) && !('bank_last4' in sv.item) && !('error' in sv.item) && !('att' in sv.item) && sv.item.pay_date === '2026-11-27', sv);
t('qtyText: 勤怠の分は時:分・日数は日・回数は回・「分÷60」の支給は時:分', P.qtyText({ sec: 'att', code: 'workMin', qty: 9060 }) === '151:00' && P.qtyText({ sec: 'att', code: 'workDays', qty: 20 }) === '20日'
  && P.qtyText({ sec: 'att', code: 'nightShiftCount', qty: 4 }) === '4回' && P.qtyText({ sec: 'pay', code: 'ot_out', qty: 90, basis: '単価1×1.25×90分÷60' }) === '1:30' && P.qtyText({ sec: 'pay', code: 'board', qty: null }) === '');
/* 勤怠の月の結果 → 締めの控え → att の通し（kintai-calc.js の computeMonth と snapshotOf を本物で動かす） */
const KC = require(path.join(ROOT, 'kintai-calc.js'));
const Sym = require(path.join(ROOT, 'shift-symbols.js'));
const schedRows = KC.buildSchedule({ ym: '2026-12', plan: { cells: { 's-1': { 9: '早', 10: '早' } }, subCells: {} }, nextPlan: {}, staff: [{ id: 's-1', name: '見本 一', mainDivision: '施設', empCode: '', employment: '正社員', active: true }],
  symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
const pin = (d, hm, kind) => ({ id: 'q' + d + kind, staff_id: 's-1', kind, at: new Date(KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1])).toISOString(), source: 'tablet', created_at: new Date(KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1])).toISOString() });
const month = KC.computeMonth({ ym: '2026-12', staff: [{ staff_id: 's-1', name: '見本 一', office: 'facility', emp_code: null }], schedule: schedRows, days: [], config: {},
  punches: [pin('2026-12-09', '7:00', 'in'), pin('2026-12-09', '18:00', 'out'), pin('2026-12-10', '7:00', 'in'), pin('2026-12-10', '16:00', 'out')], now: Date.parse('2027-01-10T12:00:00+09:00') });
const per = month && month.people && month.people[0];
if (per) {
  const a1 = P.attFromKintai(per.sum), a2 = P.attFromKintai(KC.snapshotOf(month).rows[0]);
  const keys = ['workDays', 'paidDays', 'paidMin', 'workMin', 'schedInMin', 'legalInOverMin', 'legalOverMin', 'over60Min', 'nightMin', 'holidayMin', 'absentDays', 'lateMin', 'earlyLeaveMin', 'nightShiftCount', 'schedDays'];
  t('attFromKintai: computeMonth の1人ごとの集計と締めの控えから同じ att を作り、契約 §2 の鍵が全部ある', keys.every((k) => typeof a1[k] === 'number' && a1[k] === a2[k]) && a2.missing.length === 0, { a1, a2 });
  t('attFromKintai: 2日働いた（出勤日数2・総労働は集計の値のまま・回数の記号「早」2回）', a2.workDays === 2 && a2.workMin === per.sum.workMin && a2.workMin > 0 && a2.counts['早'] === 2, a2);
} else t('attFromKintai: computeMonth が1人ごとの集計を返す', false, Object.keys(month || {}));
/* v4（2026-11-20）: 手で入れた有休（leave_uses）がある月の控えは、数え直しに leave_uses を渡した時だけ一致する（渡さないと食い違って給与が止まる） */
{
  const base = { ym: '2026-12', staff: [{ staff_id: 's-1', name: '見本 一', office: 'facility', emp_code: null }], schedule: schedRows, days: [], config: {},
    punches: [pin('2026-12-09', '7:00', 'in'), pin('2026-12-09', '16:00', 'out'), pin('2026-12-10', '7:00', 'in'), pin('2026-12-10', '16:00', 'out')], now: Date.parse('2027-01-10T12:00:00+09:00') };
  const lu = [{ id: 'lu1', staff_id: 's-1', use_date: '2026-12-14', days: 1 }, { id: 'lu2', staff_id: 's-1', use_date: '2026-12-15', days: 0.5 }];
  const snapRow = KC.snapshotOf(KC.computeMonth(Object.assign({ leave_uses: lu }, base))).rows[0];
  const withL = KC.snapshotOf(KC.computeMonth(Object.assign({ leave_uses: lu }, base))).rows[0], without = KC.snapshotOf(KC.computeMonth(base)).rows[0];
  t('手入力の有休の月: 控えと、leave_uses を渡した数え直しの att が一致（有休 1.5日・720分）', JSON.stringify(P.attFromKintai(snapRow)) === JSON.stringify(P.attFromKintai(withL)) && snapRow.paidDays === 1.5 && snapRow.paidMin === 720, snapRow);
  t('手入力の有休の月: leave_uses を渡さない数え直しは控えと食い違う（だから渡す）', JSON.stringify(P.attFromKintai(snapRow)) !== JSON.stringify(P.attFromKintai(without)));
  t('給与の数え直し（verifyKintai）は kintai_month_get の leave_uses を computeMonth に渡す', /K\.computeMonth\(\{ ym: ymx, period: d\.period, [^}]*days: arr\(d\.days\),\s*leave_uses: arr\(d\.leave_uses\), config: obj\(snap\.config\)/.test(J));
}
const old = P.attFromKintai({ workDays: 3, workMin: 600, schedInMin: 600 });
t('attFromKintai: 0101 より前の控えで欠けた鍵は 0 にして名前を残す（黙って信じない）', old.legalInOverMin === 0 && old.missing.indexOf('legalInOverMin') >= 0 && old.missing.indexOf('workDays') < 0);
const H2 = read('payroll.html');
const iT = H2.indexOf('payroll-tax-table.js'), iR = H2.indexOf('payroll-rates.js'), iC = H2.indexOf('payroll-calc.js'), iX = H2.indexOf('payroll-export.js'), iJ = H2.indexOf('payroll.js?');
t('画面は本物の4つの部品を 税額表 → 率表 → 計算 → 書き出し → 画面 の順に読む', iT > 0 && iR > iT && iC > iR && iX > iC && iJ > iX, [iT, iR, iC, iX, iJ]);
t('指紋は bootstrap の値に率と計算の版（と日付の形の支給日）を足すだけ（画面で作らない）', /var f = Object\.assign\(\{\}, bs \? bs\.fingerprint : \{\}, \{ rates_ver: ratesVer\(\), calc_ver: calcVer\(\) \}\), pd = payDate\(\);\s*if \(isDate\(pd\)\) f\.pay_date = pd;/.test(J));
t('呼ぶ口の引数は統合 0102 の名前（設定に理由なし・名簿は1人ずつ・取り込みは p_payload）', /rpc\('payroll_settings_put', \{ p_config: c, p_rev: bs\.settings\.rev \}\)/.test(J) && /rpc\('payroll_members_put', \{ p_email: email, p_on: onv \}\)/.test(J)
  && /rpc\('payroll_import_put', \{ p_payload: payload \}\)/.test(J) && /rpc\('payroll_allowance_put', \{ p_def: d, p_rev: a \? a\.rev : 0 \}\)/.test(J) && /rpc\('payroll_audit_get', \{ p_from: from\.toISOString\(\), p_to: to\.toISOString\(\) \}\)/.test(J));

console.log('\n— 10. 反証レビュー（2026-11-19）の直し —');
t('ブラウザの止める窓（alert・confirm・prompt）を使わず、画面の中の窓（SUDialog）へ（使えない時だけブラウザの窓）', !/(^|[^.\w])(alert|confirm|prompt)\(/m.test(J.replace(/window\.(alert|confirm)\(/g, '')) && /window\.SUDialog\.alert\(msg\)/.test(J) && /window\.SUDialog\.confirm\(msg\)/.test(J) && /su-dialog\.js\?v=/.test(H));
t('確かめの窓の答えは、隠した・覆いに変わった後なら「やめる」', /return !!ok && mg === maskGen && !masked && view === 'app';/.test(J));
t('42501（aal 以外）は覆いに倒す', /if \(e && e\.code === '42501'\) \{\s*if \(isAdmin\(\) \|\| !\/管理者\/\.test\(String\(e\.message \|\| ''\)\)\) \{ showGate\('denied'\); return null; \}/.test(J));
t('金額を表示する時は DB に確かめ直す（読み直し）', /masked = false; lastAct = Date\.now\(\);[\s\S]{0,200}return load\(true\);/.test(fnBody(J, 'unmask', 'function idleCheck')));
t('確定した月の口座の下4桁は確定の写し（frozen.bank_last4）を使う', /if \(Array\.isArray\(fr\.bank_last4\)\) it\.bank_last4 = /.test(J));
t('書き出しの振込元・全銀の種別・仕訳の科目は今の設定、事業者名は写し', /settings: Object\.assign\(\{\}, cfg\(\), \{ company_name: paperCfg\(\)\.company_name \}\)/.test(J));
t('住民税は今の年度と前の年度だけを送る', /var rtMin = shiftYm\(c\.months\[0\], -12\), rtMax = c\.months\[c\.months\.length - 1\];/.test(J));
t('取り込みで口座名義が空なら口座を送らない', /else if \(!bank\.name_kana\) \{ ch\.push\('⚠ 口座名義が無いので送りません'\); bank = null; \}/.test(J));
t('全銀の合計と件数を画面の振込する分と比べ、合わない時はファイルを作らない', /if \(num\(res\.total\) !== want\.total \|\| num\(res\.count\) !== want\.parts\) \{\s*res = null;/.test(J));
t('締めの控えを数え直す: kintai_month_get → computeMonth → snapshotOf と比べ、食い違えば計算・保存・確定を止める', /rpc\('kintai_month_get', \{ p_ym: ymx \}\)/.test(J) && /K\.computeMonth\(/.test(J) && /K\.snapshotOf\(month\)/.test(J)
  && /var kb = kintaiBlock\(\); if \(kb\) \{ say\(kb\); return; \}/.test(fnBody(J, 'doCompute', 'function figures')) && /var kb = kintaiBlock\(\); if \(kb\) \{ say\(kb\); return; \}/.test(fnBody(J, 'saveDraft', 'function changedList')) && /return verifyKintai\(ym, fresh\)/.test(fnBody(J, 'confirmGo', 'function openUnconfirm')) && /kintai-calc\.js\?v=/.test(H));
const A = { workDays: 2, paidDays: 0, paidMin: 0, workMin: 960, schedInMin: 960, legalInOverMin: 0, legalOverMin: 0, over60Min: 0, nightMin: 0, holidayMin: 0, absentDays: 0, lateMin: 0, earlyLeaveMin: 0, nightShiftCount: 0, schedDays: 2, reviewCount: 0, counts: { '日': 2 } };
t('attSame: 同じなら真・1分でも違えば偽・回数の記号が違えば偽', P.attSame(P.attFromKintai(A), P.attFromKintai(Object.assign({}, A))) && !P.attSame(P.attFromKintai(A), P.attFromKintai(Object.assign({}, A, { workMin: 961 })))
  && !P.attSame(P.attFromKintai(A), P.attFromKintai(Object.assign({}, A, { counts: { '早': 2 } }))));

console.log('\n— 11. 確かめの印（代表者の決定 2026-11-19） —');
t('甲乙・扶養の「確かめた」は true の時だけ印が入って開く（空・false は印なし）', /chk\('f-depok', '[^']+', tx\.dependents_checked === true\)/.test(J));
t('固定残業代の欄: 手当の選択・含む時間（分）・確かめた（true の時だけ印）', /sel\('f-fot', '固定残業代の手当'/.test(J) && /inp\('f-fotmin', '含む時間（分）'/.test(J) && /chk\('f-fotok', '[^']+', fo\.checked === true\)/.test(J)
  && /d\.fixed_ot = \{ allowance_code: fot, covered_min: fotMin, checked: on\('f-fotok'\) \};/.test(J) && /if \(!fot\) delete d\.fixed_ot;/.test(J));
t('取り込みで甲乙・扶養の列が無い（空の）行は dependents_checked=false', /if \(!g\('tax_col'\) \|\| toNum\(g\('deps'\)\) == null\) setv\('tax\.dependents_checked', false,/.test(J));
t('手当の定義の窓に「深夜の割増を含む（夜勤手当）」（includes_night_premium）の欄', /\['includes_night_premium', '深夜の割増を含む（夜勤手当）'\]/.test(J));

const pend = [];   /* 動かして確かめる試験（Promise）の待ち合わせ */
console.log('\n— 職員の並び（勤怠と同じ入職順・2026-11-20 代表者の指示）—');
{
  const SEC = J.slice(J.indexOf('/* ── 職員の並び（勤怠と同じ入職順'), J.indexOf('/* ── 読み込み ── */'));
  /* 画面の関数をそのまま動かす（rpc は架空の答えを返す） */
  const run = (staff, masters, list) => new Function('STAFF', 'MASTERS', 'LIST', `
    var ym = '2026-12', bs = null, calc = null, importRows = null, view = 'app', masked = false;
    function arr(x) { return Array.isArray(x) ? x : []; } function note() {} function paint() {}
    function rpc(name) { return Promise.resolve(name === 'kintai_month_get' ? { ok: true, staff: STAFF } : { ok: true, rows: MASTERS }); }
    ${SEC}
    loadHire();
    return new Promise(function (r) { setTimeout(function () { r(orderStaff(LIST).map(function (x) { return x.staff_id; }).join()); }, 0); });`)(staff, masters, list);
  const staff = [{ staff_id: 'a', code: '0300', master_id: 'M1' }, { staff_id: 'b', code: '0100', master_id: 'M2' }, { staff_id: 'c', code: '0200', master_id: null },
    { staff_id: 'd', code: '0050', master_id: 'M9' }, { staff_id: 'e', code: '0400', master_id: 'M3' }];
  const masters = [{ master_id: 'M1', hire_date: '2020-04-01' }, { master_id: 'M2', hire_date: '2015-07-01' }, { master_id: 'M3', hire_date: '2018-01-01' }, { master_id: 'M9', hire_date: null }];
  const list = ['a', 'b', 'c', 'd', 'e', 'p:x'].map((s) => ({ staff_id: s }));
  pend.push(run(staff, masters, list).then((got) => t('事業所に関係なく入職日の古い順・入職日の分からない人は番号の順・勤怠にいない人（p:）は最後', got === 'b,e,a,d,c,p:x', got)));
  pend.push(new Function(`var hireRank = null; ${SEC.slice(SEC.indexOf('function orderStaff'), SEC.indexOf('function orderBs'))} return orderStaff([{staff_id:'z'},{staff_id:'y'}]).map(function(x){return x.staff_id;}).join();`)() === 'z,y'
    ? Promise.resolve(t('並びを読めない時は今の並びのまま', true)) : Promise.resolve(t('並びを読めない時は今の並びのまま', false)));
  t('読み込むたびに並べ直し、並びをまだ読んでいなければ読む・取り込みの比べも並べる',
    /bs = normBoot\(r\); loadErr = null;\s*orderBs\(\); if \(!hireRank\) loadHire\(\);/.test(J) && /importRows = orderStaff\(buildImport\(/.test(J)
    && /bs\.profiles = orderStaff\(bs\.profiles\); bs\.items = orderStaff\(bs\.items\);/.test(SEC));
  t('並びに有給の設定の入職日の上書きを使わない・端末に残さない', !/hire_date_override|leave|localStorage|sessionStorage/.test(SEC));
}

console.log('\n— 給与専用の暗証番号（統合 0110・2026-11-20 代表者の指示）—');
{
  const PIN = J.slice(J.indexOf('/* ── 給与専用の暗証番号'), J.indexOf('/* ── 覆い ── */'));
  t('起動は暗証番号の状態を読み、関数の無い DB（0110 の前）では今までどおり読み込む・断られたら覆い',
    /function pinStart\(\) \{\s*return rpc\('payroll_pin_status'\)/.test(PIN) && /if \(noDb\(e\)\) \{ pinOn = false; view = 'app'; \$\('p-app'\)\.hidden = false; return load\(false\); \}/.test(PIN)
    && /if \(e && e\.code === '42501'\) \{ showGate\(isAal\(e\) \? 'mfa' : 'denied'\); return null; \}/.test(fnBody(J, 'pinStart', 'function pinStatusThen')));
  /* 反証レビュー（2026-11-20）: 開くたびにデータベースの鍵をかけると、同じログインのほかのタブまで鍵の画面に倒れた。鍵の画面はこの画面だけにする */
  t('開いたままのログインでも鍵の画面を出す（データベースの鍵はかけない＝ほかのタブを巻き込まない）',
    /pinOn = true; pinSt = r; showLock\(''\); return null;/.test(fnBody(J, 'pinStart', 'function pinStatusThen')) && !/payroll_pin_lock/.test(fnBody(J, 'pinStart', 'function pinStatusThen')));
  t('決めていない時は2回入れて決める・違えば決めない・4〜6桁の数字だけ',
    /pinIn\('p-pin1', '暗証番号（4〜6桁）'\) \+ pinIn\('p-pin2', 'もう一度'\)/.test(PIN) && /if \(a !== b2\) \{ pinSay\(/.test(PIN)
    && /PIN_RE = \/\^\[0-9\]\{4,6\}\$\//.test(PIN) && /rpc\('payroll_pin_set', \{ p_pin: a, p_old: null \}\)/.test(PIN));
  t('番号の欄はパスワードの欄にしない（ブラウザに覚えさせない）・自動の補完を切る・数字のキーボード',
    /class="pin" type="text" inputmode="numeric"[^']*autocomplete="off"/.test(PIN) && !/type="password"/.test(PIN) && /\.pin\{-webkit-text-security:disc/.test(H));
  t('番号を端末に残さない（暗証番号の部分に localStorage・sessionStorage・console が無い）・入れた欄はすぐ空にする',
    !/localStorage|sessionStorage|console\./.test(PIN) && /if \(el\) el\.value = '';/.test(PIN));
  t('違い・止め・ログインが無いは、職員向けの文で出す（あと何回・何時まで）',
    /あと ' \+ r\.left \+ ' 回間違えると15分止めます/.test(PIN) && /5回続けて間違えたため/.test(PIN) && /nosession: '/.test(PIN));
  t('10分さわらない時は、暗証番号がある DB では鍵をかけ、無い DB では今までどおり金額を隠す',
    /if \(view === 'app' && !masked && Date\.now\(\) - lastAct > IDLE_MS\) \{ if \(pinOn\) pinLockNow\('idle'\); else mask\(\); \}/.test(J));
  t('さわった時に延ばすのは1分に1回まで・延ばせなかったら鍵の画面',
    /Date\.now\(\) - lastTouch < 60000\) return;/.test(PIN) && /r\.unlocked === false\) pinRecheck\(\)/.test(PIN) && /lastAct = Date\.now\(\); pinTouch\(\);/.test(J));
  t('読み込み・操作で断られた（42501）時は、鍵がかかっただけかを確かめ直す（名簿から外されたなら覆い）',
    /if \(e && e\.code === '42501' && !isAal\(e\) && pinRecheck\(\)\) return null;/.test(fnBody(J, 'load', 'function handleStale'))
    && /if \(e && e\.code === '42501' && pinRecheck\(\)\) return null;/.test(fnBody(J, 'fail', '/* ── 下書き保存')));
  t('鍵の画面では金額・明細・窓・印刷を消し、保存していない計算はメモリに残す（番号が合えば load(true) で続き）',
    /function showLock\(msg\) \{\s*view = 'lock'; pinGen\+\+; masked = false; maskGen\+\+; closeDlg\(\); bs = null;/.test(PIN) && !/calc = null/.test(fnBody(J, 'showLock', 'function pinVal'))
    && /return load\(true\);/.test(fnBody(J, 'pinOpened', 'function pinSetGo')));
  t('「鍵をかける」のボタン（暗証番号がある DB の時だけ出す）・設定のタブの「暗証番号を消す（忘れた人用）」は理由を聞いてから消す',
    /id="p-lock" data-act="pin-lock" hidden>鍵をかける</.test(H) && /b\.hidden = !pinOn;/.test(PIN)
    && /data-act="pin-reset" data-i="' \+ esc\(i\) \+ '">暗証番号を消す（忘れた人用）</.test(J) && /rpc\('payroll_pin_reset', \{ p_email: email, p_reason: reason \}\)/.test(PIN));
  /* 反証レビュー（2026-11-20）: 管理者の PC が開いたままなら、別の人がボタン2つで番号を外せた。自分の番号は鍵の画面から消せない */
  t('自分の番号は鍵の画面から消せない（ボタンを出さない・ほかの管理者に頼む案内だけ）・DB の self に文がある',
    !/pin-forgot|pinForgot/.test(J) && /ほかの管理者に「設定」のタブで消してもらってください/.test(PIN) && /self: '/.test(PIN) && /reason: '/.test(PIN) && /badshape: '/.test(PIN));
  t('起動は鍵が決まるまで中身の帯を出さない（view は boot・p-app は隠したまま）',
    /view = 'boot';\s*\$\('p-app'\)\.hidden = true;/.test(fnBody(J, 'boot', 'var go = function')));
  t('「鍵をかける」はデータベースの鍵もかけてほかのタブにも知らせ、10分さわらない時はこの画面だけ鍵にする',
    /if \(w === 'manual'\) \{\s*rpc\('payroll_pin_lock'\)[\s\S]*?pinCh\.postMessage\('lock'\)/.test(PIN)
    && /pinCh\.onmessage = function \(e\) \{ if \(e && e\.data === 'lock' && pinOn && view === 'app'\) pinLockNow\('manual-other'\); \};/.test(J)
    && /new window\.BroadcastChannel\('su-payroll-pin'\)/.test(PIN));
  t('鍵の画面の間に届いた断り・状態の答えでは描き直さない（世代 pinGen）・通信の失敗では覆いに倒さず鍵の画面のまま',
    /if \(view === 'lock'\) return true;/.test(PIN) && /var my = pinGen;/.test(PIN) && /if \(my !== pinGen\) return null;/.test(PIN)
    && /if \(pinSt\) \{ showLock\(msg \|\| ''\); pinSay\('通信できませんでした/.test(PIN));
  t('決める画面の1つ目の欄の Enter は2つ目の欄へ移るだけ（欄を空にしない）', /if \(e\.target\.id === 'p-pin1' && \$\('p-pin2'\)\) \{ e\.preventDefault\(\); \$\('p-pin2'\)\.focus\(\); return; \}/.test(J));
  t('番号を消す窓の間に鍵がかかった・金額を隠した時は送らない', /if \(x == null \|\| mg !== maskGen \|\| view !== 'app'\) return null;/.test(PIN));
  t('戻るボタンで戻った時は鍵の画面から', /else if \(e && e\.persisted && pinOn && view === 'app'\) pinLockNow\('expired'\);/.test(J));
  t('鍵の画面の欄で Enter を押すと決める・開くを押したのと同じ（変換中は除く）', /e\.key !== 'Enter' \|\| e\.isComposing \|\| view !== 'lock'/.test(J));
  t('起動は pinStart を通る（読み込みは鍵が開いてから）', /return pinStart\(\);/.test(fnBody(J, 'boot', 'var go = function')) && !/return load\(false\);/.test(fnBody(J, 'boot', 'var go = function')));
  /* ★勤怠 v5 段4 の給与の側（2026-11-20）: payroll.js の中身を変えて版を 2026-11-20.5 に上げたので、期待の版を改めた */
  /* ★給与の側の反証レビューの直し（2026-11-20）: payroll.js の中身を変えて版を 2026-11-20.6 に上げたので、期待の版を改めた */
  /* ★再確認の反証の直し（2026-11-20・欠勤の印と部分の休暇）: payroll.js を 2026-11-20.7 に上げたので、期待の版を改めた */
  /* ★総点検（2026-11-21・給与の額の5件と給与の反証の直し）: payroll.js を 2026-11-21 に上げたので、期待の版を改めた */
  /* ★反証レビュー（2026-11-21・有休の日数の鍵の受け取り）: payroll.js を 2026-11-21.2 に上げたので、期待の版を改めた */
  /* ★統合 0118 の受け渡し（確定できない警告の DB の断り・もう一度の書き出し・駐車場の料金・2026-11-21）で payroll.js を 2026-11-21.3 に上げたので、期待の版を改めた */
  /* ★取り込みの「見出しから読めた項目」が入職順の並べ直しで消えていた直し（2026-11-21）で 2026-11-21.4 に上げたので、期待の版を改めた */
  /* ★賞与のタブ（2026-11-23）で payroll.js を 2026-11-23.3 に上げたので、期待の版を改めた */
  /* ★賞与の年末調整の記録を待つ間の止め（2026-11-23）で 2026-11-23.4 に上げたので、期待の版を改めた */
  /* ★賞与の画面の反証レビューの直し（2026-11-23）で 2026-11-23.5 に上げたので、期待の版を改めた */
  /* ★賞与の空の止め（#660・2026-11-23.7）の入った main を取り込み、両方が入った payroll.js を 2026-11-23.8 に上げたので、期待の版を改めた */
  /* ★年末調整のタブ（2026-11-23・ROOT-yearend.md の C）を賞与の入った main に取り込み、両方が入った payroll.js を 2026-11-23.6 に上げたので、期待の版を改めた */
  /* ★賞与の「freee と比べる」と、確定した賞与を年末調整の累計へ入れる（2026-11-23・0124）で 2026-11-23.9 に上げたので、期待の版を改めた */
  /* ★支給日の欄（既定27・全角と「日」を受ける・空の知らせ・2026-11-24）で 2026-11-24.1 に上げたので、期待の版を改めた */
  t('payroll.js の版を上げた（2026-11-24.1・支給日の欄の直しの入った版）', /payroll\.js\?v=2026-11-24\.1"/.test(H));
}

console.log('\n— 年末調整のタブ（2026-11-23・ROOT-yearend.md の C） —');
{
  const U = read('payroll-yearend-ui.js');
  /* 画面の登録（payroll.js はタブの登録と呼び口だけ） */
  /* ★賞与のタブと一緒になったので7つの並び（年末調整は職員の給与設定の次・設定の前） */
  t('TABS に yearend（設定の前・ホワイトリストのまま）', /var TABS = \['run', 'slip', 'export', 'bonus', 'profile', 'yearend', 'settings'\];/.test(J));
  /* ★賞与のタブと一緒になったので7つ */
  t('画面のタブは7つ・「年末調整」は data-tab="yearend"（設定は初めは隠す）', (H.match(/role="tab" data-tab="/g) || []).length === 7 && /<button type="button" role="tab" data-tab="yearend">年末調整<\/button>/.test(H) && /data-tab="settings" hidden>設定</.test(H));
  const iF = H.indexOf('<script src="payroll-freee-slips.js?v='), iYR = H.indexOf('<script src="payroll-yearend-rates.js?v='), iY = H.indexOf('<script src="payroll-yearend.js?v='), iW = H.indexOf('<script src="payroll-withholding-slip.js?v='), iU = H.indexOf('<script src="payroll-yearend-ui.js?v='), iP = H.indexOf('<script src="payroll.js?v=');
  t('新しい5つの部品を payroll.js より前に ?v= つきで読む', iF > 0 && iYR > iF && iY > iYR && iW > iY && iU > iW && iP > iU, [iF, iYR, iY, iW, iU, iP]);
  /* ★賞与の入った main を取り込み 2026-11-23.6 に上げたので、期待の版を改めた */
  /* ★賞与の「freee と比べる」と累計へ入れる（2026-11-23・0124）で 2026-11-23.9 に上げたので、期待の版を改めた */
  t('payroll.js の版を上げた（2026-11-24.1）', /payroll\.js\?v=2026-11-24\.1"/.test(H));
  t('描く物は PayrollYearEndUI.html(ctx)・無ければ「計算の部品が読み込めていません」', /else if \(tab === 'yearend'\) h = YEU\(\) \? YEU\(\)\.html\(yeCtx\(\)\) : '<div class="band ng" role="alert">計算の部品が読み込めていません。/.test(J));
  t('出来事は ye- で始まる act だけ・金額を隠している間は渡さない', /else if \(\/\^ye-\/\.test\(a\) && YEU\(\) && view === 'app' && !masked\) YEU\(\)\.onClick\(yeCtx\(\), a, b\);/.test(J)
    && /YEU\(\)\.onChange\(yeCtx\(\), e\.target\)/.test(J));
  const yc = fnBody(J, 'yeCtx', '/* ── 振込と書き出し');
  t('ctx は今ある関数を渡すだけ（rpc・esc・yen・bs・items・ym・paint・toast・openDlg・closeDlg・isAdmin・note・parseCsv・decode）', ['rpc: rpc', 'esc: esc', 'yen: yen', 'bs: bs', 'items: bs ? items() : []', 'ym: ym', 'paint: paint', 'toast: toast', 'openDlg: openDlg', 'closeDlg: closeDlg', 'isAdmin: isAdmin', 'note: note', 'parseCsv: parseCsv', 'decode: decode', 'adjOf: adjOf', 'compute: doCompute'].every((k) => yc.indexOf(k) >= 0), yc.slice(0, 300));
  t('精算を入れるのは今の adjEdits の仕組み（確定した月は入れない）', /setAdj: function \(sid, list\) \{ if \(!frozen\(\)\) adjEdits\[sid\] = list; \}/.test(yc));
  /* ★賞与の片付けと同じ所に並べたので、文の並びではなく「その関数の中で年末調整の物を捨てる」で確かめる（意味は同じ） */
  t('隠す・鍵の画面・覆いでは年末調整の物（申告・累計・CSV・紙）も捨てる', /put\(\$\('p-print'\), ''\);[\s\S]*yePrint = null; yeReset\(\);/.test(fnBody(J, 'mask', 'function paintMasked'))
    && /members = null;[\s\S]*yePrint = null; yeReset\(\);/.test(fnBody(J, 'showLock', 'function pinVal')) && /members = null;[\s\S]*yePrint = null; yeReset\(\);/.test(fnBody(J, 'showGate', 'function showField')));
  const cg2 = fnBody(J, 'confirmGo', 'function openUnconfirm');
  t('確定は 年末調整の確かめ（beforeConfirm・毎回）→ 読み直し → 勤怠の数え直し → 確定 の順・止めた時は読み直さず確定しない', cg2.indexOf('YEU().beforeConfirm(yeCtx())') >= 0 && cg2.indexOf('YEU().beforeConfirm(yeCtx())') < cg2.indexOf("rpc('payroll_bootstrap'") && cg2.indexOf("rpc('payroll_bootstrap'") < cg2.indexOf("rpc('payroll_run_confirm'")
    && /if \(yng\) \{ yStop = true; done\(\); closeDlg\(\); notice = \{ cls: 'ng', text: '確定していません。' \+ yng \}; paint\(\); return null; \}/.test(cg2) && /if \(yStop\) return null;/.test(cg2));
  t('今月の給与のタブに精算の帯・振込と書き出しに freee との差の印（止めない）', /if \(YEU\(\)\) h \+= YEU\(\)\.runBand\(yeCtx\(\)\);/.test(fnBody(J, 'runHtml', 'function itemBody')) && /if \(YEU\(\)\) h \+= YEU\(\)\.exportBadge\(yeCtx\(\)\);/.test(fnBody(J, 'exportHtml', 'function download')));
  t('源泉徴収票の紙は SUPrint の別のビュー（#p-print・隠した時は出さない）', /window\.SUPrint\.define\('ye-slips', \{ label: '源泉徴収票', paper: 'A4 portrait'/.test(J) && /when: function \(\) \{ return !!yePrint && view === 'app' && !masked; \}/.test(J));
  t('年末調整の部品は端末に残さない・console に出さない・HTML を入れない（put を ctx で受ける）', !/localStorage|sessionStorage|indexedDB|caches\.|console\.|\.innerHTML|outerHTML|insertAdjacentHTML/.test(U));
  t('年は端末に残さない（payroll.js の lsSet は LS_TAB だけのまま）', (J.match(/lsSet\(([^,]+),/g) || []).filter((x) => x !== 'lsSet(k,').every((x) => /lsSet\(LS_TAB,/.test(x)));
  t('マイナンバーの欄を作らない（欄の id・鍵の名前に無い）', !/my_?number|kojin_bango|id="[^"]*(個人番号|マイナンバー)/i.test(U));
  const L = ['1. 給与所得者の扶養控除等（異動）申告書', '2. 給与所得者の基礎控除申告書・配偶者控除等申告書', '3. 給与所得者の保険料控除申告書', '4. 住宅借入金等特別控除申告書', '5. 前職の源泉徴収票'].map((x) => U.indexOf(x));
  t('申告の欄は紙の順（扶養控除等 → 基礎・配偶者 → 保険料 → 住宅 → 前職）', L.every((x, i) => x > 0 && (i === 0 || x > L[i - 1])), L);

  t('内訳は決まった鍵だけを決まった順に描き、fuyo_etc（扶養・障害者等の合計）は小計の行にして二重に数えない', /\['fuyo_etc', '（小計）扶養控除額及び障害者等の控除額の合計'\]/.test(U) && /DED\.forEach\(function \(x\) \{ if \(typeof dd\[x\[0\]\] === 'number'\)/.test(U) && !/Object\.keys\(dd\)/.test(U));
  t('部品は rates → yearend → 源泉徴収票 の順に読む（.gitignore に5つとも載せる）', iYR < iY && iY < iW && ['payroll-freee-slips.js', 'payroll-yearend-rates.js', 'payroll-yearend.js', 'payroll-withholding-slip.js', 'payroll-yearend-ui.js'].every((f) => read('.gitignore').indexOf('!/' + f + '\n') >= 0));
  /* 動かして確かめる（架空の職員・架空の金額） */
  let lastStaff = null;
  const mkDoc = () => { const f = {}; return { f, getElementById: (id) => f[id] || null }; };
  const load = (opt) => {
    const D = mkDoc();
    const w = { document: D, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN, isFinite, parseInt, Uint8Array };
    w.window = w;
    vm.runInNewContext(read('payroll-freee-slips.js'), w);
    if (!opt || !opt.noParts) {
      w.PayrollYearEnd = { computeYearEnd: (inp) => { w.lastInput = inp; return { eligible: true, pay_total: inp.rows.reduce((s, r) => s + r.data.gross, 0), withheld_total: 0, nenzei: 1000, balance: -2500, balance_settle: -2500, warnings: [], deductions: { basic: 1 } }; } };
      w.PayrollWithholdingSlip = { slipValues: (r, s) => { lastStaff = s; return { name: s.name }; }, slipHtml: (l) => '<div class="ws">' + l.length + '</div>', summaryValues: () => ({}), toCsv: () => 'a,b' };
    }
    vm.runInNewContext(read('payroll-yearend-ui.js'), w);
    return { w, D, U: w.PayrollYearEndUI };
  };
  const ctxOf = (o) => {
    const calls = [], adj = {};
    const c = Object.assign({ calls, adj, esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ''), yen: (n) => String(n), ym: '2026-12', frozen: false, runRev: 3, payDate: '2026-12-25', items: [],
      bs: { profiles: [{ staff_id: 's-1', name: '見本 一', data: { freee_emp_num: 'E901' } }, { staff_id: 's-2', name: '見本 二', data: {} }] },
      paint() { c.painted = (c.painted || 0) + 1; }, toast() {}, say(m) { c.said = m; }, ask: () => Promise.resolve(true), note() {}, put(e, h) { if (e) e.html = h; }, isAdmin: () => true,
      openDlg(title, body, foot, x) { c.dlg = { title, body, foot, x }; }, closeDlg() { c.dlg = null; }, noDb: (e) => !!e && e.code === 'PGRST202', fail(e) { c.failed = e; },
      adjOf: (sid) => adj[sid] || [], setAdj: (sid, l) => { adj[sid] = l; }, compute() { c.computed = (c.computed || 0) + 1; },
      rpc: (name, args) => { calls.push({ name, args }); return Promise.resolve(c.answer ? c.answer(name, args) : { ok: true }); } }, o || {});
    return c;
  };
  const DATA = { ok: true, rows: [
    { staff_id: 's-1', pay_date: '2026-01-25', kind: 'salary', source: 'freee', data: { gross: 200000, income_tax: 4000 }, rev: 1, fp: 'f0a1' },
    { staff_id: 's-1', pay_date: '2026-12-24', kind: 'bonus', source: 'manual', data: { gross: 300000, income_tax: 9000 }, rev: 1 }],
    yearend: [{ staff_id: 's-1', decl: { kou: true }, result: { balance_settle: -2500 }, basis: {}, status: 'final', settle_ym: '2026-12', rev: 2 }] };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  pend.push((async () => {
    {
      const { U: U0 } = load({ noParts: true });
      const h0 = U0.html(ctxOf());
      t('部品が無い時は「計算の部品が読み込めていません」を出して止める（読み込みもしない）', /計算の部品が読み込めていません/.test(h0) && !/freee の明細を取り込む/.test(h0));
    }
    {
      const { U: U1 } = load();
      const c = ctxOf({ answer: () => { const e = new Error('nf'); e.code = 'PGRST202'; throw e; } });
      c.rpc = (name, args) => { c.calls.push({ name, args }); const e = new Error('nf'); e.code = 'PGRST202'; return Promise.reject(e); };
      U1.html(c); await tick(); await tick();
      t('既定の年は表示中の月分の年・payroll_ytd_get(p_year) を1回だけ', c.calls.length === 1 && c.calls[0].name === 'payroll_ytd_get' && JSON.stringify(c.calls[0].args) === '{"p_year":2026}', c.calls);
      t('DB に 0122 が無い時は「まだありません」と出して止める（失敗の窓は出さない）', /データベースに年末調整の仕組みがまだありません/.test(U1.html(c)) && !c.failed);
    }
    const { w, D, U: Y } = load();
    const c = ctxOf({ answer: (n) => n === 'payroll_ytd_get' ? DATA : n === 'payroll_yearend_check' ? { ok: true, rows: [{ staff_id: 's-1', match: true }] } : { ok: true } });
    Y.html(c); await tick(); await tick();
    const h = Y.html(c);
    t('読めたら取り込み・比べる・一覧・精算の手順・印刷の5つの節', ['freee の明細を取り込む', 'freee と比べる', '職員ごとの累計と年末調整', '精算する月分の給与へ入れる', '源泉徴収票と合計表の値'].every((x) => h.indexOf(x) >= 0));
    t('一覧: 累計の回数（給与1・賞与1）・支給の合計・確定の印', /給与 1・賞与 1/.test(h) && /500000/.test(h) && /✓ 確定/.test(h));
    t('累計に1回分を手で足す: 賞与の既定の支給日は 2026-12-24', (Y.onClick(c, 'ye-manual', null), /id="ye-m-date" value="2026-12-24"/.test(c.dlg.body)) && /ye-m-income_tax/.test(c.dlg.body));
    Object.assign(D.f, { 'ye-m-sid': { value: 's-2' }, 'ye-m-kind': { value: 'bonus' }, 'ye-m-date': { value: '2026-12-24' }, 'ye-m-gross': { value: '250,000' }, 'ye-m-taxable': { value: '' }, 'ye-m-si_health': { value: '12000' }, 'ye-m-si_care': { value: '' }, 'ye-m-si_support': { value: '' }, 'ye-m-si_pension': { value: '22000' }, 'ye-m-si_emp': { value: '1500' }, 'ye-m-income_tax': { value: '8000' } });
    c.calls.length = 0; Y.onClick(c, 'ye-manual-go', null); await tick();
    const put0 = c.calls.find((x) => x.name === 'payroll_ytd_put');
    t('手で足す分は payroll_ytd_put に source=manual・課税支給が空なら総支給と同じ・新しい行は rev 0', !!put0 && put0.args.p_year === 2026 && put0.args.p_rows[0].source === 'manual' && put0.args.p_rows[0].kind === 'bonus' && put0.args.p_rows[0].data.taxable === 250000 && put0.args.p_rows[0].data.nontax === 0 && put0.args.p_rows[0].rev === 0, put0 && put0.args);
    await tick(); await tick();
    /* 精算（今月の給与のタブ）: もとは DB の payroll_yearend_check の行（年末調整のタブで読んだ物に頼らない）。二度押しても1行に置き換わる・額は balance_settle（負＝還付） */
    const CHK = (rows) => (n) => n === 'payroll_yearend_check' ? { ok: true, year: 2026, rows } : { ok: true };
    const FIN1 = { staff_id: 's-1', status: 'final', settle_ym: '2026-12', run_status: 'draft', has_item: true, tax_adjust: 0, balance_settle: -2500, state: 'diff' };
    const c2 = ctxOf({ answer: CHK([FIN1]) });
    const { U: Y2, D: D2 } = load();
    c2.adj['s-1'] = [{ kind: 'pay', name: '見本の手当', amount: 1000, reason: 'x' }, { kind: 'tax_adjust', name: '前の月の直し', amount: 300, reason: '別の精算' }];
    t('今月の給与の帯: 初めは payroll_yearend_check(年) を読む（年末調整のタブを開いていなくても）', Y2.runBand(c2) === '' && (await tick(), c2.calls.some((x) => x.name === 'payroll_yearend_check' && JSON.stringify(x.args) === '{"p_year":2026}')));
    t('今月の給与の帯: 精算がまだ入っていない人を知らせ、ボタンを出す', /年末調整の精算を入れる/.test(Y2.runBand(c2)) && /まだこの月分に入っていない/.test(Y2.runBand(c2)));
    Y2.onClick(c2, 'ye-settle', null); Y2.onClick(c2, 'ye-settle', null);
    const st = c2.adj['s-1'].filter((a) => a.kind === 'tax_adjust' && a.name === '年末調整の精算');
    t('「年末調整の精算を入れる」は名前「年末調整の精算」の行を1人1行に置き換える（二度押しで増えない・ほかの調整と別の tax_adjust は残す）・計算し直す', st.length === 1 && st[0].amount === -2500 && c2.adj['s-1'].length === 3 && c2.adj['s-1'].some((a) => a.name === '前の月の直し') && c2.computed === 2, c2.adj['s-1']);
    t('精算の額は「年末調整の精算」の行だけで比べる（別の tax_adjust 300 円は数えない）→「入っています」', /✓ 年末調整の精算（1 人）はこの月分に入っています/.test(Y2.runBand(c2)));
    t('確定した月（frozen）には帯を出さない', Y2.runBand(Object.assign({}, c2, { frozen: true })) === '');
    /* 確定の前の確かめ（0122 の行の形・state） */
    c2.calls.length = 0;
    t('確定の前: 毎回 payroll_yearend_check(年) を呼ぶ・この月分の確定済みの人の diff で止める（氏名つき）', /見本 一/.test(await Y2.beforeConfirm(c2) || '') && c2.calls.some((x) => x.name === 'payroll_yearend_check'));
    c2.answer = CHK([Object.assign({}, FIN1, { state: 'stale' })]);
    t('確定の前: stale（年末調整の確定の後に明細が変わった）で止める', /年末調整を確定した後に、この月分の明細が変わりました（見本 一）/.test(await Y2.beforeConfirm(c2) || ''));
    c2.answer = CHK([Object.assign({}, FIN1, { state: 'ok', tax_adjust: -2500 })]);
    t('確定の前: state=ok なら通す', (await Y2.beforeConfirm(c2)) === null);
    c2.answer = CHK([Object.assign({}, FIN1, { state: 'ok' }), { staff_id: 's-2', status: 'draft', settle_ym: '2026-12', state: 'notfinal' }, { staff_id: 'x-9', status: null, settle_ym: '2026-12', state: 'noyearend' }, { staff_id: 's-2', status: 'final', settle_ym: '2026-12', state: 'nobalance' }, { staff_id: 's-2', status: 'final', settle_ym: '2026-12', state: 'noitem', balance_settle: 3000 }]);
    t('確定の前: notfinal・noyearend・nobalance・noitem では止めない', (await Y2.beforeConfirm(c2)) === null);
    t('…それらは今月の給与の帯で知らせる（止めない）', /年末調整の知らせ（確定は止めません）: 見本 二（年末調整がまだ下書き）、x-9（年末調整が無いのに所得税の精算がある）、見本 二（年末調整の過不足の額が無い）/.test(Y2.runBand(c2)), Y2.runBand(c2));
    c2.answer = CHK([Object.assign({}, FIN1, { settle_ym: '2026-11', state: 'diff' }), Object.assign({}, FIN1, { status: 'draft', state: 'diff' })]);
    t('確定の前: ほかの月分を精算する月分にした人・下書きの人の diff では止めない', (await Y2.beforeConfirm(c2)) === null);
    const c11 = Object.assign({}, c2, { ym: '2026-11', calls: [] }); c11.rpc = (n, a) => { c11.calls.push(n); return Promise.resolve({ ok: true, rows: [Object.assign({}, FIN1, { settle_ym: '2026-11', state: 'stale' })] }); };
    t('確定の前: 12月分でない月も確かめ、その月分を精算する月分にした人の stale で止める', /見本 一/.test(await Y2.beforeConfirm(c11) || '') && c11.calls.indexOf('payroll_yearend_check') >= 0);
    const cNo = Object.assign({}, c2, { rpc: () => { const e = new Error('nf'); e.code = 'PGRST202'; return Promise.reject(e); } });
    t('確定の前: DB に確かめの関数がまだ無い（0122 の前）は今の流れのまま通す（仮置き）', (await Y2.beforeConfirm(cNo)) === null);
    const cErr = Object.assign({}, c2, { rpc: () => Promise.reject(new Error('net')) });
    t('確定の前: 通信の失敗は止める（安全の側）', /確かめられませんでした/.test(await Y2.beforeConfirm(cErr) || ''));
    const cBad = Object.assign({}, c2, { rpc: () => Promise.resolve({ ok: false, error: 'badyear' }) });
    t('確定の前: DB が ok=false を返したら止める', /確かめられませんでした（badyear）/.test(await Y2.beforeConfirm(cBad) || ''));
    c2.answer = (n) => n === 'payroll_ytd_get' ? DATA : { ok: true };
    Y2._test.state().data = null; Y2.html(c2); await tick(); await tick();
    /* 計算の入力: 累計の全行（freee・manual）＋精算する月分の給与（app・tax_adjust を除く） */
    const it12 = { staff_id: 's-1', gross: 210000, taxable: 200000, si_total: 30000, deduct: 40000, net: 170000, pay_date: '2026-12-25', lines: [{ sec: 'deduct', code: 'health', amount: 10000 }, { sec: 'deduct', code: 'pension', amount: 20000 }, { sec: 'deduct', code: 'income_tax', amount: 4000 }, { sec: 'deduct', code: 'tax_adjust', amount: -2500 }], adjustments: [] };
    c2.items = [it12];
    Y2._test.state().dlg = { sid: 's-1', settle_ym: '2026-12', nDep: 0, nPrev: 0 };
    const ci = Y2._test.calcInput(c2, 's-1', { kou: true });
    t('年末調整の rows は累計の全行（freee・manual）と12月分の給与（app）・12月分の所得税に精算を入れない', ci.input.rows.map((r) => r.source).join() === 'freee,manual,app' && ci.input.rows[2].pay_date === '2026-12-25' && ci.input.rows[2].data.income_tax === 4000 && ci.input.rows[2].data.gross === 210000, ci.input.rows);
    t('basis は 0122 の形 {ytd:[(pay_date, kind, rev, fp)], items:[(ym, rev, gross, taxable, si, tax)]}・fp は ytd_get の値をそのまま写す', Object.keys(ci.basis).sort().join() === 'items,ytd' && JSON.stringify(ci.basis.ytd[0]) === '{"pay_date":"2026-01-25","kind":"salary","rev":1,"fp":"f0a1"}'
      && JSON.stringify(ci.basis.items[0]) === '{"ym":"2026-12","rev":3,"gross":210000,"taxable":200000,"si":30000,"tax":4000}', ci.basis);
    const ci11 = Y2._test.calcInput(Object.assign({}, c2, { ym: '2026-11' }), 's-1', { kou: true });
    t('精算する月分を表示していない時は12月分を入れず、警告を出す（確定できない）', ci11.input.rows.length === 2 && ci11.basis.items.length === 0 && /精算する月分/.test(ci11.warn));
    t('精算する月分の選びはその年の1〜12月分だけ（0122 の basis が同じ年の月分だけを受ける）・既定は12月分', Y2._test.settleOpts(2026).length === 12 && Y2._test.settleOpts(2026)[11][0] === '2026-12');
    t('年末調整の計算に定数（rates）・prevJobs を渡さない（年で引かせる・前職は decl から）', !('rates' in ci.input) && !('prevJobs' in ci.input));
    /* 申告の欄 → decl（0122 の白い一覧の鍵・反証レビュー 2026-11-23 で足した5つを含む） */
    {
      const st = Y2._test.state();
      st.dlg = { sid: 's-1', settle_ym: '2026-12', nDep: 2, nPrev: 1, nU23: 2, decl: {} };
      const F0 = { 'ye-kou': { checked: true }, 'ye-s-dis': { value: 'none' }, 'ye-s-wid': { value: 'none' },
        'ye-d0-name': { value: '見本 子' }, 'ye-d0-birth': { value: '2010-04-01' }, 'ye-d0-inc': { value: '0' }, 'ye-d0-dis': { value: 'none' }, 'ye-d0-nr': { checked: true }, 'ye-d0-stu': { checked: true }, 'ye-d0-r38': { checked: true },
        'ye-d1-name': { value: '見本 親' }, 'ye-d1-birth': { value: '1950-01-01' }, 'ye-d1-dis': { value: 'none' }, 'ye-d1-stu': { checked: true }, 'ye-d1-r38': { checked: true },
        'ye-u0-birth': { value: '2008-05-05' }, 'ye-u0-sd': { checked: true }, 'ye-i-national_pension': { value: '200,000' }, 'ye-i-life_new_general': { value: '' },
        'ye-h-amt': { value: '150000' }, 'ye-h-start': { value: '2020-03-01' }, 'ye-h-cnt': { value: '1' }, 'ye-h-lim': { value: '20000000' },
        'ye-p0-payer': { value: '見本の前職' }, 'ye-p0-addr': { value: '架空の市 1-2-3' }, 'ye-p0-pay': { value: '500000' }, 'ye-p0-left': { value: '2026-03-31' }, 'ye-settle-ym': { value: '2026-12' } };
      Object.assign(D2.f, F0);
      const rd = Y2._test.readDecl();
      const dd = rd.decl;
      t('申告: 扶養親族の留学・38万円以上の送金は非居住者の時だけ入れる', rd.bad.length === 0 && dd.dependents[0].student === true && dd.dependents[0].remit38 === true && !('student' in dd.dependents[1]) && !('remit38' in dd.dependents[1]), [rd.bad, dd.dependents]);
      t('申告: 配偶者の扶養に入れた23歳未満の子など（under23_others: birth・special_disabled）', JSON.stringify(dd.under23_others) === '[{"birth":"2008-05-05","special_disabled":true}]', dd.under23_others);
      t('申告: 国民年金保険料等（national_pension）・住宅ローンの所得の要件（income_limit）・前職の住所（address）', dd.insurance.national_pension === 200000 && dd.housing_loan.income_limit === 20000000 && dd.prev_jobs[0].address === '架空の市 1-2-3', [dd.insurance, dd.housing_loan, dd.prev_jobs]);
      D2.f["ye-h-lim"] = { value: "9" };
      t('申告: 所得の要件は 1,000万・2,000万・3,000万円だけ（知らない値は既定の2,000万円）', Y2._test.readDecl().decl.housing_loan.income_limit === 20000000);
      t('申告: マイナンバーの鍵を作らない（入れ子も）', !/my_?number|kojin|個人番号|マイナンバー/i.test(JSON.stringify(Object.keys(dd)) + JSON.stringify(dd)));
      const dh = Y2._test.depsHtml((s0) => String(s0), [{ nonresident: false }, { nonresident: true }], 2);
      t('扶養親族の欄: 留学・送金の印は非居住者の行だけに出す', (dh.match(/id="ye-d\d-stu"/g) || []).join() === 'id="ye-d1-stu"' && (dh.match(/id="ye-d\d-r38"/g) || []).join() === 'id="ye-d1-r38"');
      t('所得の要件の選びの既定は2,000万円・3つ', /'ye-h-lim', '所得の要件（合計所得金額）', String\(hl\.income_limit \|\| 20000000\), \[\['10000000', '1,000万円以下'\], \['20000000', '2,000万円以下'\], \['30000000', '3,000万円以下'\]\]/.test(U));
      st.dlg = null;
    }
    /* 反証レビュー（2026-11-23・画面と取り込み）の直し */
    {
      const S2 = Y2._test.state();
      /* 8: 精算する月分の自社の給与と同じ暦の月の給与の行（freee・manual）が累計にあれば、二重に数えるので計算を止める */
      const twinRow = { staff_id: 's-1', pay_date: '2026-12-10', kind: 'salary', source: 'manual', data: { gross: 210000, income_tax: 4000 }, rev: 4 };
      S2.data.rows.push(twinRow);
      S2.dlg = { sid: 's-1', settle_ym: '2026-12', nDep: 0, nPrev: 0, nU23: 0, decl: {} };
      const ciT = Y2._test.calcInput(c2, 's-1', { kou: true });
      t('二重の月: 精算する月分の給与（app）と同じ暦の月の累計の給与（manual）があれば計算の入力を作らず止める', ciT.input === null && ciT.stop.length === 1 && ciT.stop[0].pay_date === '2026-12-10', ciT);
      D2.f['ye-res'] = {}; D2.f['ye-kou'] = { checked: true }; D2.f['ye-settle-ym'] = { value: '2026-12' };
      c2.said = null; Y2.onClick(c2, 'ye-calc', null);
      t('二重の月: 「計算する」は止めて知らせ、累計の行を消すボタン（理由つき）を出す', /二重に数えるので計算しません/.test(c2.said || '') && /data-act="ye-ytd-del" data-pd="2026-12-10" data-k="salary"/.test(D2.f['ye-res'].html || '') && /id="ye-del-reason"/.test(D2.f['ye-res'].html || ''));
      D2.f['ye-del-reason'] = { value: '二重の取り込み' };
      c2.calls.length = 0;
      const delBtn = { disabled: false, getAttribute: (k) => ({ 'data-pd': '2026-12-10', 'data-k': 'salary' }[k] || null) };
      Y2.onClick(c2, 'ye-ytd-del', delBtn); await tick(); await tick();
      const dc = c2.calls.find((x) => x.name === 'payroll_ytd_delete');
      t('二重の月: 「累計のこの行を消す」は payroll_ytd_delete（年・職員・支給日・種類・版・理由）', !!dc && JSON.stringify(dc.args) === JSON.stringify({ p_year: 2026, p_staff_id: 's-1', p_pay_date: '2026-12-10', p_kind: 'salary', p_rev: 4, p_reason: '二重の取り込み' }) && !S2.data.rows.includes(twinRow), dc && dc.args);
      /* 9: 欄を足す時、入れかけの前職・23歳未満の子の行を落とさない */
      S2.dlg = { sid: 's-1', settle_ym: '2026-12', nDep: 0, nPrev: 1, nU23: 1, decl: {} };
      D2.f['ye-prevs'] = {}; D2.f['ye-u23s'] = {};
      D2.f['ye-p0-payer'] = { value: '' }; D2.f['ye-p0-addr'] = { value: '架空の町' }; D2.f['ye-p0-pay'] = { value: '' }; D2.f['ye-u0-birth'] = { value: '' }; D2.f['ye-u0-sd'] = { checked: true };
      Y2.onClick(c2, 'ye-prev-add', null); Y2.onClick(c2, 'ye-u23-add', null);
      t('欄を足す: 入れかけの前職（住所だけ）と23歳未満の子（特別障害者の印だけ）を描き直しても残す', /id="ye-p0-addr" value="架空の町"/.test(D2.f['ye-prevs'].html || '') && /id="ye-p1-payer"/.test(D2.f['ye-prevs'].html || '') && /id="ye-u0-sd" checked/.test(D2.f['ye-u23s'].html || '') && /id="ye-u1-birth"/.test(D2.f['ye-u23s'].html || ''));
      S2.dlg = null;
      /* 5: 源泉徴収票の印刷・CSV は記録（payroll_yearend_log）が通ってからだけ */
      c2.printSlips = (html, pages) => { c2.printed = pages; }; c2.download = (r) => { c2.dl = r; };
      c2.calls.length = 0; c2.printed = null;
      c2.answer = (n) => n === 'payroll_yearend_log' ? { ok: true } : { ok: true };
      Y2.onClick(c2, 'ye-print', { getAttribute: () => 'all' }); await tick(); await tick();
      const lg = c2.calls.find((x) => x.name === 'payroll_yearend_log');
      t('印刷: payroll_yearend_log({p_year, p_kind:withholding_slip, p_count}) が ok の後に印刷', !!lg && JSON.stringify(lg.args) === '{"p_year":2026,"p_kind":"withholding_slip","p_count":1}' && c2.printed === 1, lg && lg.args);
      c2.printed = null; c2.answer = (n) => n === 'payroll_yearend_log' ? { ok: false, error: 'denied' } : { ok: true };
      Y2.onClick(c2, 'ye-print', { getAttribute: () => 'all' }); await tick(); await tick();
      t('印刷: 記録が ok でなければ印刷しない', c2.printed === null && /記録に残せなかった/.test(c2.said || ''));
      const rpc0 = c2.rpc; c2.rpc = (n, a) => { c2.calls.push({ name: n, args: a }); if (n === 'payroll_yearend_log') { const e = new Error('nf'); e.code = 'PGRST202'; return Promise.reject(e); } return Promise.resolve({ ok: true }); };
      Y2.onClick(c2, 'ye-print', { getAttribute: () => 'all' }); await tick(); await tick();
      t('印刷: 0122 の無い DB（記録の関数が無い）では止める', c2.printed === null && /記録の仕組みがまだ無い/.test(c2.said || ''));
      c2.rpc = rpc0; c2.answer = (n) => ({ ok: true }); c2.calls.length = 0; c2.dl = null;
      Y2.onClick(c2, 'ye-csv', null); await tick(); await tick();
      const lg2 = c2.calls.find((x) => x.name === 'payroll_yearend_log');
      t('CSV: payroll_yearend_log(kind=yearend_csv) の ok の後に書き出す', !!lg2 && lg2.args.p_kind === 'yearend_csv' && lg2.args.p_count === 1 && !!c2.dl && /withholding-2026\.csv/.test(c2.dl.name));
      /* 4・10: 取り込み（必須の見出しが無いファイルは断る・同じ人・支給日・種類が2つのファイルにある時は知らせ、後のファイルを入れる） */
      const fake = (name, text) => ({ name, size: text.length, arrayBuffer: () => Promise.resolve(text) });
      c2.decode = (x) => x;
      const A = '氏名,支給日,総支給額,課税支給額,所得税\n見本 一,2026/03/25,"200,000","200,000","4,000"\n';
      const B = '氏名,支給日,総支給額,課税支給額,所得税\n見本 一,2026/03/25,"210,000","210,000","4,200"\n';
      const Cx = '氏名,支給日,総支給額,課税支給額\n見本 二,2026/03/25,"100,000","100,000"\n';
      const fin = S2.data.yearend[0]; fin.status = 'draft';
      Y2.onChange(c2, { id: 'ye-files', files: [fake('a.csv', A), fake('b.csv', B), fake('c.csv', Cx)], value: 'x' }); for (let i = 0; i < 6; i++) await tick();
      const im = S2.imp;
      t('取り込み: 必須の見出し（所得税）が無いファイルは行を作らず断る', !!im && im.files.find((f) => f.name === 'c.csv').refused === true && !im.rows.some((r) => r.name === '見本 二'), im && im.files);
      t('取り込み: 同じ人・支給日・種類が2つのファイル → 後のファイル（b.csv）の行を入れ、知らせを出す', !!im && im.ok.length === 1 && im.ok[0].data.gross === 210000 && im.dups.length === 1 && im.dups[0].chosen === 'b.csv' && im.dups[0].files.join() === 'a.csv,b.csv', im && [im.ok, im.dups]);
      const hi = Y2.html(c2);
      t('取り込み: 画面に「読めなかったファイル」（読めなかった見出し）と「2つのファイルにあり」の印', /読めなかったファイル（入れません）/.test(hi) && /c\.csv：読めなかった見出し 所得税/.test(hi) && /2つのファイルにあり・「b\.csv」の行/.test(hi) && /入れるのは「b\.csv」/.test(hi));
      fin.status = 'final'; S2.imp = null;
      /* 2回目の反証（2026-11-23）1: 負の値の行は赤く出し、ある間は「累計に入れる」を押せない */
      fin.status = 'draft';
      const N = '氏名,支給日,総支給額,課税支給額,所得税\n見本 一,2026/06/25,"200,000","200,000","-1,200"\n見本 二,2026/06/25,"180,000","180,000","3,000"\n';
      Y2.onChange(c2, { id: 'ye-files', files: [fake('june.csv', N)], value: 'x' }); for (let i = 0; i < 6; i++) await tick();
      const hn = Y2.html(c2);
      t('負の値: 取り込みの一覧に人・支給日・項目つきで赤く出す（ファイル名つき）', S2.imp.neg.length === 1 && /class="band ng" role="alert"><b>⛔ 負の値があって入れられない行（1行）/.test(hn) && /見本 一・2026-06-25・給与：所得税（june\.csv）/.test(hn) && /1回分を手で足す」で差し引きした額/.test(hn), S2.imp.neg);
      t('負の値: ある間は「累計に入れる」を押せない（ボタンは disabled・押しても送らない）', /data-act="ye-imp-go" disabled>1回分を累計に入れる/.test(hn) && (c2.calls.length = 0, Y2.onClick(c2, 'ye-imp-go', null), !c2.calls.some((x) => x.name === 'payroll_ytd_put')));
      S2.imp = null;
      /* 3: 500行ごとの途中の塊が断られた時は、ytd_get で読み直して入った行と入らなかった行を出す */
      const keepData = S2.data, many = [];
      for (let d = 0; d < 501; d++) { const sid = d < 300 ? 's-1' : 's-2', day = new Date(Date.UTC(2026, 0, 1 + (d % 300))).toISOString().slice(0, 10); many.push({ staff_id: sid, pay_date: day, kind: 'salary', source: 'freee', data: { gross: 1 }, src_fp: '', rev: 0 }); }
      S2.imp = { files: [], rows: [], unmatched: [], ok: many.map((x) => Object.assign({}, x)), warnings: [], finalNg: [], dups: [], neg: [] };
      let putN = 0; c2.calls.length = 0;
      c2.answer = (n, a) => {
        if (n === 'payroll_ytd_put') { putN++; return putN === 1 ? { ok: true, added: a.p_rows.length } : { ok: false, error: 'conflict', staff_id: 's-2' }; }
        if (n === 'payroll_ytd_get') return { ok: true, rows: many.slice(0, 500).map((x) => Object.assign({}, x, { rev: 1, fp: 'f' })), yearend: [] };
        return { ok: true };
      };
      c2.said = null;
      Y2.onClick(c2, 'ye-imp-go', null); for (let i = 0; i < 8; i++) await tick();
      const done = S2.imp && S2.imp.done;
      t('途中で断られた: 2つ目の塊で断られたら ytd_get で読み直す', putN === 2 && c2.calls.some((x) => x.name === 'payroll_ytd_get') && c2.calls.filter((x) => x.name === 'payroll_ytd_put')[0].args.p_rows.length === 500);
      t('途中で断られた: 入った行 500・入らなかった行 1 を出し、残りは入らなかった行だけ（今の版で送り直せる）', !!done && done.entered.length === 500 && done.missed.length === 1 && S2.imp.ok.length === 1 && S2.imp.ok[0].rev === 0 && /入った行 500・入らなかった行 1/.test(c2.said || ''), done && [done.entered.length, done.missed.length]);
      t('途中で断られた: 画面に「途中で断られました」と入らなかった行の一覧', /途中で断られました（ほかの人が先に累計を変えました。読み直してください（s-2）。）/.test(Y2.html(c2)) && /入らなかった行<\/p><ul><li>見本 二・/.test(Y2.html(c2)));
      fin.status = 'final'; S2.imp = null; S2.data = keepData; c2.answer = (n) => ({ ok: true });
      /* 2: 源泉徴収票の乙欄の印は、給与の設定の源泉の区分（tax.col が otsu）から staffInfo.otsu で渡す */
      const sv = []; const ws0 = Y2._test.state();
      c2.bs.profiles[0].data.tax = { col: 'otsu' };
      const wsl = Y2._test.slipList(c2, 'all');
      t('源泉徴収票: 源泉の区分が乙欄の人は staffInfo.otsu=true', wsl.length === 1 && wsl[0].name === '見本 一' && lastStaff && lastStaff.otsu === true, lastStaff);
      c2.bs.profiles[0].data.tax = { col: 'kou' }; Y2._test.slipList(c2, 'all');
      t('源泉徴収票: 甲欄の人は otsu=false', lastStaff && lastStaff.otsu === false);
      delete c2.bs.profiles[0].data.tax;
    }
    /* 振込と書き出しの印 */
    /* ★比べた結果に指紋（fp）と対象外の数（others・pass）を持たせた（2026-11-23 反証の直し）ので、同じ場面（差2・片方だけ1）を今の形で作る */
    Y2._test.state().cmp = { ym: '2026-12', fp: Y2._test.cmpFp(c2), res: { diffCount: 2, unmatched: [{}], others: 1, pass: false } };
    t('振込と書き出し: この月分を freee と比べて差があれば「freee と差があります（n件）」', /freee と差があります（3件）/.test(Y2.exportBadge(c2)) && Y2.exportBadge(Object.assign({}, c2, { ym: '2026-11' })) === '');
    Y2._test.state().cmp.res = { diffCount: 0, unmatched: [{ excluded: true }], others: 0, pass: true };
    t('振込と書き出し: 合格（対象外の人だけが自社だけ）なら印を出さない', Y2.exportBadge(c2) === '');
    Y2._test.state().cmp.fp = 'old';
    t('振込と書き出し: 比べた後に計算が変わったら「比べ直してください」', /比べた後に計算が変わりました/.test(Y2.exportBadge(c2)));
    Y2.reset();
    t('reset で申告・累計・取り込み・比べた結果を捨てる', Y2._test.state().data === null && Y2._test.state().cmp === null && Y2._test.state().imp === null && Y2._test.state().dlg === null);
  })());
}


console.log('\n— 賞与のタブ（統合 0121・2026-11-23 設計 CONTRACT-bonus-v1.md §4）—');
{
  const BON = J.slice(J.indexOf('/* ── 賞与（2026-11-23 足した'), J.indexOf('/* ── 職員の給与設定 ── */'));
  /* 0121 の関数の見出し（care-backend の下書き PR #206 の supabase/migrations/0121_payroll_bonus.sql）の引数の名前。打ち間違えると PGRST202 で「準備中」に化けるので固定する */
  const SIG = { payroll_bonus_bootstrap: ['p_bonus_id'], payroll_bonus_create: ['p_pay_date', 'p_title'], payroll_bonus_config_put: ['p_bonus_id', 'p_config', 'p_rev'],
    payroll_bonus_save: ['p_bonus_id', 'p_items', 'p_fingerprint', 'p_rev'], payroll_bonus_confirm: ['p_bonus_id', 'p_rev'], payroll_bonus_unconfirm: ['p_bonus_id', 'p_reason'],
    payroll_bonus_delete: ['p_bonus_id', 'p_rev'], payroll_bonus_bank_export: ['p_bonus_id'], payroll_bonus_export_log: ['p_bonus_id', 'p_kind'] };
  const calls = [...BON.matchAll(/rpc\('(payroll_bonus_[a-z_]+)', \{([^}]*)\}/g)].map((m) => [m[1], m[2].split(',').map((x) => x.split(':')[0].trim()).filter(Boolean).sort().join()]);
  t('賞与の口は9本とも 0121 の引数の名前で呼ぶ（一覧も p_bonus_id を鍵ごと送る）', Object.keys(SIG).every((n) => calls.some((c) => c[0] === n)) && calls.every((c) => SIG[c[0]] && SIG[c[0]].slice().sort().join() === c[1])
    && /rpc\('payroll_bonus_bootstrap', \{ p_bonus_id: bSel \|\| null \}\)/.test(BON), calls);
  t('年末調整の口は payroll_ytd_get(p_year)・無い・断られた時は黙って飛ばす', /rpc\('payroll_ytd_get', \{ p_year: yr \}\)/.test(BON) && /if \(!bonusNoDb\(e\) && !\(e && e\.code === '42501'\)\) note\('年末調整の記録', e\);/.test(BON));
  t('関数の無い DB（42883・PGRST202 など）では「賞与はまだ使えません（データベースの準備中）」だけ出して何もしない・月の給与の noDb は変えない',
    P.bonusNoDb({ code: '42883' }) && P.bonusNoDb({ code: 'PGRST202' }) && !P.bonusNoDb({ code: '42501' }) && /if \(bNoDb\) return '<div class="cd"><h2>賞与<\/h2><div class="band warn" role="status">賞与はまだ使えません（データベースの準備中）。<\/div><\/div>';/.test(BON)
    && /function noDb\(e\) \{ var c = e && e\.code; return c === '42P01' \|\| c === 'PGRST205' \|\| c === 'PGRST202'; \}/.test(J));
  t('賞与の部分に localStorage・sessionStorage・console・innerHTML が無い（タブは今の lsSet(LS_TAB) だけ）', !/localStorage|sessionStorage|console\.|innerHTML/.test(BON));
  t('10分で隠す時・鍵の画面・覆いで賞与の紙と読んだ物を捨てる', /put\(\$\('p-print'\), ''\);\n    bPrint = null;/.test(J) && /members = null;\n    bb = null; bGen\+\+; bLoading = false; bPrint = null;/.test(J) && /members = null;\n    bGen\+\+; bLoading = false; bonusClear\(\);/.test(J));
  t('賞与の断りの stale は賞与だけ読み直す（月の給与の handleStale に渡さない）・権限の断りは今の fail', /if \(e && e\.payroll === 'stale'\) \{ bNotice = \{ cls: 'warn', text: BNG\.stale \}; return bonusLoad\(true\); \}/.test(BON) && /if \(e && e\.code === '42501'\) return fail\(e, where\);/.test(BON) && !/handleStale/.test(BON));
  t('全銀は種別12（設定の写しで上書き）・振込指定日は支給日・スイッチ zengin_enabled の裏', /zengin: Object\.assign\(\{\}, obj\(c\.zengin\), \{ kind: '12' \}\)/.test(BON) && /payDate: bb\.run\.pay_date/.test(BON) && /bonusCfgOf\(\)\.zengin_enabled !== true\) return;/.test(BON));
  t('確定のボタンは止めの警告があれば押せない（一覧の画面も窓の中も）・押した時も読み直して止めを確かめ直す',
    /data-act="b-confirm"' \+ \(bb\.items\.length && !bonusDirty\(\) && !run\.stale && !blk\.length( && !bYtdWait)? \? '' : ' disabled'\)/.test(BON) && /data-act="b-confirm-go"' \+ \(blk\.length \? ' disabled' : ''\)/.test(BON)
    && /var blk = bonusBlocks\(fresh\.items, fresh\.prev\);/.test(BON));
  t('年末調整の記録の答え（届いた・失敗・無い）が決まるまで「下書き保存」「確定」を押せない（ボタン・押した時の両方）・答えが決まったら必ず描き直す',
    /data-act="b-save"' \+ \(c && !bCfgDirty && !bYtdWait \? '' : ' disabled'\)/.test(BON) && /!blk\.length && !bYtdWait \? '' : ' disabled'\)/.test(BON)
    && /function bonusSave\(btn\) \{\n    if \(busy \|\| !bb \|\| !bb\.run \|\| bonusFrozen\(\) \|\| bYtdWait\) return;/.test(BON) && /bonusDirty\(\) \|\| bYtdWait\) return;/.test(BON)
    && /bYtdWait = !!\(bb\.run && !bonusFrozen\(\) && isDate\(bb\.run\.pay_date\)\);/.test(BON) && /* ★時間切れを足して答えの受け口を finish にまとめたので、描き直しの所の書き方の期待を改めた（決まりは同じ） */ /rows = null; bYtdWait = false;\n      if \(any\) \{[\s\S]*?\n      \}\n      paint\(\);\n    \};/.test(BON)
    && /Promise\.all\(\[one\(y - 1\), one\(y\)\]\)/.test(BON) && /function \(e\) \{ if \(!bonusNoDb\(e\)/.test(BON));
  t('明細の紙は SUPrint の別の名前（bonus-slips）・今の月の明細と同じ型（.slip）に「賞与明細」・施設名と印刷日の印', /define\('bonus-slips', \{ label: '賞与明細', paper: 'A4 portrait'/.test(BON) && /<section class="slip"/.test(BON) && /<h3>賞与明細　/.test(BON) && /data-su-print-head="name date"/.test(BON));

  /* 動かして確かめる: 本物の computeBonus の出力 → 保存の形に写す → 0121 の形の確かめの写し（check/fixtures/payroll.mjs の bonusItemErr）が通す */
  const PC = require(path.join(ROOT, 'payroll-calc.js')), PX = require(path.join(ROOT, 'payroll-export.js'));
  win.PayrollCalc = PC; win.PayrollExport = PX;
  const ALLOWED = ['gross', 'deduct', 'net', 'social', 'tax', 'lines', 'std', 'ins', 'warns', 'ver', 'taxable', 'tax_base', 'P', 'employer', 'taxMethod', 'rate', 'prev_kind'];
  const base = (o) => Object.assign({ pay_type: 'monthly', base: 250000, birth_date: '1980-05-01', entry_date: '2020-04-01', retire_date: null,
    ins: { health: { on: true, std: 260000 }, pension: { on: true, std: 260000 }, emp: { on: true } }, tax: { col: 'kou', dependents: 0, dependents_checked: true } }, o);
  const defs = [{ code: 'meal', name: '見本の控除', sec: 'deduct', calc: 'fixed', attrs: {} }];
  const cases = [
    ['甲欄・前月の給与あり（給与の記録）・控除の定義の行あり', base({}), [{ code: 'bonus', amount: 300000 }, { code: 'meal', amount: 1000 }], { state: 'ok', items: { 's-1': { P: 213211 } } }, null, null],
    ['資格を失う月（退職の日の前に払う）', base({ retire_date: '2026-12-26' }), [{ code: 'bonus', amount: 200000 }], { state: 'ok', items: { 's-1': { P: 180000 } } }, null, null],
    ['産休・育休の免除の期間', base({ ins: { health: { on: true, std: 260000 }, pension: { on: true, std: 260000 }, emp: { on: true }, exempt: [{ from_ym: '2026-11', to_ym: '2027-02' }] } }), [{ code: 'bonus', amount: 250000 }], { state: 'none', items: {} }, { none: true, source: 'freee' }, null],
    ['乙欄・年末調整の記録の前月の給与', base({ tax: { col: 'otsu', dependents: 0 } }), [{ code: 'bonus', amount: 120000 }], { state: 'none', items: {} }, null, 95000],
    ['源泉の区分 none・手入力の前月の給与', base({ tax: { col: 'none' }, ins: { health: { on: false }, pension: { on: false }, emp: { on: false } } }), [{ code: 'bonus', amount: 50000 }], { state: 'none', items: {} }, { P: 88000, source: 'paper' }, null],
    ['前月の給与が10倍を超える（月額表の方法）', base({}), [{ code: 'bonus', amount: 2000000 }], { state: 'ok', items: { 's-1': { P: 150000 } } }, null, null],
  ];
  pend.push(import(path.join(ROOT, 'check/fixtures/payroll.mjs')).then((FX) => {
    {
      /* 賞与額 0 の人も明細にする: 本物の computeBonus が総支給0・控除0・差引0 を返し、0121 の形の確かめ（std は総支給の千円未満切り捨て以下）を通る */
      const pv0 = P.bonusPrevOf({ state: 'ok', items: { s0: { P: 200000 } } }, 's0', null, null);
      const o0 = PC.computeBonus({ bonus: { pay_date: '2026-12-24', lines: [{ code: 'bonus', amount: 0 }] }, settings: { prefecture: '43' }, profile: base({}), allowanceDefs: defs,
        prev: { kind: pv0.kind, P: pv0.P }, fyStdSum: 0, fyPriorStd: 0, monthStdSum: 0, count12: 0, count12Other: 0 });
      const s0 = JSON.parse(JSON.stringify(P.bonusToSave(o0, 's0', pv0)));
      t('賞与額 0 の人: 総支給0・控除0・差引0・標準賞与額0・確定の止め無しで、0121 の形の確かめを通る', o0.gross === 0 && o0.deduct === 0 && o0.net === 0 && o0.std.health === 0 && o0.std.pension === 0
        && !o0.warns.some((w) => w.stop) && FX.bonusItemErr(s0) === null, { o0w: o0.warns, err: FX.bonusItemErr(s0) });
    }
    t('偽の DB の確定の止めの印は DB の直しと同じ10個', FX.BONUS_STOP.slice().sort().join() === ['prev_missing', 'prev_unconfirmed', 'rate_missing', 'tax_table_missing', 'emp_rate_missing', 'std_missing', 'badinput', 'calc_error', 'leave_check', 'tax_col'].sort().join());
    {
      const R = FX.routesFor({ bonus: true }), call = R.rpcDirect;
      const a1 = call('payroll_bonus_create', { p_pay_date: '2026-12-24', p_title: '見本' }), a2 = call('payroll_bonus_create', { p_pay_date: '2026-12-24', p_title: '見本' });
      call('payroll_bonus_delete', { p_bonus_id: a1.bonus_id, p_rev: 1 });
      const a3 = call('payroll_bonus_create', { p_pay_date: '2026-12-24', p_title: '見本' }), bad = call('payroll_bonus_create', { p_pay_date: '2026-12-24', p_title: '見本\u0007' });
      t('偽の DB の回の番号は同じ支給日の番号の最大＋1（消した番号を詰めない）・題の制御文字は断る', a1.bonus_id === '2026-12-24#1' && a2.bonus_id === '2026-12-24#2' && a3.bonus_id === '2026-12-24#3' && bad.ok === false && bad.error === 'badshape', [a1, a2, a3, bad]);
    }
    t('偽の DB の賞与の引数の組も 0121 と同じ', Object.keys(SIG).every((n) => FX.BONUS_ARGS[n] && FX.BONUS_ARGS[n].slice().sort().join() === SIG[n].slice().sort().join()) && Object.keys(FX.BONUS_ARGS).length === 9);
    cases.forEach(([nm, prof, lines, prev, manual, ytdP]) => {
      const pv = P.bonusPrevOf(prev, 's-1', manual, ytdP);
      const out = PC.computeBonus({ bonus: { pay_date: '2026-12-24', lines }, settings: { prefecture: '43' }, profile: prof, allowanceDefs: defs,
        prev: { kind: pv.kind, P: pv.P, manualP: pv.manualP }, fyStdSum: 0, fyPriorStd: 0, monthStdSum: 0, count12: 0, count12Other: 0 });
      const sv = P.bonusToSave(out, 's-1', pv);
      const err = FX.bonusItemErr(JSON.parse(JSON.stringify(sv)));
      t('保存の形（' + nm + '）: 0121 の形の確かめが通す・許された鍵だけ・std.raw と T と stop を落とす', err === null && Object.keys(sv.item).every((k) => ALLOWED.includes(k)) && !('raw' in sv.item.std) && !('T' in sv.item)
        && sv.item.warns.every((w) => !('stop' in w)) && sv.item.tax_base === out.T && out.gross > 0 && Object.keys(sv).sort().join() === 'item,prev_manual,staff_id', { err, keys: Object.keys(sv.item), warns: out.warns });
    });
    const badKey = P.bonusToSave(PC.computeBonus({ bonus: { pay_date: '2026-12-24', lines: [{ code: 'bonus', amount: 100000 }] }, settings: {}, profile: base({}), prev: { kind: 'none' }, fyPriorStd: 0 }), 's-1', P.bonusPrevOf({ state: 'none' }, 's-1', { none: true }, null));
    badKey.item.std.raw = 100000;
    t('写しの確かめは知らない鍵（std.raw）を断る（試験の確かめが効いている）', FX.bonusItemErr(badKey) === 'badshape');
  }));

  t('前月の給与: 自社の確定した明細 ＞ 年末調整の記録 ＞ 手入力（記録から取った P も prev_manual に入れて送る）', (() => {
    const a = P.bonusPrevOf({ state: 'ok', items: { s: { P: 100 } } }, 's', { P: 90, source: 'freee' }, 95);
    const b = P.bonusPrevOf({ state: 'ok', items: {} }, 's', { P: 90, source: 'freee' }, 95);
    const c = P.bonusPrevOf({ state: 'none' }, 's', { P: 90, source: 'freee' }, null);
    return a.kind === 'db' && a.P === 100 && a.prev_kind === 'ok' && a.manualP === 90 && b.kind === 'ytd' && b.P === 95 && b.prev_kind === 'manual' && b.send.source === 'ytd' && b.send.P === 95
      && c.kind === 'manual' && c.send.P === 90 && c.prev_kind === 'manual';
  })());
  t('前月の給与: 「前月なし」は {P:null, none:true}・何も無ければ止め（prev_missing）・前月の給与が下書きなら手入力があっても止め', (() => {
    const n = P.bonusPrevOf({ state: 'none' }, 's', { none: true, source: 'freee' }, null), m = P.bonusPrevOf({ state: 'none' }, 's', null, null), u = P.bonusPrevOf({ state: 'draft' }, 's', { P: 1, source: 'freee' }, 5);
    return n.kind === 'none' && n.send.none === true && n.send.P === null && n.prev_kind === 'none' && m.kind === 'missing' && m.send === null && m.dbBlock === 'prev_missing' && m.prev_kind === null
      && u.kind === 'unconfirmed' && u.dbBlock === 'prev_unconfirmed';
  })());
  const BBK = { prev_missing: 1, leave_check: 1, tax_col: 1 };
  t('止めの警告: 画面だけの止め（leave_check など）・源泉の区分 none の人の前月の給与なし（DB と同じ）で止め、手入力があれば止めない', (() => {
    const pvNone = { state: 'none', items: {} };
    const a = P.bonusBlocks([{ staff_id: 's', name: '見本 一', warns: [{ code: 'leave_check', msg: 'x' }], prev_manual: { none: true } }], pvNone, BBK);
    const b = P.bonusBlocks([{ staff_id: 's', name: '見本 一', warns: [], prev_manual: null }], pvNone, BBK);
    const c = P.bonusBlocks([{ staff_id: 's', name: '見本 一', warns: [{ code: 'four_times' }], prev_manual: { P: 1, none: false, source: 'freee' } }], pvNone, BBK);
    const d = P.bonusBlocks([{ staff_id: 's', name: '見本 一', warns: [], prev_manual: null }], { state: 'ok', items: { s: { P: 100 } } }, BBK);
    return a.length === 1 && /見本 一：x/.test(a[0]) && b.length === 1 && /前月の給与/.test(b[0]) && c.length === 0 && d.length === 0;
  })());
  t('年末調整の記録から: 前月の給与の P・この年度に他所で払った標準賞与額（千円未満切り捨て）・過去12か月の回の数（自社の行と taxable の無い行は使わない）', (() => {
    const r = P.bonusYtd([
      { staff_id: 'a', pay_date: '2026-11-25', kind: 'salary', source: 'freee', data: { taxable: 250000, si_health: 12000, si_pension: 22000, si_emp: 1200 } },
      { staff_id: 'b', pay_date: '2026-11-25', kind: 'salary', source: 'freee', data: { gross: 1 } },
      { staff_id: 'a', pay_date: '2026-07-10', kind: 'bonus', source: 'freee', data: { gross: 301234 } },
      { staff_id: 'a', pay_date: '2026-03-10', kind: 'bonus', source: 'freee', data: { gross: 100000 } },
      { staff_id: 'a', pay_date: '2026-08-10', kind: 'bonus', source: 'app', data: { gross: 500000 } },
    ], '2026-12-24');
    return r.P.a === 214800 && !('b' in r.P) && r.fy.a === 301000 && r.cnt.a === 2;
  })());
  /* ★賞与支払届の CSV の決まりを改めた（2026-11-23 反証レビュー 7・仮置き: 支払った人を全員載せる・同じ月の合算の印は回の一覧から）ので、期待を改めた */
  t('賞与支払届の CSV: 決めた列だけ（個人番号・基礎年金番号なし）・千円未満切り捨ては上限の前の額・70歳以上の印・支払った人を全員（標準賞与額0の人も）載せる', (() => {
    const csv = P.bonusShoyoCsv([{ staff_id: 'a', name: '見本 一', gross: 1234567, std: { health: 1234000, pension: 1234000 }, warns: [] }, { staff_id: 'b', name: '見本 二', gross: 99999, std: { health: 99000, pension: 0 }, warns: [] },
      { staff_id: 'c', name: '見本 三', gross: 50000, std: { health: 0, pension: 0 }, warns: [] }], [{ staff_id: 'a', data: { birth_date: '1950-01-01' } }, { staff_id: 'b', data: { birth_date: '1990-01-01' } }], '2026-12-24',
      [{ bonus_id: '2026-12-24#1', pay_date: '2026-12-24', status: 'confirmed' }, { bonus_id: '2026-11-30#1', pay_date: '2026-11-30', status: 'confirmed' }], '2026-12-24#1');
    const rows = csv.trim().split('\r\n');
    return rows[0] === '氏名,生年月日,支給日,賞与額,千円未満切り捨ての額,70歳以上の印,同じ月の合算の印' && rows.length === 4 && rows[1] === '見本 一,1950-01-01,2026-12-24,1234567,1234000,1,' && rows[2] === '見本 二,1990-01-01,2026-12-24,99999,99000,,' && rows[3] === '見本 三,,2026-12-24,50000,50000,,' && !/個人番号|基礎年金/.test(csv);
  })());
  t('賞与支払届の CSV: 同じ年月に支給日のある別の回（下書きを除く・先の回も後の回も）があれば合算の印を付ける', (() => {
    const one = (runs) => P.bonusShoyoCsv([{ staff_id: 'a', name: '見本 一', gross: 100000, std: {}, warns: [] }], [], '2026-12-10', runs, '2026-12-10#1').trim().split('\r\n')[1].split(',')[6];
    return one([{ bonus_id: '2026-12-10#1', pay_date: '2026-12-10', status: 'confirmed' }, { bonus_id: '2026-12-24#1', pay_date: '2026-12-24', status: 'confirmed' }]) === '1'
      && one([{ bonus_id: '2026-12-10#1', pay_date: '2026-12-10', status: 'confirmed' }, { bonus_id: '2026-12-01#1', pay_date: '2026-12-01', status: 'exported' }]) === '1'
      && one([{ bonus_id: '2026-12-10#1', pay_date: '2026-12-10', status: 'confirmed' }, { bonus_id: '2026-12-24#1', pay_date: '2026-12-24', status: 'draft' }]) === ''
      && one([{ bonus_id: '2026-12-10#1', pay_date: '2026-12-10', status: 'confirmed' }]) === '';
  })());
  t('年末調整の記録の待ちは10秒で読めなかった扱いにして解く（答えが後から届いても使わない）', /BONUS_YTD_MS = 10000/.test(BON) && /setTimeout\(function \(\) \{ finish\(true\); \}, BONUS_YTD_MS\);/.test(BON)
    && /if \(settled\) return; settled = true;/.test(BON) && /if \(timedOut\) \{ any = false;/.test(BON) && /\.then\(function \(r\) \{ if \(settled\) return;/.test(BON));
  t('記録が後から届いて札に変わる人は、入れかけの前月の給与の選びを外す・札の人は見えない欄の形で止めない', /if \(x && x\.pm && bonusPrevOf\(bb\.prev, sid, null, bYtd\.v\.P\[sid\]\)\.kind === 'ytd'\) \{ x\.pm = ''; x\.pP = ''; \}/.test(BON)
    && /if \(x\.pm === 'P' && k0 !== 'db' && k0 !== 'ytd' && !bonusManual\(p\.staff_id\)\)/.test(BON));
  t('賞与額が空の人（明細の無い対象の人）: 確定を止める文を作る・全員に明細があれば止めない（0 の人も明細）', (() => {
    const pr = [{ staff_id: 'a', name: '見本 一' }, { staff_id: 'b', name: '見本 二' }, { staff_id: 'c', name: '見本 三' }];
    const m1 = P.bonusBlankMsg(pr, [{ staff_id: 'a', gross: 100 }]), m2 = P.bonusBlankMsg(pr, [{ staff_id: 'a' }, { staff_id: 'b', gross: 0 }, { staff_id: 'c', gross: 0 }]);
    return m1.length === 1 && m1[0] === '賞与額が空の人がいます（2人）：見本 二、見本 三。払わない人は 0 を入れてください' && m2.length === 0;
  })());
  /* ★空の止めの対象を在籍・退職前の人に絞った（反証レビュー 2026-11-23）ので、渡す人の書き方の期待を改めた（3か所に入っていることは同じ） */
  t('賞与額が空の人の止めは、回の画面の確定のボタン・確定の窓・押した時の読み直しの3か所に入っている（下書き保存は止めない）',
    /var blk = bonusBlocks\(bb\.items, bb\.prev\);\n      blk = bonusBlankMsg\(bonusBlankTargets\(bb\), bb\.items\)\.concat\(blk\);/.test(BON) && /blk = bonusBlocks\(list, bb\.prev\);\n    blk = bonusBlankMsg\(bonusBlankTargets\(bb\), list\)\.concat\(blk\);/.test(BON)
    && /var blk = bonusBlocks\(fresh\.items, fresh\.prev\);\n      blk = bonusBlankMsg\(bonusBlankTargets\(fresh\), fresh\.items\)\.concat\(blk\);/.test(BON) && !/bonusBlankMsg/.test(BON.slice(BON.indexOf('function bonusSave('), BON.indexOf('function bonusCfgSave('))));
  t('賞与額 0 は計算・保存し（空だけ外す）、読み直すと 0 と出す・総支給0の人は明細の印刷・CSV に出さない', /if \(a === null\) return;/.test(BON) && /bIn\[it\.staff_id\] = \{ amt: String\(a\),/.test(BON)
    && /\.filter\(function \(it\) \{ return num\(it\.gross\) > 0; \}\);   \/\* 総支給0の人は明細/.test(BON) && /bonusPrint\(bb\.items\.filter\(function \(it\) \{ return num\(it\.gross\) > 0; \}\)\)/.test(BON)
    && P.bonusShoyoCsv([{ staff_id: 'a', name: '見本 一', gross: 0 }, { staff_id: 'b', name: '見本 二', gross: 1000 }], [], '2026-12-24', [], 'x').trim().split('\r\n').length === 2);
  t('空の止めの対象は在籍で、退職日が無いか支給日以後の人だけ（在籍でない人・支給日より前に退職した人は外す・仮の ID の人は在籍として数える）', (() => {
    const b = P.bonusNorm({ staff: [{ staff_id: 'a', name: '見本 一', active: true }, { staff_id: 'b', name: '見本 二', active: false }, { staff_id: 'c', name: '見本 三', active: true }, { staff_id: 'd', name: '見本 四', active: true }],
      run: { bonus_id: '2026-12-24#1', pay_date: '2026-12-24', title: 'x' },
      profiles: [{ staff_id: 'a', data: {} }, { staff_id: 'b', data: {} }, { staff_id: 'c', data: { retire_date: '2026-09-30' } }, { staff_id: 'd', data: { retire_date: '2026-12-24' } }, { staff_id: 'p:x', data: {} }] });
    const ids = P.bonusBlankTargets(b).map((x) => x.staff_id).join();
    return ids === 'a,d,p:x' && P.bonusBlankMsg(P.bonusBlankTargets(b), [{ staff_id: 'a' }, { staff_id: 'd' }, { staff_id: 'p:x' }]).length === 0;
  })(), P.bonusBlankTargets(P.bonusNorm({})));
  t('職員の一覧にいて在籍なのに支給日の給与の設定が無い人を知らせる（止めた人は出さない・知らせだけ）', (() => {
    const b = P.bonusNorm({ staff: [{ staff_id: 'a', name: '見本 一', active: true }, { staff_id: 'b', name: '見本 二', active: true }, { staff_id: 'c', name: '見本 三', active: false }],
      run: { bonus_id: '2026-12-24#1', pay_date: '2026-12-24', title: 'x' }, profiles: [{ staff_id: 'a', name: '見本 一' }] });
    return P.bonusNoProfile(b).join() === '見本 二' && /給与の設定が無いので賞与の一覧に出ていない職員: /.test(BON);
  })());
  t('「もう一度読む」は保存していない入力があれば確かめの窓を出す', /if \(a === 'b-reload'\) \{ if \(bonusDirty\(\)\) \{ ask\('保存していない賞与の入力があります。捨てて読み直しますか？'\)/.test(BON));
  t('入力を残す読み直し: 回の設定の欄は人が直していなければ DB の値で作り直し、直していて DB が変わっていれば保存を止めて知らせる', /if \(!bCfgDirty\) bonusInitCfg\(\);\n        else if \(bCfgBase !== JSON\.stringify\(obj\(bb\.run && bb\.run\.config\)\)\) bCfgConflict = true;/.test(BON)
    && /if \(bCfgConflict\) \{ say\(BNG\.cfgconflict\); return; \}/.test(BON) && /data-act="b-cfg-save"' \+ \(bCfgDirty && !bCfgConflict \? '' : ' disabled'\)/.test(BON) && /cfgconflict: '回の設定がほかの人に変えられました。読み直してください/.test(BON));
  const nb = P.bonusNorm({ ok: true, runs: [{ bonus_id: '2026-12-24#1', pay_date: '2026-12-24', title: '見本', status: 'weird', count: 2, gross: 5 }, { bonus_id: 'bad' }], settings: 'x',
    run: { bonus_id: '2026-12-24#1', pay_date: '2026-12-24', title: '見本', status: 'draft', rev: 3, config: { fy_prior_std: { a: 1000 } } }, prev: { state: 'ok', ym: '2026-11', items: { a: { P: 'x' }, b: { P: 5 } } },
    items: [{ staff_id: 'a', item: { gross: 1, lines: 'x' }, prev_manual: { P: 1 } }, { staff_id: 'z' }], fingerprint: 'b1:x', ctx: { fy_std: { a: 'q', b: 3 } } });
  t('bonusNorm: 崩れた形は捨てる・P は数だけ・指紋は文字のまま', nb.runs.length === 1 && nb.runs[0].status === 'draft' && nb.run.rev === 3 && nb.prev.items.a.P === null && nb.prev.items.b.P === 5
    && nb.items.length === 1 && Array.isArray(nb.items[0].lines) && nb.fingerprint === 'b1:x' && !('a' in nb.ctx.fy_std) && nb.ctx.fy_std.b === 3);
}

console.log('\n— 賞与の「freee と比べる」と、確定した賞与を年末調整の累計へ（2026-11-23・0124） —');
{
  const U = read('payroll-yearend-ui.js');
  const cf = fnBody(J, 'bonusCmpFile', 'function bonusCmpHtml'), ch = fnBody(J, 'bonusCmpHtml', '/* ── 確定した明細を年末調整の累計へ'), yp = fnBody(J, 'bonusYtdPut', 'function bonusYtdHtml'), cg = fnBody(J, 'bonusConfirmGo', 'function bonusHtml');
  t('賞与の CSV は kind bonus で読み・職員の給与設定の freee の番号で結び・compareSlips(…, \'bonus\')', /F\.parse\(decode\(buf\), \{ kind: 'bonus' \}\)/.test(cf) && /emp_num: obj\(q\.data\)\.freee_emp_num/.test(cf) && /F\.compareSlips\(ours, pk\.rows, 'bonus'\)/.test(cf));
  t('freee の行は回の支給日でしぼり、1つも合わなければ比べない（夏と冬の取り違え）', /F\.pickByDate\(/.test(cf) && /if \(pk\.off\)/.test(cf));
  t('読んだ後に ArrayBuffer を捨て、ファイルの欄を空に戻す・2MB まで', /buf = null/.test(cf) && /el\.id === 'b-cmpfile'\) \{ if \(tab === 'bonus'\) bonusCmpFile\(el\.files && el\.files\[0\]\); el\.value = ''; return; \}/.test(J) && /BONUS_CMP_MAX = 2 \* 1024 \* 1024/.test(J));
  t('比べた後に明細が変わったら古い結果（合格の帯）を出さない（指紋で見る）', /c\.fp !== bonusCmpFp\(\)/.test(ch) && /fp: bonusCmpFp\(\)/.test(cf));
  t('合格の帯は年末調整の画面と同じ cmpBand（A9 の対象外の人数も出す）', /UI\.cmpBand\(esc, r\)/.test(ch) && /cmpBand: cmpBand/.test(U) && /freee に登録の無い人（比べる対象外）/.test(U) && /✓ 1円まで一致/.test(U));
  t('給与の比べる画面も、計算し直した後は古い結果を出さない（cmpFp）', /if \(c\.fp !== cmpFp\(ctx\)\)/.test(U) && /fp: cmpFp\(ctx\), nodate: pk\.nodate, res: F\(\)\.compareSlips\(ours, fr, 'salary'\)/.test(U));
  t('比べた結果・累計へ入れた結果はメモリだけ（回を替える・一覧へ戻ると捨てる）', /bCmp = null; bYtdPut = null; bYtdPending = null; \}/.test(J) && /bCmp = null; bYtdPut = null; bonusLoad\(false\);/.test(J));
  t('賞与の部分に端末への保存が無い（タブの payroll_tab のほか）', !/localStorage|sessionStorage|indexedDB/.test(cf + ch + yp));
  t('確定に成功した後、読み直してから累計へ入れる（確定は戻さない）', /bYtdPending = pbid;/.test(cg) && /return Promise\.resolve\(bonusLoad\(false\)\)\.then\(function \(\) \{ shown = bYtdPut; return bonusYtdPut\(null\); \}\)/.test(cg));
  t('累計へは planBonusYtd で作った行を payroll_ytd_put に送る・同じ支給日のほかの確定した回も読んで合算', /F\.planBonusYtd\(items, pd, g\)/.test(yp) && /rpc\('payroll_ytd_put', \{ p_year: yr, p_rows: rows \}\)/.test(yp)
    && /r\.pay_date === pd && \(r\.status === 'confirmed' \|\| r\.status === 'exported'\)/.test(yp) && /rpc\('payroll_bonus_bootstrap', \{ p_bonus_id: r\.bonus_id \}\)/.test(yp));
  t('累計に入らなかった時は「確定はできましたが…入っていません」とやり直しのボタン・古い DB（badshape）は手で足す案内', /確定はできましたが、年末調整の累計には入っていません/.test(yp) && /retry: true/.test(yp) && /badshape: 'データベースがまだ賞与を累計に入れる形になっていません/.test(J) && /data-act="b-ytd-put"/.test(J) && /a === 'b-ytd-put'\) bonusYtdPut\(b\)/.test(J));
  t('年末調整の手で足す窓の説明を改めた（賞与の表とはまだつないでいない、を消した）', !/賞与の表とはまだつないでいない/.test(U) && /賞与のタブで確定すると累計に入ります/.test(U));
  /* 反証レビュー（2026-11-23 画面）の直し */
  t('確定した回を開くと累計に入っているかを確かめる（送らない）・確定の直後に入れている間は確かめない', /if \(bb\.run && bonusFrozen\(\) && bYtdPending !== bb\.run\.bonus_id\) bonusYtdPut\(null, 'check'\);/.test(J) && /bYtdPending = pbid;/.test(J) && /if \(check\) \{/.test(yp));
  t('累計に前の確定の行が残る人（stale）を名前つきで出し、賞与のタブから消せる（payroll_ytd_delete・理由つき）', /plan\.stale\.length/.test(yp) && /「累計の残っている行を消す」で消してください/.test(yp) && /data-act="b-ytd-del"/.test(J) && /rpc\('payroll_ytd_delete', \{ p_year: y\.year, p_staff_id: r\.staff_id, p_pay_date: y\.pay_date, p_kind: 'bonus', p_rev: r\.rev, p_reason: /.test(J));
  t('確定の直後に送っている途中で読み直されたら、終わった後に帯が出ていなければ確かめ直す', /if \(bb && bb\.run && bb\.run\.bonus_id === pbid && bonusFrozen\(\) && bYtdPut === shown\) bonusYtdPut\(null, 'check'\);/.test(cg));
  t('読めない支給日の CSV は給与・賞与とも比べない', /pk\.why === 'baddate'/.test(cf) && /pk\.why === 'baddate'/.test(U) && /F\(\)\.pickByDate\(fr, mon, \{ month: true \}\)/.test(U));
  t('振込の所の印は対象外の人を差に数えず、比べた後に計算が変われば知らせる', /var n = c\.res\.pass \? 0 : c\.res\.diffCount \+ c\.res\.others;/.test(U) && /freee と比べた後に計算が変わりました/.test(U));
  t('「直す」に従業員番号の欄（20字まで・空なら前に値があった時だけ空に戻す）・A9 の人は比べる対象から外すと知らせる', /inp\('f-emp', '従業員番号（freee の番号）', d\.freee_emp_num/.test(J) && /else if \(empIn\) d\.freee_emp_num = empIn;/.test(J)
    && /else if \('freee_emp_num' in obj\(p\.data\)\) d\.freee_emp_num = null;/.test(J) && /比べる対象から外します/.test(J));
  t('部品の版を上げた（freee-slips 2026-11-23.3・yearend-ui 2026-11-23.2）', /payroll-freee-slips\.js\?v=2026-11-23\.3"/.test(H) && /payroll-yearend-ui\.js\?v=2026-11-23\.2"/.test(H));
}

Promise.all(pend).catch((e) => { fail++; console.log('  ✗ 動かして確かめる試験が止まった  → ' + e.message); }).then(() => {
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
});
