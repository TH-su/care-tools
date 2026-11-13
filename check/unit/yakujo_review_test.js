/* 薬情の反映の見直しの印（yakujo-calc.js の reviewMark ほか・2026-11-11 代表者の決定）の試験
   実行: node check/unit/yakujo_review_test.js（環境変数 YAKUJO_CALC で別の版を当てられる）
   架空データのみ（薬の名前は「見本」の架空の名前・メールは example.test）。
   守りたいこと:
     1. 印を出すのは、まとめて反映で消した・変えた方と、すべて入れ替えで消した方と、自動の中止の期間（11/10）の中止だけ
        （まとめて反映でも足すだけの方・1人ずつで手で選んだ中止・変えるだけの方には出さない）
     2. 反映から14日未満で、見直していない時だけ出す。見直した・14日たった・時刻が読めない・先の時刻は出さない
        7日以上14日未満は「期限切れ」（overdue）にする（2026-11-13 代表者の決定。それまでは7日で消していた）
     3. 消えた薬は反映前と反映後の行の差で出す（同じ行が2つあれば2つ目も数える）
     4. 見直し待ちの数は同じ記録を1つに数え、メニューの控えは件数と日付だけ（管理者にだけ出す印つき）
     5. 管理者の一覧は、自動の中止の期間の中止と、すべて入れ替えの中止だけを新しい順に出す */
'use strict';
const path = require('path');
const Y = require(process.env.YAKUJO_CALC || path.join(__dirname, '..', '..', 'yakujo-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const DAY = 86400000;
const NOW = Date.parse('2026-11-12T03:00:00Z');
const iso = ms => new Date(ms).toISOString();
const rec = (o) => Object.assign({ at: iso(NOW - DAY), id: '11', srcKey: 'S|11|2026-11-11|0000000a', srcDate: '2026-11-11',
  docRows: '', before: '見本A錠 1錠 朝食後\n見本B錠 1錠 夕食後', after: '見本A錠 1錠 朝食後', by: 'adm@example.test', how: '', reviewedAt: '', reviewedBy: '' }, o);
const STOP = '中止｜（書類に無い今の行）｜（中止）', ALL = '中止（すべて入れ替え）｜（書類に無い今の行）｜（中止）';
const CHG = '変える｜見本C錠2mg｜見本C錠2mg 1錠 朝食後', ADD = '足す｜見本D錠｜見本D錠 1錠 朝食後', KEEP = '残す｜（書類に無い今の行）｜見本A錠 1錠 朝食後';
const EDIT = '直す｜（書類に無い今の行）｜見本A錠 2錠 朝食後';

console.log('■ 1. 印を出す方');
t('まとめて反映で中止した方は bulk', Y.reviewKind(rec({ how: 'まとめて反映', docRows: STOP })) === 'bulk');
t('まとめて反映で変えた方は bulk', Y.reviewKind(rec({ how: 'まとめて反映', docRows: CHG + '\n' + KEEP })) === 'bulk');
t('まとめて反映で直した方は bulk', Y.reviewKind(rec({ how: 'まとめて反映', docRows: EDIT })) === 'bulk');
t('まとめて反映で足すだけの方は出さない（代表者の決定）', Y.reviewKind(rec({ how: 'まとめて反映', docRows: ADD + '\n' + KEEP })) === null);
t('すべて入れ替えの中止は all（1人ずつ）', Y.reviewKind(rec({ docRows: ALL + '\n' + CHG })) === 'all');
t('1人ずつで手で選んだ中止は出さない（期間の外）', Y.reviewKind(rec({ docRows: STOP })) === null);
t('1人ずつで変えるだけは出さない', Y.reviewKind(rec({ docRows: CHG })) === null);
const IN = Date.parse('2026-11-10T13:30:00Z');
t('自動の中止の期間の中止は auto（見分けられないので全部）', Y.reviewKind(rec({ at: iso(IN), docRows: STOP })) === 'auto');
t('期間の始まり（12:47Z）は含む・その前は含まない', Y.reviewKind(rec({ at: '2026-11-10T12:47:00.000Z', docRows: STOP })) === 'auto'
  && Y.reviewKind(rec({ at: '2026-11-10T12:46:59.000Z', docRows: STOP })) === null);
t('期間の終わり（15:00Z＝11/11 0時）は含まない', Y.reviewKind(rec({ at: '2026-11-10T14:59:59.000Z', docRows: STOP })) === 'auto'
  && Y.reviewKind(rec({ at: '2026-11-10T15:00:00.000Z', docRows: STOP })) === null);
t('期間の中のまとめて反映は bulk（まとめて反映の語を先に）', Y.reviewKind(rec({ at: iso(IN), how: 'まとめて反映', docRows: STOP })) === 'bulk');
t('how が他の語・空なら 1人ずつ扱い', Y.reviewKind(rec({ how: 'まとめて', docRows: STOP })) === null);
t('記録でない値は null', Y.reviewKind(null) === null && Y.reviewKind('x') === null && Y.reviewKind({}) === null);
t('似た語（中止の前後に文字）は数えない', Y.logCount('中止する｜x｜y\n中止（手で）｜x｜y').stop === 0 && Y.logCount('中止する｜x｜y').stopAll === 0);
const lc = Y.logCount([CHG, ADD, STOP, ALL, EDIT, KEEP, '…（以下 3 行）'].join('\n'));
t('書類の行を扱いごとに数える・切れた記録は truncated', lc.change === 1 && lc.add === 1 && lc.stop === 1 && lc.stopAll === 1 && lc.edit === 1 && lc.truncated === true, lc);
t('1行目で切れた記録（末尾が…）も truncated', Y.logCount('変える｜見本…').truncated === true);

console.log('■ 2. 7日間・期限切れは14日まで・見直すまで');
const B = rec({ how: 'まとめて反映', docRows: STOP });
let m = Y.reviewMark(B, NOW);
t('印の文言は「まとめて反映（日時・確かめた人）」（日本時間）', m && m.text === 'まとめて反映（2026-11-11 12:00・確かめた人 adm@example.test）', m);
t('すべて入れ替えの文言', Y.reviewMark(rec({ docRows: ALL }), NOW).text.indexOf('すべて入れ替え（') === 0);
t('自動の期間の文言は「完全入れ替え」', Y.reviewMark(rec({ at: iso(IN), docRows: STOP }), Date.parse('2026-11-11T00:00:00Z')).label === '完全入れ替え');
t('見直した記録は出さない', Y.reviewMark(Object.assign({}, B, { reviewedAt: iso(NOW - 3600000), reviewedBy: 'nurse@example.test' }), NOW) === null);
/* 2026-11-13 代表者の決定: 7日を過ぎて見直されていない方は「期限切れ」にし、反映から14日まで印を残す（それまでの「7日ちょうどで消える」を置き換えた） */
const T0 = Date.parse(B.at);
t('7日の1秒前は期限切れでない', Y.reviewMark(B, T0 + 7 * DAY - 1000).overdue === false);
t('7日ちょうどで期限切れになる（印は消えない）', Y.reviewMark(B, T0 + 7 * DAY).overdue === true);
t('14日の1秒前は期限切れのまま出る', Y.reviewMark(B, T0 + 14 * DAY - 1000).overdue === true);
t('14日ちょうどで消える', Y.reviewMark(B, T0 + 14 * DAY) === null);
t('期限切れでも見直した記録は出さない', Y.reviewMark(Object.assign({}, B, { reviewedAt: iso(T0 + 8 * DAY), reviewedBy: 'nurse@example.test' }), T0 + 8 * DAY) === null);
t('期限切れの印も文言・送り先は同じ', (() => { const o = Y.reviewMark(B, T0 + 8 * DAY); return o.text === m.text && o.id === m.id && o.srcKey === m.srcKey && o.at === m.at; })());
t('すべて入れ替え・自動の中止の期間の記録も14日まで', Y.reviewMark(rec({ docRows: ALL }), Date.parse(rec({}).at) + 13 * DAY).overdue === true
  && Y.reviewMark(rec({ at: iso(IN), docRows: STOP }), IN + 14 * DAY) === null && Y.reviewMark(rec({ at: iso(IN), docRows: STOP }), IN + 14 * DAY - 1000).overdue === true);
t('14日は反映記録が消える30日の内側', Y.REVIEW_KEEP_DAYS === 14 && Y.REVIEW_DAYS === 7 && Y.REVIEW_KEEP_DAYS < 30);
t('先の時刻（1分を超えるずれ）は出さない・1分以内は出す', Y.reviewMark(rec({ at: iso(NOW + 61000), how: 'まとめて反映', docRows: STOP }), NOW) === null
  && !!Y.reviewMark(rec({ at: iso(NOW + 30000), how: 'まとめて反映', docRows: STOP }), NOW));
t('時刻が読めない記録・今が読めない時は出さない', Y.reviewMark(rec({ at: 'x', how: 'まとめて反映', docRows: STOP }), NOW) === null && Y.reviewMark(B, NaN) === null);
t('確かめた人が空なら「不明」と書く', Y.reviewMark(rec({ how: 'まとめて反映', docRows: STOP, by: '' }), NOW).text.indexOf('確かめた人 不明') > 0);
t('印に7日の終わりの日時（見直しの期限）と14日の終わりの日時（印の終わり）を持つ', m.until === '2026-11-18 12:00' && m.end === '2026-11-25 12:00' && m.overdue === false, m);
t('印は記録の番号・印・時刻を持つ（見直しの送り先）', m.id === '11' && m.srcKey === B.srcKey && m.at === B.at);

console.log('■ 3. 消えた薬');
t('反映前にあって反映後に無い行', JSON.stringify(m.gone) === JSON.stringify(['見本B錠 1錠 夕食後']), m.gone);
t('同じ行が2つあれば2つ目も数える', JSON.stringify(Y.goneLines('見本A錠\n見本A錠\n見本B錠', '見本A錠')) === JSON.stringify(['見本A錠', '見本B錠']));
t('行末の空白・改行の種類・空行は見ない', Y.goneLines('見本A錠  \r\n\r\n見本B錠', '見本A錠\n見本B錠').length === 0);
t('反映前が空なら何も消えていない', Y.goneLines('', '見本A錠').length === 0 && Y.goneLines(null, undefined).length === 0);
t('中止と変えた行の数を持つ', Y.reviewMark(rec({ how: 'まとめて反映', docRows: [STOP, CHG, EDIT].join('\n') }), NOW).stop === 1
  && Y.reviewMark(rec({ how: 'まとめて反映', docRows: [STOP, CHG, EDIT].join('\n') }), NOW).change === 2);

console.log('■ 4. 見直し待ちの数とメニューの控え');
const rows = [B, Object.assign({}, B), rec({ id: '12', srcKey: 'S|12|2026-11-11|0000000b', docRows: ALL }),
  rec({ id: '13', srcKey: 'S|13|2026-11-11|0000000c', how: 'まとめて反映', docRows: ADD }),
  rec({ id: '14', srcKey: 'S|14|2026-11-11|0000000d', how: 'まとめて反映', docRows: STOP, reviewedAt: iso(NOW) }), null, 'x'];
t('同じ記録は1つ・足すだけ・見直した・形の違う行は数えない', Y.reviewPending(rows, NOW) === 2, Y.reviewPending(rows, NOW));
t('配列でなければ0', Y.reviewPending(null, NOW) === 0);
const md = Y.reviewMenuDue(rows, NOW, '2026-11-12');
t('控えは v・at・admin・review・overdue だけ（氏名・番号を持たない・2026-11-13 から v:2）', JSON.stringify(md) === '{"v":2,"at":"2026-11-12","admin":true,"review":2,"overdue":0}', md);
const rowsO = rows.concat([rec({ id: '15', srcKey: 'S|15|2026-11-03|0000000e', at: iso(NOW - 8 * DAY), how: 'まとめて反映', docRows: STOP }),
  rec({ id: '16', srcKey: 'S|16|2026-10-28|0000000f', at: iso(NOW - 15 * DAY), how: 'まとめて反映', docRows: STOP })]);
t('期限切れは見直し待ちの内数（8日前は数える・15日前は数えない）', JSON.stringify(Y.reviewCounts(rowsO, NOW)) === '{"pending":3,"overdue":1}', Y.reviewCounts(rowsO, NOW));
t('控えの overdue', JSON.stringify(Y.reviewMenuDue(rowsO, NOW, '2026-11-12')) === '{"v":2,"at":"2026-11-12","admin":true,"review":3,"overdue":1}', Y.reviewMenuDue(rowsO, NOW, '2026-11-12'));
t('日付の形が違えば控えを作らない', Y.reviewMenuDue(rows, NOW, '11/12') === null);

console.log('■ 5. 管理者の一覧');
const au = Y.replaceAudit([
  rec({ at: '2026-11-10T12:00:00.000Z', docRows: STOP }),                                  // 期間の前
  rec({ at: '2026-11-10T13:00:00.000Z', id: '21', docRows: STOP + '\n' + CHG, before: '見本A錠\n見本B錠\n見本C錠1mg', after: '見本A錠\n見本C錠2mg' }),
  rec({ at: '2026-11-10T13:10:00.000Z', id: '22', how: 'まとめて反映', docRows: STOP }),
  rec({ at: '2026-11-10T13:20:00.000Z', id: '23', docRows: CHG }),                         // 中止なし
  rec({ at: '2026-11-11T01:00:00.000Z', id: '24', docRows: STOP }),                        // 期間の後の手の中止
  rec({ at: '2026-11-11T02:00:00.000Z', id: '25', docRows: ALL, reviewedAt: '2026-11-11T05:00:00.000Z', reviewedBy: 'nurse@example.test' }),
  null]);
t('期間の中止・すべて入れ替えだけ（期間の前・中止なし・期間の後の手の中止は出さない）', au.map(x => x.id).join(',') === '25,22,21', au.map(x => x.id));
t('種類と時刻（日本時間）', au[0].type === 'all' && au[1].type === 'auto' && au[2].at === '2026-11-10 22:00');
t('まとめて反映の印・消えた行（中止と変える前の行）', au[1].bulk === true && JSON.stringify(au[2].gone) === JSON.stringify(['見本B錠', '見本C錠1mg']) && au[2].stop === 1 && au[2].change === 1, au[2]);
t('見直した時刻と人', au[0].reviewedAt === '2026-11-11 14:00' && au[0].reviewedBy === 'nurse@example.test' && au[1].reviewedAt === '' && au[1].reviewedBy === '');
t('見直していない記録に reviewedBy だけあっても出さない', Y.replaceAudit([rec({ docRows: ALL, reviewedBy: 'x@example.test' })])[0].reviewedBy === '');
t('配列でなければ空', Y.replaceAudit('x').length === 0);

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
