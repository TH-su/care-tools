/* 事務所の管理画面（勤怠管理・給与）の見た目の仕上げ（2026-11-26・su-office.css と手順の段階）の試験
   実行: node check/unit/office_ux_test.js
   守りたいこと:
     1. su-office.css は画面だけ（中身は全部 @media screen の中）・色は画面の色の名前（var(--…)）だけで、色の値を直に書かない
     2. 読むのは勤怠管理と給与の2画面だけ・公開の許可リストに載っている
     3. 月分の帯: 「◀ 月分 ▶」を1つのまとまり（role=group）にし、元の部品（id）は全部残す
     4. 手順の段階: 給与は 勤怠の締め→計算→下書き保存→確定→振込・書き出し、勤怠は 要確認を決める→月を締める→給与で計算。
        済んだ段・今の段（aria-current="step"）・まだの段を状態どおりに出す。勤怠の段は印刷に出さない（no-print） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };
const CSS = read('su-office.css'), KH = read('kintai.html'), PH = read('payroll.html'), KJ = read('kintai.js'), PJ = read('payroll.js');

console.log('\n— 1. 画面だけ・色は名前だけ —');
const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '').trim();
t('中身は1つの @media screen の塊だけ', /^@media screen \{[\s\S]*\}$/.test(body) && (body.match(/@media screen/g) || []).length === 1 && !/@media print/.test(body));
t('色の値（#…・rgb）を直に書かない（画面の色の名前だけ＝暗い表示も効く）', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(body));
t('桁そろえは画面の中の表だけ（有給休暇管理簿 #k-ledger の紙の字の大きさの測りに当てない）', !/:root\[data-su-theme\] table/.test(body) && /#g-main table/.test(body));
t('どの決まりも :root[data-su-theme] から書く（画面の <style> より強く・型の画面だけ）', body.split('}').map((x) => x.split('{')[0].trim()).filter((s) => s && !/^@media/.test(s)).every((s) => s.split(',').every((p) => /^(@media[^]*\{\s*)?:root\[data-su-theme\]/.test(p.trim()))));

console.log('\n— 2. 読む画面と公開 —');
t('勤怠管理と給与が su-shell.css の次に読む', /su-shell\.css\?v=2026-11-13">\n<link rel="stylesheet" href="su-office\.css\?v=2026-11-26">/.test(KH) && /su-shell\.css\?v=2026-11-13">\n<link rel="stylesheet" href="su-office\.css\?v=2026-11-26">/.test(PH));
const others = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f) && f !== 'kintai.html' && f !== 'payroll.html').filter((f) => /su-office\.css/.test(read(f)));
t('ほかの画面は読まない', others.length === 0, others);
t('公開の許可リストに載っている', /^!\/su-office\.css$/m.test(read('.gitignore')));

console.log('\n— 3. 月分の帯 —');
const kbar = /<div class="bar no-print su-mbar">([\s\S]*?)\n  <\/div>/.exec(KH), pbar = /<div class="bar su-mbar">([\s\S]*?)\n  <\/div>/.exec(PH);
t('勤怠: ◀ 月分 ▶ がまとまり（role=group）・期間・操作（取り込み直す・読み直す）の順', !!kbar && /<div class="su-mnav" role="group" aria-label="月分の切り替え">\s*<button[^>]*id="g-prev"[\s\S]*id="g-ym"[\s\S]*id="g-next"[^<]*<\/button>\s*<\/div>\s*<span id="g-period"[^>]*><\/span>\s*<div class="su-mact">[\s\S]*id="g-import"[\s\S]*id="g-reload"/.test(kbar[1]));
t('給与: ◀ 月分 ▶ がまとまり・期間・操作（読み直す・鍵をかける）の順', !!pbar && /<div class="su-mnav" role="group" aria-label="月分の切り替え">\s*<button[^>]*id="p-prev"[\s\S]*id="p-ym"[\s\S]*id="p-next"[^<]*<\/button>\s*<\/div>\s*<span id="p-period"[^>]*><\/span>\s*<div class="su-mact">[\s\S]*id="p-reload"[\s\S]*id="p-lock" data-act="pin-lock" hidden/.test(pbar[1]));

console.log('\n— 4. 手順の段階 —');
const P = vm.createContext({}); vm.runInContext(/var FLOW = \[[^\]]*\];/.exec(PJ)[0] + '\n' + fn(PJ, 'flowSteps'), P);
const ps = (o) => P.flowSteps(o).map((x) => x.state[0]).join('');
t('給与: 勤怠が未締め・未計算 → 1段目が今', ps({ locked: false, hasCalc: false, status: null, dirty: false }) === 'cttt' && P.flowSteps({}).map((x) => x.name).join('→') === '勤怠の締め→計算→下書き保存→確定', ps({}));
t('給与: 締め済み・未計算 → 計算が今', ps({ locked: true, hasCalc: false, status: null }) === 'dctt');
t('給与: 計算した・保存していない → 下書き保存が今', ps({ locked: true, hasCalc: true, status: null, dirty: true }) === 'ddct');
t('給与: 下書き保存済み（変えていない）→ 確定が今', ps({ locked: true, hasCalc: true, status: 'draft', dirty: false }) === 'dddc');
t('給与: 下書きの後に変えた（保存していない）→ 下書き保存が今に戻る', ps({ locked: true, hasCalc: true, status: 'draft', dirty: true }) === 'ddct');
t('給与: 確定済み・書き出し済み → 全部済み（振込・書き出しは段に入れない＝確定し直した月で食い違わない）', ps({ locked: true, status: 'confirmed' }) === 'dddd' && ps({ locked: true, status: 'exported' }) === 'dddd');
t('給与: 保存の後に設定が変わった（stale）は dirty として渡す＝確定を今にしない', /dirty: dirty \|\| !!\(bs\.run && bs\.run\.stale\)/.test(fn(PJ, 'flowHtml')));
t('給与: 今月の給与の見出しの下に描く・今の段に aria-current="step"', /'<\/h2>' \+ flowHtml\(\) \+ '<div class="row">'/.test(PJ) && /aria-current="step"/.test(fn(PJ, 'flowHtml')) && /\.su-steps/.test(CSS));
const K = vm.createContext({}); vm.runInContext(fn(KJ, 'closeSteps'), K);
const ks = (r, l) => K.closeSteps(r, l).map((x) => x.state[0]).join('');
t('勤怠: 要確認が残る → 1段目が今で「残り N 件」', ks(3, false) === 'ctt' && K.closeSteps(3, false)[0].sub === '残り 3 件');
t('勤怠: 要確認 0・未締め → 月を締めるが今', ks(0, false) === 'dct');
t('勤怠: 締めた → 給与で計算が今', ks(0, true) === 'ddc' && ks(5, true) === 'ddc');
t('勤怠: 締めが止まっている間（期間の末日前・シフト未取り込み）は「まだ締められません」', K.closeSteps(0, false, true)[1].sub === 'まだ締められません' && K.closeSteps(0, true, true)[1].sub === '');
t('勤怠: 締めの見出しの下に描き、印刷に出さない', /月の締め<\/h2>' \+ closeStepsHtml\(review, lk, !!stop\)/.test(KJ) && /<ol class="su-steps no-print" aria-label="締めの手順">/.test(fn(KJ, 'closeStepsHtml')));

console.log('\n結果: ' + pass + ' 合格 / ' + fail + ' 不合格');
process.exit(fail ? 1 : 0);
