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
  stopIf('調剤日が読めず、日付も選んでいなければ止める', st => { st.dates = { labeled: [], other: [] }; st.date = ''; }, /調剤日を選んで/);
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

console.log('\n— 8e. 調剤日を読めない書類は、取り込んだ日で止めずに取り込む（代表者の決定 2026-10-22）—');
{
  const rows = () => [{ kind: 'add', action: 'add', line: '架空錠C 1錠分1 就寝前', warns: [], checked: false }];
  const st = (dates, date, extra) => Object.assign({ id: '11', dates, date, today: '2026-10-22', identity: true, server: 'ok',
    rows: rows(), current: '架空錠A 1錠分1 朝食後', lastChange: '2026-10-01' }, extra || {});
  const j1 = Y.judge(st({ labeled: [], other: [] }, '2026-10-22'));
  t('★日付が1つも読めない書類は、取り込んだ日を選べば止めない', j1.stop === '' && j1.importDay === true, j1.stop);
  t('★その時は「取り込んだ日を調剤日として記録」と知らせる', j1.notes.some(n => /取り込んだ日（2026-10-22）/.test(n)), j1.notes);
  const j2 = Y.judge(st({ labeled: [], other: ['2026-10-18'] }, '2026-10-22'));
  t('★「調剤日」の語の無い日付だけの書類も、取り込んだ日なら確かめた印なしで止めない', j2.stop === '' && j2.importDay === true, j2.stop);
  const j3 = Y.judge(st({ labeled: ['2026-10-18'], other: [] }, '2026-10-22'));
  t('★「調剤日」の語の付いた日付がある書類で今日を選んだら、確かめた印が無ければ止める', /語がありません/.test(j3.stop) && j3.importDay === false, j3.stop);
  const j4 = Y.judge(st({ labeled: [], other: [] }, '2026-10-21'));
  t('★日付の読めない書類で今日以外の日付を入れたら、確かめた印が無ければ止める', /語がありません/.test(j4.stop) && j4.importDay === false, j4.stop);
  const j5 = Y.judge(st({ labeled: [], other: [] }, '2026-10-22', { today: '' }));
  t('★今日が分からなければ、取り込んだ日として扱わない（確かめた印が要る）', /語がありません/.test(j5.stop) && j5.importDay === false, j5.stop);
  const j5b = Y.judge(st({ labeled: [], other: [] }, '', { today: '' }));
  t('★日付も今日も空なら、取り込んだ日とせず、空の日付の知らせも出さない', /調剤日を選んで/.test(j5b.stop) && j5b.importDay === false && !j5b.notes.some(n => /取り込んだ日/.test(n)), j5b);
  const j6 = Y.judge(st({ labeled: ['2026-10-18'], other: [] }, '2026-10-18'));
  t('語の付いた調剤日を選んだ時は、取り込んだ日の知らせを出さない', j6.stop === '' && j6.importDay === false && !j6.notes.some(n => /取り込んだ日/.test(n)), j6);
  const j7 = Y.judge(st({ labeled: [], other: [] }, '2026-10-22', { sameDay: '2026-10-22T09:00:00Z' }));
  t('★取り込んだ日で、同じ日に反映済みなら確かめるまで止める', /既に反映/.test(j7.stop), j7.stop);
  t('取り込んだ日の印も朝回診の道具が受け付ける形', /^S\|[^|]+\|(\d{4}-\d{2}-\d{2})\|[0-9a-f]{8}$/.test(Y.srcKey('11', '2026-10-22', j1.after)));
  /* 取り込んだ日でゆるめるのは日付の印だけ（審査の指摘・2026-10-22） */
  const j8 = Y.judge(st({ labeled: [], other: [] }, '2026-10-22', { identity: false }));
  t('★取り込んだ日でも、本人の照合の印が無ければ止める', /この方の書類/.test(j8.stop), j8.stop);
  const j9 = Y.judge(Object.assign(st({ labeled: [], other: [] }, '2026-10-22'), { rows: [{ kind: 'add', action: 'add', line: '架空錠C 1錠分1 就寝前', warns: ['頓服の書き方です'], checked: false }] }));
  t('★取り込んだ日でも、⚠ の行を確かめていなければ止める', /⚠ の行が 1 行/.test(j9.stop), j9.stop);
  const j10 = Y.judge(Object.assign(st({ labeled: [], other: [] }, '2026-10-22'), { rows: [{ kind: 'left', cur: '架空錠A 1錠分1 朝食後', action: '', warns: [] }, ...rows()] }));
  t('★取り込んだ日でも、書類に無い今の行を決めていなければ止める', /残す」か「中止/.test(j10.stop), j10.stop);
}

console.log('\n— 8f. 調剤日の既定と、取り込んだ日を使う時の日付（0時をまたいでも選んだまま・審査の指摘 2026-10-22）—');
{
  const s0 = Y.startDate({ labeled: [], other: ['2026-10-18'] });
  t('★「調剤日」の語の付いた日付が無ければ、取り込んだ日を選んでおく', s0.importDay === true && s0.date === '', s0);
  const s1 = Y.startDate({ labeled: ['2026-10-18'], other: [] });
  t('★語の付いた日付が1つなら、その日を選び、取り込んだ日にしない', s1.importDay === false && s1.date === '2026-10-18', s1);
  const s2 = Y.startDate({ labeled: ['2026-10-04', '2026-10-18'], other: [] });
  t('★語の付いた日付が2つ以上なら、選ばせる（空）', s2.importDay === false && s2.date === '', s2);
  t('取り込んだ日はその時の今日を使う', Y.useDate({ importDay: true, date: '' }, '2026-10-23') === '2026-10-23');
  t('★取り込んだ日でない時は、選んだ日付をそのまま使う（今日に変えない）', Y.useDate({ importDay: false, date: '2026-10-18' }, '2026-10-23') === '2026-10-18');
  t('今日が分からない時は空（止める側へ）', Y.useDate({ importDay: true, date: '' }, '') === '');
  /* 画面の関数を切り出して動かす（0時をまたいだ時） */
  const RM = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
  const cutF = (src, name) => { const h = src.indexOf('function ' + name + '('); if (h < 0) throw new Error('関数が見つかりません: ' + name);
    let i = src.indexOf('{', h), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } } };
  const box = { YakujoCalc: Y, String, Array, todayISO: () => box.now, now: '2026-10-22' };
  vm.createContext(box);
  vm.runInContext([cutF(RM, 'yjSameDay_'), cutF(RM, 'yjJudge_')].join('\n'), box);
  const cur = { id: '11', importDay: true, date: '', dates: { labeled: [], other: [] }, identity: true,
    rows: [{ kind: 'add', action: 'add', line: '架空錠C 1錠分1 就寝前', warns: [], checked: false }], before: '架空錠A 1錠分1 朝食後',
    lastChange: '2026-10-01', oldChecked: false, ack: false, dupChecked: false, dateChecked: false,
    rec: { medsHistory: [{ at: '2026-10-23T00:10:00+09:00', via: '変更候補（薬情 10/23）' }] } };
  box.yjSt = { server: 'ok', cur };
  box.yjSameDay_(cur);
  const w1 = box.yjJudge_();
  t('★取り込んだ日を選んで開いた日は、日付の印なしで反映できる', w1.stop === '' && w1.importDay === true, w1.stop);
  cur.ack = true; box.now = '2026-10-23';
  const w2 = box.yjJudge_();
  t('★0時を過ぎても取り込んだ日のまま（日付の印を求めない）', w2.importDay === true && !/語がありません/.test(w2.stop), w2.stop);
  t('★0時を過ぎたら、同じ日の確かめを新しい日で作り直し、前の日の「確かめた」は外す', /既に反映/.test(w2.stop) && cur.ack === false && cur.sameDayFor === '2026-10-23', { stop: w2.stop, ack: cur.ack, for: cur.sameDayFor });
  /* 配線（画面のコードが純関数をこの形で使っていること） */
  t('書類を開く時の既定は startDate で決め、読み直しでは印を引き継ぐ', /sd=YakujoCalc\.startDate\(dates\)/.test(cutF(RM, 'yjStartDoc_')) && /importDay:keep\?!!keep\.importDay:sd\.importDay/.test(cutF(RM, 'yjStartDoc_')));
  const ap = cutF(RM, 'yjApply_');
  t('★反映は判定と送る調剤日を同じ今日で決める', /today=todayISO\(\), j=yjJudge_\(today\)/.test(ap) && /date=YakujoCalc\.useDate\(c, today\)/.test(ap));
  t('★反映の直前に止まった時は、黙って戻らず理由を出す', /if\(j\.stop\)\{ c\.msg='反映できません：'\+j\.stop; yjPaint_\(\); return; \}/.test(ap));
  const wk = cutF(RM, 'yjWorkHtml_');
  t('選ぶ欄の「（取り込んだ日）」は印（__import__）で選ぶ', /value="__import__"'\+\(c\.importDay\?' selected':''\)/.test(wk) && /!c\.importDay&&c\.date===dt/.test(wk));
  t('★取り込んだ日の時は、日付の「確かめた」の印を出さない', /if\(d&&c\.dates\.labeled\.indexOf\(d\)<0&&!j\.importDay\) h\+='<label class="yj-chk yj-warn"><input type="checkbox" id="yjDateOk"/.test(wk));
  t('選ぶ欄を変えたら印を付け替える', /c\.importDay=\(t\.value==='__import__'\); c\.date=c\.importDay\?'':t\.value;/.test(RM));
}

console.log('\n— 9. 判断の印 —');
{
  const k = Y.srcKey('11', '2026-10-18', '架空錠A5mg 2錠分2 朝夕食後');
  t('★朝回診の道具が受け付ける形（S|利用者No|YYYY-MM-DD|小文字16進8桁）', /^S\|[^|]+\|(\d{4}-\d{2}-\d{2})\|[0-9a-f]{8}$/.test(k), k);
  t('同じ全文なら同じ印・違えば違う印', Y.srcKey('11', '2026-10-18', 'A') === Y.srcKey('11', '2026-10-18', 'A') && Y.srcKey('11', '2026-10-18', 'A') !== Y.srcKey('11', '2026-10-18', 'B'));
}

console.log('\n— 10. 「同じ意味」と取り違えない（単位・1日量と1回量・時点・2026-10-24）—');
{
  const sp = (name, slots, dose, unit, meal) => ({ name, maker: '', slots, dose, unit, meal, free: '' });
  /* 対照: 本当に同じ意味の行は true のまま */
  t('対照: 「1日2錠 分2 朝夕食後」と 1回1錠の朝夕は同じ意味', Y.sameMeaning('架空錠A5mg 1日2錠 分2 朝夕食後', sp('架空錠A5mg', ['朝', '夕'], 1, '錠', '食後')) === true);
  const pairs = [
    ['(a) mg と g（数字を合わせた例）', '架空散 500mg 分2 朝夕食後', sp('架空散', ['朝', '夕'], 250, 'g', '食後')],
    ['(a) mg と g（数字が合わない例）', '架空散 500mg 分2 朝夕食後', sp('架空散', ['朝', '夕'], 0.25, 'g', '食後')],
    ['(b) 錠と包', '架空錠A5mg 1日2錠 分2 朝夕食後', sp('架空錠A5mg', ['朝', '夕'], 1, '包', '食後')],
    ['(c) 今が1回2錠・書類が1日2錠', '架空錠A5mg 1回2錠 朝夕食後', sp('架空錠A5mg', ['朝', '夕'], 1, '錠', '食後')],
    ['(c) 今が1日2錠 分2・書類が1回2錠', '架空錠A5mg 1日2錠 分2 朝夕食後', sp('架空錠A5mg', ['朝', '夕'], 2, '錠', '食後')],
    ['(d) 朝夕と朝昼夕（1回量が同じ）', '架空錠A5mg 1回1錠 朝夕食後', sp('架空錠A5mg', ['朝', '昼', '夕'], 1, '錠', '食後')],
    ['(d) 朝昼夕と朝夕（1日量が同じ3錠）', '架空錠A5mg 1日3錠 分3 朝昼夕食後', sp('架空錠A5mg', ['朝', '夕'], 1.5, '錠', '食後')],
  ];
  pairs.forEach(([n, cur, spec]) => t('★sameMeaning は ' + n + ' を同じ意味にしない', Y.sameMeaning(cur, spec) === false, { cur, spec }));
  /* matchCurrent の経路でも same にならず change になる（書類の行は別の書き方にして、一字一致の same を避ける） */
  const lines = ['架空散 250g 分2 朝夕食後', '架空散 0.25g 分2 朝夕食後', '架空錠A5mg 2包分2 朝夕食後', '架空錠A5mg 2錠分2 朝夕食後', '架空錠A5mg 4錠分2 朝夕食後',
    '架空錠A5mg 3錠分3 朝昼夕食後', '架空錠A5mg 3錠分2 朝夕食後'];
  pairs.forEach(([n, cur, spec], i) => {
    const m = Y.matchCurrent([{ line: lines[i], spec, raw: spec.name }], cur);
    t('★matchCurrent でも ' + n + ' は change（same にしない）', m.pairs.length === 1 && m.pairs[0].kind === 'change' && m.left.length === 0, m.pairs[0] && { kind: m.pairs[0].kind, how: m.pairs[0].how });
  });
  const mc = Y.matchCurrent([{ line: '架空錠A5mg 2錠分2 朝夕食後', spec: sp('架空錠A5mg', ['朝', '夕'], 1, '錠', '食後'), raw: '架空錠A5mg' }], '架空錠A5mg 1日2錠 分2 朝夕食後');
  t('対照: matchCurrent でも本当に同じ意味なら same（meaning）', mc.pairs[0].kind === 'same' && mc.pairs[0].how === 'meaning', mc.pairs[0]);
  /* 書類の行を lineSpec で組んだ時も同じ（1日量と1回量の取り違え） */
  const dd = one([[L('架空錠A5mg', 0.1, 0.3), L('1回2錠', 0.45, 0.3), L('1日2回朝夕食後 14日分', 0.6, 0.3)]]);
  const rr = Y.parseRows(dd)[0];
  const ls = Y.lineSpec(rr, { source: 'current', name: '架空錠A5mg', maker: '', makerOk: true, near: [] });
  t('lineSpec: 書類の「1回2錠 朝夕」は1回量2', ls.spec.dose === 2 && ls.spec.slots.join() === '朝,夕', ls.spec);
  const ml = Y.matchCurrent([{ line: '架空錠A5mg 4錠分2 朝夕食後', spec: ls.spec, raw: rr.raw }], '架空錠A5mg 1日2錠 分2 朝夕食後');
  t('★lineSpec を通した書類の1回2錠と、今の1日2錠は change', ml.pairs[0].kind === 'change', ml.pairs[0]);
}

console.log('\n— 11. 変更記録の「書類の行と扱い」（logRows・2026-10-24）—');
{
  const rows = [
    { kind: 'same', action: 'keep', raw: '架空錠A5mg', cur: '架空錠A5mg 1錠分1 朝食後', line: '架空錠A5mg 1錠分1 朝食後' },
    { kind: 'change', action: 'change', raw: '架空錠A5mg 1錠 朝食後', cur: '架空錠A5mg 1錠分1 朝食後', line: '架空錠A10mg 1錠分1 朝食後' },
    { kind: 'change', action: 'keep', raw: '架空カプセルB', cur: '架空カプセルB 2カプセル分2 朝夕食後', line: '架空カプセルB 4カプセル分2 朝夕食後' },
    { kind: 'add', action: 'add', raw: '架空錠N', cur: '', line: '架空錠N 1錠分1 夕食後' },
    { kind: 'add', action: 'skip', raw: '架空錠H 頓用', cur: '', line: '架空錠H 頓用' },
    { kind: 'left', action: 'keep', raw: '', cur: '架空錠Z 1錠分1 朝食後', line: '架空錠Z 1錠分1 朝食後' },
    { kind: 'left', action: 'stop', raw: '', cur: '架空錠Y 1錠分1 朝食後', line: '架空錠Y 1錠分1 朝食後' },
  ];
  const out = Y.logRows(rows).split('\n');
  t('1行1件', out.length === 7, out);
  t('変えない（そのまま）', out[0] === '変えない｜架空錠A5mg｜架空錠A5mg 1錠分1 朝食後', out[0]);
  t('変える', out[1] === '変える｜架空錠A5mg 1錠 朝食後｜架空錠A10mg 1錠分1 朝食後', out[1]);
  t('★変える行を「今の行のまま」にした時は「変えない」で、反映する行は今の行', out[2] === '変えない｜架空カプセルB｜架空カプセルB 2カプセル分2 朝夕食後', out[2]);
  t('足す', out[3] === '足す｜架空錠N｜架空錠N 1錠分1 夕食後', out[3]);
  t('入れない', out[4] === '入れない｜架空錠H 頓用｜（入れない）', out[4]);
  t('★書類に無い今の行は「残す」と「（書類に無い今の行）」', out[5] === '残す｜（書類に無い今の行）｜架空錠Z 1錠分1 朝食後', out[5]);
  t('★書類に無い今の行の中止', out[6] === '中止｜（書類に無い今の行）｜（中止）', out[6]);
  t('行の中の改行は1行にそろえる', Y.logRows([{ kind: 'add', action: 'add', raw: '架空錠N', line: '架空錠N\n1錠分1 夕食後' }]) === '足す｜架空錠N｜架空錠N 1錠分1 夕食後');
  t('空・配列でない時は空文字', Y.logRows([]) === '' && Y.logRows(null) === '');
  /* ★扱いの語は実際に定期薬へ効いたかで決め、judge の数と食い違わない（10/25 反証レビュー指摘1） */
  const odd = [
    { kind: 'change', action: 'change', raw: '架空錠A 1錠 朝食後', cur: '架空錠A 1錠分1 朝食後', line: '' },
    { kind: 'change', action: 'change', raw: '架空錠C 1錠 夕食後', cur: '架空錠C 1錠分1 夕食後', line: '架空錠C 1錠分1 夕食後' },
    { kind: 'add', action: 'add', raw: '架空錠M', cur: '', line: '' },
    { kind: 'add', action: 'add', raw: '架空錠N', cur: '', line: '架空錠N 1錠分1 夕食後' },
  ];
  const ol = Y.logRows(odd).split('\n');
  t('★反映先が空の「変える」は「変えない」と書き、反映する行は今の行', ol[0] === '変えない（反映先が空か今の行と同じ）｜架空錠A 1錠 朝食後｜架空錠A 1錠分1 朝食後', ol[0]);
  t('★反映先が今の行と同じ「変える」も「変えない」', ol[1].indexOf('変えない（反映先が空か今の行と同じ）｜') === 0, ol[1]);
  t('★反映先が空の「足す」は「入れない」', ol[2] === '入れない（反映先が空）｜架空錠M｜（入れない）', ol[2]);
  const cnt = (ls, w) => ls.filter(l => l.indexOf(w + '｜') === 0).length;
  [odd, rows].forEach((rs, i) => {
    const jj = Y.judge({ rows: rs, current: rs.filter(r => r.cur).map(r => r.cur).join('\n') }), ll = Y.logRows(rs).split('\n');
    t('★記録の「変える・足す・中止」の数は judge が反映する数と同じ（組 ' + (i + 1) + '）', cnt(ll, '変える') === jj.counts.change && cnt(ll, '足す') === jj.counts.add && cnt(ll, '中止') === jj.counts.stop, { ll, c: jj.counts });
  });
  /* 8000字に収める */
  const big = Array.from({ length: 200 }, (_, i) => ({ kind: 'add', action: 'add', raw: '架空錠' + i, line: '架空錠' + i + ' ' + 'あ'.repeat(60) }));
  const lb = Y.logRows(big), lbl = lb.split('\n');
  const kept = lbl.length - 1;
  t('★8000字を超える時は8000字以内に収める', lb.length <= 8000 && lb.length > 7800, lb.length);
  t('★末尾を「…（以下 N 行）」で切り、N は残りの行の数', lbl[lbl.length - 1] === '…（以下 ' + (200 - kept) + ' 行）' && lbl[kept - 1].indexOf('足す｜架空錠' + (kept - 1) + '｜') === 0, lbl[lbl.length - 1]);
  const exact = Y.logRows(Array.from({ length: 1 }, () => ({ kind: 'add', action: 'add', raw: 'x', line: 'y'.repeat(7995) })));
  t('ちょうど8000字なら切らない', exact.length === 8000 && exact.indexOf('…') < 0, exact.length);
  const huge = Y.logRows([{ kind: 'add', action: 'add', raw: 'x', line: 'y'.repeat(9000) }, { kind: 'add', action: 'add', raw: 'z', line: 'w' }]);
  t('1行目だけで超える時も8000字以内で、残りの行を知らせる', huge.length <= 8000 && /…\n…（以下 1 行）$/.test(huge), huge.length);
  const huge1 = Y.logRows([{ kind: 'add', action: 'add', raw: 'x', line: 'y'.repeat(9000) }]);
  t('1行だけで超える時は「…」で切る', huge1.length === 8000 && /…$/.test(huge1), huge1.length);
  /* 画面の配線 */
  const RM2 = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
  const cut2 = (src, name) => { const h = src.indexOf('function ' + name + '('); let i = src.indexOf('{', h), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } } };
  const ap2 = cut2(RM2, 'yjApply_');
  t('★反映は docRows を logRows で作って送る（本文は yjBody_ で作り、1人ずつは確認表の行 c.rows を渡す）', /body\.docRows=YakujoCalc\.logRows\(rows\)/.test(cut2(RM2, 'yjBody_')) && /var body=yjBody_\(c, x, j, date, c\.rows, ''\);/.test(ap2));
  t('★反映はログインの証明を保存と同じ取り方（rmAccessToken_）で添え、取れなければ送らない', /rmAccessToken_\(\)/.test(ap2) && /if\(!at\)\{ c\.msg='ログインし直してから反映してください（何も書いていません）'; return; \}/.test(ap2) && /body\.accessToken=at;\s*return apiPostRaw\(body,40000\)/.test(ap2));
  t('★unverified の応答は確かめ中（unsure）にしない', /if\(r&&r\.unverified\)\{ c\.msg='ログインを確かめられませんでした。ログインし直してから反映してください（何も書いていません）'; return; \}/.test(ap2));
  t('★版の確かめは「反映記録」を含む版', /\/反映記録\/\.test\(String\(r\.build/.test(cut2(RM2, 'yjPing_')));
  t('★反映記録の欄は印刷しない（@media print・PRINT_SECS に無い）', /@media print\{\.sec-yjlog,\.yjl-slot\{display:none !important\}\}/.test(RM2) && !/薬情の反映記録/.test(RM2.slice(RM2.indexOf('var PRINT_SECS='), RM2.indexOf('];', RM2.indexOf('var PRINT_SECS=')))));
  t('★反映記録は現場端末では取りに行かない', /getDeviceRole\(\)==='field'/.test(cut2(RM2, 'yjlSlot_')) && /getDeviceRole\(\)==='field'/.test(cut2(RM2, 'yjlLoad_')));
  t('★反映記録の応答は、開いている方と世代を確かめてから使う', /gen!==yjlGen\|\|dg!==devGen/.test(cut2(RM2, 'yjlLoad_')) && /String\(curResident\.id\)!==id/.test(cut2(RM2, 'yjlLoad_')));
  t('★詳細画面の「定期薬の変更履歴」の直後に欄を置く', /h\+=medsHistHtml_\(r\.medsHistory\);\s*h\+=yjlSlot_\(r\);/.test(cut2(RM2, 'renderView')));
  t('★開き直すたびに控えを捨てる（反映の直後も新しい記録を取り直す）', /yjlReset_\(\)/.test(cut2(RM2, 'openResident')));
  t('★現場用への切り替えで控え（定期薬の全文）を捨てる', /yjlReset_\(\)/.test(cut2(RM2, 'yjPurge_')));
  { const rx = { }; vm.createContext(rx); vm.runInContext('var yjlGen=0, yjlMem={id:"x", rows:[1]};\n' + cut2(RM2, 'yjlReset_') + '\nyjlReset_();', rx);
    t('★yjlReset_ は控えを空にし、世代を進める', rx.yjlMem.id === '' && rx.yjlMem.rows === null && rx.yjlGen === 1, rx.yjlMem); }
  t('★反映記録は端末に保存しない', !/localStorage/.test(cut2(RM2, 'yjlLoad_') + cut2(RM2, 'yjlSlot_') + cut2(RM2, 'yjlHtml_')));
  /* 欄の組み立て（文字はエスケープ・0件は出さない・日時は日本時間） */
  const bx = { String, Array, isNaN, Date };
  vm.createContext(bx);
  vm.runInContext([cut2(RM2, 'esc'), cut2(RM2, 'yjlAt_'), cut2(RM2, 'yjlHtml_')].join('\n'), bx);
  t('記録が0件なら欄を出さない', bx.yjlHtml_([]) === '' && bx.yjlHtml_(null) === '');
  const hh = bx.yjlHtml_([{ at: '2026-10-24T01:05:00.000Z', srcDate: '2026-10-18', docRows: '変える｜<b>架空</b>｜x', before: 'a', after: 'b', by: 'kakuu@example.com' }]);
  t('日時は日本時間の yyyy-MM-dd HH:mm', hh.indexOf('2026-10-24 10:05') >= 0, hh);
  t('★文字はエスケープする', hh.indexOf('<b>架空') < 0 && hh.indexOf('&lt;b&gt;架空') >= 0);
  t('見出しは日時・調剤日・確かめた人で、中身は details の中', /<details class="yjl-e"><summary>.*2026-10-18.*kakuu@example\.com.*<\/summary>.*書類の行と扱い.*反映前.*反映後.*<\/details>/.test(hh));
}

console.log('\n— 12. 取り込みの一致率（correctionKinds・metricOf・summarize・2026-10-26）—');
{
  const K = (a, b) => { const k = Y.correctionKinds(a, b); return ['name', 'dose', 'unit', 'time', 'other'].filter(n => k[n]).join(',') + (k.changed ? '' : '(なし)'); };
  const A = '架空錠A5mg 2錠分2 朝夕食後';
  t('直していない行（同じ文字）は直しにしない', K(A, A) === '(なし)', K(A, A));
  t('空白・全角半角だけの違いは直しにしない', K(A, '架空錠A5mg  ２錠分2　朝夕食後') === '(なし)', K(A, '架空錠A5mg  ２錠分2　朝夕食後'));
  t('★薬名だけ', K(A, '架空錠B5mg 2錠分2 朝夕食後') === 'name', K(A, '架空錠B5mg 2錠分2 朝夕食後'));
  t('★屋号の違いも薬名', K(A, '架空錠A5mg「見本」 2錠分2 朝夕食後') === 'name');
  t('★規格の違い（5mg→10mg）は薬名に数える（drugKey で別の品目）', K(A, '架空錠A10mg 2錠分2 朝夕食後') === 'name', K(A, '架空錠A10mg 2錠分2 朝夕食後'));
  t('★【般】などの頭書きだけの違いは薬名にしない（その他）', K(A, '【般】架空錠A5mg 2錠分2 朝夕食後') === 'other', K(A, '【般】架空錠A5mg 2錠分2 朝夕食後'));
  t('★量だけ', K(A, '架空錠A5mg 4錠分2 朝夕食後') === 'dose', K(A, '架空錠A5mg 4錠分2 朝夕食後'));
  t('★1日量と1回量の書き方違い（同じ量）は直しにしない種類（その他）', K(A, '架空錠A5mg 1回1錠 朝夕食後') === 'other', K(A, '架空錠A5mg 1回1錠 朝夕食後'));
  t('★単位だけ', K(A, '架空錠A5mg 2包分2 朝夕食後') === 'unit', K(A, '架空錠A5mg 2包分2 朝夕食後'));
  t('★時点だけ（朝夕→朝・就寝前）', K(A, '架空錠A5mg 2錠分2 朝食後・就寝前') === 'time', K(A, '架空錠A5mg 2錠分2 朝食後・就寝前'));
  t('★食前後だけでも時点', K(A, '架空錠A5mg 2錠分2 朝夕食前') === 'time');
  t('★複数の種類（薬名・量・時点）', K(A, '架空錠B5mg 3錠分3 毎食後') === 'name,dose,time', K(A, '架空錠B5mg 3錠分3 毎食後'));
  t('★読めない直し（用法を読めない行の書き換え）は「その他」', K('架空錠A5mg 用法は原本を見る', '架空錠A5mg 用法は医師に聞く') === 'other', K('架空錠A5mg 用法は原本を見る', '架空錠A5mg 用法は医師に聞く'));
  t('★読めない行を読める行に直したら、量・単位・時点に数える（その他にしない）', K('架空錠A5mg 用法不明', A) === 'dose,unit,time', K('架空錠A5mg 用法不明', A));
  t('★起床時などの書き足しは「その他」', K(A, A + ' 起床時') === 'other', K(A, A + ' 起床時'));

  /* buildRows は自動で作った行（auto）を持つ */
  const mb = Y.matchCurrent([{ line: '架空錠N 1錠分1 夕食後', spec: {}, raw: '架空錠N' }, { line: '架空錠Z 2錠分1 朝食後', spec: {}, raw: '架空錠Z' }], '架空錠Z 1錠分1 朝食後\n架空錠Y 1錠分1 朝食後');
  const br = Y.buildRows(mb.pairs, mb.left, [{ warn: [], skip: false, spec: {} }, { warn: [], skip: false, spec: {} }], {});
  t('★buildRows は行ごとに自動で作った行（auto）を持つ（人が直す前の line と同じ）', br.length === 3 && br.every(r => typeof r.auto === 'string' && r.auto === r.line), br.map(r => [r.kind, r.auto, r.line]));
  /* metricOf: 書類1件の記録 */
  const rows = [
    { kind: 'same', action: 'keep', auto: '架空錠S 1錠分1 朝食後', line: '架空錠S 1錠分1 朝食後', cur: '架空錠S 1錠分1 朝食後', raw: '架空錠S' },
    { kind: 'change', action: 'change', auto: A, line: '架空錠A10mg 4錠分2 朝夕食後', cur: '架空錠A5mg 1錠分1 朝食後', raw: '架空錠A5mg' },
    { kind: 'add', action: 'add', auto: '架空錠N 1錠分1 夕食後', line: '架空錠N 1錠分1 夕食後', cur: '', raw: '架空錠N' },
    { kind: 'add', action: 'add', auto: '架空錠M 1錠分1 夕食後', line: '架空錠M 1包分1 夕食前', cur: '', raw: '架空錠M' },
    { kind: 'add', action: 'skip', auto: '架空錠H 頓用', line: '架空錠H 1錠 頓用 痛い時', cur: '', raw: '架空錠H 頓用' },
    { kind: 'change', action: 'keep', auto: '架空錠K 2錠分2 朝夕食後', line: '架空錠K 9錠分2 朝夕食後', cur: '架空錠K 1錠分1 朝食後', raw: '架空錠K' },
    { kind: 'add', action: 'add', auto: '架空錠Q 用法は原本', line: '架空錠Q 用法は原本を見る', cur: '', raw: '架空錠Q' },
    { kind: 'left', action: 'stop', auto: '架空錠Z 1錠分1 朝食後', line: '架空錠Z 1錠分1 朝食後', cur: '架空錠Z 1錠分1 朝食後', raw: '' },
  ];
  const m = Y.metricOf({ at: '2026-10-26T01:00:00.000Z', autoId: '11', pickId: '11', rows });
  t('★薬名の行数は書類から読めた行（書類に無い今の行は数えない）', m.rows === 7, m);
  t('★人が直した行は、反映に使った行（変える・足す）で自動の行と違うものだけ（入れない・今の行のままは数えない）', m.fixed === 3, m);
  t('★種類ごと（1行で複数の種類は各種類に1ずつ）', m.name === 1 && m.dose === 1 && m.unit === 1 && m.time === 1 && m.other === 1, m);
  t('★名簿の一致: 自動の方を人がそのまま使った', m.match === true);
  t('★名簿の不一致: 人が選び直した', Y.metricOf({ autoId: '11', pickId: '12', rows }).match === false);
  t('★名簿の不一致: 自動で振り分けられなかった', Y.metricOf({ autoId: '', pickId: '12', rows }).match === false);
  t('★自動で振り分けられなかった時は、人の方が空・未定でも一致にしない', Y.metricOf({ autoId: '', pickId: '', rows }).match === false && Y.metricOf({ rows }).match === false);
  t('記録の項目は決まった9つだけ', Object.keys(m).sort().join() === 'at,dose,fixed,match,name,other,rows,time,unit', Object.keys(m));
  const leak = JSON.stringify(Y.metricOf({ at: '2026-10-26T01:00:00.000Z', autoId: '架空 太郎', pickId: '架空 太郎', name: '架空 太郎', rows }));
  t('★記録に氏名・薬名・入居者の番号・行の文字が入らない', !/架空|錠|朝食|太郎/.test(leak) && leak.indexOf('"11"') < 0, leak);
  t('★反映先を空にした行（judge が反映しない行）は直しに数えない', Y.metricOf({ rows: [{ kind: 'add', action: 'add', auto: A, line: '  ' }, { kind: 'change', action: 'change', auto: A, line: '' }] }).fixed === 0);
  t('auto の無い行（古い確認表）は直しに数えない', Y.metricOf({ rows: [{ kind: 'add', action: 'add', line: 'x 1錠分1 朝食後' }] }).fixed === 0);
  t('行が無い・壊れている時も0で返す', Y.metricOf(null).rows === 0 && Y.metricOf({ rows: [null, 3, 'a'] }).rows === 0);

  /* 置く・読む */
  const rec = (i, match, o) => Object.assign({ at: '2026-10-' + String(1 + (i % 28)).padStart(2, '0') + 'T00:00:' + String(i % 60).padStart(2, '0') + '.000Z', rows: 5, match, fixed: 1, name: 1, dose: 0, unit: 0, time: 0, other: 0, seq: i }, o || {});
  let raw = null;
  for (let i = 0; i < 35; i++) raw = Y.metricsSave(Y.metricsLoad(raw), rec(i, i % 2 === 0));
  const ld = Y.metricsLoad(raw);
  t('★直近30件だけ置き、古いものから落とす', ld.length === 30 && ld[0].at === rec(5, false).at && ld[29].at === rec(34, true).at, ld.length);
  t('★置く形は {v:1, list} で、決まった項目以外は捨てる', JSON.parse(raw).v === 1 && !/seq/.test(raw));
  t('★端末に置く文字列そのものが30件まで（読む側で切るだけにしない）', JSON.parse(raw).list.length === 30 && JSON.parse(Y.metricsSave(Array.from({ length: 40 }, (_, i) => rec(i, true)), rec(40, true))).list.length === 30);
  t('★壊れた JSON は空', Y.metricsLoad('{') .length === 0);
  t('★版が違えば空', Y.metricsLoad(JSON.stringify({ v: 2, list: [rec(1, true)] })).length === 0);
  t('★形が違えば空（配列そのもの・null・空）', Y.metricsLoad(JSON.stringify([rec(1, true)])).length === 0 && Y.metricsLoad(null).length === 0 && Y.metricsLoad('').length === 0);
  const mixed = Y.metricsLoad(JSON.stringify({ v: 1, list: [rec(1, true), { at: 'x', rows: 1, match: true }, rec(2, false, { rows: -1 }), rec(3, true, { fixed: 9 }), rec(4, 'yes'), rec(5, true, { name: '架空 太郎' }), null, rec(6, false)] }));
  t('★壊れた1件は捨て、正しい件だけ残す', mixed.length === 2 && mixed[0].match === true && mixed[1].match === false, mixed);
  t('★壊れた記録に新しい1件を足すと、新しい1件だけになる（画面を止めない）', Y.metricsLoad(Y.metricsSave(Y.metricsLoad('壊れた'), rec(1, true))).length === 1);
  t('★記録の形が壊れた1件は足さない', Y.metricsLoad(Y.metricsSave([], { at: '架空 太郎', rows: 1, match: true })).length === 0);

  /* 集計と表示の文 */
  const sm = Y.summarize([rec(1, true, { rows: 6, fixed: 2, name: 1, dose: 1, unit: 0, time: 1, other: 0 }), rec(2, false, { rows: 4, fixed: 1, name: 0, dose: 0, unit: 1, time: 0, other: 1 }), rec(3, true, { rows: 0, fixed: 0, name: 0 })]);
  t('集計', sm.n === 3 && sm.match === 2 && sm.rows === 10 && sm.fixed === 3 && sm.name === 1 && sm.dose === 1 && sm.unit === 1 && sm.time === 1 && sm.other === 1, sm);
  t('★表示の文', Y.metricText(sm) === '直近 3 件：名簿の一致 2/3 件（67%）・人が直した行 3/10 行（薬名 1・量 1・単位 1・時点 1・その他 1）', Y.metricText(sm));
  t('★0件の時は「まだ記録がありません」', Y.metricText(Y.summarize([])) === 'まだ記録がありません' && Y.metricText(Y.summarize(null)) === 'まだ記録がありません');
  t('集計も直近30件まで', Y.summarize(Array.from({ length: 40 }, (_, i) => rec(i, true))).n === 30);

  /* 画面の配線（切り出して偽の localStorage で動かす） */
  const RM3 = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
  const cut3 = (src, name) => { const h = src.indexOf('function ' + name + '('); if (h < 0) throw new Error('関数が見つかりません: ' + name);
    let i = src.indexOf('{', h), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } } };
  const mkBox = (role, stored) => {
    const store = {}, el = { textContent: '前の文' }, sets = [];
    if (stored !== undefined) store.yj_metrics = stored;
    const b = { YakujoCalc: Y, String, JSON, Date, role,
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { sets.push(k); store[k] = String(v); } },
      $: id => (id === 'yjMetric' ? el : null), store, el, sets };
    b.getDeviceRole = () => b.role;
    vm.createContext(b);
    vm.runInContext(RM3.match(/var YJ_MET_KEY='[^']*';/)[0] + '\n' + ['yjCalcOk_', 'yjMetOk_', 'yjMetRead_', 'yjMetAdd_', 'yjMetPaint_'].map(n => cut3(RM3, n)).join('\n'), b);
    return b;
  };
  const off = mkBox('office');
  off.yjMetPaint_();
  t('★事務所PC・0件: 欄は「まだ記録がありません」', off.el.textContent === 'まだ記録がありません', off.el.textContent);
  off.yjMetAdd_(Y.metricOf({ autoId: '11', pickId: '11', rows }));
  const saved = JSON.parse(off.store.yj_metrics);
  t('★事務所PC: 反映した書類を1件記録し、キーは yj_ で始まる', off.sets.length === 1 && off.sets[0] === 'yj_metrics' && saved.v === 1 && saved.list.length === 1 && /^\d{4}-\d{2}-\d{2}T/.test(saved.list[0].at), saved);
  t('★記録した後、欄を描き直す', /^直近 1 件：名簿の一致 1\/1 件（100%）・人が直した行 3\/7 行/.test(off.el.textContent), off.el.textContent);
  const fld = mkBox('field', JSON.stringify({ v: 1, list: [rec(1, true)] }));
  fld.yjMetAdd_(Y.metricOf({ autoId: '11', pickId: '11', rows }));
  fld.yjMetPaint_();
  t('★現場端末では記録しない', fld.sets.length === 0, fld.sets);
  t('★現場端末では表示しない（欄は空）', fld.el.textContent === '', fld.el.textContent);
  t('★現場端末では読まない', fld.yjMetRead_().length === 0);
  const brk = mkBox('office', '{壊れた');
  let threw = false; try { brk.yjMetPaint_(); brk.yjMetAdd_(Y.metricOf({ autoId: '', pickId: '12', rows: [] })); } catch (e) { threw = true; }
  t('★端末の記録が壊れていても止めず、空として扱う', !threw && /^直近 1 件：名簿の一致 0\/1 件（0%）/.test(brk.el.textContent), brk.el.textContent);
  const thr = mkBox('office'); thr.localStorage.getItem = () => { throw new Error('使えない'); }; thr.localStorage.setItem = () => { throw new Error('使えない'); };
  threw = false; try { thr.yjMetPaint_(); thr.yjMetAdd_(Y.metricOf({ rows })); } catch (e) { threw = true; }
  t('★localStorage が使えなくても止めない', !threw && thr.el.textContent === 'まだ記録がありません', thr.el.textContent);
  const ap3 = cut3(RM3, 'yjApply_');
  const okBranch = ap3.slice(ap3.indexOf('if(r&&r.ok===true){'), ap3.indexOf('if(r&&r.already)'));
  t('★記録は「反映できた」（応答 ok）の分岐の中だけで、ほかの分岐（既に反映・確かめ中・食い違い・失敗）では記録しない', (ap3.match(/yjMetAdd_\(/g) || []).length === 1 && /yjMetAdd_\(met\)/.test(okBranch), okBranch);
  t('★記録の材料は送る時点の確認表で作る（自動の方 x.a.id と人が決めた方 x.pick）', /var met=yjMetOk_\(\)\?YakujoCalc\.metricOf\(\{autoId:x\.a&&x\.a\.id, pickId:x\.pick, rows:c\.rows\}\):null;/.test(ap3) && ap3.indexOf('var met=') < ap3.indexOf('c.busy=true; c.writing=true'));
  t('★ほかの場所から記録しない（変更なし・一覧に戻る・閉じるでは記録しない。まとめて反映は ok の分岐の中だけ）', (RM3.match(/yjMetAdd_\(/g) || []).length === 3 && (cut3(RM3, 'yjBulkApply_').match(/yjMetAdd_\(/g) || []).length === 1 && /if\(r&&r\.ok===true\)\{[^\n]*yjMetAdd_\(met\); return; \}/.test(cut3(RM3, 'yjBulkApply_')), (RM3.match(/yjMetAdd_\(/g) || []).length);
  const pt = cut3(RM3, 'yjMetPaint_');
  t('★欄は textContent で入れる（innerHTML を使わない）', /el\.textContent=YakujoCalc\.metricText/.test(pt) && !/innerHTML/.test(pt + cut3(RM3, 'yjMetAdd_') + cut3(RM3, 'yjMetRead_')));
  t('★取り込みを開いた時に欄を描く', /yjMetPaint_\(\)/.test(cut3(RM3, 'yjOpen_')));
  t('★現場用への切り替えでは欄を空にする（端末の記録は消さない）', /mt\.textContent=''/.test(cut3(RM3, 'yjPurge_')) && !/removeItem/.test(cut3(RM3, 'yjPurge_')));
  const modal = RM3.slice(RM3.indexOf('<div class="modal" id="mYakujo"'), RM3.indexOf('<!-- 端末用途ガード'));
  t('★欄は取り込みの窓（#mYakujo）の中にあり、窓ごと印刷しない', /<div class="box">[\s\S]*<p class="yj-met" id="yjMetric"><\/p>\s*<div class="yj-body" id="yjBody"><\/div>\s*<\/div>\s*<\/div>\s*$/.test(modal.trim() + '\n') && /@media print\{ #mYakujo,#yjOpen\{display:none !important\} \}/.test(RM3));
  t('共有部品の版（?v=）を上げた', /yakujo-calc\.js\?v=2026-11-10"/.test(RM3));
}

/* ── まとめて反映できるか（bulkCheck・半自動・代表者の決定 2026-11-04）──
   守りたいこと: 人が確かめる所が1つでもあれば1人ずつへ回す。書類に無い今の薬は消さず「残す」。中止はしない。変わる行の数・最後の変更より前かでは止めない（本人指示 2026-11-07） */
/* ── 見出しの付いた枠の書式（parseLabeled・2026-11-05）──
   実際の薬情（1剤ごとに「お薬名」「用法」「1回量」の見出し、量は時点の欄の下）の並びを架空の薬でまねる。
   直す前は色・形の行（「白色の錠剤」）を薬と取り違え、量・日数がどの薬のものか分からず、取り込みが実用にならなかった */
console.log('\n[見出しの付いた枠の書式（parseLabeled）]');
{
  const hdr = (y, skip) => [['起床時', 0.31], ['朝', 0.42], ['昼', 0.51], ['タ', 0.60], ['就寝前', 0.67]].filter((h) => h[0] !== skip).map((h) => L(h[0], h[1], y, 0.03));
  const blk = (y, nameLines, use, doses, days, extra) => [].concat(nameLines,
    [L('用法', 0.25, y + 0.03, 0.03), L(use, 0.32, y + 0.03, 0.15), L('残', 0.75, y + 0.03, 0.02)],
    hdr(y + 0.06, extra && extra.skipHdr), [L('白色の錠剤', 0.09, y + 0.08, 0.07), L('1回量', 0.24, y + 0.08, 0.05)],
    doses.map((d) => L(d[0], d[1], y + 0.083, 0.04)), days ? [L(days, 0.82, y + 0.08, 0.11)] : [],
    [L('・見本の説明の文です。血圧を下げる薬です。', 0.09, y + 0.12, 0.6)]);
  const pages = [
    [L('薬剤情報提供書', 0.4, 0.02), L('架空 太郎 様', 0.1, 0.05), L('調剤日 2026年11月01日', 0.5, 0.05)].concat(
      blk(0.10, [L('お薬名', 0.25, 0.10, 0.05), L('アゾセミド錠30mg「JG」(処方名:アゾセミド錠30mg)', 0.32, 0.10, 0.4)], '1日1回朝食後', [['1錠', 0.41]], '14日分(計14錠)', { skipHdr: '朝' }),
      blk(0.30, [L('お薬名 アルファカルシドール錠0.5ug「アメル」', 0.25, 0.30, 0.5)], '1日1回朝食後', [['1錠', 0.41]], '14日分(計14錠)'),
      [L('お薬名', 0.25, 0.50, 0.05), L('架空テープ4.5mg「見本」', 0.32, 0.50, 0.3), L('用法', 0.25, 0.53, 0.03), L('外用', 0.32, 0.53, 0.04),
        L('<外用>', 0.24, 0.545, 0.06), L('1日1回1回1枚貼付', 0.32, 0.545, 0.21), L('1回量', 0.24, 0.58, 0.05), L('(計14枚)', 0.87, 0.58, 0.06)]),
    blk(0.10, [L('お薬名', 0.25, 0.10, 0.05), L('マグミット錠330mg', 0.32, 0.10, 0.3)], '1日2回 朝夕食後', [['1錠', 0.41], ['1錠', 0.59]], '14日分(計28錠)').concat(
      blk(0.30, [L('お薬名', 0.25, 0.30, 0.05), L('ランソプラゾール〇D錠15mg「ケミファ」', 0.32, 0.30, 0.3)], '1日2回 朝夕食後', [['1錠', 0.41]], '14日分(計14錠)'),
      [L('*お薬の飲み合わせについての注意', 0.09, 0.6, 0.3), L('白色の錠剤', 0.09, 0.62, 0.07)]),
  ];
  const d = one(pages);
  const rows = Y.parseRows(d, {});
  t('★1剤1行で読み、色・形の行（白色の錠剤）や説明の文を薬と取り違えない', rows.length === 5 && rows.every((r) => r.labeled) && !rows.some((r) => /白色|説明/.test(r.raw)), rows.map((r) => r.raw));
  t('★名前の後ろの「(処方名:…)」は名前に含めない', rows[0].raw === 'アゾセミド錠30mg「JG」' && /処方名/.test(rows[0].own), rows[0]);
  t('★1回量・時点・食後・日数を、その薬の枠から読む（欠けた「朝」の見出しは並びの間隔から推す）', rows[0].use.per === 'dose' && rows[0].use.amount === 1 && rows[0].use.unit === '錠' && rows[0].use.slots.join() === '朝' && rows[0].use.meal === '食後' && rows[0].use.days === 14 && !rows[0].use.extra.length, rows[0].use);
  t('「お薬名 〇〇」と1つの行に続けて書かれた名前も読み、読み違い ug を μg に直す', rows[1].raw === 'アルファカルシドール錠0.5μg「アメル」', rows[1].raw);
  t('外用（<外用> の段の用法）は外用として読む', rows[2].topical === true && /貼付/.test(rows[2].rest), rows[2]);
  t('ページをまたいでも1剤ずつ読み、朝夕の2つの欄の量を1回量として読む', rows[3].raw === 'マグミット錠330mg' && rows[3].page === 2 && rows[3].use.slots.join() === '朝,夕' && rows[3].use.amount === 1 && !rows[3].use.extra.length, rows[3].use);
  t('★用法（朝夕）と時点の欄の量（朝だけ）が合わない時は、決めつけずに確かめる印を付ける', rows[4].use.extra.some((x) => /合いません/.test(x)), rows[4].use);
  t('読み違い「〇D錠」を「OD錠」に直す', rows[4].raw === 'ランソプラゾールOD錠15mg「ケミファ」', rows[4].raw);
  t('「*お薬の飲み合わせ」から後ろは薬の枠に入れない', rows.length === 5);
  const sp0 = Y.lineSpec(rows[0], Y.snap(rows[0].raw, { current: [], used: [], items: ITEMS }));
  t('★規格と剤形の並びだけが違う一般名（薬価基準「アゾセミド30mg錠」）と同じ薬として一字一致させ、1回1錠 朝食後に組む', sp0.warn.length === 0 && sp0.spec.slots.join() === '朝' && sp0.spec.dose === 1 && sp0.spec.unit === '錠', sp0);
  const s1 = Y.snap('アゾセミド錠30mg「JG」', { current: ['アゾセミド30mg錠 1回1錠 朝食後'], used: [], items: ITEMS });
  t('★今の定期薬の書き方（一般名の並び）とも同じ薬として結ぶ（施設の書き方の名前を使う）', s1.source === 'current' && s1.name === 'アゾセミド30mg錠', s1);
  {
    const cur = 'アゾセミド錠30mg 1錠分1 朝食後';
    const sn = Y.snap(rows[0].raw, { current: [cur], used: [], items: ITEMS }), sp = Y.lineSpec(rows[0], sn);
    const m = Y.matchCurrent([{ line: 'アゾセミド錠30mg 1錠分1 朝食後', spec: sp.spec, raw: rows[0].raw }], cur);
    t('★施設の定期薬に屋号が無い時は、書類の屋号（「JG」）だけの違いで「変える」にしない（同じ意味なら今の行のまま）', sn.source === 'current' && sp.spec.maker === '' && m.pairs[0].kind === 'same', { sn, spec: sp.spec, kind: m.pairs[0].kind });
  }
  {
    const sc = Y.snap('アゾセミド錠30mg「トーワ」', { current: ['アゾセミド錠30mg「サワイ」 1錠分1 朝食後'], used: ['アゾセミド錠30mg 1錠分1 朝食後'], items: ITEMS });
    const lc = Y.lineSpec({ raw: 'アゾセミド錠30mg「トーワ」', rest: '', use: Y.parseUse('1日1回朝食後 1回1錠 14日分', 'dose') }, sc);
    t('★今の定期薬に別の屋号で書かれた同じ薬は、ほかの方の屋号なしの名前で結ばず、屋号の不一致として ⚠（反証レビュー指摘2）', sc.makerOk === false && lc.warn.some((w) => /屋号/.test(w)), { sc, warn: lc.warn });
    const pg = (ls) => one([ls]);
    const mdoc = pg([L('お薬名', 0.25, 0.10, 0.05), L('アゾセミド錠30mg', 0.32, 0.10, 0.3), L('用法', 0.25, 0.13, 0.03), L('1日1回朝食後', 0.32, 0.13, 0.15), L('1回量', 0.24, 0.18, 0.05), L('1錠', 0.41, 0.183, 0.04),
      L('用法', 0.25, 0.33, 0.03), L('1日1回夕食後', 0.32, 0.33, 0.15), L('1回量', 0.24, 0.38, 0.05), L('2錠', 0.59, 0.383, 0.04)]);
    t('★1つの枠に用法・1回量が2つある（お薬名の読み落とし）時は、決めつけずに確かめる印（指摘3）', Y.parseRows(mdoc, {})[0].use.extra.some((x) => /2つ以上/.test(x)), Y.parseRows(mdoc, {})[0].use);
    const ndoc = pg([L('お薬名', 0.25, 0.10, 0.05), L('アゾセミド錠30mg', 0.32, 0.10, 0.3), L('用法', 0.25, 0.13, 0.03), L('1日3回毎食後', 0.32, 0.13, 0.15), L('1回量', 0.24, 0.18, 0.05), L('1錠', 0.41, 0.183, 0.04), L('1錠', 0.51, 0.183, 0.04)]);
    t('★時点の欄の見出しを読めない時、量の数（2）と用法の時点（3）が合わなければ確かめる印（指摘4）', Y.parseRows(ndoc, {})[0].use.extra.some((x) => /量の数/.test(x)), Y.parseRows(ndoc, {})[0].use);
  }
  t('規格の数字が無い名前では並びの鍵を作らない（広く結ばない）', Y.canonKey('見本錠') === '' && Y.canonKey('アゾセミド錠30mg') === Y.canonKey('アゾセミド30mg錠'));
  t('規格が違えば同じ鍵にしない', Y.canonKey('アゾセミド錠30mg') !== Y.canonKey('アゾセミド60mg錠'));
  t('読み違いの直し: 2:5mg→2.5mg・O.3%→0.3%・へパリン→ヘパリン・カブセル→カプセル', Y.cleanDrugName('見本錠2:5mg') === '見本錠2.5mg' && Y.cleanDrugName('へパリン類似物質クリームO.3%') === 'ヘパリン類似物質クリーム0.3%' && Y.cleanDrugName('見本カブセル24μg') === '見本カプセル24μg');
  const old = one([[L('お薬の名前', 0.1, 0.10), L('1日量', 0.5, 0.10), L('用法', 0.6, 0.10), L('1.架空錠A5mg「見本」', 0.1, 0.15), L('2錠', 0.5, 0.15), L('1日2回朝夕食後 14日分', 0.6, 0.15)]]);
  t('★見出しの枠が無い書類は今までどおりの読み方（parseLabeled は null）', Y.parseLabeled(old, {}) === null && Y.parseRows(old, {}).length === 1 && !Y.parseRows(old, {})[0].labeled);
}

/* ── 名前の違う同じ薬（先発の商品名⇔後発品）を薬価基準コード9桁で結ぶ（meds-yakka-yj.js・2026-11-05）── */
console.log('\n[コード9桁で結ぶ（yjIndex・snap・matchCurrent）]');
{
  const sb2 = { window: {} }; vm.createContext(sb2);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'meds-yakka-yj.js'), 'utf8'), sb2);
  const YJT = sb2.window.MedsYakkaYJ.text, I = Y.yjIndex(YJT);
  const same = (a, b) => !!Y.yjOf(a, I) && Y.yjOf(a, I) === Y.yjOf(b, I);
  t('★先発の商品名と後発品（同じ成分・剤形・規格）を結ぶ', same('マグミット錠330mg', '酸化マグネシウム錠330mg「ケンエー」') && same('ムコスタ錠100mg', 'レバミピド錠100mg「JG」') && same('アルダクトンA錠25mg', 'スピロノラクトン錠25mg「CH」'));
  t('★剤形が違う（普通の錠と OD錠）・規格が違う薬は結ばない', !same('アムロジピン錠5mg', 'アムロジピンOD錠5mg「CH」') && !same('ベルソムラ錠10mg', 'ベルソムラ錠15mg'));
  t('一覧に無い名前はコードを返さない（推して結ばない）', Y.yjOf('カクウヨメナイ錠9mg', I) === '' && Y.yjOf('マグミット錠330mg', null) === '');
  const cur = 'マグミット錠330mg 1錠分1 朝食後\nカクウ錠1mg 1錠分1 夕食後';
  const row = { raw: '酸化マグネシウム錠330mg「ケンエー」', rest: '1日2回 朝夕食後 1回1錠 14日分', use: Y.parseUse('1日2回 朝夕食後 1回1錠 14日分', 'dose') };
  const sn = Y.snap(row.raw, { current: cur.split('\n'), used: [], items: ITEMS, yj: YJT }), sp = Y.lineSpec(row, sn);
  t('★施設の商品名と同じコードの後発品は、施設の行と結ぶ（名前は調剤された品・屋号は施設の書き方に合わせて付けない）', sn.source === 'current' && sn.alias === 'マグミット錠330mg' && sp.spec.name === '酸化マグネシウム錠330mg' && sp.spec.maker === '' && sp.warn.length === 0, { sn, warn: sp.warn });
  const m = Y.matchCurrent([{ line: '酸化マグネシウム錠330mg 2錠分2 朝夕食後', spec: sp.spec, raw: row.raw }], cur);
  t('★「足す」と「書類に無い今の薬」に分かれず、1つの「変える」になる（同じ薬を2行にしない）', m.pairs[0].kind === 'change' && m.pairs[0].cur === 'マグミット錠330mg 1錠分1 朝食後' && m.left.length === 1 && m.left[0] === 'カクウ錠1mg 1錠分1 夕食後', m);
  const sn2 = Y.snap(row.raw, { current: cur.split('\n'), used: [], items: ITEMS });
  t('コードの一覧が読めない時は今までどおり（結ばない）', sn2.alias === undefined && sn2.source !== 'current', sn2);
  t('施設の書き方の「：」区切り（〇〇錠5mg：1日1回）でも名前を取る', Y.lineName('アトルバスタチン錠5mg：1日1回') === 'アトルバスタチン錠5mg' && Y.lineName('見本錠5mg　1錠分1') === '見本錠5mg');
  t('照合の鍵では μg の書き方（ug）とカブセルの違いを吸収する', Y.drugKey('メコバラミン錠500ug') === Y.drugKey('メコバラミン錠500μg') && Y.drugKey('見本カブセル1mg') === Y.drugKey('見本カプセル1mg'));
}

/* ── 反証レビュー（2026-11-05 最終）の指摘の再現 ── */
console.log('\n[コード9桁で結んだ時の重なり・単位・同じ方の2枚]');
{
  const sb3 = { window: {} }; vm.createContext(sb3);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'meds-yakka-yj.js'), 'utf8'), sb3);
  const YJT = sb3.window.MedsYakkaYJ.text, yf = Y.yjLookup(YJT);
  const cur = 'マグミット錠330mg 1回1錠 朝食後\nマグミット錠330mg 1回1錠 夕食後\nカクウ錠1mg 1回1錠 朝食後';
  const rows0 = [{ raw: '酸化マグネシウム錠330mg「ケンエー」', rest: '1日2回 朝夕食後 1回1錠 14日分', use: Y.parseUse('1日2回 朝夕食後 1回1錠 14日分', 'dose'), page: 1 },
    { raw: 'カクウ錠1mg', rest: '1日1回 朝食後 1回1錠 14日分', use: Y.parseUse('1日1回 朝食後 1回1錠 14日分', 'dose'), page: 1 }];
  const specs = rows0.map((r) => Y.lineSpec(r, Y.snap(r.raw, { current: cur.split('\n'), used: [], items: ITEMS, yj: YJT })));
  const lines = ['酸化マグネシウム錠330mg 2錠分2 朝夕食後', 'カクウ錠1mg 1錠分1 朝食後'];
  const m = Y.matchCurrent(rows0.map((r, i) => ({ line: lines[i], spec: specs[i].spec, raw: r.raw })), cur);
  const rows = Y.buildRows(m.pairs, m.left, specs, { yjOf: yf });
  const left = rows.filter((r) => r.kind === 'left');
  t('★施設が1つの薬を時点ごとに2行で書き、書類が後発品の名前で1行の時、結ばれなかった方の行に「同じ薬」の知らせを付ける（反証レビュー最終 指摘1）', left.length === 1 && left[0].warns.some((w) => /同じ薬/.test(w)), left);
  const bc = Y.bulkCheck({ autoId: '11', pickId: '11', id: '11', dates: { labeled: ['2026-11-01'], other: [] }, today: '2026-11-04', server: 'ok', current: cur, lastChange: '', sameDay: '',
    doc: { error: '', note: '', pagesTotal: 1, pages: [{ img: 'data:image/jpeg;base64,AA==', error: '' }] }, rows, yjOf: yf });
  t('★その書類は、まとめて反映に入れない（量を二重にしない）', bc.ok === false && bc.why.some((w) => /⚠ の行/.test(w)), bc.why);
  const keepAll = rows.map((r) => Object.assign({}, r, { checked: true, action: r.kind === 'left' ? 'keep' : r.action }));
  const j = Y.judge({ id: '11', dates: { labeled: ['2026-11-01'], other: [] }, date: '2026-11-01', today: '2026-11-04', identity: true, server: 'ok', rows: keepAll, current: cur, yjOf: yf });
  t('★1人ずつで「残す」を選んでも、名前の違う同じ薬が2行になることを重なりとして止める', /同じ名前の薬が2行/.test(j.stop) && j.dupStems.length >= 1, j.stop);
  t('★規格の単位の違い（500μg と 0.5mg）をそろえる（指摘3）', Y.canonKey('メコバラミン錠500μg') === Y.canonKey('メコバラミン0.5mg錠') && Y.canonKey('見本錠0.25μg') !== Y.canonKey('見本錠0.25mg'));
  const RM5 = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
  t('★同じ方の書類が2枚以上ある時は、まとめて反映に入れない（指摘2）', /dupPick\[String\(x\.pick\)\]>1&&\(bc\.ok\|\|bc\.none\)/.test(RM5) && /同じ方の書類が /.test(RM5));
  t('結果のファイルを作った時刻を出し、1日より前なら知らせる（指摘4）', /この結果のファイルは /.test(RM5) && /age>24/.test(RM5));
}

console.log('\n[まとめて反映できるか（bulkCheck）]');
{
  const A0 = 'テストロール錠5mg 1回1錠 朝食後', A1 = 'テストロール錠5mg 1回2錠 朝食後', B = 'ミホンジン錠10mg 1回1錠 夕食後', C = 'カクウパム錠2mg 1回1錠 眠前';
  const row = (kind, cur, line, action, warns) => ({ kind, cur, line, raw: kind === 'left' ? '' : line, page: 1, box: null, warns: warns || [], action, checked: false, auto: line });
  const base = () => ({ autoId: '11', pickId: '11', id: '11', dates: { labeled: ['2026-11-01'], other: [] }, today: '2026-11-04', server: 'ok',
    current: [A0, B, C].join('\n'), lastChange: '2026-10-01', sameDay: '',
    doc: { error: '', note: '', pagesTotal: 1, pages: [{ no: 1, img: 'data:image/jpeg;base64,AA==', error: '', lines: [] }] },
    rows: [row('change', A0, A1, 'change'), row('same', B, B, 'keep'), row('left', C, C, '')] });
  const b0 = base(), r0 = Y.bulkCheck(b0);
  t('★人が確かめる所が無い書類は ok', r0.ok === true && r0.none === false && r0.why.length === 0, r0.why);
  t('★書類に無い今の薬（⚠ 無し）は「残す」にして消さない', r0.kept === 1 && r0.judged.after.split('\n').indexOf(C) >= 0 && r0.judged.counts.stop === 0, r0.judged.after);
  t('反映する全文は確認表と同じ組み立て（変える行だけ差し替え・並びを保つ）', r0.judged.after === [A1, B, C].join('\n'), r0.judged.after);
  t('調剤日は「調剤日」の語の付いた日付', r0.date === '2026-11-01');
  t('★渡した行は書き換えない（写しで判定する）', b0.rows[2].action === '' && b0.rows[0].checked === false);
  const ng = (name, mut, re) => { const st = base(); mut(st); const r = Y.bulkCheck(st); t('★' + name, r.ok === false && r.none === false && r.why.some((w) => re.test(w)), r.why); };
  ng('人が別の方を選び直した書類は1人ずつ', (s) => { s.pickId = '12'; s.id = '12'; }, /一字一致/);
  ng('振り分けが自動で決まっていない書類は1人ずつ', (s) => { s.autoId = ''; }, /一字一致/);
  ng('調剤日を書類から読めない書類は1人ずつ（取り込んだ日で自動にしない）', (s) => { s.dates = { labeled: [], other: ['2026-11-01'] }; }, /調剤日を読めません/);
  ng('調剤日が2つ以上ある書類は1人ずつ', (s) => { s.dates = { labeled: ['2026-11-01', '2026-10-01'], other: [] }; }, /2つ以上/);
  ng('⚠ の行がある書類は1人ずつ', (s) => { s.rows[0].warns = ['薬の名前が一字一致しません']; }, /⚠ の行が 1 行/);
  const sw = base(); sw.rows[1].warns = ['量が1日量か1回量か読めません（1日量として計算しました）'];
  t('今の行と同じ意味の行（書き換えない行）の ⚠ は止めない（確認表の judge と同じ扱い）', Y.bulkCheck(sw).ok === true, Y.bulkCheck(sw).why);
  ng('⚠ の付いた「書類に無い今の薬」がある書類は1人ずつ（残すか中止かを人が決める）', (s) => { s.rows[2].warns = ['同じ薬の名前です']; }, /⚠ の行/);
  const sk = base(); sk.rows.push(row('add', '', 'カクウゲル 適量', 'skip', ['外用・注射の薬のようです']));
  const rsk = Y.bulkCheck(sk);
  t('★書類にあって「入れない」になった外用・頓服の足す行は止めず、名前を一覧に出す（定期薬には書かない・2026-11-05 仮置き）', rsk.ok === true && rsk.skipped.join() === 'カクウゲル' && rsk.judged.after.indexOf('カクウゲル') < 0, rsk);
  const dp = base(); dp.rows[0] = row('same', A0, A0, 'keep'); dp.rows.push(row('add', '', 'カクウテープ4mg　1日1回1回1枚貼付 14日分', 'skip', ['外用・注射の薬のようです']));
  const rdp = Y.bulkCheck(dp);
  t('★毎日使う書き方の外用（新しい定期の貼り薬）が「入れない」になる書類は、変更なしで閉じず1人ずつ（反証レビュー指摘1）', rdp.ok === false && rdp.none === false && rdp.why.some((w) => /⚠ の行/.test(w)), rdp.why);
  const pp = base(); pp.rows[0] = row('same', A0, A0, 'keep'); pp.rows.push(row('add', '', 'カクウ軟膏　1日数回 患部に塗布', 'skip', ['外用・注射の薬のようです']));
  const rpp = Y.bulkCheck(pp);
  t('「1日数回」「適宜」などの外用だけが入れない書類は、変更なしで終え、名前を返す（画面の変更なしの欄にも出す）', rpp.none === true && rpp.skipped.join() === 'カクウ軟膏', rpp);
  ng('外用の足す行を「足す」に変えた（⚠ のまま）書類は1人ずつ', (s) => { s.rows.push(row('add', '', 'カクウゲル 適量', 'add', ['外用・注射の薬のようです'])); }, /⚠ の行/);
  { const mx = base(); for (let k = 0; k < 6; k++) mx.rows.push(row('add', '', 'ツイカ' + k + 'ロール錠1mg 1回1錠 朝食後', 'add'));
    const rmx = Y.bulkCheck(mx);
    t('★変わる行が多い（7行）書類も、ほかに止める理由が無ければ ok（行の数では止めない・本人指示 2026-11-07）', rmx.ok === true && rmx.judged.counts.change + rmx.judged.counts.add === 7 && Y.BULK_MAX === undefined, rmx.why); }
  ng('同じ調剤日の薬情から反映済みの方は1人ずつ', (s) => { s.sameDay = '2026-11-02T10:00'; }, /同じ調剤日/);
  { const od = base(); od.lastChange = '2026-11-03'; const rod = Y.bulkCheck(od);
    t('★定期薬の最後の変更より前の書類も、まとめて反映に入れ、一覧で知らせる日を返す（本人指示 2026-11-07）', rod.ok === true && rod.older === '2026-11-03', rod);
    t('最後の変更より後の書類は知らせない', r0.older === ''); }
  ng('調剤日が今日より後の書類は1人ずつ', (s) => { s.today = '2026-10-30'; }, /今日より後/);
  ng('同じ名前の薬が2行になる書類は1人ずつ', (s) => { s.rows.push(row('add', '', 'カクウパム錠5mg 1回1錠 朝食後', 'add')); }, /同じ名前/);
  ng('★薬情よみとりの読み残しの知らせ（note）がある書類は1人ずつ', (s) => { s.doc.note = 'はじめの 1 ページだけを読みました（残りは読んでいません）'; }, /読み残し/);
  ng('★読めなかったページがある書類は1人ずつ', (s) => { s.doc.pages.push({ no: 2, img: '', error: '画像にできません', lines: [] }); }, /読めなかったページ/);
  ng('★原本の画像が無いページがある書類は1人ずつ', (s) => { s.doc.pages[0].img = ''; }, /画像が無い/);
  ng('★途中までしか読んでいない書類（pagesTotal がページ数より多い）は1人ずつ', (s) => { s.doc.pagesTotal = 3; }, /全部のページ/);
  ng('★書類を渡さない・読めなかった書類は1人ずつ', (s) => { delete s.doc; }, /書類を読めていません/);
  ng('書類に薬の行が1行も無い書類は1人ずつ', (s) => { s.rows = [row('left', A0, A0, ''), row('left', B, B, ''), row('left', C, C, '')]; }, /薬の行を読めません/);
  const up = base(); up.rows = up.rows.concat([row('add', '', 'ツイカロール錠1mg 1回1錠 朝食後', 'add'), row('add', '', 'ツイカジン錠1mg 1回1錠 夕食後', 'add')]);
  const ru = Y.bulkCheck(up);
  t('変わる行が3行の書類も ok', ru.ok === true && ru.judged.counts.change + ru.judged.counts.add === 3, ru.why);
  const nc = base(); nc.rows[0] = row('same', A0, A0, 'keep'); nc.current = [A0, B, C].join('\n');
  const rn = Y.bulkCheck(nc);
  t('★変更が1行も無い書類は none（書かずに終える）で ok ではない', rn.ok === false && rn.none === true && rn.why.length === 0, rn);
  const nn = base(); nn.rows[0] = row('same', A0, A0, 'keep'); nn.sameDay = '2026-11-02T10:00';
  t('変更が無くても、ほかに止める理由があれば none にしない', Y.bulkCheck(nn).none === false);
  t('壊れた入力でも例外を出さない', (() => { try { const r = Y.bulkCheck(null); return r.ok === false && r.none === false; } catch (e) { return false; } })());
}
console.log('\n[医療機関ごとの入れ替えと臨時薬（clinicPlan・本人指示 2026-11-10）]');
{
  const H = 'ミホン内科クリニック';
  const docOf = (...ts) => ({ error: '', note: '', pagesTotal: 1, pages: [{ no: 1, img: 'data:image/jpeg;base64,AA==', error: '', lines: ts.map((t) => ({ t })) }] });
  const D = docOf('お薬の説明書', '医療機関名　ミホン 内科クリニック', '調剤日 2026年11月1日');
  const rowsN = (n) => { const r = []; for (let k = 0; k < n; k++) r.push({ kind: 'same' }); return r; };
  const curN = (n) => Array.from({ length: n }, (_, k) => 'カクウ' + k + '錠1mg 1回1錠 朝食後').join('\n');
  const plan = (nDoc, nReg, o) => Y.clinicPlan(Object.assign({ hospital: H, doc: D, rows: rowsN(nDoc), current: curN(nReg) }, o || {}));
  t('★3剤で定期薬5剤（2剤以上少ない）は臨時薬', plan(3, 5).mode === 'temp');
  t('★3剤で定期薬4剤（1剤だけ少ない）は入れ替え', plan(3, 4).mode === 'replace');
  t('★4剤で定期薬10剤（4剤以上）は入れ替え', plan(4, 10).mode === 'replace');
  t('★1剤で定期薬3剤は臨時薬', plan(1, 3).mode === 'temp');
  t('同じ数・増えた書類は入れ替え', plan(5, 5).mode === 'replace' && plan(6, 2).mode === 'replace');
  t('★医療機関名は全角半角・空白の違いを問わない（書類の「ミホン 内科クリニック」と欄の「ミホン内科クリニック」）', plan(5, 5).clinic === H);
  t('★法人の頭書きの付いた欄でも、書類に法人名が無ければ頭書きを除いて探す', plan(5, 5, { hospital: '医療法人社団ミホン会 ミホン内科クリニック' }).mode === 'replace');
  t('★かかりつけ病院が2つ以上の方は残す（どの薬がどの医療機関か分からない）', plan(5, 5, { hospital: H + '\nカクウ整形外科医院' }).mode === 'keep' && /2つ以上/.test(plan(5, 5, { hospital: H + '\nカクウ整形外科医院' }).why));
  t('同じ名前が2行あるだけなら1つと数える', plan(5, 5, { hospital: H + '\n' + H }).mode === 'replace');
  t('★かかりつけ病院が空の方は残す', plan(5, 5, { hospital: '' }).mode === 'keep');
  t('★書類にかかりつけ病院の名前が無い（ほかの医療機関の書類かもしれない）時は残す', plan(5, 5, { hospital: 'カクウ皮膚科医院' }).mode === 'keep');
  t('★4文字に満たない名前では一致にしない', plan(5, 5, { hospital: 'ミホン', doc: docOf('ミホン') }).mode === 'keep');
  t('かっこ書き（診療科など）は除いて探す', plan(5, 5, { hospital: H + '（内科）' }).mode === 'replace');
  t('書類に文字が無い時は残す', plan(5, 5, { doc: docOf() }).mode === 'keep');
  const skipRows = [{ kind: 'same' }, { kind: 'add', action: 'skip' }, { kind: 'add', action: 'skip' }, { kind: 'add', action: 'skip' }];
  t('★外用・頓服で定期薬に入れない行は書類の薬の数に数えない（内服1剤＋頓服3行／定期薬5剤は臨時薬・反証レビュー指摘1）', Y.clinicPlan({ hospital: H, doc: D, rows: skipRows, current: curN(5) }).mode === 'temp' && Y.clinicPlan({ hospital: H, doc: D, rows: skipRows, current: curN(5) }).nDoc === 1);
  t('★門前の薬局の名前に病院名が入っていても、「薬局」の行では一致にしない（指摘2a）', plan(5, 5, { hospital: 'カクウ中央病院', doc: docOf('処方 ミホン内科', 'カクウ中央病院前薬局') }).mode === 'keep');
  t('★法人の頭書きを除くと一般の語だけ（内科医院）が残る名前では、別の医院に当てない（指摘2b）', plan(5, 5, { hospital: '医療法人カクウ会 内科医院', doc: docOf('処方 ミホン内科医院') }).mode === 'keep');
  t('★行をまたいだ文字では一致にしない（指摘2c）', plan(5, 5, { hospital: 'カクウ中央病院', doc: docOf('市立カクウ中央', '病院前') }).mode === 'keep');
  t('法人の頭書きを除いても固有の名前が4文字以上残る時は、頭書きを除いて探す', plan(5, 5, { hospital: '医療法人カクウ会 ミホンミホン内科', doc: docOf('処方 ミホンミホン内科') }).mode === 'replace');
  t('壊れた入力でも例外を出さない', (() => { try { return Y.clinicPlan(null).mode === 'keep' && Y.clinicPlan({ doc: { pages: [null] } }).mode === 'keep'; } catch (e) { return false; } })());
  const pr = Y.planRows([{ kind: 'left', action: '' }, { kind: 'left', action: 'keep' }, { kind: 'add', action: 'add' }], { mode: 'replace' });
  t('★入れ替えの時は、書類に無い今の行でまだ選んでいない行を「中止」にする（選んだ行は変えない）', pr[0].action === 'stop' && pr[1].action === 'keep' && pr[2].action === 'add');
  t('臨時薬・残すの時は既定を当てない', Y.planRows([{ kind: 'left', action: '' }], { mode: 'temp' })[0].action === '' && Y.planRows([{ kind: 'left', action: '' }], { mode: 'keep' })[0].action === '');

  const A0 = 'テストロール錠5mg 1回1錠 朝食後', A1 = 'テストロール錠5mg 1回2錠 朝食後', B = 'ミホンジン錠10mg 1回1錠 夕食後', C = 'カクウパム錠2mg 1回1錠 眠前';
  const row = (kind, cur, line, action, warns) => ({ kind, cur, line, raw: kind === 'left' ? '' : line, page: 1, box: null, warns: warns || [], action, checked: false, auto: line });
  const base = (mode) => ({ autoId: '11', pickId: '11', id: '11', dates: { labeled: ['2026-11-01'], other: [] }, today: '2026-11-04', server: 'ok',
    current: [A0, B, C].join('\n'), lastChange: '2026-10-01', sameDay: '', doc: D, plan: { mode: mode || 'replace', clinic: H },
    rows: [row('change', A0, A1, 'change'), row('same', B, B, 'keep'), row('left', C, C, '')] });
  const r1 = Y.bulkCheck(base());
  t('★入れ替えの時は、書類に無い今の薬を消して、まとめて反映に入れる', r1.ok === true && r1.judged.counts.stop === 1 && r1.judged.after === [A1, B].join('\n') && r1.lefts.length === 1 && r1.lefts[0].action === 'stop' && r1.lefts[0].k === 2, r1);
  const r2 = Y.bulkCheck(Object.assign(base(), { leftAct: { 2: 'keep' } }));
  t('★一覧で「残す」に選び直した行は消さない', r2.ok === true && r2.judged.counts.stop === 0 && r2.judged.after === [A1, B, C].join('\n'), r2);
  const r3 = Y.bulkCheck(Object.assign(base('keep'), { leftAct: { 2: 'stop' } }));
  t('★残すの時も、一覧で「消す」を選んだ行は消して、まとめて反映に入れる（先発と後発の重なりを同じ画面で消す）', r3.ok === true && r3.judged.counts.stop === 1 && r3.judged.after.indexOf(C) < 0, r3);
  const r4 = Y.bulkCheck(base('temp'));
  t('★臨時薬の時は、書類に無い今の薬を残す（足す・変えるだけ）', r4.ok === true && r4.judged.counts.stop === 0 && r4.kept === 1, r4);
  const r5 = Y.bulkCheck(Object.assign(base(), { lastChange: '2026-11-03' }));
  t('★調剤日が定期薬の最後の変更より前で、消す行がある書類は1人ずつ', r5.ok === false && r5.why.some((w) => /最後の変更より前で、消す行/.test(w)), r5.why);
  const r6 = Y.bulkCheck(Object.assign(base(), { lastChange: '2026-11-03', leftAct: { 2: 'keep' } }));
  t('消す行が無ければ、古い書類も止めずに知らせだけ', r6.ok === true && r6.older === '2026-11-03', r6.why);
  const r7 = Y.bulkCheck(Object.assign(base(), { leftAct: { 0: 'stop', 9: 'stop' } }));
  t('書類に無い今の行でない行・無い番号への選び直しは効かない', r7.judged.counts.change === 1 && r7.judged.counts.stop === 1, r7.judged.counts);
  const w8 = base(); w8.rows[2].warns = ['同じ薬の名前です'];
  t('⚠ の付いた書類に無い今の行は、入れ替えでも1人ずつ（選び直しの一覧に出さない）', Y.bulkCheck(w8).ok === false && Y.bulkCheck(w8).lefts.length === 0);
  const r9 = Y.bulkCheck(Object.assign(base(), { rows: [row('same', A0, A0, 'keep'), row('same', B, B, 'keep'), row('left', C, C, '')] }));
  t('★書類と同じ薬だけで、書類に無い今の薬がある時は「変更なし」にせず消す行として出す', r9.ok === true && r9.none === false && r9.judged.counts.stop === 1, r9);
}
console.log('\n[まとめて反映の画面（resident-master.html）]');
{
  const RM4 = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
  const cut4 = (src, name) => { const h = src.indexOf('function ' + name + '('); if (h < 0) throw new Error('関数が見つかりません: ' + name); let i = src.indexOf('{', h), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } } };
  const ba = cut4(RM4, 'yjBulkApply_'), pl = cut4(RM4, 'yjPreload_'), bh = cut4(RM4, 'yjBulkHtml_');
  t('★1人ずつの確認表も、同じ判断（clinicPlan）で書類に無い今の行の既定を当てる（本人指示 2026-11-10）', /cur\.plan=typeof Y\.clinicPlan==='function'\?Y\.clinicPlan\(\{hospital:cur\.rec&&cur\.rec\.hospital, doc:d, rows:cur\.rows, current:cur\.before\}\):null;/.test(cut4(RM4, 'yjBuild_')) && /cur\.rows=Y\.planRows\(cur\.rows, cur\.plan\)/.test(cut4(RM4, 'yjBuild_')));
  t('★まとめて反映も1人ずつと同じ本文（yjBody_）・同じ受け口（apiPostRaw）で送り、記録に「まとめて反映」と残す', /yjBody_\(c, x, j, p\.bc\.date, p\.bc\.rows, 'まとめて反映'\)/.test(ba) && /apiPostRaw\(body,40000\)/.test(ba));
  t('★ログインの証明が無い時は送らずに止める', /if\(!at\)\{ stopAll=/.test(ba));
  t('★書き込みは再試行しない（apiPostRaw は1人1回・届いたか分からない時は確かめ中にして残りへは送らない）', (ba.match(/apiPostRaw\(/g) || []).length === 1 && /x\.status='unsure'; res\.unsure\+\+; stopAll=/.test(ba) && /r&&r\.unknown\)\{ x\.status='unsure'; res\.unsure\+\+; stopAll=/.test(ba));
  t('★書類の ⚠（読み残し・読めないページ）を判定に渡す', /sameDay:cur\.sameDay, doc:x\.d, yjOf:cur\.yjOf\|\|null, plan:cur\.plan\|\|null\};\s*var bc=YakujoCalc\.bulkCheck\(arg\)/.test(pl));
  t('★調べの描き直しは一覧を見ている時だけ', !/yjPaint_\(\)/.test(pl.replace(/if\(S\.phase==='queue'\) yjPaint_\(\)/g, '')));
  t('★既に反映されていた方は、書き換えた人数に数えない', /r&&r\.already\)\{ x\.status='done'; res\.already\+\+; return; \}/.test(ba));
  t('★1人ずつで開いた書類は、まとめての一覧から外す', /if\(x\.pre&&x\.pre\.st!=='busy'\) x\.pre=null;/.test(cut4(RM4, 'yjStartDoc_')));
  t('★食い違い・同じ調剤日は何も書かずに1人ずつへ回す', /r&&r\.conflict\)\{ back\(/.test(ba) && /r&&r\.sameDay\)\{ back\(/.test(ba));
  t('★確認の窓を1回出してから書く', ba.indexOf('confirm(') >= 0 && ba.indexOf('confirm(') < ba.indexOf('S.bulkBusy=true'));
  t('★入居者マスタGASの版を確かめられない時は書かない', /if\(S\.server!=='ok'\)\{/.test(ba));
  t('★まとめて反映の途中は窓を閉じない・振り分けに戻らない・1人ずつを開かない', /if\(yjSt&&yjSt\.bulkBusy\) return false;/.test(cut4(RM4, 'yjClose_')) && /if\(!S\|\|S\.bulkBusy\) return;/.test(cut4(RM4, 'yjStartDoc_')) && /if\(t\.id==='yjBack'\)\{ if\(yjSt\.bulkBusy\) return;/.test(RM4));
  t('★調べは世代（bulkGen・devGen）が変わったら捨てる', /yjSt===S&&S\.bulkGen===bg&&dg===devGen/.test(pl));
  t('★判定は YakujoCalc.bulkCheck で行い、確認表と同じ組み立て（yjBuild_）で行を作る', /yjBuild_\(cur, x\.d, r\[1\]\)/.test(pl) && /YakujoCalc\.bulkCheck\(/.test(pl));
  t('★読んだ定期薬・行を端末に保存しない', !/localStorage|sessionStorage|indexedDB|console\./.test(ba + pl + bh));
  t('★一覧に出す文字はすべて esc を通す', !/\+\s*(c\.name|r\.cur|r\.line)\s*\+/.test(bh.replace(/esc\([^)]*\)/g, '')));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
