/* 自分の勤怠の給与明細（kintai-self-slip.js・統合 0145・2026-11-28）の純関数と画面のつなぎの試験
   実行: node check/unit/kintai_self_slip_test.js
   守りたいこと: 一覧は新しい順・明細は支給・控除・勤怠の3つと合計だけ・知らない区分（会社が払う保険料など）を出さない・
   HTML の代入を使わない・端末に残さない・閉じる時に捨てる・タブが4つ。人と金額は架空 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const K = require(path.join(ROOT, 'kintai-self-slip.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const L = K.listRows([{ ym: '2027-03', pay_date: '2027-03-25', net: 201234 }, { ym: '2027-04', pay_date: '2027-04-25', net: 210000 }, { ym: 'x' }, null]);
t('一覧: 新しい順・形の違う行は捨てる', L.length === 2 && L[0].ym === '2027-04' && L[0].title === '2027年4月分' && L[0].pay === '2027年4月25日 支給' && L[1].net === '201,234 円', L);
const V = K.slipView({ ym: '2027-04', pay_date: '2027-04-25', period: { from: '2027-03-16', to: '2027-04-15' }, company_name: '見本の会社', name: '見本 一郎', gross: 250000, deduct: 40000, net: 210000,
  lines: [{ sec: 'pay', code: 'basic', name: '基本給', qty: null, amount: 240000 }, { sec: 'deduct', code: 'health', name: '健康保険', amount: 12000 },
    { sec: 'att', code: 'workDays', name: '出勤日数', qty: 20 }, { sec: 'att', code: 'overtimeMin', name: '残業', qty: 95 }, { sec: 'att', code: 'x', name: '空', qty: null },
    { sec: 'employer', code: 'er_emp', name: '雇用保険料（会社）', amount: 999 }, { sec: 'pay', code: 'adj:0', name: '調整', amount: -500 }] });
t('明細: 題・支給日と期間・会社と名前', V.title === '2027年4月分 給与明細' && V.sub === '支給日 2027年4月25日・期間 3/16〜4/15' && V.company === '見本の会社' && V.name === '見本 一郎', V);
t('明細: 支給2行（マイナスは −）・控除1行', JSON.stringify(V.pay) === JSON.stringify([{ name: '基本給', value: '240,000 円' }, { name: '調整', value: '−500 円' }]) && V.deduct.length === 1, [V.pay, V.deduct]);
t('明細: 勤怠は日・回はそのまま・分は時間:分・空は出さない', JSON.stringify(V.att) === JSON.stringify([{ name: '出勤日数', value: '20' }, { name: '残業', value: '1:35' }]), V.att);
t('明細: 会社が払う保険料（employer）は出さない', !JSON.stringify(V).includes('会社）') && !JSON.stringify(V).includes('999'));
t('明細: 合計3つ', JSON.stringify(V.totals) === JSON.stringify([['総支給額', '250,000 円'], ['控除の合計', '40,000 円'], ['差引支給額', '210,000 円']]));
t('断りの文: 古い受け口（format）は「まだ使えません」・知らない符号は読めない', /まだ使えません/.test(K.errText('format')) && /うまく読めません/.test(K.errText('zzz')));

const S = read('kintai-self-slip.js'), J = read('kintai-self.js'), H = read('kintai-self.html'), C = read('kintai-self.css'), G = read('.gitignore');
const code = S.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
t('画面: HTML の代入を使わない（innerHTML・insertAdjacentHTML・outerHTML なし）', !/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(code));
t('画面: 端末に残さない・console なし', !/localStorage|sessionStorage|indexedDB|console\./.test(code));
t('画面: 受け口の op は payslips と payslip だけ', (code.match(/callFn\('([a-z_]+)'/g) || []).sort().join() === ["callFn('payslip'", "callFn('payslips'"].join());
t('つなぎ: タブに slip・閉じる時に reset・開いた時に start', /var TABS = \['days', 'leave', 'req', 'slip'\];/.test(J) && /window\.KintaiSelfSlip\.reset\(\)/.test(J) && /window\.KintaiSelfSlip\.start\(/.test(J) && /window\.KintaiSelfSlip\.load\(\)/.test(J));
t('HTML: タブのボタン「給与明細」と枠・部品を ?v= つきで読む', /id="t-slip" data-tab="slip" aria-controls="p-slip">給与明細</.test(H) && /id="p-slip" role="tabpanel" aria-labelledby="t-slip" hidden/.test(H) && /<script src="kintai-self-slip\.js\?v=\d{4}-\d{2}-\d{2}[^"]*"><\/script>/.test(H));
t('見た目: タブは4列・押す行は 48px', /\.tabs \{ display: grid; grid-template-columns: repeat\(4, 1fr\);/.test(C) && /\.slip-row \{[^}]*min-height: 48px/.test(C));
t('公開の許可に kintai-self-slip.js', /^!\/kintai-self-slip\.js$/m.test(G));
console.log('\n' + pass + ' 件合格・' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
