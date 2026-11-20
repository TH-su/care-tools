/* 勤怠管理（kintai.js）の v5 段1 の試験（2026-11-20 契約 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md「段1」1-2・1-3・1-5）
   実行: node check/unit/kintai_edits_label_test.js
   守りたいこと:
     1. 直しの履歴: DB の勤怠の移行（0098〜0112）が kintai_edits に書く action は全部 ACT_LABEL に言い方がある（内部の名前のまま出る action が0）。
        一覧はこの試験の中に書く（care-backend の移行を grep で拾った 2026-11-20 の22種。DB に action を足したら、ここと ACT_LABEL に足す）
     2. 有給・職員マスタ・管理者の名簿の直しは、前後の値が読める時は中身も言う（付与 10日を足した 等）。読めない時も内部の名前を出さない
     3. 理由の無い口が action の名前を理由に入れた行（番号の振り直し・メモの無い付与と使用）は、理由の列を空にする
     4. 締めの解除を給与の確定で断られた時（payrolllocked）の文（1-2・仮置き）
     5. 「設定」タブの「勤怠の管理者」の欄: 管理者の時だけ出す・印刷に出さない・2つの関数（list・put）・断りの語の文・関数が無い時の文・読み終わりで画面全体を描き直さない
     6. 個人の月の schedInMin は「所定内（法定内）」と出し、CSV の「所定内」（総労働−残業・kintai-calc.js は変えない）との違いを注記する（v5 1-1 の改め・文は仮置き）
   ★試験のメールは架空のもの（example.com）。職員の名前は出さない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const C = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const K = read('kintai.js');
/* care-backend の supabase/migrations/0098〜0112 の「insert into public.kintai_edits」の action（2026-11-20 に grep で拾った全部） */
const DB_ACTIONS = ['code_reset', 'punch_add', 'punch_void', 'day_put',                                   // 0098・0099・0101・0104
  'master_import', 'master_add', 'staff_link', 'clock_visible',                                             // 0106
  'leave_profile', 'leave_grant_add', 'leave_grant_void', 'leave_use_add', 'leave_use_void',                // 0106
  'display_name',                                                                                            // 0107
  'code_fixed',                                                                                              // 0108・0109
  'sched_set', 'sched_off', 'sched_clear', 'fixed_put', 'fixed_void',                                       // 0111
  'managers_add', 'managers_remove'];                                                                       // 0112

/* kintai.js から直しの履歴の言い方の部分と、それが使う補助を切り出して動かす（画面の DOM には触れない部分だけ） */
function line(re) { const m = re.exec(K); if (!m) throw new Error('見つからない: ' + re); return m[0]; }
const block = K.slice(K.indexOf('  var ACT_LABEL = {'), K.indexOf('  function editsHtml('));
const helpers = [
  line(/  function hm\(v\) \{[^\n]*\n/), line(/  function ms\(v\) \{[^\n]*\n/), line(/  function md\(date\) \{[^\n]*\n/),
  line(/  var WD = \[[^\n]*\n/), line(/  var WD_ORDER = \[[^\n]*\n/), line(/  function ymdSl\(d\) \{[^\n]*\n/),
  line(/  var KIND_JA = \{[^\n]*\n/),
  K.slice(K.indexOf('  function weekTxt(w) {'), K.indexOf('  function ymdSl(d)'))
].join('');
const api = new Function('C', helpers + block + '\nreturn { ACT_LABEL: ACT_LABEL, describe: describe };')(C);
const { ACT_LABEL, describe } = api;
const internal = (s) => /\b[a-z]+_[a-z_]+\b/.test(String(s).replace(/[\w.+-]+@[\w.-]+/g, ''));

console.log('\n— 1. 全部の action に言い方がある —');
const noLabel = DB_ACTIONS.filter((a) => !ACT_LABEL[a]);
t('DB が書く22種の action は全部 ACT_LABEL にある', noLabel.length === 0, noLabel);
const rawOut = DB_ACTIONS.filter((a) => { const d = describe({ action: a, before: null, after: null }); return d === a || internal(d); });
t('前後の値が無い行でも、内部の名前のまま出る action は0', rawOut.length === 0, rawOut.map((a) => [a, describe({ action: a })]));
t('ACT_LABEL の言い方に内部の名前（英字と _）が入っていない', Object.keys(ACT_LABEL).every((k) => !internal(ACT_LABEL[k])), ACT_LABEL);

console.log('\n— 2. 中身も言う —');
const d = (action, before, after, extra) => describe(Object.assign({ action, before, after, work_date: null }, extra || {}));
t('有給の付与を足した: 「有給の付与 10日を足した（付与日 2025/04/01・手で足した）」',
  d('leave_grant_add', null, { grant_date: '2025-04-01', days: 10, kind: 'manual' }) === '有給の付与 10日を足した（付与日 2025/04/01・手で足した）',
  d('leave_grant_add', null, { grant_date: '2025-04-01', days: 10, kind: 'manual' }));
t('移行の残りの付与（日数は文字の数でも読む）: 7.5日・移行の残り',
  d('leave_grant_add', null, { grant_date: '2024-10-01', days: '7.5', kind: 'opening' }) === '有給の付与 7.5日を足した（付与日 2024/10/01・移行の残り）');
t('有給の付与を取り消した: 前の値から日数と付与日',
  d('leave_grant_void', { grant_date: '2025-04-01', days: 10 }, { grant_date: '2025-04-01', days: 10, voided_at: 'x' }) === '有給の付与 10日（付与日 2025/04/01）を取り消した');
t('有休の使用: 1日・半日（足す・取り消す）',
  d('leave_use_add', null, { use_date: '2026-12-03', days: 1 }) === '有休の使用 1日を足した' && d('leave_use_add', null, { days: 0.5 }) === '有休の使用 半日を足した'
  && d('leave_use_void', { days: 0.5 }, { days: 0.5 }) === '有休の使用 半日を取り消した');
t('有給の設定: 変わった所だけを言う（週の所定日数と移行日）',
  d('leave_profile', { weekly_days: 3, opening_date: null }, { weekly_days: 4, opening_date: '2026-04-01' }) === '有給の設定: 週の所定日数を 4日にした・移行日を 2026/04/01 にした',
  d('leave_profile', { weekly_days: 3 }, { weekly_days: 4, opening_date: '2026-04-01' }));
t('有給の設定: 初めての設定（前が null）・付与しない日の件数',
  d('leave_profile', null, { hire_date: '2020-04-01', skip_grants: ['2021-10-01', '2022-10-01'] }) === '有給の設定: 入職日の上書きを 2020/04/01 にした・付与しない日を 2 件にした');
t('職員マスタと突き合わせた: 結んだ人数と止めた人数（数で入っている）',
  d('master_import', null, { linked: 3, deactivated: 1, linked_ids: ['a', 'b', 'c'], deactivated_ids: ['m_x'] }) === '職員マスタと突き合わせた（結んだ 3 人・止めた 1 人）');
t('職員マスタから足した: 足した人数と足せなかった人数',
  d('master_add', null, { added: ['m_1', 'm_2'], skipped: [{ master_id: 'x', error: 'retired' }] }) === '職員マスタから 2 人を足した（足せなかった 1 人）'
  && d('master_add', null, { added: ['m_1'], skipped: [] }) === '職員マスタから 1 人を足した');
t('結び付け: 結んだ・外した（休止にした）・結び直した',
  d('staff_link', { master_id: null, active: true }, { master_id: 'S1', active: true }) === '職員マスタの人と結んだ'
  && d('staff_link', { master_id: 'm1', active: true }, { master_id: null, active: false }) === '職員マスタとの結び付けを外した（休止にした）'
  && d('staff_link', { master_id: 'S1', active: true }, { master_id: 'S2', active: true }) === '職員マスタの別の人と結び直した');
t('打刻画面に出す・出さない',
  d('clock_visible', { clock_visible: true }, { clock_visible: false }) === '打刻画面に出さないようにした' && d('clock_visible', { clock_visible: false }, { clock_visible: true }) === '打刻画面に出すようにした');
t('勤怠の管理者に足した・外した（メールを括弧で）',
  d('managers_add', null, { email: 'kt-office@example.com' }) === '勤怠の管理者に足した（kt-office@example.com）'
  && d('managers_remove', { email: 'kt-office@example.com' }, null) === '勤怠の管理者から外した（kt-office@example.com）');
t('今までの言い方は変えない（打刻を足した・番号を振り直した・打刻の番号を職員No に合わせた・表示名を変えた）',
  d('punch_add', null, { kind: 'in', at: '2026-12-01T09:00:00+09:00' }, { work_date: '2026-12-01' }) === '出勤 09:00 を足した'
  && d('code_reset', { code: '1234' }, { code: '5678' }) === '番号を振り直した' && d('code_fixed', {}, {}) === '打刻の番号を職員No に合わせた'
  && d('display_name', { display_name: 'a' }, { display_name: 'b' }) === '表示名を変えた');
t('番号の振り直し・打刻の番号の合わせは番号そのものを出さない', describe({ action: 'code_reset', before: { code: '1234' }, after: { code: '5678' } }).indexOf('5678') < 0
  && describe({ action: 'code_fixed', before: { code: '01234' }, after: { code: '00001' } }).indexOf('00001') < 0);

console.log('\n— 3. 理由の列 —');
const eh = K.slice(K.indexOf('  function editsHtml('), K.indexOf('  var SET_FIELDS'));
t('理由が action の名前の行（番号の振り直し・メモの無い付与と使用）は理由の列を空にする', /esc\(e\.reason === e\.action \? '' : e\.reason\)/.test(eh));

console.log('\n— 4. 締めの解除の断り —');
t('payrolllocked の文（仮置き）',
  K.indexOf("payrolllocked: 'この月分の給与が確定（または書き出し済み）のため、締めを解除できません。先に給与の画面で確定を取り消してください。'") > 0);
t('締めの解除は NG の文で知らせる（msgOf）', /rpc\('kintai_month_unlock'[^\n]*alert\(msgOf\(e\)\)/.test(K));

console.log('\n— 5. 勤怠の管理者の欄 —');
const ps = K.slice(K.indexOf('  function paintSettings()'), K.indexOf('  /* ── v5 1-5: 勤怠の管理者の名簿'));
t('管理者（isAdmin）の時だけ欄を出し、読みに行く', /if \(isAdmin\(\)\) \{\s*if \(!mgrSt && !mgrBusy\) loadMgr\(\);/.test(ps));
t('欄は印刷に出さない（no-print）', /<div class="cd no-print"><h2[^>]*>勤怠の管理者<\/h2><div id="g-mgr">/.test(ps));
const mg = K.slice(K.indexOf('  /* ── v5 1-5: 勤怠の管理者の名簿'), K.indexOf('  /* ── 窓（直す・日付を選ぶ'));
t('2つの関数を呼ぶ（list と put）・送るのはメール・載せるか外すか・理由だけ・足す口と外す口を別に呼ばない',
  /rpc\('kintai_managers_list', \{\}\)/.test(mg) && /rpc\('kintai_managers_put', \{ p_email: email, p_on: !!add, p_reason: reason \}\)/.test(mg)
  && !/kintai_managers_(add|remove)/.test(K));
t('管理者でなければ読みにも行かない・書きもしない', /function loadMgr\(\) \{\s*if \(!isAdmin\(\)\) return/.test(mg) && /if \(!dlgCtx \|\| dlgCtx\.mode !== 'mgr' \|\| busy \|\| !isAdmin\(\)\) return;/.test(mg));
t('関数が無い（noDb）時は「データベースの更新がまだです」', /noDb\(e\) \? 'データベースの更新がまだです/.test(mg));
t('読み終わりで画面全体を描き直さず、自分の入れ物だけ差し替える・遅れた応答は世代で捨てる',
  !/paint\(\)/.test(mg) && /var el = \$\('g-mgr'\); if \(el && tab === 'settings'\) el\.innerHTML = mgrHtml\(\);/.test(mg) && (mg.match(/if \(my !== mgrGen\) return;/g) || []).length === 3);
t('給与の名簿の人には「外す」を出さず注記', /r\.in_payroll \? '<span class="help">給与の名簿に載っているため外せません/.test(mg));
t('画面に入れる値は esc を通す（メール・役割・足した人・日時）', /esc\(r\.email\)/.test(mg) && /esc\(MGR_ROLE\[r\.role\] \|\| r\.role \|\| ''\)/.test(mg) && /esc\(r\.added_by \|\| ''\)/.test(mg) && /data-email="' \+ esc\(r\.email\) \+ '"/.test(mg));
const ngm = /var NG_MGR = \{([\s\S]*?)\};/.exec(K);
t('名簿の断りの語6つ（notallowed・exists・notfound・payroll・badvalue・reason）に文がある', !!ngm && ['notallowed', 'exists', 'notfound', 'payroll', 'badvalue', 'reason'].every((k) => new RegExp('\\b' + k + ": '").test(ngm[1])), ngm && ngm[1]);
t('payroll の文は契約の仮置きどおり', K.indexOf("payroll: 'この人は給与の名簿に載っているため外せません（給与の画面が勤怠を読めなくなります）。'") > 0);
t('名簿の窓の断りは名簿の文（mgrMsg）で出す', /msg\.textContent = mgrMsg\(e\)/.test(mg));
t('名簿の窓も保存していない入力を確かめる', /DIRTY_MODES\.mgr = 1;/.test(K));
t('localStorage に書く所は今までどおり1か所（名簿は端末に残さない）', (K.match(/localStorage\.setItem/g) || []).length === 1);
t('押した時の振り分け（足す・外す・読み直す）', ["a === 'mgr-add-open'", "a === 'mgr-del-open'", "a === 'mgr-add-go'", "a === 'mgr-del-go'", "a === 'mgr-reload'"].every((x) => K.indexOf(x) > 0));

console.log('\n— 6. 所定内（法定内）の名前 —');
t('個人の月の schedInMin は「所定内（法定内）」と出す（「所定内 」のまま出す所は無い）', /'（所定内（法定内） ' \+ fm\(s\.schedInMin\)/.test(K) && !/所定内 ' \+ fm\(s\.schedInMin\)/.test(K.replace("所定内（法定内） ' + fm(s.schedInMin)", '')));
t('注記を1行出す（画面だけ）', /<p class="help no-print">所定内（法定内）は、予定のうち法定の1日8時間・週40時間の中で働いた時間です（法定外・休日労働は含みません）。CSV の「所定内」は予定どおり働いた時間（総労働−残業）で、法定外になった分も含みます。<\/p>/.test(K));
t('CSV の「所定内」は今までどおり 総労働−残業（kintai-calc.js の式）', /fmtMin\(Math\.max\(0, s\.workMin - s\.overtimeMin\), mode\)/.test(read('kintai-calc.js')));

console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
