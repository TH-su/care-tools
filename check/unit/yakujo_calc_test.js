/* 薬情の取り込み（yakujo-calc.js）の純関数の試験（2026-10-22）
   実行: node check/unit/yakujo_calc_test.js（環境変数 YAKUJO_CALC で別の版を当てられる）
   架空データのみ。実在の入居者・処方は登場しない（薬価基準の品目だけは公開の一覧 meds-yakka-naiyo.js を読む）。
   守りたいこと:
     1. 振り分けは「名簿の1人にだけ一字一致」の時だけ。カナがある書類は氏名とカナが同じ1人に一致した時だけ。
        カナの無い書類は、その方と同姓同名・1字違いの在籍者がいない時だけ（代表者の決定 2026-10-22）
     2. 調剤日は西暦の YYYY-MM-DD にそろえる（朝回診の道具が印の形を確かめるため）。生年月日は拾わない
     3. 1日量・1回量・時点・日数・頓用を取り違えない。決めきれない所は確かめる印（warn）を付ける
     4. 名前は今の定期薬 → 施設で使っている名前 → 薬価基準の順に一字一致を見る。近いだけでは決めない
     5. 書き方だけが違う行は今の行のまま。並び順を保ち、中止は除き、追加は末尾
     6. 判断の印は S|利用者No|YYYY-MM-DD|小文字16進8桁 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const Y = require(process.env.YAKUJO_CALC || path.join(ROOT, 'yakujo-calc.js'));
const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'meds-yakka-naiyo.js'), 'utf8'), sb);
const ITEMS = sb.window.MedsYakka.items;
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

/* 架空の結果のファイルを作る。lines は [文字, x, y] の並び（高さは 0.02） */
const L = (t, x, y, w) => ({ t, x, y, w: w || 0.3, h: 0.02, c: 1 });
const doc = (pages) => ({ kind: 'yakujo-yomitori', v: 1, createdAt: '2026-10-22T10:00:00+09:00',
  docs: [{ no: 1, file: '架空.jpg', type: 'photo', error: '', pages: pages.map((ls, i) => ({ no: i + 1, w: 1000, h: 1400, img: '', lines: ls, codes: { qr: 0, other: 0 } })) }], skipped: [] });
const one = (pages) => Y.parseResult(doc(pages)).docs[0];
const R = [
  { id: '11', name: '架空 太郎', kana: 'カクウ タロウ', active: true },
  { id: '12', name: '見本 花子', kana: 'ミホン ハナコ', active: true },
  { id: '13', name: '試験 次郎', kana: 'シケン ジロウ', active: false },
];

console.log('\n— 1. 結果のファイルを読む —');
{
  t('JSON でなければ断る', Y.parseResult('{').ok === false);
  t('薬情よみとりの結果でなければ断る', Y.parseResult({ kind: 'other', v: 1, docs: [] }).ok === false);
  t('版が違えば断る', Y.parseResult({ kind: 'yakujo-yomitori', v: 2, docs: [] }).ok === false);
  const d = { kind: 'yakujo-yomitori', v: 1, docs: [{ file: 'a', type: 'photo', pages: [{ w: 10, h: 10, img: 'data:image/png;base64,AAAA', lines: [{ t: ' ＡＢＣ\n', x: 2, y: -1 }], codes: {} }] }], skipped: [] };
  const r = Y.parseResult(JSON.stringify(d));
  t('JPEG 以外の画像は捨てる', r.ok && r.docs[0].pages[0].img === '');
  t('文字は NFKC にそろえ、改行を除く', r.docs[0].pages[0].lines[0].t === 'ABC', r.docs[0].pages[0].lines[0]);
  t('位置は 0〜1 に収める', r.docs[0].pages[0].lines[0].x === 1 && r.docs[0].pages[0].lines[0].y === 0);
  const many = { kind: 'yakujo-yomitori', v: 1, docs: Array.from({ length: 25 }, () => ({ pages: [] })), skipped: [] };
  t('書類は20件まで', Y.parseResult(many).docs.length === 20);
}

console.log('\n— 2. 振り分け —');
{
  const a1 = Y.assign(one([[L('架空 太郎 様', 0.1, 0.1), L('カクウ タロウ', 0.1, 0.13)]]), R);
  t('氏名とカナが同じ1人に一致すれば振り分ける', a1.id === '11' && a1.how === '氏名とカナが一致', a1);
  const a2 = Y.assign(one([[L('架空太郎様', 0.1, 0.1), L('調剤日 2026年10月18日', 0.5, 0.1)]]), R);
  t('カナの無い書類は、氏名が1人に一致し、似た名前の方がいなければ振り分ける', a2.id === '11' && /カナなし/.test(a2.how), a2);
  const R2 = R.concat([{ id: '14', name: '架空 太朗', kana: 'カクウ タロウ', active: true }]);
  const a3 = Y.assign(one([[L('架空 太郎 様', 0.1, 0.1)]]), R2);
  t('★1字違いの在籍者がいれば、カナの無い書類は振り分けない', a3.id === '' && /1字違い/.test(a3.why), a3);
  const a3b = Y.assign(one([[L('架空 太郎 様', 0.1, 0.1), L('カクウ タロウ', 0.1, 0.13)]]), R2);
  t('★カナが2人に当たる時は振り分けない', a3b.id === '', a3b);
  const a4 = Y.assign(one([[L('架空 太郎 様', 0.1, 0.1), L('見本 花子 様', 0.1, 0.5)]]), R);
  t('★2人の氏名があれば振り分けない', a4.id === '' && a4.cands.length === 2, a4);
  const a5 = Y.assign(one([[L('架空 太郎 様', 0.1, 0.1)], [L('見本 花子 様', 0.1, 0.1)]]), R);
  t('★ページごとに氏名が違えば振り分けない', a5.id === '', a5);
  const a6 = Y.assign(one([[L('架空 太郎 様', 0.1, 0.1), L('ミホン ハナコ', 0.1, 0.13)]]), R);
  t('★氏名とカナが別の方なら振り分けない', a6.id === '', a6);
  const a7 = Y.assign(one([[L('架空 太郎 様', 0.1, 0.1), L('ベツノ カナデス', 0.1, 0.13)]]), R);
  t('★カナがあるのに一致しなければ振り分けない', a7.id === '' && /カナ/.test(a7.why), a7);
  const a8 = Y.assign(one([[L('試験 次郎 様', 0.1, 0.1)]]), R);
  t('退去の方には振り分けない', a8.id === '', a8);
  const a9 = Y.assign(one([[L('架空 大郎 様', 0.1, 0.1)]]), R);
  t('★読み違い（1字違い）は振り分けず、似た名前の候補として出す', a9.id === '' && a9.cands.some(c => c.id === '11' && c.how === '似た名前'), a9);
}

console.log('\n— 3. 調剤日 —');
{
  const d1 = Y.findDates(one([[L('調剤日：2026年10月18日', 0.1, 0.1), L('生年月日 2001年1月2日', 0.1, 0.2)]]));
  t('「調剤日」の日付を西暦の YYYY-MM-DD で拾い、生年月日は拾わない', d1.labeled.join() === '2026-10-18' && d1.other.length === 0, d1);
  t('令和の書き方', Y.datesIn('令和8年10月18日').join() === '2026-10-18');
  t('R8.10.18 の書き方', Y.datesIn('R8.10.18').join() === '2026-10-18');
  t('2026/10/18 の書き方', Y.datesIn('2026/10/18').join() === '2026-10-18');
  t('ありえない日付は拾わない', Y.datesIn('2026年2月30日').length === 0);
  const d2 = Y.findDates(one([[L('調剤日', 0.1, 0.1), L('2026年10月18日', 0.1, 0.12), L('処方日 2026年10月4日', 0.1, 0.3)]]));
  t('語の次の行の日付も拾う・2つあれば2つ返す（画面が選ばせる）', d2.labeled.join() === '2026-10-04,2026-10-18', d2);
  const d3 = Y.findDates(one([[L('2026年10月18日', 0.1, 0.1)]]));
  t('語の無い日付は other に分ける', d3.labeled.length === 0 && d3.other.join() === '2026-10-18', d3);
}

console.log('\n— 4. 用量・用法 —');
{
  const u1 = Y.parseUse('1回1錠 1日3回 毎食後 14日分', '');
  t('1回量・回数・時点・日数', u1.per === 'dose' && u1.amount === 1 && u1.unit === '錠' && u1.times === 3 && u1.slots.join() === '朝,昼,夕' && u1.meal === '食後' && u1.days === 14, u1);
  const u2 = Y.parseUse('2錠 1日2回 朝夕食後', 'day');
  t('見出しが1日量なら、裸の量は1日量', u2.per === 'day' && u2.amount === 2 && u2.slots.join() === '朝,夕', u2);
  const u3 = Y.parseUse('1日1回 朝食後', '');
  t('★「1日1回」を量と取り違えない', u3.amount === 0 && u3.times === 1, u3);
  t('就寝前', Y.parseUse('1錠 就寝前', 'day').slots.join() === '眠前');
  t('頓用', Y.parseUse('1錠 疼痛時 頓用 10回分', '').prn === true);
  t('起床時は毎日の時点として組まない（extra）', Y.parseUse('1錠 起床時', 'day').extra.length === 1);
  t('隔日は extra', Y.parseUse('1錠 隔日 朝食後', 'day').extra.length === 1);
}

console.log('\n— 5. 薬の行を組み立てる —');
{
  /* 表の形（見出しが1日量・名前の右に量と用法）。1行目は番号つき */
  const d = one([[
    L('お薬の名前', 0.1, 0.10), L('1日量', 0.5, 0.10), L('用法', 0.6, 0.10),
    L('1.架空錠A5mg「見本」', 0.1, 0.15), L('2錠', 0.5, 0.15), L('1日2回朝夕食後 14日分', 0.6, 0.15),
    L('2.架空カプセルB', 0.1, 0.20), L('1カプセル', 0.5, 0.20), L('1日1回就寝前 14日分', 0.6, 0.20),
    L('架空散C', 0.1, 0.25), L('3包', 0.5, 0.25), L('1日3回毎食後 5日分', 0.6, 0.25),
  ]]);
  const rows = Y.parseRows(d);
  t('3剤を拾い、番号を外す', rows.length === 3 && rows[0].raw === '架空錠A5mg「見本」' && rows[1].raw === '架空カプセルB', rows.map(r => r.raw));
  t('同じ並びの量・用法を読む', rows[0].use.amount === 2 && rows[0].use.per === 'day' && rows[0].use.slots.join() === '朝,夕', rows[0].use);
  const sd = Y.shortDays(rows);
  t('日数が短い行に印', sd.join() === 'false,false,true', sd);
  /* Rp ごとに用法が上に1行ある形 */
  const d2 = one([[
    L('Rp1 1日1回 朝食後 14日分', 0.1, 0.10, 0.6),
    L('架空錠D10mg', 0.1, 0.13), L('1錠', 0.6, 0.13),
    L('架空錠E2mg', 0.1, 0.16), L('2錠', 0.6, 0.16),
    L('Rp2 1日2回 朝夕食後 14日分', 0.1, 0.22, 0.6),
    L('架空錠F', 0.1, 0.25), L('2錠', 0.6, 0.25),
  ]]);
  const r2 = Y.parseRows(d2, {});
  t('上に書かれた Rp の用法を、その組の薬に当てる', r2.length === 3 && r2[0].use.slots.join() === '朝' && r2[1].use.slots.join() === '朝' && r2[2].use.slots.join() === '朝,夕',
    r2.map(r => r.use.slots.join('')));
  t('自分の行の量は自分のもの', r2[1].use.amount === 2 && r2[2].use.amount === 2, r2.map(r => r.use.amount));
}

console.log('\n— 6. 名前を確かめる —');
{
  const cur = ['架空錠A5mg「見本」 2錠分2 朝夕食後'];
  const s1 = Y.snap('架空錠A5mg「見本」', { current: cur, used: [], items: ITEMS });
  t('今の定期薬の名前と一字一致', s1.source === 'current' && s1.name === '架空錠A5mg' && s1.maker === '見本', s1);
  const s2 = Y.snap('架空錠G1mg', { current: [], used: ['架空錠G1mg 1錠分1 朝食後'], items: ITEMS });
  t('施設で使っている名前と一字一致', s2.source === 'used', s2);
  const s3 = Y.snap('マグミット錠250mg', { current: [], used: [], items: ITEMS });
  t('薬価基準と一字一致', s3.source === 'yakka' && s3.name === 'マグミット錠250mg', s3);
  const s4 = Y.snap('マグミツト錠250mg', { current: [], used: [], items: ITEMS });
  t('★近いだけでは決めない（候補は出す）', s4.source === '' && s4.near.indexOf('マグミット錠250mg') >= 0, s4);
  const s5 = Y.snap('架空錠A5mg「見木」', { current: cur, used: [], items: ITEMS });
  t('★屋号が違えば今の定期薬とは一致にしない', s5.source !== 'current', s5);
}

console.log('\n— 7. 1剤1行の材料と確かめる印 —');
{
  const d = one([[L('1日量', 0.5, 0.05), L('架空錠A5mg', 0.1, 0.1), L('3錠', 0.5, 0.1), L('1日2回 朝夕食後', 0.6, 0.1)]]);
  const r = Y.parseRows(d)[0];
  const ls = Y.lineSpec(r, { source: 'current', name: '架空錠A5mg', maker: '', makerOk: true, near: [] });
  t('1日量 ÷ 時点の数 ＝ 1回量', ls.spec.dose === 1.5 && ls.spec.slots.join() === '朝,夕' && ls.spec.meal === '食後', ls.spec);
  const dp = one([[L('架空錠H', 0.1, 0.1), L('1錠 疼痛時 頓用', 0.5, 0.1)]]);
  const lp = Y.lineSpec(Y.parseRows(dp)[0], { source: 'used', name: '架空錠H', maker: '', makerOk: true, near: [] });
  t('★頓服は既定で入れない（skip）・印あり', lp.skip === true && lp.warn.some(w => /頓服/.test(w)), lp);
  const dt = one([[L('架空テープI', 0.1, 0.1), L('1日1回 1枚 貼付', 0.5, 0.1)]]);
  const lt = Y.lineSpec(Y.parseRows(dt)[0], { source: 'used', name: '架空テープI', maker: '', makerOk: true, near: [] });
  t('★外用は既定で入れない（skip）・印あり', lt.skip === true && lt.warn.some(w => /外用/.test(w)), lt);
  const dn = one([[L('架空錠J', 0.1, 0.1)]]);
  const ln = Y.lineSpec(Y.parseRows(dn)[0], { source: '', near: [] });
  t('★名前も用法も読めなければ印が2つ', ln.warn.length >= 2, ln.warn);
  const dm = one([[L('架空錠K', 0.1, 0.1), L('2錠 1日3回 朝夕食後', 0.5, 0.1)]]);
  const lm = Y.lineSpec(Y.parseRows(dm)[0], { source: 'used', name: '架空錠K', maker: '', makerOk: true, near: [] });
  t('★「1日3回」と時点の数（2）が合わなければ印', lm.warn.some(w => /合いません/.test(w)), lm.warn);
}

console.log('\n— 8. 今の定期薬との対応と、反映する全文 —');
{
  const cur = '架空錠A5mg 2錠分2 朝夕食後\n架空カプセルB 1カプセル分1 就寝前\n架空錠Z 1錠分1 朝食後';
  const spec = (name, slots, dose, unit, meal) => ({ name, maker: '', slots, dose, unit, meal, free: '' });
  const m = Y.matchCurrent([
    { line: '架空錠A5mg 2錠分2 朝夕食後', spec: spec('架空錠A5mg', ['朝', '夕'], 1, '錠', '食後') },
    { line: '架空カプセルB 2カプセル分1 就寝前', spec: spec('架空カプセルB', ['眠前'], 2, 'カプセル', '') },
    { line: '架空錠N 1錠分1 夕食後', spec: spec('架空錠N', ['夕'], 1, '錠', '食後') },
  ], cur);
  t('同じ行は same・量が違えば change・今に無ければ add', m.pairs.map(p => p.kind).join() === 'same,change,add', m.pairs.map(p => p.kind));
  t('書類に無い今の行は left（➖ の候補）', m.left.join() === '架空錠Z 1錠分1 朝食後', m.left);
  const m2 = Y.matchCurrent([{ line: '架空錠A5mg 2錠分2 朝夕食後', spec: spec('架空錠A5mg', ['朝', '夕'], 1, '錠', '食後') }],
    '架空錠A5mg 1回1錠 1日2回 朝夕食後');
  t('書き方だけが違う行は今の行のまま（same・meaning）', m2.pairs[0].kind === 'same' && m2.pairs[0].how === 'meaning', m2.pairs[0]);
  const after = Y.buildAfter(cur, { change: [{ from: '架空カプセルB 1カプセル分1 就寝前', to: '架空カプセルB 2カプセル分1 就寝前' }], stop: ['架空錠Z 1錠分1 朝食後'], add: ['架空錠N 1錠分1 夕食後'] });
  t('並び順を保ち、変える・中止・追加を当てる', after === '架空錠A5mg 2錠分2 朝夕食後\n架空カプセルB 2カプセル分1 就寝前\n架空錠N 1錠分1 夕食後', after);
}

console.log('\n— 8b. 確認表の行と「反映する」を止める規則（設計書 §4-3）—');
{
  const cur = '架空錠A5mg 2錠分2 朝夕食後\n架空錠Z 1錠分1 朝食後';
  const spec = (name, slots, dose, unit, meal) => ({ name, maker: '', slots, dose, unit, meal, free: '' });
  const m = Y.matchCurrent([
    { line: '架空錠A5mg 4錠分2 朝夕食後', spec: spec('架空錠A5mg', ['朝', '夕'], 2, '錠', '食後'), raw: '架空錠A5mg' },
    { line: '架空錠N 1錠分1 夕食後', spec: spec('架空錠N', ['夕'], 1, '錠', '食後'), raw: '架空錠N' },
    { line: '架空錠H 頓用', spec: { name: '架空錠H', free: '頓用' }, raw: '架空錠H' },
  ], cur);
  const specs = [{ warn: [], skip: false, spec: spec('架空錠A5mg', ['朝', '夕'], 2, '錠', '食後') },
    { warn: ['薬の名前が一字一致しません'], skip: false, spec: spec('架空錠N', ['夕'], 1, '錠', '食後') },
    { warn: ['頓服の書き方です'], skip: true, spec: { free: '頓用' } }];
  const rows = Y.buildRows(m.pairs, m.left, specs, {});
  t('既定: 変える・足す・頓服は足さない・書類に無い今の行は決めていない', rows.map(r => r.kind + ':' + r.action).join() === 'change:change,add:add,add:skip,left:', rows.map(r => r.kind + ':' + r.action));
  const base = () => ({ id: '11', dates: { labeled: ['2026-10-18'], other: [] }, date: '2026-10-18', identity: true, server: 'ok',
    rows: JSON.parse(JSON.stringify(rows)), current: cur, lastChange: '2026-10-01', oldChecked: false, sameDay: '', ack: false });
  const ok = st => { st.rows[1].checked = true; st.rows[3].action = 'keep'; return st; };
  const j0 = Y.judge(ok(base()));
  t('全部そろえば反映できる', j0.stop === '' && j0.after === '架空錠A5mg 4錠分2 朝夕食後\n架空錠Z 1錠分1 朝食後\n架空錠N 1錠分1 夕食後', j0);
  const stopIf = (name, mut, re) => { const st = ok(base()); mut(st); const j = Y.judge(st); t('★' + name, !!j.stop && re.test(j.stop), j.stop); };
  stopIf('振り分け先が無ければ止める', st => { st.id = ''; }, /振り分け先/);
  stopIf('GAS が古ければ止める', st => { st.server = 'old'; }, /貼り替え/);
  stopIf('GAS に届かなければ止める', st => { st.server = 'ng'; }, /届きません/);
  stopIf('調剤日が読めなければ止める', st => { st.dates = { labeled: [], other: [] }; st.date = ''; }, /調剤日を読めません/);
  stopIf('調剤日が2つ以上で選んでいなければ止める', st => { st.dates = { labeled: ['2026-10-04', '2026-10-18'], other: [] }; st.date = ''; }, /2つ以上/);
  stopIf('調剤日の形が違えば止める', st => { st.date = 'R081018'; }, /形/);
  stopIf('本人の照合の印が無ければ止める', st => { st.identity = false; }, /この方の書類/);
  stopIf('書類に無い今の行を決めていなければ止める', st => { st.rows[3].action = ''; }, /残す」か「中止/);
  stopIf('⚠ の行を確かめていなければ止める', st => { st.rows[1].checked = false; }, /⚠ の行が 1 行/);
  stopIf('頓服を「足す」に変えたら、確かめるまで止める', st => { st.rows[2].action = 'add'; }, /⚠ の行が 1 行/);
  stopIf('調剤日が最後の変更より前なら、確かめるまで止める', st => { st.lastChange = '2026-10-20'; }, /最後の変更/);
  stopIf('同じ調剤日に反映済みなら、確かめるまで止める', st => { st.sameDay = '2026-10-18T10:00:00Z'; }, /既に反映/);
  stopIf('変更が無ければ止める', st => { st.rows.forEach(r => { if (r.kind !== 'left') r.action = r.kind === 'add' ? 'skip' : 'keep'; }); }, /変更はありません/);
  stopIf('全部中止で空になるなら止める', st => { st.rows = [{ kind: 'left', cur: '架空錠A5mg 2錠分2 朝夕食後', action: 'stop', warns: [] }, { kind: 'left', cur: '架空錠Z 1錠分1 朝食後', action: 'stop', warns: [] }]; }, /空/);
  stopIf('「（不明）」が残れば止める', st => { st.rows[1].line = '架空錠N（不明）'; }, /不明/);
  stopIf('同じ行が2つになるなら止める', st => { st.rows[1].line = '架空錠Z 1錠分1 朝食後'; }, /同じ行が2つ/);
  const j2 = Y.judge(Object.assign(ok(base()), { lastChange: '2026-10-20', oldChecked: true }));
  t('古い書類も、確かめた印があれば反映できる', j2.stop === '', j2.stop);
  const st3 = ok(base()); st3.rows[3].action = 'stop';
  const j3 = Y.judge(st3);
  t('中止を選べば全文から除き、知らせる', j3.stop === '' && !/架空錠Z/.test(j3.after) && j3.notes.some(n => /中止/.test(n)), j3);
}

console.log('\n— 8c. 反証レビュー（2026-10-22）の指摘の再発防止 —');
{
  const R2 = [{ id: '21', name: '森 誠', kana: 'もり まこと', active: true }, { id: '22', name: '林 誠', kana: 'はやし まこと', active: true }];
  const p1 = Y.assign(one([[L('大森 誠 様', 0.1, 0.1), L('オオモリ マコト', 0.1, 0.13)]]), R2);
  t('★名簿に無い「大森 誠」の書類を、名簿の「森 誠」に振り分けない（カナの部分一致も）', p1.id === '', p1);
  const p2 = Y.assign(one([[L('患者 林 誠一 様', 0.1, 0.1)]]), R2);
  t('★名簿に無い「林 誠一」の書類を、名簿の「林 誠」に振り分けない', p2.id === '', p2);
  const p3 = Y.assign(one([[L('氏名架空太郎', 0.1, 0.1)]]), R);
  t('「氏名」などの見出しに続く氏名は一致にする', p3.id === '11', p3);
  /* 用法: 見出しの注意書きの「食後」を Rp の用法の行と取り違えない */
  const d3 = one([[
    L('※お薬は食後に飲んでください', 0.1, 0.10, 0.6),
    L('架空A錠5mg', 0.1, 0.20), L('1回1錠', 0.6, 0.20),
    L('1日1回 朝食後 28日分', 0.1, 0.24, 0.6),
    L('架空B錠10mg', 0.1, 0.30), L('1回1錠', 0.6, 0.30),
    L('1日2回 朝夕食後 28日分', 0.1, 0.34, 0.6),
  ]]);
  const r3 = Y.parseRows(d3);
  t('★注意書きの「食後」を用法の行にしない（A は朝・B は朝夕）', r3.length === 2 && r3[0].use.slots.join() === '朝' && r3[1].use.slots.join() === '朝,夕', r3.map(r => r.use.slots.join('')));
  /* 規格だけ違う薬は「変える」に印 */
  const mS = Y.matchCurrent([{ line: '架空ジピン錠2.5mg 1錠分1 朝食後', spec: { name: '架空ジピン錠2.5mg', maker: '', slots: ['朝'], dose: 1, unit: '錠', meal: '食後', free: '' }, raw: '架空ジピン錠2.5mg' }], '架空ジピン錠5mg 1錠分1 朝食後');
  const rS = Y.buildRows(mS.pairs, mS.left, [{ warn: [], skip: false, spec: { slots: ['朝'], dose: 1 } }], {});
  t('★規格だけ違う「変える」には印を付ける', rS[0].kind === 'change' && rS[0].warns.some(w => /規格/.test(w)), rS[0]);
  /* 対応の付かない「足す」と書類に無い今の行が同時にある時は「足す」に印 */
  const mA = Y.matchCurrent([{ line: '架空ゾール錠10mg 1錠分1 朝食後', spec: { slots: ['朝'], dose: 1 }, raw: '架空ゾール錠10mg' }], '先発架空錠10 1錠分1 朝食後');
  const rA = Y.buildRows(mA.pairs, mA.left, [{ warn: [], skip: false, spec: { slots: ['朝'], dose: 1 } }], {});
  t('★対応の付かない「足す」と書類に無い今の行が同時にあれば「足す」に印', rA[0].kind === 'add' && rA[0].warns.some(w => /書き方違い/.test(w)), rA);
  /* 同じ薬が2行になる時は、確かめた印が無ければ止める */
  const cur2 = '架空錠5mg 1錠分1 朝食後\n架空錠5mg 1錠分1 就寝前';
  const m2 = Y.matchCurrent([{ line: '架空錠5mg 2錠分2 朝食後・就寝前', spec: { name: '架空錠5mg', maker: '', slots: ['朝', '眠前'], dose: 1, unit: '錠', meal: '食後', free: '' }, raw: '架空錠5mg' }], cur2);
  const rows2 = Y.buildRows(m2.pairs, m2.left, [{ warn: [], skip: false, spec: { slots: ['朝', '眠前'], dose: 1 } }], {});
  t('書類に無い今の行が書類の薬と同じ名前なら知らせる', rows2.some(r => r.kind === 'left' && r.warns.some(w => /同じ薬の名前/.test(w))), rows2);
  rows2.forEach(r => { if (r.kind === 'left') r.action = 'keep'; r.checked = true; });
  const st2 = { id: '11', dates: { labeled: ['2026-10-18'], other: [] }, date: '2026-10-18', identity: true, server: 'ok', rows: rows2, current: cur2 };
  const j2 = Y.judge(st2);
  t('★同じ名前の薬が2行になるなら、確かめた印が無ければ止める', /同じ名前の薬が2行/.test(j2.stop), j2.stop);
  t('確かめた印があれば止めない', Y.judge(Object.assign({}, st2, { dupChecked: true })).stop === '');
  /* 調剤日: 次回の予定日を拾わない・空白で数字をつながない・今日より後は止める */
  const dN = Y.findDates(one([[L('2026年10月1日', 0.1, 0.1), L('次回処方予定日 2026年11月5日', 0.1, 0.2)]]));
  t('★「次回処方予定日」の日付は調剤日の候補にしない', dN.labeled.length === 0 && dN.other.join() === '2026-10-01', dN);
  t('★「2026/10/1 1/2」を 2026-10-11 と読まない', Y.datesIn('調剤日 2026/10/1 1/2').join() === '2026-10-01', Y.datesIn('調剤日 2026/10/1 1/2'));
  const jF = Y.judge({ id: '11', dates: { labeled: ['2026-11-05'], other: [] }, date: '2026-11-05', today: '2026-10-22', identity: true, server: 'ok', rows: [], current: 'x' });
  t('★今日より後の調剤日は止める', /今日より後/.test(jF.stop), jF.stop);
  /* 曜日の指定 */
  t('★「月水金」は毎日の書き方にしない（extra）', Y.parseUse('1回1錠 1日1回 朝食後 月水金 28日分', 'day').extra.length === 1);
  t('★「火・金」も同じ', Y.parseUse('1錠 朝食後 火・金', 'day').extra.length === 1);
  t('日付の「10月18日」は曜日の指定と見なさない', Y.parseUse('調剤 10月18日 1錠 朝食後', 'day').extra.length === 0);
  t('★今の行の「月水金」は、書類の毎日の行と同じ意味にしない', Y.sameMeaning('架空錠5mg 1錠分1 朝食後 月水金', { name: '架空錠5mg', maker: '', slots: ['朝'], dose: 1, unit: '錠', meal: '食後', free: '' }) === false);
  /* 屋号を他の方の行から借りない */
  const sm = Y.snap('架空ピン錠5mg', { current: [], used: ['架空ピン錠5mg「見本」 1錠分1 朝食後'], items: [] });
  t('★書類に屋号が無い時、ほかの方の行の屋号を借りない', sm.source === 'used' && sm.maker === '', sm);
  const sc = Y.snap('架空ピン錠5mg', { current: ['架空ピン錠5mg「見本」 1錠分1 朝食後'], used: [], items: [] });
  t('この方の今の行の屋号は引き継ぐ', sc.source === 'current' && sc.maker === '見本', sc);
}

console.log('\n— 8d. 審査（2026-10-22）の指摘の再発防止 —');
{
  const r = Y.parseResult({ kind: 'yakujo-yomitori', v: 1, docs: [{ file: 'a.pdf', type: 'pdf', error: '', note: '12 ページのうち、はじめの 10 ページだけを読みました', pagesTotal: 12,
    pages: [{ no: 1, w: 10, h: 10, img: '', lines: [], error: '' }, { no: 3, w: 0, h: 0, img: '', lines: [], error: 'このページを画像にできませんでした' }] }], skipped: [] });
  t('★PDF の「残りを読んでいない」知らせと元のページ数を捨てない', /10 ページだけ/.test(r.docs[0].note) && r.docs[0].pagesTotal === 12, r.docs[0]);
  t('★読めないページの理由と元のページ番号を捨てない', r.docs[0].pages[1].no === 3 && /画像にできません/.test(r.docs[0].pages[1].error), r.docs[0].pages[1]);
  const cur = '架空錠A 1錠分1 朝食後\n\n架空錠B 1錠分1 夕食後\n';
  t('★今の定期薬の空行・並びを保つ（変える・中止・足す）',
    Y.buildAfter(cur, { change: [{ from: '架空錠A 1錠分1 朝食後', to: '架空錠A 2錠分2 朝夕食後' }], stop: [], add: ['架空錠C 1錠分1 就寝前'] }) ===
    '架空錠A 2錠分2 朝夕食後\n\n架空錠B 1錠分1 夕食後\n架空錠C 1錠分1 就寝前', Y.buildAfter(cur, { change: [{ from: '架空錠A 1錠分1 朝食後', to: '架空錠A 2錠分2 朝夕食後' }], stop: [], add: ['架空錠C 1錠分1 就寝前'] }));
  const st = { id: '11', dates: { labeled: [], other: ['2026-10-18'] }, date: '2026-10-18', today: '2026-10-22', identity: true, server: 'ok',
    rows: [{ kind: 'add', action: 'add', line: '架空錠C 1錠分1 就寝前', warns: [], checked: false }], current: '架空錠A 1錠分1 朝食後' };
  t('★「調剤日」の語の無い日付を選んだら、確かめた印が無ければ止める', /語がありません/.test(Y.judge(st).stop), Y.judge(st).stop);
  t('確かめた印があれば止めない', Y.judge(Object.assign({}, st, { dateChecked: true })).stop === '', Y.judge(Object.assign({}, st, { dateChecked: true })).stop);
}

console.log('\n— 9. 判断の印 —');
{
  const k = Y.srcKey('11', '2026-10-18', '架空錠A5mg 2錠分2 朝夕食後');
  t('★朝回診の道具が受け付ける形（S|利用者No|YYYY-MM-DD|小文字16進8桁）', /^S\|[^|]+\|(\d{4}-\d{2}-\d{2})\|[0-9a-f]{8}$/.test(k), k);
  t('同じ全文なら同じ印・違えば違う印', Y.srcKey('11', '2026-10-18', 'A') === Y.srcKey('11', '2026-10-18', 'A') && Y.srcKey('11', '2026-10-18', 'A') !== Y.srcKey('11', '2026-10-18', 'B'));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
