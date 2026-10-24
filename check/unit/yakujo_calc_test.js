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
  t('★反映は docRows を logRows で作って送る', /body\.docRows=YakujoCalc\.logRows\(c\.rows\)/.test(ap2));
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

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
