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
t('年なし: 月が基準日の月より前なら翌年', C.completeYear('1/31', '2026-10-26') === '2027-01-31', C.completeYear('1/31', '2026-10-26'));
t('年なし: 月が同じか後なら同じ年（全角・「月日」・曜日つきも）', C.completeYear('１１月３日', '2026-10-26') === '2026-11-03' && C.completeYear('10/30(金)', '2026-10-26') === '2026-10-30');
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
t('不採用 → 不採用', D({ result: '不採用' }).stage === 'rejected');
t('本人断り・辞退・採用辞退 → 辞退', ['本人断り', '辞退', '採用辞退'].every((r) => D({ result: r }).stage === 'declined'));
t('空欄・受付から90日超 → 連絡途絶', D({ result: '', received: '2026-07-27' }).stage === 'lost', D({ result: '', received: '2026-07-27' }));
t('空欄・ちょうど90日 → 連絡途絶にしない', D({ result: '', received: '2026-07-28' }).stage === 'applied');
t('空欄・面接日あり → 面接', D({ result: '', received: '2026-10-01', interviewOn: '2026-10-20' }).stage === 'interview');
t('空欄・面接日なし → 応募受付', D({ result: '', received: '2026-10-01' }).stage === 'applied');
const unk = D({ result: '保留' });
t('知らない語 → null＋issue', unk.stage === null && /保留/.test(unk.issue), unk);
t('連絡途絶の日数は設定で変わる', C.deriveStage({ received: '2026-10-01' }, '2026-10-26', 20).stage === 'lost');

console.log('\n— 5. 見出しと取り込みの試算 —');
const CSV = [
  '採用者一覧,,,,',
  'No,受付日,経路,氏名,フリガナ,性別,連絡先,本人希望,面接日,採用可否,就業開始日,知らない列',
  '1,2026/10/01,ハローワーク・紹介,甲野 一郎,コウノ イチロウ,男,000-0000-0001 x@example.com,"夜勤なし,土日休み",10/20見学のみ,,,',
  '2,2026/07/01,求人サイト,乙川 花子,オツカワ ハナコ,女,000-0000-0002,,,,,',
  '3,2026/10/02,紹介,丙山 三郎,,男,,,,保留,,',
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
t('1行目: 入れられる・面接日を備考に残し段階は面接・経路を分ける', it[0].ok && it[0].row.stage === 'interview' && /^面接日: 2026-10-20 見学のみ/.test(it[0].row.note_text) && J(it[0].row.sources) === J(['ハローワーク', '紹介']), it[0]);
t('1行目: 連絡先とメール・本人希望の文章・取り込みの鍵', it[0].row.email === 'x@example.com' && it[0].row.phones[0].num === '000-0000-0001' && it[0].row.wish_text === '夜勤なし,土日休み' && it[0].row.import_key === '甲野一郎|2026-10-01' && it[0].row.gender === 'M', it[0].row);
t('2行目: 取り込み済み（have にある）→ 外す', !it[1].ok && it[1].issues.indexOf('取り込み済みです') >= 0, it[1]);
t('3行目: 知らない採用可否 → 外す', !it[2].ok && it[2].issues.some((x) => /保留/.test(x)), it[2]);
t('4行目: 受付日が無い → 外す', !it[3].ok && it[3].issues.indexOf('受付日がありません') >= 0, it[3]);
t('5行目: 全角空白違いの同じ氏名・受付日 → 重複で外す', !it[4].ok && it[4].issues.some((x) => /同じ氏名・受付日/.test(x)), it[4]);
t('6行目: 採用＋就業開始日（年なしは受付日から補う）→ 入職準備・入職予定日', it[5].ok && it[5].row.stage === 'prep' && it[5].row.start_on === '2026-11-01', it[5].row);
t('件数は入れられる行だけ・行番号は CSV の行', plan.count === 2 && it[0].line === 3, { count: plan.count, line: it[0].line });
t('見出しの無い CSV は理由つきで止める', C.planImport('a,b\n1,2', '2026-10-26').ok === false);
const lost = C.normApplicant({ name: 0, received: 1 }, ['己野 六子', '2026/06/01'], '2026-10-26', C.DEFAULT_SETTINGS).row;
t('連絡途絶で入る行は終わった日・終わり方が付く（保管期限はデータベースが付ける＝送らない）', lost.stage === 'lost' && lost.closed_on === '2026-10-26' && lost.outcome_reason === '連絡途絶' && !('retain_until' in lost), lost);
const IMPORT_KEYS = ['legacy_no', 'received_on', 'sources', 'name', 'kana', 'gender', 'birth_date', 'jobs', 'quals_text', 'address', 'phones', 'email', 'wish_text', 'cond_text', 'note_text', 'reply_due', 'outcome_reason', 'outcome_note', 'start_on', 'prep', 'first_contact_at', 'stage', 'closed_on', 'import_key'];
t('取り込みの行のキーはデータベース（ats_import）が受ける名前だけ', it.every((x) => Object.keys(x.row).every((k) => IMPORT_KEYS.indexOf(k) >= 0)), Object.keys(it[0].row));
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
t('送ってから6分未満 → wait', C.staffVerdict(null, '2026-10-26T00:55:00Z', now) === 'wait');
t('6分以上 → absent', C.staffVerdict(null, '2026-10-26T00:54:00Z', now) === 'absent');
t('送った時刻が読めない → absent・6分より先の未来 → absent', C.staffVerdict(null, '', now) === 'absent' && C.staffVerdict(null, '2026-10-26T01:07:00Z', now) === 'absent');
t('残りの分', C.staffWaitMinutes('2026-10-26T00:58:00Z', now) === 4);
const LIST = [{ id: 'S0001', name: '甲野　一郎', hireDate: '2026-11-01', birthDate: '1990-04-01' }, { id: 'S0002', name: '甲野 一郎', hireDate: '2025-04-01' }];
t('照合は氏名（空白を除く）＋入職日＋生年月日', C.staffMatches(LIST, { name: '甲野一郎', hireDate: '2026-11-01', birthDate: '1990-04-01' }).length === 1);
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

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
