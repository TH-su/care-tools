/* 入居者マスタ画面（resident-master.html）の薬の変更候補を、申送の原文（events）から作ることの試験（2026-10-10）。
   守りたいこと:
     A AI 要約（ledger）の名前と原文の名前が食い違っても、候補は原文の行の方に付く（要約に他の方の内容が混ざることがあるため）
     B 要約は「その日に服薬関連があるか」の手がかりにだけ使う（人ではなく日で取る＝要約が別の方に付いていても取りこぼさない）
     C 薬の行の見分け（薬の語は必ず・カタカナの薬名＋変更の語は手がかりがある時だけ・入浴中止などは候補にしない）
     D 候補の印はサーバーが受け付ける形（'S|利用者No|日付|指紋8桁'）で、要約が変わっても変わらない
     E 判断済み（反映・反映しない・保留）の扱いと、同じ日の判断の印
   ★画面の本物の判定（MC-JUDGE-BEGIN〜END の間）をそのまま取り出して動かす（朝回診と同じ取り出し方）。
   実行: node check/unit/master_mc_rawfirst_test.js（MASTER_HTML で別の resident-master.html を当てられる）
   架空データのみ。実在の入居者は登場しない。 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('unbalanced: ' + name);
}
const b0 = src.indexOf('MC-JUDGE-BEGIN'), b1 = src.indexOf('/* ==== 薬の変更候補の判定ここまで（MC-JUDGE-END）');
if (b0 < 0 || b1 < 0) throw new Error('MC-JUDGE の目印が見つかりません');
const JUDGE = src.slice(src.lastIndexOf('/*', b0), b1);

const ROSTER = [
  { id: '101', name: '架空 一郎', room: '201', active: true },
  { id: '102', name: '架空 二郎', room: '202', active: true },
  { id: '103', name: '仮名 花子', room: '203', active: true },
  { id: '104', name: '試験 退子', room: '204', active: false }
];
function build(d, decided) {
  const sb = { window: {}, localStorage: { getItem: () => null, key: () => null, length: 0 }, console, roster: ROSTER };
  vm.createContext(sb);
  vm.runInContext(JUDGE, sb, { filename: 'MC-JUDGE(取り出し)' });
  sb.mcSt = { decided: decided || {}, raw: {} };
  const out = sb.mcBuild_(d);
  return { out, others: sb.mcSt.others, st: sb.mcSt, sb };
}
const D = '2026-10-08';
const ev = (name, body, extra) => Object.assign({ key: 'k' + Math.random(), date: D, facility: '有料', shift: '日勤', row: 1, name, kind: '申送', time: '10:00', body, reporter: '' }, extra || {});
const lg = (name, summary, cats, extra) => Object.assign({ key: 'l' + Math.random(), date: D, facility: '有料', name, categories: cats || ['服薬関連'], time: '10:00', summary, reporter: '' }, extra || {});
const all = r => r.out.concat(r.others);

console.log('\n— A. 要約の名前と原文の名前が食い違う —');
{
  /* 要約は「架空 一郎」として、二郎さんの薬の中止を書いている（他の方の内容が混ざった）。原文は二郎さんの行 */
  const r = build({
    events: [ev('架空 二郎', 'アムロジピン5mg 受診にて中止'), ev('架空 一郎', '入浴後 更衣介助')],
    ledger: [lg('架空 一郎', '二郎さんのアムロジピンが中止になった')]
  });
  const A = all(r);
  t('★候補は原文の行の方（二郎さん・102）に付く', A.length === 1 && A[0].id === '102' && A[0].name === '架空 二郎', A.map(c => [c.id, c.text]));
  t('★候補の本文は原文の行そのもの（要約の文ではない）', A[0] && A[0].text === 'アムロジピン5mg 受診にて中止');
  t('★要約の名前（一郎さん・101）には候補を作らない', !A.some(c => c.id === '101'));
  t('★一郎さんとして付いた要約を、二郎さんの候補の参考に出さない', A[0] && Array.isArray(A[0].sums) && A[0].sums.length === 0, A[0] && A[0].sums);
  t('★要約にだけ服薬関連がある記録（一郎さんの分）は件数だけ数える', r.st.sumOnly === 1, r.st.sumOnly);
  t('定期薬の変更らしい（中止）ので上の一覧に出る', r.out.length === 1 && r.others.length === 0);
}
{
  /* 逆向き: 要約は二郎さんとして付いたが、原文は一郎さんの行 */
  const r = build({
    events: [ev('架空 一郎', '降圧薬 朝のみへ変更（指示にて）')],
    ledger: [lg('架空 二郎', '降圧薬が朝のみになった')]
  });
  const A = all(r);
  t('★逆向きでも、候補は原文の一郎さん（101）に付く', A.length === 1 && A[0].id === '101', A.map(c => c.id));
  t('二郎さんとして付いた要約は件数だけ', r.st.sumOnly === 1);
}
{
  /* 要約と原文の名前が同じ時は、その方の候補に参考として要約を出す */
  const r = build({ events: [ev('架空 一郎', 'マグミット330mg 1錠追加')], ledger: [lg('架空 一郎', '便秘のためマグミット追加')] });
  const A = all(r);
  t('名前が合う時は、要約を参考（sums）に出す', A.length === 1 && A[0].sums.length === 1 && A[0].sums[0] === '便秘のためマグミット追加', A[0] && A[0].sums);
  t('原文に薬の行がある日は、要約だけの件数に数えない', r.st.sumOnly === 0);
}

console.log('\n— B. 要約は手がかりにだけ使う（人ではなく日で取る）—');
{
  /* カタカナの薬名＋変更の語だけの行（薬の語なし）。手がかりが無ければ候補にしない */
  const r0 = build({ events: [ev('架空 一郎', 'ラシックス 追加')], ledger: [] });
  t('★手がかり（その方のその日の服薬関連の要約）が無ければ、カタカナの薬名＋変更の語だけの行は候補にしない', all(r0).length === 0, all(r0).map(c => c.text));
  const r1 = build({ events: [ev('架空 一郎', 'ラシックス 追加')], ledger: [lg('架空 一郎', '利尿薬の追加')] });
  t('★その方のその日に服薬関連の要約があれば、候補にする', all(r1).length === 1 && all(r1)[0].id === '101');
  const r2 = build({ events: [ev('架空 一郎', 'ラシックス 追加')], ledger: [lg('架空 二郎', '利尿薬の追加')] });
  t('★要約が別の方（二郎さん）に付いていても、同じ日なら一郎さんの行の手がかりにする（候補は一郎さんの原文）', all(r2).length === 1 && all(r2)[0].id === '101' && all(r2)[0].sums.length === 0, all(r2).map(c => c.id));
  const r3 = build({ events: [ev('架空 一郎', 'ラシックス 追加', { date: '2026-10-07' })], ledger: [lg('架空 一郎', '利尿薬の追加')] });
  t('★別の日の要約は手がかりにしない', all(r3).length === 0);
  const r4 = build({ events: [ev('架空 一郎', 'ラシックス 追加')], ledger: [lg('架空 一郎', '食事量が少ない', ['食事'])] });
  t('服薬関連でない要約は手がかりにしない', all(r4).length === 0);
}

console.log('\n— C. 薬の行の見分け —');
{
  const r = build({
    events: [
      ev('架空 一郎', '入浴中止（微熱のため）'),          /* 「中止」だけ＝薬の行ではない */
      ev('架空 一郎', 'トイレ介助 2回'),                  /* カタカナだけ＝薬の行ではない */
      ev('架空 一郎', 'リハビリ 開始'),                    /* カタカナ＋変更の語でも、手がかりが無ければ候補にしない */
      ev('架空 一郎', '眠前薬 本日抜薬'),                  /* 薬の語あり・その日だけ＝下の一覧 */
      ev('架空 一郎', '点眼 1日3回へ'),                    /* 薬の語あり（点眼） */
      ev('架空 一郎', '処方変更あり 詳細は薬情参照')       /* 処方 */
    ], ledger: []
  });
  const T = all(r).map(c => c.text);
  t('★「入浴中止」は候補にしない', T.indexOf('入浴中止（微熱のため）') < 0, T);
  t('★「トイレ介助」は候補にしない', T.indexOf('トイレ介助 2回') < 0);
  t('★カタカナ＋変更の語でも、手がかりが無ければ候補にしない（リハビリ開始）', T.indexOf('リハビリ 開始') < 0);
  t('薬の語がある行は候補にする（3行）', T.length === 3, T);
  t('★その日だけの見合わせ（抜薬）は下の一覧（変更らしくない）へ', r.others.some(c => c.text === '眠前薬 本日抜薬') && !r.out.some(c => c.text === '眠前薬 本日抜薬'));
  t('処方の変更は上の一覧', r.out.some(c => c.text === '処方変更あり 詳細は薬情参照'));
  const r2 = build({ events: [ev('架空 一郎', 'リハビリ 開始')], ledger: [lg('架空 一郎', '服薬の記録')] });
  t('★手がかりがあっても、介護の場面のカタカナ（リハビリ）＋変更の語は候補にしない', all(r2).length === 0, all(r2).map(c => c.text));
  const r3 = build({ events: [ev('架空 一郎', 'ｱﾑﾛｼﾞﾋﾟﾝ ５ｍｇ　中止')], ledger: [] });
  t('半角カナ・全角の mg も見分ける（NFKC）', all(r3).length === 1 && r3.out.length === 1);
}

console.log('\n— D. 候補の印 —');
{
  const body = 'アムロジピン5mg 受診にて中止';
  const r1 = build({ events: [ev('架空 二郎', body)], ledger: [lg('架空 二郎', '要約その1')] });
  const r2 = build({ events: [ev('架空 二郎', body)], ledger: [lg('架空 二郎', '書き直された要約その2')] });
  const r3 = build({ events: [ev('架空 二郎', body)], ledger: [] });
  const k = r1.out[0] && r1.out[0].srcKey;
  t('★印はサーバーの形（S|利用者No|日付|指紋8桁）', /^S\|102\|2026-10-08\|[0-9a-f]{8}$/.test(k || ''), k);
  t('★要約が作り直されても、要約が無くても、印は変わらない（原文の行の指紋）', k && r2.out[0].srcKey === k && r3.out[0].srcKey === k);
  t('印の頭は S|利用者No|日付|', r1.out[0].head === 'S|102|2026-10-08|');
  const r4 = build({ events: [ev('架空 二郎', body), ev('架空 二郎', body, { shift: '夜勤', time: '22:00' }), ev('架空 二郎', '降圧薬 夕を中止')], ledger: [] });
  t('★原文1行＝1候補（同じ本文の重複は1件・別の本文は別の候補）', all(r4).length === 2, all(r4).map(c => c.text));
  t('同じ日のこの方の薬の行の数（many）', all(r4).every(c => c.many === 2));
  t('その日の原文は全部取っておく（中身の表示・反映の可否に使う）', r4.st.raw['2026-10-08|102'] && r4.st.raw['2026-10-08|102'].length === 3);
}

console.log('\n— E. 判断済みの扱い —');
{
  const body = 'アムロジピン5mg 受診にて中止';
  const k = build({ events: [ev('架空 二郎', body)], ledger: [] }).out[0].srcKey;
  const H = 'S|102|2026-10-08|';
  let r = build({ events: [ev('架空 二郎', body)], ledger: [] }, { [k]: { status: '見送り' } });
  t('同じ印で「反映しない」と判断済みなら出さない', all(r).length === 0);
  r = build({ events: [ev('架空 二郎', body)], ledger: [] }, { [k]: { status: '保留', note: '受診結果待ち' } });
  t('同じ印で保留なら出し続ける（保留の理由つき）', all(r).length === 1 && all(r)[0].hold === '受診結果待ち');
  r = build({ events: [ev('架空 二郎', body)], ledger: [] }, { [H + 'aaaaaaaa']: { status: '見送り' } });
  t('★以前の要約の印で「反映しない」と判断した日は、隠さずに印（daySkip・理由つき）を付けて出す', all(r).length === 1 && all(r)[0].daySkip === '理由なし' && all(r)[0].sameDay === '', all(r)[0]);
  r = build({ events: [ev('架空 二郎', body)], ledger: [] }, { [H + 'bbbbbbbb']: { status: '保留' } });
  t('★以前の要約の印で保留中の日は、印（dayHold）を付けて出す', all(r).length === 1 && all(r)[0].dayHold === '保留' && all(r)[0].hold === '', all(r)[0]);
  r = build({ events: [ev('架空 二郎', body)], ledger: [] }, { [H + 'cccccccc']: { status: '反映', decidedAt: '2026-10-08 15:00' } });
  t('★同じ日に反映済みなら sameDay（⛔ の印とサーバーの止め）', all(r).length === 1 && all(r)[0].sameDay === '2026-10-08 15:00');
  r = build({ events: [ev('架空 二郎', body)], ledger: [] }, { ['S|101|2026-10-08|dddddddd']: { status: '見送り' } });
  t('ほかの方の判断は印にしない', all(r).length === 1 && !all(r)[0].daySkip);
}

console.log('\n— F. 名前・事業所・在籍 —');
{
  const r = build({
    events: [
      ev('架空 三郎', 'アムロジピン5mg 中止'),                       /* 名簿にいない */
      ev('試験 退子', 'アムロジピン5mg 中止'),                       /* 退去者 */
      ev('架空 一郎', 'アムロジピン5mg 中止', { facility: 'デイ' }),  /* デイ */
      ev('架空 三郎', '散歩 30分'),                                   /* 名簿にいない・薬の行でない */
      ev('仮名 花子様', '降圧薬 中止')                                /* 敬称つき */
    ], ledger: []
  });
  const A = all(r);
  t('★名簿の在籍者1名に合わない薬の行は候補にせず、数だけ数える（名簿にいない・退去者の2件）', r.st.unmatched === 2, r.st.unmatched);
  t('デイの行は候補にしない', !A.some(c => c.id === '101'));
  t('敬称つきの名前も結ぶ', A.length === 1 && A[0].id === '103', A.map(c => c.id));
}

console.log('\n— G. 画面の表示と AI へ渡す記録 —');
{
  const work = cut('mcWorkHtml_'), paint = cut('mcPaintModal_'), item = cut('mcItemHtml_'), ai = cut('mcAiRun_');
  t('★候補の中身で、要約は参考として「他の方の内容が混ざることがあります」と添える', /AI 要約（参考・他の方の内容が混ざることがあります）/.test(work));
  t('★候補の中身の先頭は、この候補の原文の行', work.indexOf('この候補の原文') >= 0 && work.indexOf('この候補の原文') < work.indexOf('AI 要約'));
  t('要約は候補の本文（c.text）ではなく c.sums から出す', /c\.sums/.test(work) && !/mc-sum">'\+esc\(c\.text\)/.test(work));
  t('★要約にだけある記録の件数を一覧に出す', /mcSt\.sumOnly/.test(paint) && /他の方の内容が混ざることがある/.test(paint));
  t('一覧に同じ日の判断の印（反映しない・保留）を出す', /c\.daySkip/.test(item) && /c\.dayHold/.test(item));
  t('AI へは候補の行と、同じ日のほかの薬の行を渡す（同じ行を二重に送らない）', /String\(e\.body\)!==cur\.c\.text/.test(ai));
}

console.log('\n— H. 反証レビュー（10/10）の場面 —');
{
  /* a: 要約は一郎さんに付き、中身は二郎さんの「アムロジピン 中止」（薬の語・用量なし）。一郎さんには内服済みの行がある */
  const r = build({
    events: [ev('架空 二郎', 'アムロジピン 中止'), ev('架空 一郎', '眠前薬 内服済み')],
    ledger: [lg('架空 一郎', '二郎さんのアムロジピン中止')]
  });
  const A = all(r);
  t('★要約が別の方に付いていても、本当の方（二郎さん）の「アムロジピン 中止」を候補にする', A.some(c => c.id === '102' && c.text === 'アムロジピン 中止') && r.out.some(c => c.id === '102'), A.map(c => [c.id, c.text]));
  t('★決まった服薬の記録（眠前薬 内服済み）は候補にしない', !A.some(c => c.text === '眠前薬 内服済み'));
  t('★一郎さんに付いた要約は、一郎さんに変更らしい行が無いので件数に数える（内服済みの行で消えない）', r.st.sumOnly === 1, r.st.sumOnly);
}
{
  /* b: 「剤」・用量の書き方 */
  const rows = ['利尿剤 増量', '眠剤 中止', '降圧剤 変更となる', '坐剤 中止', '1T→0.5Tへ'];
  const r = build({ events: rows.map(b => ev('架空 一郎', b)), ledger: [] });
  t('★「剤」と用量の書き方の行を、要約が無くても候補にする（5行とも上の一覧）', rows.every(b => r.out.some(c => c.text === b)), all(r).map(c => c.text));
}
{
  /* c: 変更の語の言い回し（手がかりあり） */
  const rows = ['アムロジピン 朝だけに', 'ワーファリン 飲まなくてよいとのこと', 'ロキソニン 終わり'];
  const r = build({ events: rows.map(b => ev('架空 一郎', b)).concat([ev('架空 一郎', '昼食後 服薬介助')]), ledger: [lg('架空 二郎', '服薬の変更')] });
  t('★「〜だけに」「飲まなくてよい」「終わり」を、手がかりがある日は候補にする', rows.every(b => all(r).some(c => c.text === b)), all(r).map(c => c.text));
  t('服薬介助の行は候補にしない', !all(r).some(c => c.text === '昼食後 服薬介助'));
}
{
  /* 保留の日の行は、変更らしくない本文でも上の一覧に出し、まとめて片付けで選べない */
  const H = 'S|101|2026-10-08|';
  const r = build({ events: [ev('架空 一郎', '眠前薬 Dr確認待ち')], ledger: [] }, { [H + 'eeeeeeee']: { status: '保留', note: '受診結果待ち' } });
  t('★以前の印で保留中の日の行は、変更らしくない本文でも上の一覧に出す（理由つき）', r.out.length === 1 && r.out[0].dayHold === '受診結果待ち', [r.out.length, r.others.length]);
  const sb2 = { mcSt: { unsure: {} } }; vm.createContext(sb2); vm.runInContext(cut('mcBulkable_'), sb2);
  t('★保留中の日の行は、まとめて片付けで選べない', sb2.mcBulkable_({ dayHold: '受診結果待ち' }) === false && sb2.mcBulkable_({}) === true);
  t('まとめて片付けの画面にも、反映済み・反映しないの日の印を出す', /c\.sameDay/.test(cut('mcBulkHtml_')) && /c\.daySkip/.test(cut('mcBulkHtml_')));
  const r2 = build({ events: [ev('架空 一郎', 'アムロジピン5mg 中止')], ledger: [] }, { [H + 'ffffffff']: { status: '見送り', note: '既に反映済み' } });
  t('以前「反映しない」とした理由を印に出す', all(r2)[0].daySkip === '既に反映済み');
}
{
  /* 拾いすぎ・数えすぎ */
  const r = build({
    events: [ev('架空 一郎', '夜間の施錠を開始'), ev('架空 一郎', '玄関施錠確認済'), ev('架空 一郎', 'シャワー浴 中止'), ev('架空 一郎', 'デイサービス 利用中止'),
             ev('', '降圧薬の在庫 発注済み'), ev('架空 一郎', '入浴剤 変更')],
    ledger: [lg('架空 一郎', '服薬の記録')]
  });
  t('★施錠・入浴剤・シャワー浴中止・デイサービス利用中止は、手がかりがある日でも候補にしない', all(r).length === 0, all(r).map(c => c.text));
  t('★名前の空の行は「名前が合わない記録」に数えない（別に数える）', r.st.unmatched === 0 && r.st.noName === 1, [r.st.unmatched, r.st.noName]);
}
{
  /* AI へ渡す・突き合わせる「薬の行」は、候補と同じ規則 */
  const sbx = build({ events: [ev('架空 一郎', 'ラシックス 追加'), ev('架空 一郎', '散歩 30分'), ev('架空 一郎', '入浴中止（微熱のため）'), ev('架空 一郎', '降圧薬 夕を中止')],
    ledger: [lg('架空 二郎', '服薬の変更')] });
  const c = all(sbx).find(x => x.text === '降圧薬 夕を中止');
  vm.runInContext(cut('mcRaw_') + '\n' + cut('mcRawMed_'), sbx.sb);
  const meds = sbx.sb.mcRawMed_(c).map(e => e.body);
  t('★AI へ渡す薬の行に「散歩」「入浴中止」を入れない', meds.indexOf('散歩 30分') < 0 && meds.indexOf('入浴中止（微熱のため）') < 0, meds);
  t('★手がかりで候補になった行（ラシックス 追加）は、AI へ渡す薬の行に入る', meds.indexOf('ラシックス 追加') >= 0, meds);
}

console.log('\n— I. 反証レビュー2回目（10/10）の場面 —');
{
  /* 1: 漢方・カタカナ薬名・g 表記（手がかりなし） */
  const rows = ['抑肝散 中止', '五苓散 開始', '大建中湯 中止', '麻子仁丸 中止', 'モビコール 中止', 'カマ 0.5gへ減量'];
  const r = build({ events: rows.map(b => ev('架空 一郎', b)), ledger: [] });
  t('★漢方（〜散・〜湯・〜丸）・カタカナ薬名＋中止・0.5g の行を、要約が無くても候補にする（上の一覧）', rows.every(b => r.out.some(c => c.text === b)), all(r).map(c => c.text));
  const r2 = build({ events: [ev('架空 一郎', 'ラコール 1日2回へ変更')], ledger: [lg('架空 二郎', '栄養剤の変更')] });
  t('カタカナ薬名＋弱い変更の語は、手がかりがある日は候補にする（ラコール）', all(r2).length === 1);
  const r3 = build({ events: [ev('架空 一郎', '朝食後 散歩 30分'), ev('架空 一郎', 'お湯で清拭')], ledger: [] });
  t('「散歩」「お湯」は候補にしない', all(r3).length === 0, all(r3).map(c => c.text));
}
{
  /* 1: モビコール と 服薬介助 終了 が同じ日 */
  const r = build({ events: [ev('架空 一郎', 'モビコール 中止'), ev('架空 一郎', '服薬介助 終了')], ledger: [lg('架空 一郎', '下剤の中止')] });
  t('★「モビコール 中止」は「服薬介助 終了」と同じ日でも候補になる', r.out.some(c => c.text === 'モビコール 中止'), all(r).map(c => c.text));
  t('★「服薬介助 終了」（決まった服薬の記録）は上の一覧に出さない', !r.out.some(c => c.text === '服薬介助 終了'));
  const r2 = build({ events: [ev('架空 一郎', '眠前薬 今日だけに')], ledger: [lg('架空 一郎', '二郎さんの薬の中止')] });
  t('★「今日だけに」は変更らしくない（下の一覧）。その方に変更らしい行が無いので要約の分を件数に数える', r2.others.length === 1 && r2.out.length === 0 && r2.st.sumOnly === 1, [r2.out.length, r2.others.length, r2.st.sumOnly]);
}
{
  /* 2: 原文の行の印での判断を、同じ日のほかの行に重ねない */
  const b1 = '降圧薬 夕を中止', b2 = 'アムロジピン5mg 中止', b3 = '眠前薬 本日抜薬';
  const evs = [ev('架空 一郎', b1), ev('架空 一郎', b2), ev('架空 一郎', b3)];
  const k1 = build({ events: evs, ledger: [] }).out.find(c => c.text === b1).srcKey;
  let r = build({ events: evs, ledger: [] }, { [k1]: { status: '見送り', note: '定期薬の変更ではない' } });
  const c2 = all(r).find(c => c.text === b2);
  t('★原文の行の印で「反映しない」とした判断を、同じ日の別の行に印として重ねない', c2 && !c2.daySkip, c2);
  r = build({ events: evs, ledger: [] }, { [k1]: { status: '保留', note: '確認中' } });
  const c3 = all(r).find(c => c.text === b3);
  t('★原文の行の印で保留にしても、同じ日の別の行（その日だけ）は下の一覧のまま', c3 && c3.low === true && !c3.dayHold, c3);
  r = build({ events: evs, ledger: [] }, { [k1]: { status: '反映', decidedAt: '2026-10-09 09:00' } });
  t('反映は原文の行の印でも同じ日の印（sameDay）にする（二重反映の止め）', all(r).every(c => c.sameDay === '2026-10-09 09:00'));
}
{
  /* 3: バイタルの行 */
  const r = build({ events: [ev('架空 一郎', 'BP 128/76 P 68 T 36.5'), ev('架空 一郎', 'KT 37.2 SpO2 96%'), ev('架空 一郎', '降圧薬 夕を中止')], ledger: [lg('架空 一郎', '服薬')] });
  t('★バイタルの行（T 36.5 など）は薬の行にしない', !all(r).some(c => /BP|KT/.test(c.text)), all(r).map(c => c.text));
  const c = all(r).find(x => x.text === '降圧薬 夕を中止');
  vm.runInContext(cut('mcRaw_') + '\n' + cut('mcRawMed_'), r.sb);
  const meds = r.sb.mcRawMed_(c).map(e => e.body);
  t('★バイタルの行は AI へ渡す薬の行に入れない', meds.length === 1 && meds[0] === '降圧薬 夕を中止', meds);
  const r2 = build({ events: [ev('架空 一郎', '1T→0.5Tへ')], ledger: [] });
  t('（用量の T は今までどおり見分ける）', r2.out.length === 1);
}
{
  /* 4: その日だけ・拒薬・残薬・下剤の追加は下の一覧 */
  const rows = ['薬が明日で終わり 薬局へ依頼', '薬を飲まなくて困っている', '下剤 追加', '下剤 1包 追加'];
  const r = build({ events: rows.map(b => ev('架空 一郎', b)), ledger: [] });
  t('★残薬・拒薬・下剤の追加は、消さずに下の一覧へ', rows.every(b => r.others.some(c => c.text === b)) && r.out.length === 0, [r.out.map(c => c.text), r.others.map(c => c.text)]);
  const r2 = build({ events: [ev('架空 一郎', 'ソフト食に変更'), ev('架空 一郎', 'ミキサー食へ変更'), ev('架空 一郎', 'テープ止めオムツへ変更'), ev('架空 一郎', '〇〇クリニック 受診日 変更')], ledger: [lg('架空 一郎', '服薬')] });
  t('★食事形態・オムツ・受診日の変更は、手がかりがある日でも候補にしない', all(r2).length === 0, all(r2).map(c => c.text));
}
{
  /* 5・6: 決まった服薬の記録に変更が続く行・名前の欄が空の行 */
  const r = build({ events: [ev('架空 一郎', '内服済み。明日からワーファリン1mgになる')], ledger: [] });
  t('★「内服済み」に続けて用量のある変更が書かれた行は、消さずに候補にする', all(r).length === 1, all(r).map(c => c.text));
  const r2 = build({ events: [ev('', '【架空様】降圧薬 中止'), ev('', '業務連絡：薬の在庫を発注')], ledger: [] });
  t('★名前の欄が空の薬の行は、「名前が合わない」とは別に数える（候補にはしない）', r2.st.noName === 2 && r2.st.unmatched === 0 && all(r2).length === 0, [r2.st.noName, r2.st.unmatched]);
  t('名前の欄が空の行の件数を一覧に出す', /mcSt\.noName/.test(cut('mcPaintModal_')));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
