/* menu_due_badge_test.js — メニューの「個別機能訓練計画書」タイルの期限の件数の札（2026-10-24 代表者の決定 案A）
   実行: node check/unit/menu_due_badge_test.js
   （画面を差し替えて試す時: INDEX_HTML=… TP_HTML=… node check/unit/menu_due_badge_test.js）
   守ること:
     1. 計画書が端末に残すのは件数と数えた日だけ（氏名・利用者Noを入れない）。一覧の絞込に関係なく「在籍デイ利用者」で数える
     2. 一覧の情報・名簿（入居者マスタ）・デイ利用者の判定（週間計画）の3つが読めた時だけ書く。現場端末では書かない
     3. メニューは読むだけ（書かない・送らない）。現場端末では読まない。形が違う・数えた日が今日より先・件数が整数でない時は出さない
        （メニューが端末に書くのは毬の柄だけで、su-menu.js の SUMenu.setBall を通す・2026-10-26 代表者の決定）
     4. 0件の項目は書かず、全部0件なら札を出さない（今と同じ見た目）
   ★日付・件数はすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const INDEX = fs.readFileSync(process.env.INDEX_HTML || path.join(ROOT, 'index.html'), 'utf8');
const TPH = fs.readFileSync(process.env.TP_HTML || path.join(ROOT, 'training-plan.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

/* メニューの札の文字を作る純関数（印 DUE_TEXT_BEGIN〜END の間）を取り出す */
const B = INDEX.indexOf('DUE_TEXT_BEGIN'), E = INDEX.indexOf('/* DUE_TEXT_END */');
if (B < 0 || E < 0) { console.log('DUE_TEXT の印が見つからない'); process.exit(1); }
const fnSrc = INDEX.slice(INDEX.indexOf('function dueText', B), E);
const box = {};
vm.createContext(box);
vm.runInContext(fnSrc + '\nthis.dueText = dueText;', box);
const dueText = box.dueText;

/* 計画書の純関数層 */
const mark = TPH.indexOf('TP_PURE_MODULE');
const OPEN = TPH.indexOf('(function (global) {', mark);
const END = "})(typeof window !== 'undefined' ? window : this);";
const CLOSE = TPH.indexOf(END, OPEN);
if (mark < 0 || OPEN < 0 || CLOSE < 0) { console.log('TP_PURE_MODULE を切り出せない'); process.exit(1); }
const sb = {};
vm.createContext(sb);
vm.runInContext(TPH.slice(OPEN, CLOSE + END.length), sb);
const TP = sb.TP;

const J = (o) => JSON.stringify(o);
const TODAY = '2026-10-24';

console.log('\n— 1. 計画書が残す中身 —');
const rows = [
  { masterId: 'R0001', name: '架空 一郎', kana: 'かくう いちろう', isDaycare: true, active: true, latestPlanDate: '2026-06-01', nextDue: '2026-09-01' },   // 超過
  { masterId: 'R0002', name: '架空 二郎', kana: 'かくう じろう', isDaycare: true, active: true, latestPlanDate: '2026-08-01', nextDue: '2026-11-01' },   // 要注意（28日以内）
  { masterId: 'R0003', name: '架空 三郎', kana: 'かくう さぶろう', isDaycare: true, active: true, latestPlanDate: '' },                                  // 計画なし
  { masterId: 'R0004', name: '架空 四郎', kana: 'かくう しろう', isDaycare: true, active: true, latestPlanDate: '2026-10-01', nextDue: '2027-01-01' },   // 期限内
  { masterId: 'R0005', name: '架空 五郎', kana: 'かくう ごろう', isDaycare: false, active: true, latestPlanDate: '' },                                   // デイ利用者でない
  { masterId: 'R0006', name: '架空 六郎', kana: 'かくう ろくろう', isDaycare: true, active: true, dischargeDate: '2026-10-01', latestPlanDate: '' }      // 退去済み
];
const listDay = TP.buildAlerts(rows, { today: TODAY, warnDays: 28, dueRule: 'calendar', scope: 'day', sort: 'due' });
const sum = TP.menuDueSummary(listDay, TODAY);
t('在籍デイ利用者で数える（超過1・要注意1・計画なし1。デイでない方・退去済みの方は数えない）',
  !!sum && sum.overdue === 1 && sum.warn === 1 && sum.none === 1, sum);
t('残すのは v・at・overdue・warn・none の5つだけ', !!sum && Object.keys(sum).sort().join() === 'at,none,overdue,v,warn', sum && Object.keys(sum));
t('氏名・カナ・利用者Noを含まない', !/架空|かくう|R000/.test(J(sum)), sum);
t('今日が日付でなければ残さない（null）', TP.menuDueSummary(listDay, '') === null && TP.menuDueSummary(listDay, '2026/10/24') === null, '');
t('一覧が空なら全部0件', J(TP.menuDueSummary([], TODAY)) === J({ v: 1, at: TODAY, overdue: 0, warn: 0, none: 0 }), '');

console.log('\n— 2. 計画書が書く条件（字面） —');
const save = TPH.slice(TPH.indexOf('function saveMenuDue'), TPH.indexOf('function saveMenuDue') + 1100);
t('現場端末では書かない', /if \(isFieldDevice\(\)\) return;/.test(save), '');
t('一覧の情報・デイ利用者の判定・入居者マスタの名簿の3つが読めた時だけ書く（判定に注意が出ている・マスタを現場用の範囲でしか読めていない時も書かない）', /!IDX_OK \|\| !DAY_OK \|\| DAY_MSG \|\| ROSTER_SRC !== 'gas' \|\| !MASTER_OK \|\| !ROSTER\.length/.test(save), '');
t('一覧の情報の更新に失敗した方がいる間は書かない', /if \(Object\.keys\(IDX_PENDING\)\.length\) return;/.test(save), '');
t('在籍デイ利用者が0名なら書かない（中身の怪しい読み込みで前の件数を0件で上書きしない）', /if \(!list\.length\) return;/.test(save), '');
t('3つを読めた日が今日の時だけ書く（開きっぱなしの画面が前の日の中身を今日の日付で書かない）', /if \(LOADED_YMD !== today\) return;/.test(save) && /LOADED_YMD = \(IDX_OK && DAY_OK && ROSTER_SRC === 'gas'\) \? todayYmd\(\) : '';/.test(TPH), '');
t('一覧の絞込（tp_listFilter）ではなく、在籍デイ利用者（scope day）で数える', /scope: 'day'/.test(save) && !/LS\.filter/.test(save), '');
t('書く鍵は tp_menu_due だけ', /var MENU_DUE_KEY = 'tp_menu_due';/.test(TPH) && /localStorage\.setItem\(MENU_DUE_KEY, JSON\.stringify\(sum\)\)/.test(save), '');
t('一覧を描くたびに件数を更新する（renderList の先頭）', /function renderList\(\) \{\s*renderBanners\(\);\s*renderIndexChip\(\);\s*saveMenuDue\(\);/.test(TPH), '');
t('一覧とメニューの件数は同じ行（baseRows）から作る', /function listRows\(\) \{[\s\S]{0,120}TP\.buildAlerts\(baseRows\(\)/.test(TPH) && /TP\.buildAlerts\(baseRows\(\), \{/.test(save), '');

console.log('\n— 3. メニューの札の文字 —');
const ok = (o) => J(Object.assign({ v: 1, at: '2026-10-24', overdue: 0, warn: 0, none: 0 }, o));
t('超過・要注意・計画なしを語で書き、数えた日を添える', dueText(ok({ overdue: 1, warn: 3, none: 2 }), TODAY) === '超過1・要注意3・計画なし2（10/24時点）', dueText(ok({ overdue: 1, warn: 3, none: 2 }), TODAY));
t('0件の項目は書かない', dueText(ok({ warn: 3 }), TODAY) === '要注意3（10/24時点）', dueText(ok({ warn: 3 }), TODAY));
t('全部0件なら出さない（今と同じ見た目）', dueText(ok({}), TODAY) === '', '');
t('前の日に数えた件数は、その日付のまま出す', dueText(ok({ overdue: 2, at: '2026-10-03' }), TODAY) === '超過2（10/3時点）', dueText(ok({ overdue: 2, at: '2026-10-03' }), TODAY));
t('数えた日が今日より先なら出さない（端末の時計のずれ・壊れた値）', dueText(ok({ overdue: 1, at: '2026-10-25' }), TODAY) === '', '');
t('形が違う時は出さない（JSON でない・版が違う・日付が無い）',
  dueText('{', TODAY) === '' && dueText('null', TODAY) === '' && dueText(J({ v: 2, at: TODAY, overdue: 1, warn: 0, none: 0 }), TODAY) === '' &&
  dueText(J({ v: 1, overdue: 1, warn: 0, none: 0 }), TODAY) === '', '');
t('件数が整数でない・負・文字なら出さない',
  dueText(ok({ overdue: 1.5 }), TODAY) === '' && dueText(ok({ overdue: -1 }), TODAY) === '' &&
  dueText(J({ v: 1, at: TODAY, overdue: '1', warn: 0, none: 0 }), TODAY) === '' && dueText(J({ v: 1, at: TODAY, overdue: 1, warn: 0 }), TODAY) === '', '');
t('今日が日付でなければ出さない', dueText(ok({ overdue: 1 }), '') === '', '');
t('年が違う時は年も書く（去年の同じ月日と読み違えない）', dueText(ok({ overdue: 1, at: '2025-11-01' }), TODAY) === '超過1（2025/11/1時点）', dueText(ok({ overdue: 1, at: '2025-11-01' }), TODAY));
t('ありえない月日（0月0日・13月）は出さない', dueText(ok({ overdue: 1, at: '2026-00-00' }), TODAY) === '' && dueText(ok({ overdue: 1, at: '2025-13-01' }), TODAY) === '', '');
t('氏名などを入れられても札に出さない（件数と日付の項目しか読まない）', !/架空/.test(dueText(J({ v: 1, at: TODAY, overdue: 1, warn: 0, none: 0, name: '架空 一郎' }), TODAY)), '');

console.log('\n— 4. メニューの読み方（字面） —');
const badge = INDEX.slice(INDEX.indexOf('function dueBadge'), INDEX.indexOf('function dueBadge') + 600);
t('現場端末（is-field）では読まない', /classList\.contains\('is-field'\)\) return null;/.test(badge), '');
t('読めない・壊れている時は札を出さない（例外を外に出さない）', /\} catch \(e\) \{ return null; \}/.test(badge), '');
t('札の文字は textContent で入れる（el を使う）', /el\('span', 'due', txt\)/.test(badge), '');
t('メニューは端末の保存領域へ直接書かない・通信しない（書くのは毬の柄だけで SUMenu.setBall を通す）', !/localStorage\.(setItem|removeItem|clear)\(/.test(INDEX) && !/fetch\(|XMLHttpRequest/.test(INDEX)
  && (INDEX.match(/SUMenu\.setBall\(/g) || []).length === 1 && !/tp_menu_due/.test(INDEX.slice(INDEX.indexOf('function drawBall'), INDEX.indexOf('function drawBall') + 2000)), '');
const def = JSON.parse(INDEX.slice(INDEX.indexOf('>', INDEX.indexOf('id="menuDef"')) + 1, INDEX.indexOf('</script>', INDEX.indexOf('id="menuDef"'))));
const tiles = def.sections.flatMap((s) => s.tiles);
const withDue = tiles.filter((x) => x.due);
/* 2026-11-11: 入居者マスタのタイルに、薬情の見直し待ちの数の札（管理者だけ）を足した（代表者の決定）。入居者マスタのタイルは
   事務所専用の印を持たないが、札は現場端末では読まず（dueBadge）、控えの admin の印があり管理者のログインの時だけ出す（dueText）ので、
   「事務所専用のタイルだけ」の決まりを「事務所専用か、管理者だけに出す札か」に広げた */
t('札を出すのは個別機能訓練計画書と採用管理（2026-10-29）と入居者マスタ（2026-11-11・管理者だけの札）と設備・修繕の記録と担当者会議の記録（2026-11-13）のタイルだけ',
  withDue.length === 5 && withDue.some((x) => x.href === 'equip-log.html' && x.due === 'eql_menu_due')
  && withDue.some((x) => x.href === 'care-meeting.html' && x.due === 'cm_menu_due') && withDue.filter((x) => x.href !== 'resident-master.html').every((x) => x.officeOnly === true)
  && withDue.some((x) => x.href === 'training-plan.html' && x.due === 'tp_menu_due')
  && withDue.some((x) => x.href === 'ats.html' && x.due === 'ats_menu_due' && x.adminOnly === true)
  && withDue.some((x) => x.href === 'resident-master.html' && x.due === 'rm_yjrev_due'), withDue);
/* 薬情の見直し待ち（2026-11-11 代表者の決定）: 入居者マスタが管理者のログインで数え、件数と日付だけを残す。メニューは管理者にだけ出す */
const rv = (o) => JSON.stringify(Object.assign({ v: 1, at: '2026-10-24', admin: true, review: 2 }, o));
t('見直し待ち: 管理者のログインの時だけ「見直し待ちn（日付時点）」', dueText(rv({}), TODAY, 'admin') === '見直し待ち2（10/24時点）', dueText(rv({}), TODAY, 'admin'));
t('見直し待ち: 事務所・現場・ログインしていない・役割が分からない時は出さない',
  ['office', 'field', null, undefined, 'pending', 'unsure'].every((r) => dueText(rv({}), TODAY, r) === ''), '');
t('見直し待ち: 0件・形の違う数・admin の印が無い控えは出さない',
  dueText(rv({ review: 0 }), TODAY, 'admin') === '' && dueText(rv({ review: 1.5 }), TODAY, 'admin') === '' && dueText(rv({ review: '2' }), TODAY, 'admin') === ''
  && dueText(rv({ review: -1 }), TODAY, 'admin') === '' && dueText(rv({ admin: false }), TODAY, 'admin') === '' && dueText(rv({ admin: 'true' }), TODAY, 'admin') === '', '');
t('見直し待ち: 数えた日が今日より先なら出さない・前の日はその日付のまま', dueText(rv({ at: '2026-10-25' }), TODAY, 'admin') === ''
  && dueText(rv({ at: '2026-10-03' }), TODAY, 'admin') === '見直し待ち2（10/3時点）', '');
t('見直し待ち: admin の印は計画書の控えに混ぜても管理者以外には出さない', dueText(rv({ overdue: 3 }), TODAY, 'office') === '', '');
t('札の文字には今の役割を渡す', /dueText\(raw, todayYmd\(\), role\)/.test(INDEX), '');
t('今までの札は役割を渡さなくても今までどおり', dueText(ok({ overdue: 1 }), TODAY, 'office') === '超過1（10/24時点）', '');
/* 採用管理の保管期限（2026-10-29 本人指示）: 端末に残すのは期限の日付だけ。メニューが今日の日付で数える */
const ex = (dates, at) => J({ v: 1, at: at || TODAY, overdue: 0, warn: 0, none: 0, expire: dates });
t('保管期限: 今日より前の日付の数を「保管期限切れn」と書く（今日の日付ちょうどはまだ切れていない）',
  dueText(ex(['2026-10-01', '2026-10-23', '2026-10-24', '2026-11-30']), TODAY) === '保管期限切れ2（10/24時点）', dueText(ex(['2026-10-01', '2026-10-23', '2026-10-24', '2026-11-30']), TODAY));
t('保管期限: 前に数えた日のままでも、今日の日付で期限を過ぎた分が出る（採用管理を開かない日が続いても札が出る）',
  dueText(ex(['2026-10-10', '2026-10-20'], '2026-10-01'), TODAY) === '保管期限切れ2（10/1時点）', dueText(ex(['2026-10-10', '2026-10-20'], '2026-10-01'), TODAY));
t('保管期限: 期限を過ぎた方がいなければ出さない・空の並びも出さない', dueText(ex(['2026-10-24', '2027-01-01']), TODAY) === '' && dueText(ex([]), TODAY) === '', '');
t('保管期限: 形の違う日付・並びでない・2000件を超える時は出さない（壊れた値で札を出さない）',
  dueText(ex(['2026-10-01', '甲野']), TODAY) === '' && dueText(ex(['2026-13-01']), TODAY) === '' && dueText(ex([20261001]), TODAY) === ''
  && dueText(ex('2026-10-01'), TODAY) === '' && dueText(ex(Array(2001).fill('2026-10-01')), TODAY) === '', '');
t('札の色は変数で持ち、白地で 7:1 以上（--due-tx: #a50e0e）', /--due-tx: #a50e0e;/.test(INDEX) && /\.tile \.due \{[^}]*color: var\(--due-tx\)/.test(INDEX), '');
t('「戻る」で戻った時（pageshow の persisted）と、別のタブで件数が書き換わった時（storage）に札だけ付け直す', /addEventListener\('pageshow', function \(e\) \{ if \(e\.persisted\) refreshDue\(\); \}\)/.test(INDEX) && /addEventListener\('storage', function \(e\) \{\s*if \(!e\.key \|\| \(\/\^\[a-z0-9_\]\{1,40\}\$\/\.test\(e\.key\) && main\.querySelector\('a\.tile\[data-due="' \+ e\.key \+ '"\]'\)\)\) refreshDue\(\);/.test(INDEX), '');
t('付け直しは札のあるタイル（data-due）だけを読み、古い札を外してから付ける', /querySelectorAll\('a\.tile\[data-due\]'\)/.test(INDEX) && /if \(old\) tiles\[i\]\.removeChild\(old\);/.test(INDEX), '');

/* 設備・修繕の記録（2026-11-13 代表者の指示）: 設備の記録が事務所PCで数えた期限切れ・30日以内・法定の期限切れの数と数えた日だけを残す。
   ★日付は固定（TODAY = 2026-10-24） */
const BOX = (() => { const s = INDEX.slice(B, E); const b2 = {}; vm.createContext(b2); vm.runInContext(s.slice(s.indexOf('function dueText')) + '\nthis.dueLegal = dueLegal;', b2); return b2; })();
const dueLegal = BOX.dueLegal;
const eq = (o) => J(Object.assign({ v: 1, at: '2026-10-24', eq: true, overdue: 2, soon: 3, legal: 1 }, o));
t('設備: 「期限切れn・30日以内n（日付時点）」と書く', dueText(eq({}), TODAY, 'office') === '期限切れ2・30日以内3（10/24時点）', dueText(eq({}), TODAY, 'office'));
t('設備: 0件の項目は書かない・全部0件なら札を出さない（今と同じ見た目）',
  dueText(eq({ overdue: 0, legal: 0 }), TODAY) === '30日以内3（10/24時点）' && dueText(eq({ soon: 0 }), TODAY) === '期限切れ2（10/24時点）'
  && dueText(eq({ overdue: 0, soon: 0, legal: 0 }), TODAY) === '' && dueLegal(eq({ overdue: 0, soon: 0, legal: 0 }), TODAY) === '', '');
t('設備: 法定の期限切れは別の赤の札の文字「法定の期限切れn」・0件なら出さない',
  dueLegal(eq({}), TODAY) === '法定の期限切れ1' && dueLegal(eq({ legal: 0 }), TODAY) === '' && dueLegal(ok({ overdue: 1 }), TODAY) === '', dueLegal(eq({}), TODAY));
t('設備: 形の違う数・法定が期限切れより多い・eq の印の違う控えは出さない（どちらの札も）',
  [{ overdue: 1.5 }, { soon: '3' }, { legal: -1 }, { legal: 3 }, { eq: 'true' }, { soon: undefined }, { overdue: 10000 }].every((o) => dueText(eq(o), TODAY) === '' && dueLegal(eq(o), TODAY) === ''), '');
t('設備: 数えた日が今日より先なら出さない・前の日はその日付のまま',
  dueText(eq({ at: '2026-10-25' }), TODAY) === '' && dueLegal(eq({ at: '2026-10-25' }), TODAY) === '' && dueText(eq({ at: '2026-10-03' }), TODAY) === '期限切れ2・30日以内3（10/3時点）', '');
/* 薬情の見直しの期限切れ（2026-11-13 代表者の決定）: 控えは v:2 で overdue（review の内数）を持つ。赤の札「期限切れn」は管理者だけ。v:1 の控えも読む */
const rv2 = (o) => J(Object.assign({ v: 2, at: '2026-10-24', admin: true, review: 3, overdue: 1 }, o));
t('見直し v:2: 件数の札は今までどおり「見直し待ちn」・赤の札は「期限切れn」', dueText(rv2({}), TODAY, 'admin') === '見直し待ち3（10/24時点）' && dueLegal(rv2({}), TODAY, 'admin') === '期限切れ1',
  [dueText(rv2({}), TODAY, 'admin'), dueLegal(rv2({}), TODAY, 'admin')]);
t('見直し v:2: 管理者でない時はどちらも出さない', ['office', 'field', null, undefined, 'pending'].every((r) => dueText(rv2({}), TODAY, r) === '' && dueLegal(rv2({}), TODAY, r) === ''), '');
t('見直し v:2: 期限切れ0件なら赤の札は出さない・overdue が review より多い・形が違う控えは両方出さない',
  dueLegal(rv2({ overdue: 0 }), TODAY, 'admin') === '' && dueText(rv2({ overdue: 0 }), TODAY, 'admin') === '見直し待ち3（10/24時点）'
  && [{ overdue: 4 }, { overdue: 1.5 }, { overdue: '1' }, { overdue: -1 }, { overdue: undefined }, { admin: false }, { admin: 'true' }]
    .every((o) => dueText(rv2(o), TODAY, 'admin') === '' && dueLegal(rv2(o), TODAY, 'admin') === ''), '');
t('見直し v:2: 数えた日が今日より先なら出さない', dueText(rv2({ at: '2026-10-25' }), TODAY, 'admin') === '' && dueLegal(rv2({ at: '2026-10-25' }), TODAY, 'admin') === '', '');
t('見直し v:1（古い控え）は今までどおり読み、赤の札は出さない', dueText(rv({}), TODAY, 'admin') === '見直し待ち2（10/24時点）' && dueLegal(rv({ overdue: 1 }), TODAY, 'admin') === '', '');
t('v:2 は admin の印の控えだけ（計画書・設備の形の v:2 は出さない）', dueText(J({ v: 2, at: '2026-10-24', overdue: 1, warn: 0, none: 0 }), TODAY, 'admin') === '', '');
t('メニューの赤の札は今のログインの役割を渡して読む', /dueLegal\(raw, todayYmd\(\), role\)/.test(INDEX), '');
t('設備: 壊れた控え・版の違う控えは出さない', dueText('{壊れ', TODAY) === '' && dueLegal('{壊れ', TODAY) === '' && dueLegal(eq({ v: 2 }), TODAY) === '', '');
t('設備: 赤の札は地が --due-tx・文字が白（白と #a50e0e で約 7.9:1）', /\.tile \.due\.legal \{[^}]*color: #fff;[^}]*background: var\(--due-tx\)/.test(INDEX), '');
t('設備: 赤の札は件数の札と同じ守り（現場端末では読まない・鍵の形を確かめる）で付け、付け直しでも外す',
  /function dueLegalBadge\(key\) \{[\s\S]{0,200}is-field[\s\S]{0,120}\^\[a-z0-9_\]\{1,40\}\$/.test(INDEX) && /var oldL = tiles\[i\]\.querySelector\('\.due'\);\s*if \(oldL\) tiles\[i\]\.removeChild\(oldL\);/.test(INDEX), '');

/* 担当者会議の記録（2026-11-13 代表者の決定・台帳 CM-02）: 前回から6か月の分だけ。注記「6か月の分だけ」を付ける */
const cm = (o) => J(Object.assign({ v: 1, at: '2026-10-24', cm: true, overdue: 2, soon: 3 }, o));
t('担当者会議: 「期限切れn・30日以内n（6か月の分だけ・日付時点）」と書く', dueText(cm({}), TODAY, 'office') === '期限切れ2・30日以内3（6か月の分だけ・10/24時点）', dueText(cm({}), TODAY, 'office'));
t('担当者会議: 0件の項目は書かない・全部0件なら札を出さない（今と同じ見た目）',
  dueText(cm({ overdue: 0 }), TODAY) === '30日以内3（6か月の分だけ・10/24時点）' && dueText(cm({ soon: 0 }), TODAY) === '期限切れ2（6か月の分だけ・10/24時点）'
  && dueText(cm({ overdue: 0, soon: 0 }), TODAY) === '', '');
t('担当者会議: 形の違う数・印の違う控え・数えた日が先の控えは出さない・赤の札は出さない',
  [{ overdue: 1.5 }, { soon: '3' }, { overdue: -1 }, { cm: 'true' }, { soon: undefined }, { at: '2026-10-25' }, { v: 2 }].every((o) => dueText(cm(o), TODAY) === '')
  && dueLegal(cm({}), TODAY) === '', '');
t('担当者会議: 年が違う時は年も書く', dueText(cm({ at: '2025-12-30' }), TODAY) === '期限切れ2・30日以内3（6か月の分だけ・2025/12/30時点）', dueText(cm({ at: '2025-12-30' }), TODAY));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
