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
const iField = boot.indexOf('isField()'), iGate = boot.indexOf("SUAppGate.run('payroll'"), iAal = boot.indexOf("st.aal !== 'aal2'"), iLoad = boot.indexOf('load(false)');
t('boot は 現場端末の止め → 門番 → 二段階のログインの確かめ → 読み込み の順', iField >= 0 && iGate > iField && iAal > iGate && iLoad > iAal, [iField, iGate, iAal, iLoad]);
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
t('書き出し・印刷は記録（payroll_export_log）が通ってから・種類の名前は統合 0102 の5つ', /rpc\('payroll_export_log', \{ p_ym: ym, p_kind: EXP_LOG\[kind\] \}\)\.then\(okOr\)\.then/.test(J) && /rpc\('payroll_export_log', \{ p_ym: ym, p_kind: 'payslip' \}\)\.then\(okOr\)\.then/.test(J)
  && /var EXP_LOG = \{ zengin: 'zengin', journal: 'journal', ledger: 'ledger', list: 'csv' \};/.test(J));
t('書き出しの部品が作れないと言った時（ok が false）はファイルを落とさない', /if \(res\.ok === false\) \{[\s\S]{0,400}?return load\(true\);\s*\}\s*download\(res\)/.test(J));
t('確定の後に口座が直された（bank_export の stale）は計算し直しの stale と別の知らせ', /r\.error === 'stale'\) \{ var e = new Error\('bankstale'\); e\.payroll = 'bankstale'; throw e; \}/.test(J) && /bankstale: '確定した後に振込先の口座が直されました/.test(J));
t('取り込みの CSV はメモリだけ（読んだらファイルの選びを空にする）・違いの表は口座を下4桁だけ', /e\.target\.value = '';/.test(J) && /ch\.push\('口座：＊＊＊' \+ no\.slice\(-4\)\)/.test(J));
t('HTML を入れるのは put の1か所だけ', (J.match(/\.innerHTML/g) || []).length === 1);

console.log('\n— 4. タブの復元 —');
t('タブのホワイトリスト5つ', /var TABS = \['run', 'slip', 'export', 'profile', 'settings'\];/.test(J));
t('読み戻しはホワイトリスト・設定は管理者だけ・それ以外は今月の給与', /tab = TABS\.indexOf\(t\) >= 0 && \(t !== 'settings' \|\| isAdmin\(\)\) \? t : 'run';/.test(boot));
t('切り替えも同じ決まり', /if \(TABS\.indexOf\(t\) < 0 \|\| \(t === 'settings' && !isAdmin\(\)\)\) t = 'run';/.test(J));
t('月分は端末に残さない（今日の月分から始める）', /ym = todayYm\(\); \$\('p-ym'\)\.value = ym;/.test(boot) && !/lsSet\([^)]*ym/.test(J));
t('画面のタブは5つ（設定は初めは隠す）', (H.match(/role="tab" data-tab="/g) || []).length === 5 && /data-tab="settings" hidden>設定</.test(H));

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

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
