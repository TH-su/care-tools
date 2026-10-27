/* 採用管理（ats-calc.js）の純関数の試験（2026-10-26 新設・代表者承認の凍結仕様 v1）
   実行: node check/unit/ats_calc_test.js（環境変数 ATS_CALC で別の版を当てられる）
   守りたいこと:
     1. 日付は職員マスタと同じ規則で読む（全角・和暦）。年の無い日付は基準日から補い、月が前なら翌年
     2. 「1/31見学のみ」を日付と文章に分ける。日付が2つ以上なら決めない
     3. 連絡先の欄を電話（↓ の前は旧番号）とメールに分ける
     4. 採用可否 → 段階。採用＋就業開始日は入職準備（入職完了にはしない）。空欄は受付から90日超で連絡途絶。知らない語は入れない
     5. 見出しの行を探す・取り込みの試算（入れられない理由・取り込み済み・同じ行の重複を外す）
     6. 職員マスタへ送る項目は STAFF_FIELDS のキーだけ。本人希望・条件・備考の文章は送らない。必須がそろうまで ready にしない
     7. 登録できたかの判定（6分）と応答の読み分け（ok で id がある時だけ「登録済み」）
     8. 集計（経路ごとの率・母数0は「—」・10件未満は少数・複数経路は各経路に数える）・保管期限・面接予定・評価の表示
     9〜11. 面接者ノートの全部の列を写す・受付日の補い・過去の行の段階と職員マスタの照合・経路の名寄せ・採用率と年ごとの表・ボードに出さない入職完了（2026-10-27）
   ★氏名・電話・メールはすべて架空（甲野 一郎・000-0000-0001・x@example.com）。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(process.env.ATS_CALC || path.join(ROOT, 'ats-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const J = JSON.stringify;
const FLUSH = '保存を確定できたか確かめられませんでした。画面を開き直して、保存されているか確かめてください';

console.log('\n— 1. 日付 —');
t('西暦・全角・和暦を読む', C.normDate('2026/10/26') === '2026-10-26' && C.normDate('２０２６年１０月２６日') === '2026-10-26' && C.normDate('令和8年1月5日') === '2026-01-05' && C.normDate('R8.1.5') === '2026-01-05');
t('年の無い日付・読めない値は null', C.normDate('1/31') === null && C.normDate('あした') === null && C.normDate('') === null && C.normDate(null) === null);
t('年なし（受付日より後の日付＝就業開始日など）: 月が基準日の月より前なら翌年', C.completeYear('1/31', '2026-10-26') === '2027-01-31', C.completeYear('1/31', '2026-10-26'));
t('年なし（受付日より後の日付）: 月が同じか後なら同じ年（全角・「月日」・曜日つきも）', C.completeYear('１１月３日', '2026-10-26') === '2026-11-03' && C.completeYear('10/30(金)', '2026-10-26') === '2026-10-30');
t('年なし（受付日を今日から補う）: 今日より後になるなら前の年', C.completeYear('11/3', '2026-10-26', 'past') === '2025-11-03' && C.completeYear('10/27', '2026-10-26', 'past') === '2025-10-27', C.completeYear('11/3', '2026-10-26', 'past'));
t('年なし（受付日を今日から補う）: 今日まではその年', C.completeYear('10/26', '2026-10-26', 'past') === '2026-10-26' && C.completeYear('1/31', '2026-10-26', 'past') === '2026-01-31');
t('年なし: ありえない日・基準日なしは null', C.completeYear('2/30', '2026-10-26') === null && C.completeYear('1/31', '') === null);
t('年のある日付は基準日に関係なくそのまま', C.completeYear('2025/1/31', '2026-10-26') === '2025-01-31');
t('保管期限は終わった日＋6か月（月末に寄せる）', C.retainUntil('2026-08-31', 6) === '2027-02-28' && C.retainUntil('2026-04-10', 6) === '2026-10-10');
t('保管期限: 日付でない・月数が無いは空', C.retainUntil('', 6) === '' && C.retainUntil('2026-04-10', 0) === '');

console.log('\n— 2. 日付と文章を分ける —');
let sd = C.splitDateNote('1/31見学のみ', '2026-12-01');
t('「1/31見学のみ」→ 日付と「見学のみ」', sd.date === '2027-01-31' && sd.note === '見学のみ' && !sd.issue, sd);
sd = C.splitDateNote('1/31（金）10時 見学のみ', '2027-01-10');
t('曜日を文章に残さない', sd.date === '2027-01-31' && sd.note === '10時 見学のみ', sd);
sd = C.splitDateNote('1/31と2/3', '2026-12-01');
t('日付が2つ以上 → 決めずに issue', sd.date === null && sd.issue === '日付が2つ以上あります' && sd.note === '1/31と2/3', sd);
sd = C.splitDateNote('未定', '2026-12-01');
t('日付が無い → 文章だけ', sd.date === null && sd.note === '未定' && !sd.issue, sd);
t('空 → 空', J(C.splitDateNote('', '2026-12-01')) === J({ date: null, note: '', issue: '' }));

console.log('\n— 3. 連絡先 —');
let ct = C.parseContacts('000ー0000ー0001\n↓\n000-0000-0002  x@example.com');
t('↓ の前は旧番号・全角ハイフンを半角に・メールを分ける', J(ct.phones) === J([{ num: '000-0000-0001', label: '旧' }, { num: '000-0000-0002', label: '' }]) && ct.email === 'x@example.com' && !ct.issues.length, ct);
ct = C.parseContacts('０００－００００－０００３　0000000004');
t('全角数字・全角空白区切り・ハイフンなし', J(ct.phones.map((p) => p.num)) === J(['000-0000-0003', '0000000004']), ct);
ct = C.parseContacts('12-34 xexample.com@');
t('形の違う電話・メールは知らせる（推測で直さない）', ct.phones.length === 0 && ct.email === '' && ct.issues.length === 2, ct);
t('空は空', J(C.parseContacts('')) === J({ phones: [], email: '', issues: [] }));

console.log('\n— 4. 段階の判定 —');
const D = (o) => C.deriveStage(o, '2026-10-26', 90);
t('採用＋就業開始日 → 入職準備（入職完了にしない）＋印', D({ result: '採用', startOn: '2026-11-01' }).stage === 'prep' && /入職済みの印/.test(D({ result: '採用', startOn: '2026-11-01' }).note));
t('採用だけ → 内定', D({ result: '採用' }).stage === 'offer');
t('「内定」「合格」は就業開始日があっても内定のまま・入職済みの印を付けない', ['内定', '合格', '採用決定'].every((r) => D({ result: r, startOn: '2026-11-01' }).stage === 'offer' && !D({ result: r, startOn: '2026-11-01' }).note));
t('不採用 → 不採用', D({ result: '不採用' }).stage === 'rejected');
t('本人断り・辞退・採用辞退 → 辞退', ['本人断り', '辞退', '採用辞退'].every((r) => D({ result: r }).stage === 'declined'));
t('空欄・受付から90日超 → 連絡途絶', D({ result: '', received: '2026-07-27' }).stage === 'lost', D({ result: '', received: '2026-07-27' }));
t('空欄・ちょうど90日 → 連絡途絶にしない', D({ result: '', received: '2026-07-28' }).stage === 'applied');
t('空欄・面接日あり → 面接', D({ result: '', received: '2026-10-01', interviewOn: '2026-10-20' }).stage === 'interview');
t('空欄・面接日なし → 応募受付', D({ result: '', received: '2026-10-01' }).stage === 'applied');
const unk = D({ result: '検討中' });
t('知らない語 → null＋issue', unk.stage === null && /検討中/.test(unk.issue), unk);
t('連絡途絶の日数は設定で変わる', C.deriveStage({ received: '2026-10-01' }, '2026-10-26', 20).stage === 'lost');

console.log('\n— 5. 見出しと取り込みの試算 —');
const CSV = [
  '採用者一覧,,,,',
  'No,受付日,経路,氏名,フリガナ,性別,連絡先,本人希望,面接日,採用可否,就業開始日,知らない列',
  '1,2026/10/01,ハローワーク・紹介,甲野 一郎,コウノ イチロウ,男,000-0000-0001 x@example.com,"夜勤なし,土日休み",10/20見学のみ,,,',
  '2,2026/07/01,求人サイト,乙川 花子,オツカワ ハナコ,女,000-0000-0002,,,,,',
  '3,2026/10/02,紹介,丙山 三郎,,男,,,,検討中,,',
  '4,,紹介,丁田 四郎,,男,,,,,,',
  '5,2026/10/01,ハローワーク,甲野　一郎,,男,,,,,,',
  '6,2026/09/01,紹介,戊川 五郎,,男,,,,採用,11/1,'
].join('\r\n');
const rows = C.parseCsv(CSV);
t('CSV: "" の中のカンマを読む', rows[2][7] === '夜勤なし,土日休み', rows[2]);
const hd = C.detectHeader(rows);
t('見出しは2行目（先頭の表題の行を飛ばす）・知らない見出しを返す', hd && hd.index === 1 && hd.map.name === 3 && hd.map.received === 1 && J(hd.unknown) === J(['知らない列']), hd);
t('見出しが無い → null', C.detectHeader([['a', 'b'], ['1', '2']]) === null);
const plan = C.planImport(CSV, '2026-10-26', C.DEFAULT_SETTINGS, ['乙川花子|2026-07-01']);
const it = plan.items;
t('1行目: 入れられる・面接日を備考に残し段階は面接・経路を分ける・見学だけの行は interview_on にしない', it[0].ok && it[0].row.stage === 'interview' && /\n面接日: 2026-10-20 見学のみ/.test(it[0].row.note_text) && J(it[0].row.sources) === J(['ハローワーク', '紹介']) && !('interview_on' in it[0].row), it[0]);
t('1行目: 連絡先とメール・本人希望の文章・取り込みの鍵', it[0].row.email === 'x@example.com' && it[0].row.phones[0].num === '000-0000-0001' && it[0].row.wish_text === '夜勤なし,土日休み' && it[0].row.import_key === '甲野一郎|2026-10-01' && it[0].row.gender === 'M', it[0].row);
t('2行目: 取り込み済み（have にある）→ 外す', !it[1].ok && it[1].issues.indexOf('取り込み済みです') >= 0, it[1]);
t('3行目: 知らない採用可否 → 外す', !it[2].ok && it[2].issues.some((x) => /検討中/.test(x)), it[2]);
t('4行目: 受付日も代わりの日付も無い → 受付日は空のまま入れ、鍵は「氏名|no:元のNo」・受付日の元の書き方を備考に残す（2026-10-27）', it[3].ok && it[3].row.received_on === null && it[3].row.import_key === '丁田四郎|no:4' && /受付日（元の書き方）: 空欄/.test(it[3].row.note_text), it[3]);
t('5行目: 全角空白違いの同じ氏名・受付日 → 重複で外す', !it[4].ok && it[4].issues.some((x) => /同じ氏名・受付日/.test(x)), it[4]);
t('6行目: 採用＋就業開始日（年なしは受付日から補う）→ 入職準備・入職予定日', it[5].ok && it[5].row.stage === 'prep' && it[5].row.start_on === '2026-11-01', it[5].row);
t('件数は入れられる行だけ・行番号は CSV の行', plan.count === 3 && it[0].line === 3, { count: plan.count, line: it[0].line });
t('見出しの無い CSV は理由つきで止める', C.planImport('a,b\n1,2', '2026-10-26').ok === false);
const lost = C.normApplicant({ name: 0, received: 1 }, ['己野 六子', '2026/06/01'], '2026-10-26', C.DEFAULT_SETTINGS).row;
t('連絡途絶で入る行は終わった日（取り込み元の日付＝ここでは受付日）・終わり方が付く（保管期限は送らない）', lost.stage === 'lost' && lost.closed_on === '2026-06-01' && lost.outcome_reason === '連絡途絶' && !('retain_until' in lost), lost);
const IMPORT_KEYS = ['legacy_no', 'received_on', 'sources', 'name', 'kana', 'gender', 'birth_date', 'jobs', 'quals_text', 'address', 'phones', 'email', 'wish_text', 'cond_text', 'note_text', 'reply_due', 'outcome_reason', 'outcome_note', 'start_on', 'prep', 'first_contact_at', 'stage', 'closed_on', 'import_key',
  'legacy_hired', 'legacy_result', 'staff_id', 'interview_on', 'interview_note'];
t('取り込みの行のキーはデータベース（ats_import）が受ける名前だけ', it.every((x) => Object.keys(x.row).every((k) => IMPORT_KEYS.indexOf(k) >= 0)), Object.keys(it[0].row));
const past = C.normApplicant({ name: 0, received: 1, startOn: 2 }, ['甲野 一郎', '12/1', '1/5'], '2026-10-26', C.DEFAULT_SETTINGS).row;
t('取り込み: 年の無い受付日は今日より後にしない（前の年）・就業開始日は受付日から先へ', past.received_on === '2025-12-01' && past.start_on === '2026-01-05', [past.received_on, past.start_on]);
const sj = C.decodeCsv(new Uint8Array([0x82, 0xa0]), (l) => new TextDecoder(l));
t('UTF-8 で読めない時は Shift_JIS で読む', sj.enc === 'Shift_JIS' && sj.text === 'あ', sj);
t('UTF-8 で読めればそのまま', C.decodeCsv(new TextEncoder().encode('氏名'), (l) => new TextDecoder(l)).enc === 'UTF-8');

console.log('\n— 6. 職員マスタへ送る項目 —');
const STAFF_KEYS = ['legacyNo', 'name', 'kana', 'birthDate', 'gender', 'phone', 'address', 'emergencyJson', 'employmentType', 'jobTitle', 'position', 'siteFacility', 'siteVisit', 'siteDay', 'siteCm', 'primarySite', 'workStyle', 'hireDate', 'retireDate', 'onLeave', 'careStartDate', 'qualsJson', 'siteRatiosJson', 'committeesJson', 'empInsNo', 'note'];
const EN = { employmentType: [{ code: 'regular', label: '正社員' }, { code: 'part', label: 'パート' }], qualCodes: [{ code: 'cw', label: '介護福祉士' }, { code: 'shonin', label: '初任者研修' }] };
const APP = { name: '甲野 一郎', kana: 'コウノ イチロウ', birth_date: '1990-04-01', gender: 'M', phones: [{ num: '000-0000-0009', label: '旧' }, { num: '000-0000-0001', label: '' }],
  address: '架空県架空市1-1', jobs: ['介護職'], wish_text: '夜勤なし', cond_text: '週4日', note_text: '架空の備考', start_on: '2026-11-01',
  prep: { employmentType: 'part', workStyle: 'part_ded', sites: { facility: true, day: true, visit: false }, primarySite: 'facility', quals: [{ code: 'cw', acquiredOn: '2020-03-01' }, { code: 'shonin' }],
    emergency: { name: '甲野 花子', relation: '妻', phone: '000-0000-0002' } } };
const bc = C.buildStaffCreate(APP, EN);
t('そろっていれば ready・足りない項目なし', bc.ready && !bc.missing.length && !bc.issues.length, bc);
t('送るキーは職員マスタが受け付けるものだけ', Object.keys(bc.fields).every((k) => STAFF_KEYS.indexOf(k) >= 0), Object.keys(bc.fields));
t('本人希望・条件・備考の文章は送らない', !/夜勤なし|週4日|架空の備考/.test(J(bc.fields)), bc.fields);
t('入職日は入職予定日・電話は旧番号でない主番号・所属は真偽', bc.fields.hireDate === '2026-11-01' && bc.fields.phone === '000-0000-0001' && bc.fields.siteFacility === true && bc.fields.siteDay === true && !('siteVisit' in bc.fields), bc.fields);
t('緊急連絡先は配列（name・relation・phone）・資格は code と取得日', J(bc.fields.emergencyJson) === J([{ name: '甲野 花子', relation: '妻', phone: '000-0000-0002' }]) && J(bc.fields.qualsJson) === J([{ code: 'cw', acquiredOn: '2020-03-01' }, { code: 'shonin' }]), bc.fields);
t('確認の表は「採用管理の項目・値・職員マスタの欄」', bc.rows.length > 5 && bc.rows.every((r) => r.label && r.target && r.value !== undefined) && bc.rows.some((r) => r.target === '雇用区分' && r.value === 'パート'), bc.rows);
const half = C.buildStaffCreate({ name: '甲野 一郎', prep: { workStyle: 'full_ded', sites: { facility: true }, primarySite: 'facility' } }, EN);
t('必須が足りない → ready でない・「あと2項目（雇用形態・入職日）」', !half.ready && C.missingText(half.missing) === 'あと2項目（雇用形態・入職日）', half.missing);
const bad = C.buildStaffCreate(Object.assign({}, APP, { birth_date: '2026-12-01', prep: Object.assign({}, APP.prep, { primarySite: 'visit', employmentType: 'zzz' }) }), EN);
t('生年月日が入職日以後・主所属が所属外・選択肢に無い雇用形態 → issues', ['hireDate', 'primarySite', 'employmentType'].every((k) => bad.issues.some((x) => x.key === k)) && !bad.ready, bad.issues);
t('指紋は同じ中身なら同じ・違えば違う（キーの順に関係なし）', C.sentKey({ a: 1, b: 2 }) === C.sentKey({ b: 2, a: 1 }) && C.sentKey({ a: 1 }) !== C.sentKey({ a: 2 }));

console.log('\n— 7. 登録できたかの判定 —');
const now = Date.parse('2026-10-26T01:00:00Z');
t('見つかった → hit', C.staffVerdict({ id: 'S0001' }, '2026-10-26T00:59:00Z', now) === 'hit');
t('送ってから8分未満 → wait（職員マスタの処理中の印 7分より長く待つ）', C.staffVerdict(null, '2026-10-26T00:55:00Z', now) === 'wait' && C.staffVerdict(null, '2026-10-26T00:53:00Z', now) === 'wait');
t('8分以上 → absent', C.staffVerdict(null, '2026-10-26T00:52:00Z', now) === 'absent');
t('送った時刻が読めない → absent・6分より先の未来 → absent', C.staffVerdict(null, '', now) === 'absent' && C.staffVerdict(null, '2026-10-26T01:09:00Z', now) === 'absent');
t('残りの分', C.staffWaitMinutes('2026-10-26T00:58:00Z', now) === 6);
const LIST = [{ id: 'S0001', name: '甲野　一郎', hireDate: '2026-11-01', birthDate: '1990-04-01' }, { id: 'S0002', name: '甲野 一郎', hireDate: '2025-04-01' }];
t('照合は氏名（空白を除く）＋入職日＋生年月日', C.staffMatches(LIST, { name: '甲野一郎', hireDate: '2026-11-01', birthDate: '1990-04-01' }).length === 1);
t('退職日のある職員は照合から外す', C.staffMatches([Object.assign({}, LIST[0], { retireDate: '2026-03-31' })], { name: '甲野一郎', hireDate: '2026-11-01', birthDate: '1990-04-01' }).length === 0);
t('氏名だけ一致する在籍の職員（退職した方は数えない）', J(C.sameNameActive(LIST.concat([{ id: 'S0009', name: '甲野 一郎', retireDate: '2020-01-01' }]), '甲野一郎').map((x) => x.id)) === J(['S0001', 'S0002']) && C.sameNameActive(LIST, '').length === 0);
t('生年月日が違えば別の方', C.staffMatches(LIST, { name: '甲野一郎', hireDate: '2026-11-01', birthDate: '1991-04-01' }).length === 0);
t('応答: ok で id → ok', J(C.staffResult({ ok: true, created: [{ tempId: 'a1', id: 'S0003', rev: 1 }] }, FLUSH)) === J({ kind: 'ok', id: 'S0003' }));
t('応答: ok なのに id が無い → unsure（登録しましたと言わない）', C.staffResult({ ok: true, created: [] }, FLUSH).kind === 'unsure');
t('応答: FLUSH・inProgress・partial（id ありでも）→ unsure', C.staffResult({ ok: false, error: FLUSH }, FLUSH).kind === 'unsure' && C.staffResult({ ok: false, inProgress: true, error: '処理中' }, FLUSH).kind === 'unsure'
  && C.staffResult({ ok: false, partial: true, created: [{ id: 'S0004' }] }, FLUSH).kind === 'unsure');
t('応答: ok:false で partial なし → ng', C.staffResult({ ok: false, error: '合言葉が違います' }, FLUSH).kind === 'ng');
t('応答: 空・形が違う → unsure', C.staffResult(null, FLUSH).kind === 'unsure' && C.staffResult('x', FLUSH).kind === 'unsure');

console.log('\n— 8. 段階・表示・集計・期限 —');
t('段階の名前は番号つき', C.stageLabel('interview') === '3. 面接' && C.stageLabel('lost') === '連絡途絶' && C.stageLabel('x') === '');
t('次の段階', C.nextStage('applied') === 'screening' && C.nextStage('prep') === 'hired' && C.nextStage('hired') === null && C.nextStage('rejected') === null);
t('入職完了へは登録済みの時だけ', !C.canMove('prep', 'hired', false).ok && C.canMove('prep', 'hired', false).reason === 'not_registered' && C.canMove('prep', 'hired', true).ok);
t('初動遅れ: 最初の連絡なしで24時間超 → 時間', C.firstContactLate({ stage: 'applied', created_at: '2026-10-24T23:00:00Z' }, now) === 26);
t('初動遅れ: 連絡済み・24時間未満・面接より先は出さない', C.firstContactLate({ stage: 'applied', created_at: '2026-10-24T23:00:00Z', first_contact_at: '2026-10-25T00:00:00Z' }, now) === 0
  && C.firstContactLate({ stage: 'applied', created_at: '2026-10-25T02:00:00Z' }, now) === 0 && C.firstContactLate({ stage: 'interview', created_at: '2026-10-01T00:00:00Z' }, now) === 0);
t('返答期限: 明日まで soon・過ぎた past・先は空', C.replyDueState('2026-10-27', '2026-10-26') === 'soon' && C.replyDueState('2026-10-25', '2026-10-26') === 'past' && C.replyDueState('2026-10-29', '2026-10-26') === '' && C.replyDueState('', '2026-10-26') === '');
t('評価の状態の文', C.evalStatusText(1, 2) === '2人中1人提出' && C.evalStatusText(0, 0) === '面接官が決まっていません');
t('他の評価は自分が提出した後だけ見られる', C.evalVisible({ status: 'submitted' }) && !C.evalVisible({ status: 'draft' }) && !C.evalVisible(null));
t('評価の確かめ: 提出は全部要る・下書きは欠けてよい', !C.evalCheck(['経験・技術', '通勤'], { '経験・技術': 3 }, 4, true).ok && C.evalCheck(['経験・技術', '通勤'], { '経験・技術': 3 }, null, false).ok
  && J(C.evalCheck(['経験・技術', '通勤'], { '経験・技術': 3 }, 9, true).missing) === J(['通勤', '総合の点']));
t('設定: 評価項目の既定6つ・保管6か月・連絡途絶90日', J(C.normSettings(null)) === J({ evalItems: ['経験・技術', '人柄・話し方', '勤務の希望が合うか', '通勤', '長く続けられそうか', '総合'], retainMonths: 6, lostDays: 90 }));
t('設定: 重なり・空・31字以上の項目は外す・範囲外の数は既定', J(C.normSettings({ eval_items: ['通勤', ' 通勤 ', '', 'あ'.repeat(31), '経験'], retain_months: 0, lost_days: 400 })) === J({ evalItems: ['通勤', '経験'], retainMonths: 6, lostDays: 90 }));
const ivs = [{ id: 1, held_at: '2026-10-26T05:00:00Z' }, { id: 2, held_at: '2026-10-26T01:00:00Z' }, { id: 3, held_at: '2026-10-27T01:00:00Z' }, { id: 4, held_at: '2026-11-02T01:00:00Z' }, { id: 5, held_at: '2026-11-03T01:00:00Z' }, { id: 6, held_at: '2026-10-25T01:00:00Z' }];
const bk = C.scheduleBuckets(ivs, now);
t('面接予定: 今日（時刻順）・明日・7日先まで（それより先と過去は出さない）', J(bk.today.map((x) => x.id)) === J([2, 1]) && J(bk.tomorrow.map((x) => x.id)) === J([3]) && J(bk.later.map((x) => x.id)) === J([4]), bk);
t('期間: 今月・今年度（4月始まり）・全期間', J(C.periodRange('month', '2026-10-26')) === J({ from: '2026-10-01', to: '2026-10-26' }) && C.periodRange('fy', '2026-02-10').from === '2025-04-01' && J(C.periodRange('all', '2026-10-26')) === J({ from: '', to: '' }));
const AP = [
  { stage: 'hired', sources: ['紹介'], received_on: '2026-10-01', interviews: 1 },
  { stage: 'declined', reached: 'offer', sources: ['紹介', 'ハローワーク'], received_on: '2026-10-02', interviews: 2 },
  { stage: 'applied', sources: ['紹介'], received_on: '2026-10-03', interviews: 0 },
  { stage: 'rejected', sources: ['ハローワーク'], received_on: '2026-09-03', interviews: 1 }
];
const fn = C.funnel(AP, '2026-10-01', '2026-10-31');
const shokai = fn.sources.find((s) => s.source === '紹介');
t('集計: 期間の応募だけ・段階ごとの人数', fn.total === 3 && fn.stages.hired === 1 && fn.stages.declined === 1 && fn.stages.applied === 1 && fn.stages.rejected === 0, fn);
t('集計: 複数経路はそれぞれに1件・注記用の件数', shokai.n === 3 && fn.sources.find((s) => s.source === 'ハローワーク').n === 1 && fn.multiSource === 1, fn.sources);
t('集計: 面接率・内定率（進んだ先で数える）・入職率・辞退率', shokai.interviewed === 2 && shokai.offered === 2 && shokai.hired === 1 && shokai.declined === 1, shokai);
t('集計: 10件未満は少数', shokai.few === true);
t('率の書き方: 「3/5（60%）」・母数0は「—」', C.rate(3, 5) === '3/5（60%）' && C.rate(0, 0) === '—');
const PG = [{ id: 'a', retain_until: '2026-10-25' }, { id: 'b', retain_until: '2026-10-26' }, { id: 'c', retain_until: '2026-01-01', staff_id: 'S0001' }, { id: 'd', retain_until: '' }];
t('保管期限: 今日より前・職員マスタに登録していない行だけ', J(C.purgeable(PG, '2026-10-26').map((x) => x.id)) === J(['a']));

console.log('\n— 9. 面接者ノートを全部写す（2026-10-27 本人指示） —');
const NOTE_HEAD = 'No,受付日,求人媒体,氏名,性別,年齢,職種,資格,住所,連絡先,面接日,本人希望,条件,返答期限目安,採用可否,可否連絡日,就業開始日,備考';
const nh = C.detectHeader(C.parseCsv(NOTE_HEAD + '\n1,2026/10/01,Indeed,甲野 一郎,男,40,介護職,初任者研修,架空県架空市1-1,000-0000-0001,10/20,夜勤なし,週4日,1週間,,,,'));
t('面接者ノートの18列を全部見出しとして読む（年齢・可否連絡日・返答期限目安・求人媒体を含む・知らない見出しなし）', nh && Object.keys(nh.map).length === 18 && nh.unknown.length === 0 && 'age' in nh.map && 'resultOn' in nh.map && nh.map.replyDue === 13 && nh.map.sources === 2, nh);
const LONG = 'あ'.repeat(5000);
const NOTE = [NOTE_HEAD,
  /* 1 過去の採用（職員マスタに1人だけ・入職日は就業開始日の20日後・退職済みでも見つける） */
  '1,2019/04/01,job Medley,甲野 一郎,男性,40代,介護職・看護職,介護福祉士,架空県架空市1-1,000-0000-0001,4/10,"' + LONG + '","日勤のみ\n週4日",1週間後,採用,4/15,5/1,"架空の備考\n2行目"',
  /* 2 過去の採用・職員マスタにいない */
  '2,2019/05/01,ハローワーク＆知人紹介,乙川 花子,女,,介護職,,,,,,,,採用,,6/1,',
  /* 3 過去・空欄で就業開始日あり → 入職完了 */
  '3,2019/06/01,Ａ様,丙山 三郎,男,,,,,,,,,,,,7/1,',
  /* 4 過去・採用辞退／5 本人断り／6 不採用／7 空欄 → 連絡途絶 */
  '4,2019/07/01,ジョブメドレー,丁田 四郎,男,,,,,,7/5,,,,採用辞退,7/10,,',
  '5,2019/07/02,Indeed,戊川 五郎,男,,,,,,,,,,本人断り,,,',
  '6,2019/07/03,タウン情報,己野 六子,女,,,,,,,,,,不採用,,,',
  '7,2019/07/04,HP,庚田 七郎,男,,,,,,,,,,,,,',
  /* 8 受付日が空 → 面接日から補う（年のある面接日）／9 受付日が読めない → 可否連絡日から／10 → 就業開始日から */
  '8,,求人ボックス,辛山 八郎,男,,,,,,2020/3/3 面接,,,,不採用,,,',
  '9,不明,マイベストジョブ,壬川 九子,女,,,,,,,,,,辞退,2020/4/4,,',
  '10,,タイミー,癸田 十郎,男,,,,,,,,,,,,2020/5/5,',
  /* 11 見学だけの行・性別と連絡先を読めない（止めずに備考へ） */
  '11,2020/01/10,紹介,甲山 十一,不明,,,,,12-34,1/31見学のみ,,,,不採用,,,',
  /* 12 新しい行（今の決め方のまま）: 採用＋就業開始日 → 入職準備 */
  '12,2026/10/01,Indeed,乙野 十二,男,,,,,,10/10,,,,採用,,11/1,'
].join('\n');
const STAFF = [
  { id: 'S0101', name: '甲野　一郎', hireDate: '2019-05-21', retireDate: '2021-03-31' },
  { id: 'S0102', name: '丙山三郎', hireDate: '2019-07-01' },
  { id: 'S0103', name: '甲野 一郎', hireDate: '2023-04-01' }
];
const np = C.planImport(NOTE, '2026-10-26', C.DEFAULT_SETTINGS, [], STAFF);
const ni = np.items, nr = (i) => ni[i].row;
t('12行とも入れられる（受付日の空・読めない値・性別や連絡先の崩れで落とさない）', np.ok && np.count === 12 && ni.every((x) => x.ok), ni.filter((x) => !x.ok).map((x) => [x.line, x.issues]));
t('全部の列: 項目に入るもの（No・受付日・氏名・性別・職種・資格・住所・連絡先・本人希望・条件・就業開始日）',
  nr(0).legacy_no === '1' && nr(0).received_on === '2019-04-01' && nr(0).gender === 'M' && J(nr(0).jobs) === J(['介護職', '看護職']) && nr(0).quals_text === '介護福祉士' && nr(0).address === '架空県架空市1-1' && nr(0).phones[0].num === '000-0000-0001' && nr(0).start_on === '2019-05-01', nr(0));
const n0 = nr(0).note_text;
t('全部の列: 備考に見出しつきで残るもの（求人媒体・年齢・面接日・返答期限目安・採用可否・可否連絡日）と備考の全文',
  ['求人媒体（元の書き方）: job Medley', '年齢: 40代', '面接日: 2019-04-10', '返答期限目安（元の書き方）: 1週間後', '採用可否（元の書き方）: 採用', '可否連絡日: 4/15'].every((x) => n0.indexOf(x) >= 0) && /架空の備考\n2行目$/.test(n0), n0);
t('本人希望・条件は切らずに全文（5000字・改行も）', nr(0).wish_text === LONG && nr(0).cond_text === '日勤のみ\n週4日');
t('過去の採用 → 入職完了・取り込み元で入職済み・元の語', nr(0).stage === 'hired' && nr(0).legacy_hired === true && nr(0).legacy_result === '採用', nr(0));
t('職員マスタ（退職した方も含む）で氏名が同じ・入職日が前後30日以内の1人 → 職員IDを付ける（入職日が離れた同名の方は数えない）', nr(0).staff_id === 'S0101' && ni[0].staff.state === 'found');
t('過去の採用で職員マスタにいない → 職員IDなし・入職済みの印だけ', nr(1).stage === 'hired' && nr(1).legacy_hired === true && !('staff_id' in nr(1)), nr(1));
t('過去・採用可否が空で就業開始日あり → 入職完了（元の語は無いので送らない）・職員IDを付ける', nr(2).stage === 'hired' && nr(2).legacy_hired === true && !('legacy_result' in nr(2)) && nr(2).staff_id === 'S0102', nr(2));
t('過去・採用辞退／本人断り → 辞退、不採用 → 不採用、空欄 → 連絡途絶', nr(3).stage === 'declined' && nr(4).stage === 'declined' && nr(5).stage === 'rejected' && nr(6).stage === 'lost' && nr(6).outcome_reason === '連絡途絶');
t('入職済みの印は入職完了の行だけ（ほかの行も false を毎行送る＝0030 は項目の無い送信を古い画面として断る）', [3, 4, 5, 6].every((i) => nr(i).legacy_hired === false) && ni.every((x) => typeof x.row.legacy_hired === 'boolean'));
t('終わった日は取り込み元の日付（可否連絡日 → 面接日 → 受付日）・入職完了の行には送らない（0030 は終わりの3つだけ使う）', nr(3).closed_on === '2019-07-10' && nr(7).closed_on === '2020-03-03' && nr(4).closed_on === '2019-07-02' && nr(0).closed_on === null && nr(1).closed_on === null, [nr(0).closed_on, nr(3).closed_on, nr(4).closed_on, nr(7).closed_on]);
t('0030 の形: interview_note は interview_on がある行だけ・staff_id は40字まで・入職済みの行の段階は hired', ni.every((x) => !('interview_note' in x.row) || x.row.interview_on) && ni.every((x) => !x.row.staff_id || x.row.staff_id.length <= 40) && ni.every((x) => !(x.row.legacy_hired || x.row.staff_id) || x.row.stage === 'hired'));
t('面接日のある行は interview_on（文章は interview_note）', nr(0).interview_on === '2019-04-10' && nr(3).interview_on === '2019-07-05' && nr(7).interview_on === '2020-03-03' && nr(7).interview_note === '面接');
t('受付日が空 → 面接日の日付・読めない → 可否連絡日・どちらも無い → 就業開始日。元の書き方を残す',
  nr(7).received_on === '2020-03-03' && /受付日（元の書き方）: 空欄（面接日の日付を受付日にしました）/.test(nr(7).note_text)
  && nr(8).received_on === '2020-04-04' && /受付日（元の書き方）: 不明（可否連絡日の日付を受付日にしました）/.test(nr(8).note_text)
  && nr(9).received_on === '2020-05-05' && nr(9).stage === 'hired' && nr(9).import_key === '癸田十郎|2020-05-05', [nr(7).received_on, nr(8).received_on, nr(9).received_on]);
t('見学だけの行は interview_on にしない（備考に残す）', !('interview_on' in nr(10)) && /面接日: 2021-01-31 見学のみ|面接日: 2020-01-31 見学のみ/.test(nr(10).note_text), nr(10).note_text);
t('性別・連絡先を読めない → 止めずに元の書き方を備考へ', nr(10).gender === '' && /性別（元の書き方）: 不明/.test(nr(10).note_text) && /連絡先（元の書き方）: 12-34/.test(nr(10).note_text) && J(ni[10].warns) === J(['性別', '連絡先']), ni[10].warns);
t('新しい行は今の決め方のまま（採用＋就業開始日 → 入職準備・入職済みの印なし）', nr(11).stage === 'prep' && nr(11).legacy_hired === false && nr(11).closed_on === null);
const S9 = np.summary;
t('試算のまとめ: 段階ごと・職員マスタで見つかった／見つからなかった採用・面接日・経路ごと',
  J(S9.stages) === J({ hired: 4, declined: 3, rejected: 3, lost: 1, prep: 1 }) && S9.staffFound === 2 && S9.staffMissing === 2 && S9.interviewOn === 4 && S9.staffList === true
  && S9.sources['紹介'] === 3 && S9.sources['その他'] === 1 && S9.sources['ジョブメドレー'] === 2, S9);
t('試算のまとめ: その他にした元の書き方（件数つき）', J(S9.others) === J([{ text: 'タウン情報', n: 1 }]), S9.others);
const np0 = C.planImport(NOTE, '2026-10-26', C.DEFAULT_SETTINGS, [], null);
t('職員マスタを読めない → 職員IDを付けない（入職済みの印だけ）', np0.count === 12 && np0.items.every((x) => !('staff_id' in x.row)) && np0.items[0].row.legacy_hired === true && np0.summary.staffList === false && np0.summary.staffFound === 0 && np0.summary.staffMissing === 4);
t('職員マスタ: 31日離れていれば見つからない・2人いれば付けない・就業開始日が無ければ付けない',
  C.legacyStaffMatch([{ id: 'A', name: '甲野一郎', hireDate: '2019-06-01' }], '甲野 一郎', '2019-05-01').state === 'none'
  && C.legacyStaffMatch([{ id: 'A', name: '甲野一郎', hireDate: '2019-05-01' }, { id: 'B', name: '甲野 一郎', hireDate: '2019-05-02' }], '甲野 一郎', '2019-05-01').state === 'none'
  && C.legacyStaffMatch([{ id: 'A', name: '甲野一郎', hireDate: '2019-05-01' }], '甲野 一郎', null).state === 'none'
  && C.legacyStaffMatch([{ id: 'A', name: '甲野一郎', hireDate: '2019-05-31' }], '甲野 一郎', '2019-05-01').id === 'A');
const big = C.planImport('氏名,受付日,備考\n甲野 一郎,2019/01/01,' + 'い'.repeat(20001), '2026-10-26', C.DEFAULT_SETTINGS, []);
t('備考などが2万字を超えたら入れない（理由つき）・理由ごとの件数', !big.items[0].ok && big.items[0].issues.indexOf('備考が2万字を超えています') >= 0 && big.summary.reasons['備考が2万字を超えています'] === 1, big.items[0].issues);
const unk9 = C.planImport('氏名,受付日,採用可否\n甲野 一郎,2019/01/01,未定\n乙川 花子,2019/01/02,検討中', '2026-10-26', C.DEFAULT_SETTINGS, []);
t('入れられない理由は種類ごとに数える（採用可否の語はまとめる）', unk9.summary.reasons['採用可否を読めません'] === 2, unk9.summary.reasons);
const nk = C.normApplicant({ name: 0, note: 1 }, ['甲野 一郎', '架空の本文'], '2026-10-26', C.DEFAULT_SETTINGS);
t('受付日も No も無い行 → 入れる（鍵は「氏名|h:行の指紋」・受付日は空・過去の行）', !nk.issues.length && /^甲野一郎\|h:[0-9a-f]{12}$/.test(nk.row.import_key) && nk.row.received_on === null && nk.past === true && nk.row.stage === 'lost', nk.row.import_key);

console.log('\n— 10. 経路の名寄せ —');
const CS = (x) => C.canonSource(x);
t('Indeed の揺れ', ['Indeed', 'indeed', 'INDEED', 'ｉｎｄｅｅｄ', 'インディード'].every((x) => CS(x) === 'Indeed'));
t('ジョブメドレーの揺れ（job Medley・jobmedley・Job-Medley・ｼﾞｮﾌﾞﾒﾄﾞﾚｰ）', ['ジョブメドレー', 'job Medley', 'jobmedley', 'Job-Medley', 'ｼﾞｮﾌﾞﾒﾄﾞﾚｰ', 'JOB MEDLEY'].every((x) => CS(x) === 'ジョブメドレー'));
t('ハローワーク・求人ボックス・タイミー・ホームページ・求人誌・マイベストジョブ', CS('ﾊﾛｰﾜｰｸ') === 'ハローワーク' && CS('ハロワ') === 'ハローワーク' && CS('求人BOX') === '求人ボックス' && CS('Timee') === 'タイミー'
  && CS('HP') === 'ホームページ' && CS('自社ＨＰ') === 'ホームページ' && CS('求人誌') === '求人誌' && CS('マイベストジョブ') === 'マイベストジョブ' && CS('My Best Job') === 'マイベストジョブ');
t('「〜紹介」「〜様」は紹介（媒体の名前が先：ハローワーク紹介はハローワーク）', CS('知人紹介') === '紹介' && CS('職員の紹介') === '紹介' && CS('Ａ様') === '紹介' && CS('ハローワーク紹介') === 'ハローワーク');
t('表に無い語はその他', CS('タウン情報') === 'その他' && CS('その他') === 'その他' && CS('') === '');
const cs = C.canonSources('Indeed＆知人紹介、ハローワーク・indeed\nタウン情報/その他');
t('「＆」「、」「・」改行「/」で分け、重なりは1つ・元の書き方は「その他」にした語だけ（「その他」そのものは出さない）', J(cs.list) === J(['Indeed', '紹介', 'ハローワーク', 'その他']) && J(cs.others) === J(['タウン情報']), cs);
t('決まった名前の一覧（名寄せの結果は必ずこの中）', J(C.SOURCE_NAMES.slice(0, 9)) === J(['Indeed', 'ジョブメドレー', 'ハローワーク', '求人ボックス', 'タイミー', 'ホームページ', '紹介', '求人誌', 'マイベストジョブ']) && C.SOURCE_NAMES.indexOf('直接応募') >= 0 && C.SOURCE_NAMES.indexOf('派遣・紹介会社') >= 0 && C.SOURCE_NAMES[C.SOURCE_NAMES.length - 1] === 'その他');

console.log('\n— 11. 集計（採用率・年ごと）・選考ボード・保管期限 —');
const AP2 = [
  { stage: 'hired', legacy_hired: true, sources: ['紹介'], received_on: '2019-04-01', interviews: 1 },
  { stage: 'hired', legacy_hired: true, sources: ['紹介'], received_on: '2019-05-01', interviews: 0 },
  { stage: 'declined', sources: ['紹介'], received_on: '2019-07-01', interview_on: '2019-07-05', interviews: 0 },
  { stage: 'rejected', sources: ['Indeed'], received_on: '2020-03-03', interviews: 1 },
  { stage: 'lost', sources: ['Indeed'], received_on: null, interviews: 0 },
  { stage: 'offer', sources: ['Indeed'], received_on: '2020-01-01', interviews: 1 }
];
const f2 = C.funnel(AP2, '', '');
const sk = f2.sources.find((s) => s.source === '紹介'), ix = f2.sources.find((s) => s.source === 'Indeed');
t('採用率: 内定以上＋取り込み元で入職済み・入職率は入職完了（取り込みを含む）・面接率は面接の行か取り込みの面接日', sk.n === 3 && sk.accepted === 2 && sk.hired === 2 && sk.interviewed === 2 && sk.declined === 1 && ix.accepted === 1 && ix.interviewed === 2, [sk, ix]);
t('採用率: 内定以上の段階に戻した記録がない取り込みの入職済みも数える', C.countsOf({ stage: 'hired', legacy_hired: true }).accepted && !C.countsOf({ stage: 'rejected' }).accepted && C.countsOf({ stage: 'prep' }).accepted);
t('全期間は受付日の無い方も数える', f2.total === 6);
const yt = C.yearTable(AP2);
t('年ごとの表: 年は古い順・受付日なしは最後・応募・面接・採用・入職・辞退', J(yt.map((r) => r.year)) === J(['2019', '2020', '（受付日なし）']) && J(yt[0]) === J({ year: '2019', n: 3, interviewed: 2, accepted: 2, hired: 2, declined: 1 }) && J(yt[1]) === J({ year: '2020', n: 2, interviewed: 2, accepted: 1, hired: 0, declined: 0 }) && yt[2].n === 1, yt);
t('期間の既定: 今月に1件も無ければ全期間・あれば今月', C.defaultPeriod(AP2, '2026-10-26') === 'all' && C.defaultPeriod(AP2.concat([{ received_on: '2026-10-02' }]), '2026-10-26') === 'month' && C.defaultPeriod([], '2026-10-26') === 'all');
t('期間「年ごと」は全期間を数える', J(C.periodRange('year', '2026-10-26')) === J({ from: '', to: '' }));
t('選考ボード: 取り込み元で入職済み・入職日が60日より前の入職完了は出さない（60日ちょうどは出す・入職準備は出す）',
  C.boardHidden({ stage: 'hired', legacy_hired: true }, '2026-10-26') && C.boardHidden({ stage: 'hired', start_on: '2026-08-26' }, '2026-10-26') && !C.boardHidden({ stage: 'hired', start_on: '2026-08-27' }, '2026-10-26')
  && !C.boardHidden({ stage: 'prep', start_on: '2020-01-01' }, '2026-10-26') && !C.boardHidden({ stage: 'hired' }, '2026-10-26'));
t('保管期限: 取り込んだ記録（retain_until が空）は消せる一覧に出ない（代表者の決定 2026-10-27）', C.purgeable([{ id: 'x', stage: 'lost', closed_on: '2019-07-04', retain_until: null }, { id: 'y', stage: 'hired', legacy_hired: true, retain_until: null }], '2026-10-26').length === 0);

console.log('\n— 12. 反証レビューの直し（2026-10-27） —');
const RV = (csv) => C.planImport(csv, '2026-10-27', C.DEFAULT_SETTINGS, [], []);
let rv = RV('No,受付日,氏名,面接日,採用可否\n7,,甲野 一郎,3/5,採用');
let r0 = rv.items[0].row;
t('受付日が空・年の無い面接日「3/5」・採用 → 受付日は今日より後にならない（2026-03-05）', r0.received_on === '2026-03-05' && r0.received_on <= '2026-10-27', r0.received_on);
t('同じ行: 過去の行として入職完了（取り込み元で入職済み）', r0.stage === 'hired' && r0.legacy_hired === true, r0.stage);
t('同じ行: 鍵は「氏名|no:元のNo」（取り込む日で鍵が変わらない）', r0.import_key === '甲野一郎|no:7', r0.import_key);
t('同じ行: 面接の日も今日より後にならない', r0.interview_on === '2026-03-05');
rv = RV('No,受付日,氏名,面接日,採用可否\n8,,乙川 花子,11/20 見学のみ,');
r0 = rv.items[0].row;
t('受付日が空・「11/20 見学のみ」→ 前の年（2025-11-20）・面接にしない・連絡途絶', r0.received_on === '2025-11-20' && !('interview_on' in r0) && r0.stage === 'lost' && r0.import_key === '乙川花子|no:8', r0);
rv = RV('No,受付日,氏名,可否連絡日,採用可否,就業開始日\n9,,丙山 三郎,12/1,採用,12/10');
r0 = rv.items[0].row;
t('可否連絡日から補う時も前の年・就業開始日は受付日から先へ', r0.received_on === '2025-12-01' && r0.start_on === '2025-12-10' && r0.stage === 'hired' && r0.import_key === '丙山三郎|no:9', r0);
rv = RV('No,受付日,氏名,面接日,採用可否\n10,,丁田 四郎,2026/3/5,採用');
t('年のある日付から補った受付日の鍵は今までどおり「氏名|受付日」', rv.items[0].row.import_key === '丁田四郎|2026-03-05');
rv = RV('No,受付日,氏名,フリガナ\n1,2019/01/01,甲野 一郎,' + 'ア'.repeat(81) + '\n2,2019/01/02,乙川 花子,' + 'ア'.repeat(80));
t('カナが80字を超える → 試算で「カナが長すぎます」として外す（80字は入れる）', !rv.items[0].ok && rv.items[0].issues.indexOf('カナが長すぎます') >= 0 && rv.items[1].ok);
rv = RV('No,受付日,氏名,住所,資格,メール,採用可否\n1,2019/01/01,甲野 一郎,' + 'い'.repeat(201) + ',' + 'う'.repeat(1001) + ',' + 'a'.repeat(200) + '@x.jp,' + '採用'.repeat(50));
r0 = rv.items[0].row;
t('住所200・資格1000・メール200を超えたら備考へ全文（行は外さない）・採用可否の元の語は80字に切って全文を備考へ', rv.items[0].ok && r0.address === null && r0.quals_text === null && r0.email === null && r0.legacy_result.length === 80 && /住所（元の書き方）: い{201}/.test(r0.note_text) && /採用可否（元の書き方）: (採用){50}/.test(r0.note_text), rv.items[0].issues);
const LIM = { name: 80, kana: 80, legacy_no: 40, quals_text: 1000, address: 200, email: 200, wish_text: 20000, cond_text: 20000, note_text: 20000, legacy_result: 80, staff_id: 40, interview_note: 200, import_key: 200 };
const LONGCSV = 'No,受付日,氏名,フリガナ,資格,住所,連絡先,面接日,本人希望,条件,採用可否,就業開始日,備考\n' +
  'n'.repeat(41) + ',2019/01/01,' + '甲'.repeat(80) + ',' + 'ア'.repeat(80) + ',' + 'う'.repeat(1001) + ',' + 'い'.repeat(201) + ',' + 'b'.repeat(201) + '@x.jp,2019/1/5 ' + 'め'.repeat(300) + ',' + 'き'.repeat(20000) + ',' + 'じ'.repeat(20000) + ',採用,2019/2/1,' + 'び'.repeat(1000);
rv = C.planImport(LONGCSV, '2026-10-27', C.DEFAULT_SETTINGS, [], [{ id: 'S'.repeat(60), name: '甲'.repeat(80), hireDate: '2019-02-01' }]);
r0 = rv.items[0].row;
t('上限ぎりぎりの長い行: 入れられる行は表の上限（0026・0030）を1つも超えない', rv.items[0].ok && Object.keys(LIM).every((k) => r0[k] == null || String(r0[k]).length <= LIM[k]), Object.keys(LIM).filter((k) => r0[k] != null && String(r0[k]).length > LIM[k]));
const dupPlan = C.planImport('No,受付日,氏名,採用可否,就業開始日\n1,2019/01/01,甲野 一郎,採用,2019/02/01\n2,2019/03/01,甲野　一郎,採用,2019/02/20\n3,2019/04/01,乙川 花子,採用,2019/05/01', '2026-10-27', C.DEFAULT_SETTINGS, [],
  [{ id: 'S0101', name: '甲野一郎', hireDate: '2019-02-10' }, { id: 'S0102', name: '乙川花子', hireDate: '2019-05-01' }]);
t('同じ職員IDが取り込みの中で2行に当たる → どちらにも付けない（入職済みの印だけ）・ほかの行は付ける', !('staff_id' in dupPlan.items[0].row) && !('staff_id' in dupPlan.items[1].row) && dupPlan.items[0].row.legacy_hired === true && dupPlan.items[2].row.staff_id === 'S0102' && dupPlan.items[0].staff.state === 'dup', dupPlan.items.map((x) => x.row.staff_id));
t('「職員マスタで見つかった」の数も合わせる（見つかった1・見つからなかった2）', dupPlan.summary.staffFound === 1 && dupPlan.summary.staffMissing === 2, dupPlan.summary);

console.log('\n— 13. 本物の面接者ノートの試算から（2026-10-27） —');
const KEYCSV = '氏名,受付日,面接日,可否連絡日,就業開始日,No,本人希望,備考\n甲野 一郎,,,,,,架空の希望,架空の本文\n甲野 一郎,,,,,,架空の希望,架空の本文\n甲野 一郎,,,,,,架空の希望,別の本文\n乙川 花子,,,,,,,';
const kp = C.planImport(KEYCSV, '2026-10-27', C.DEFAULT_SETTINGS, [], []);
const k0 = kp.items[0].row.import_key;
t('日付も No も無い行: 鍵は「正規化氏名|h:16進12桁」・受付日は空・過去の行として連絡途絶', /^甲野一郎\|h:[0-9a-f]{12}$/.test(k0) && kp.items[0].ok && kp.items[0].row.received_on === null && kp.items[0].row.stage === 'lost', kp.items[0]);
t('同じ中身の行は同じ鍵（2行目は「同じ内容の行が上にあります」で外す）・中身が違えば別の鍵・氏名だけの行も入る', !kp.items[1].ok && kp.items[1].issues.join() === '同じ内容の行が上にあります' && kp.items[1].row.import_key === k0 && kp.items[2].ok && kp.items[2].row.import_key !== k0 && kp.items[3].ok, kp.items.map((x) => [x.row.import_key, x.issues]));
t('行の指紋は決まった計算（取り込む日・回数で変わらない）・セルの前後の空白と全角半角に左右されない', C.planImport(KEYCSV, '2027-05-01', C.DEFAULT_SETTINGS, [], []).items[0].row.import_key === k0 && C.rowHash(['ａ ', 'b']) === C.rowHash(['a', 'b']) && C.rowHash(['a', 'b']) !== C.rowHash(['ab', '']) && /^[0-9a-f]{12}$/.test(C.rowHash([])));
const nk2 = C.normApplicant({ name: 0, interview: 1 }, ['丙山 三郎', '3/5'], '2026-10-27', C.DEFAULT_SETTINGS).row;
t('年の無い日付から受付日を補い No も無い行も、鍵は行の指紋（取り込む日で変わらない）', /^丙山三郎\|h:[0-9a-f]{12}$/.test(nk2.import_key) && nk2.import_key === C.normApplicant({ name: 0, interview: 1 }, ['丙山 三郎', '3/5'], '2027-04-01', C.DEFAULT_SETTINGS).row.import_key, nk2.import_key);
const CR = C.classifyResult;
t('採用可否の揺れ → 辞退（本人断り(理由…)・辞退の連絡あり・辞退の入電あり・採用するも辞退・採用→本人より一旦保留・離脱）',
  ['本人断り(他で決まった)', '本人断り（架空の理由）', '辞退の連絡あり', '辞退の入電あり', '採用するも辞退', '採用→本人より一旦保留', '離脱'].every((x) => CR(x) === 'declined'));
t('採用可否の揺れ → 不採用（不採用(郵送)・否）・採用（可）・保留', CR('不採用(郵送)') === 'rejected' && CR('不採用（郵送）') === 'rejected' && CR('否') === 'rejected' && CR('可') === 'hired' && CR('採用') === 'hired' && CR('保留') === 'hold' && CR('検討中') === '' && CR('') === '');
const DP = (r) => C.deriveStage({ result: r }, '2026-10-27', 90, true), DN = (r, o) => C.deriveStage(Object.assign({ result: r, received: '2026-10-20' }, o || {}), '2026-10-27', 90, false);
t('過去の行: 可 → 入職完了（取り込み元で入職済み）・保留 → 連絡途絶・辞退の揺れ → 辞退・不採用(郵送) → 不採用', DP('可').stage === 'hired' && DP('可').legacy === true && DP('保留').stage === 'lost' && DP('辞退の入電あり').stage === 'declined' && DP('不採用(郵送)').stage === 'rejected' && DP('採用→本人より一旦保留').stage === 'declined');
t('新しい行: 保留 → 面接・可＋就業開始日 → 入職準備・可だけ → 内定・採用するも辞退 → 辞退', DN('保留').stage === 'interview' && DN('可', { startOn: '2026-11-01' }).stage === 'prep' && DN('可').stage === 'offer' && DN('採用するも辞退').stage === 'declined');
const lr = C.planImport('氏名,受付日,採用可否\n甲野 一郎,2019/01/01,本人断り(架空の理由)\n乙川 花子,2019/01/02,否', '2026-10-27', C.DEFAULT_SETTINGS, [], []);
t('元の語は legacy_result と備考に残す（入職完了でない行も）', lr.items[0].row.legacy_result === '本人断り(架空の理由)' && /採用可否（元の書き方）: 本人断り\(架空の理由\)/.test(lr.items[0].row.note_text) && lr.items[0].row.stage === 'declined' && lr.items[1].row.legacy_result === '否' && lr.items[1].row.stage === 'rejected');
t('経路の打ち間違い（indeel・ジョブメソレー）', CS('indeel') === 'Indeed' && CS('Indeel') === 'Indeed' && CS('ジョブメソレー') === 'ジョブメドレー');
t('経由なし・(経由なし)・直接・直電・→直接雇用 → 直接応募', ['経由なし', '(経由なし)', '（経由なし）', '直接', '直電', '→直接雇用'].every((x) => CS(x) === '直接応募'), ['経由なし', '(経由なし)', '直接', '直電', '→直接雇用'].map(CS));
t('知人・元職員・ケアマネ・様・さん・教会を含む語、漢字1〜4字だけの語（名字）→ 紹介', ['知人', '元職員の紹介', 'ケアマネ', 'Ａ様', 'Ａさん', '架空教会', '甲', '甲野', '甲乙丙丁'].every((x) => CS(x) === '紹介') && CS('甲乙丙丁戊') === 'その他', ['知人', 'ケアマネ', 'Ａさん', '甲', '甲乙丙丁戊'].map(CS));
t('派遣・担当を含む語・人材会社 → 派遣・紹介会社', ['派遣', '派遣会社', '架空担当', 'セントメディア', '日研メディカルケア', 'ミラクス', '人材紹介会社'].every((x) => CS(x) === '派遣・紹介会社'), ['派遣', '架空担当', 'ミラクス', '人材紹介会社'].map(CS));
t('媒体の名前はその名前のまま（括弧の注記を外す）', CS('求人案内') === '求人案内' && CS('求人案件') === '求人案内' && CS('タウンワーク') === 'タウンワーク' && CS('マッハバイト') === 'マッハバイト' && CS('みんジョブ') === 'みんジョブ'
  && CS('コメディカル.com') === 'コメディカル.com' && CS('介護ジョブ') === '介護ジョブ' && CS('介護求人ネット') === '介護求人ネット' && CS('架空県介護求人ナビ') === '介護求人ナビ' && CS('あつまるHD') === 'あつまるHD'
  && CS('介護あるある') === '介護あるある' && CS('すぱいす') === 'すぱいす' && CS('タウンワーク(経由なし)') === 'タウンワーク' && CS('Indeed（経由なし）') === 'Indeed');
t('「ネット」だけはその他（元の書き方に出す）・表に無い語もその他', CS('ネット') === 'その他' && J(C.canonSources('ネット').others) === J(['ネット']) && CS('架空の媒体ABC') === 'その他');
const ALLSRC = ['indeel', 'ジョブメソレー', '経由なし', '知人', 'Ａ様', '派遣', 'ミラクス', '求人案件', 'タウンワーク', 'コメディカル.com', 'ネット', '甲野', '架空の媒体ABC', 'ハローワーク紹介'];
t('名寄せの結果は必ず決まった名前の一覧の中', ALLSRC.every((x) => C.SOURCE_NAMES.indexOf(CS(x)) >= 0), ALLSRC.map(CS));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
