/* 事務所の管理画面（勤怠管理・給与）の見た目の仕上げ（2026-11-26・su-office.css と手順の段階）の試験
   実行: node check/unit/office_ux_test.js
   守りたいこと:
     1. su-office.css は画面だけ（中身は全部 @media screen の中）・色は画面の色の名前（var(--…)）だけで、色の値を直に書かない
     2. 読むのは勤怠管理と給与の2画面だけ・公開の許可リストに載っている
     3. 月分の帯: 「◀ 月分 ▶」を1つのまとまり（role=group）にし、元の部品（id）は全部残す
     4. 手順の段階: 給与は 勤怠の締め→計算→下書き保存→確定→振込・書き出し、勤怠は 要確認を決める→月を締める→給与で計算。
        済んだ段・今の段（aria-current="step"）・まだの段を状態どおりに出す。勤怠の段は印刷に出さない（no-print）
     5. 締めて給与へ渡す（2026-11-26）: 勤怠の「この月を締めて、給与へ渡す」は今の締めの流れを通し、締めが通った後だけ給与へ移る。
        給与は ?from=kintai を1回だけ読み、確かめが決まった後に「計算する」と同じ関数を呼ぶ（保存・確定は人が押す）。主ボタンは次に押す1つ・警告のある人だけ
     6. 見た目の上積み（2026-11-26）: 押した手応え・ホームの箱の地の色と並び・空の状態 */
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
t('勤怠管理と給与が su-shell.css の次に読む（2026-11-26 の上積みで版を 2026-11-26.1 に上げた・両画面で同じ版）', /su-shell\.css\?v=2026-11-13">\n<link rel="stylesheet" href="su-office\.css\?v=2026-11-26\.1">/.test(KH) && /su-shell\.css\?v=2026-11-13">\n<link rel="stylesheet" href="su-office\.css\?v=2026-11-26\.1">/.test(PH));
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

console.log('\n— 5. 締めて給与へ渡す・受け取って計算する（2026-11-26） —');
const pc = fn(KJ, 'paintClose'), hf = fn(KJ, 'homeFlowHtml'), lm = fn(KJ, 'lockMonth'), lg = fn(KJ, 'lockGo');
t('勤怠: 「この月を締めて、給与へ渡す」（data-act="lock-go"・主ボタン）を「この月を締める」の前に、締められる・要確認0・管理者の時だけ出す',
  /\(!stop && !review && isAdmin\(\) \? '<button type="button" class="btn pri" data-act="lock-go">この月を締めて、給与へ渡す<\/button> ' : ''\) \+\s*(\/\*[^*]*\*\/\s*)?'<button type="button" class="btn' \+ \(!stop && !review && isAdmin\(\) \? '' : ' pri'\) \+ '" data-act="lock"'/.test(pc));
t('勤怠: 窓の外の lock-go は締めの流れ（lockMonth）に後処理 {ym} を渡すだけ・窓の「締める」は今までどおり lockGo', /else if \(a === 'lock-go' && !b\.closest\('#g-dlg'\)\) lockMonth\(b, \{ ym: ym \}\);/.test(KJ) && /else if \(a === 'lock-go'\) lockGo\(b\);/.test(KJ) && KJ.indexOf("a === 'lock-go' && !b.closest") < KJ.indexOf("else if (a === 'lock-go') lockGo(b);"));
t('勤怠: 普通の「この月を締める」で後処理を必ず消す（lockMonth の頭で lockAfter = after || null）', /if \(busy \|\| !month\) return;\s*lockAfter = after \|\| null;/.test(lm) && /else if \(a === 'lock'\) lockMonth\(b\);/.test(KJ));
t('勤怠: 給与へ移るのは kintai_month_lock が通った後だけ（もう締めてある・数字が変わった・断られた時は移らない）', (() => { const i = lg.indexOf("rpc('kintai_month_lock'"), j = lg.indexOf('location.href = payHref(go.ym)'); return i > 0 && j > i && /var go = lockAfter; lockAfter = null; if \(go && go\.ym === ym\)/.test(lg) && lg.indexOf('location.href') === j; })());
t('勤怠: 締めた後のリンクは文言そのまま・href に from=kintai（payHref）・3段目の名前を添える', /'<p class="no-print su-next"><span class="su-next-l">次は 3 の段（給与で計算）:<\/span><a class="btn pri" href="' \+ esc\(payHref\(ym\)\) \+ '">💴 給与の画面でこの月分を計算する<\/a><\/p>'/.test(pc) && /return 'payroll\.html\?ym=' \+ encodeURIComponent\(y \|\| ''\) \+ '&from=kintai';/.test(fn(KJ, 'payHref')));
t('勤怠: 頭の「給与へ」（g-to-pay）には from を付けない（自動の計算は締めと出力・ホームからだけ）', !/from=kintai/.test(fn(KJ, 'paintHop')));
t('勤怠: CSV の箱の見出しの直後に「CSV は要りません」の1行（class "help"）', /給与計算への出力（CSV）<\/h2>' \+\s*'<p class="help">自社の給与の画面は、締めた勤怠をそのまま読みます（CSV の書き出し・取り込みは要りません）。この CSV は、ほかの給与ソフトへ渡す時だけ使います。<\/p>' \+/.test(pc));
t('勤怠: 締めを止める理由は closeStop の1つ（締めと出力とホームで同じ判定・文）', /var stop = closeStop\(lk\);/.test(pc) && /stop = closeStop\(lk\)/.test(hf) && (KJ.match(/期間の末日を過ぎてから締められます/g) || []).length === 1);
t('勤怠: ホームの進み具合は箱の一覧の上・印刷に出さない・同じ3段（closeStepsHtml）', /homeFlowHtml\(\) \+ '<div class="hgrid">'/.test(KJ) && /<section class="hflow no-print"/.test(hf) && /closeStepsHtml\(review, lk, !!stop\)/.test(hf));
t('勤怠: ホームの主ボタン: 要確認→rvd-start／締められる→締めと出力のタブ（ホームで締めない）／止め→理由だけ／締めた→管理者はリンク・ほかは札',
  /else if \(review\) act = '<button type="button" class="btn pri" data-act="rvd-start">要確認を1件目から決める<\/button>'/.test(hf) && /act = '<button type="button" class="btn pri" data-tab="close">締めと出力へ進む<\/button>'/.test(hf) &&
  /else if \(stop\) act = '<span class="hf-why" role="status">' \+ stop \+ '<\/span>'/.test(hf) && /if \(lk\) act = isAdmin\(\) \? '<a class="btn pri" href="' \+ esc\(payHref\(ym\)\) \+ '">💴 給与の画面でこの月分を計算する<\/a>' : '<span class="tag ok">✓ 締めてあります<\/span>'/.test(hf) && !/data-act="lock/.test(hf));
const hfr = fn(PJ, 'hopFrom'), fk = fn(PJ, 'fromKinTry');
t('給与: from は起動の時に hopYm より前に1回だけ読み、kintai と完全一致・ym が形どおりの時だけ印（その月分）にする', /hopFrom\(\); if \(fromKin\) tab = 'run';[^\n]*\n\s*ym = hopYm\(\) \|\| todayYm\(\);/.test(PJ) && /if \(q\.get\('from'\) === 'kintai' && isYm\(y\)\) fromKin = y;/.test(hfr) && (PJ.match(/hopFrom\(\)/g) || []).length === 2);
t('給与: from だけの URL からも from を外す（ym があれば hopYm が外す）', /if \(!q\.has\('ym'\)\) \{ try \{ history\.replaceState\(null, '', location\.pathname \+ location\.hash\); \} catch \(_\) \{\} \}/.test(hfr));
t('給与: 印は端末に残さない（hopFrom・fromKinTry で localStorage・sessionStorage を使わない）・payroll_tab を書かない', !/Storage|lsSet/.test(hfr + fk));
t('給与: 判定は締めた勤怠の確かめ（kcheck）が決まった後に1回・最初に通った時に必ず印を消す', /bs\.kcheck = k; paint\(\); fromKinTry\(\);/.test(PJ) && /if \(!fromKin\) return;\s*var y = fromKin; fromKin = null;/.test(fk));
t('給与: 月分を変える・タブを変えると印を捨てる', /fromKin = null; warnOnly = false;/.test(fn(PJ, 'setYm')) && /if \(t !== tab\) fromKin = null;/.test(fn(PJ, 'setTab')));
t('給与: 未締め・確定済み・下書き（stale でない）では計算せず帯だけ・勤怠の確かめが合わない時は帯を足さない・計算や未保存の編集がある時は何もしない',
  /if \(!bs\.kintai\.locked\) \{ kinBand = \{ cls: 'warn', text: '勤怠がまだ締められていないため、自動では計算していません。' \}/.test(fk) && /if \(frozen\(\)\) \{ kinBand = \{ cls: 'warn', text: 'この月分は確定済みです（計算し直していません）。' \}/.test(fk) &&
  /if \(kintaiBlock\(\)\) return;/.test(fk) && /if \(calc \|\| isDirty\(\) \|\| !C\(\)\) return;/.test(fk) && /if \(status\(\) === 'draft' && !\(bs\.run && bs\.run\.stale\)\) \{ kinBand = \{ cls: 'warn', text: '保存した下書きがあります（計算し直していません）。' \}/.test(fk));
t('給与: 自動では「計算する」と同じ関数（doCompute）だけを呼び、下書き保存・確定はしない', /doCompute\(\);/.test(fk) && !/saveDraft|openConfirm|confirmGo|payroll_run_/.test(fk));
t('給与: 受け取りの帯は手順の段階のすぐ下（flowHtml の末尾）・読み込み・鍵で消す', /'<\/ol>' \+ kinBandHtml\(\);/.test(fn(PJ, 'flowHtml')) && /kinBand = null;/.test(fn(PJ, 'load')) && /kinBand = null;/.test(fn(PJ, 'showLock')) && /role="status"/.test(fn(PJ, 'kinBandHtml')));
const P2 = vm.createContext({ bs: null, calc: null, dirty: false }); vm.runInContext('function status() { return (bs && bs.run && bs.run.status) || null; }\n' + fn(PJ, 'nextAct'), P2);
const na = (o) => { P2.bs = { kintai: { locked: o.locked !== false }, run: o.run || null }; P2.calc = o.calc ? {} : null; P2.dirty = !!o.dirty; return P2.nextAct(); };
t('給与: 主ボタン（塗り）は次に押す1つ: 未計算→計算する・計算して未保存→下書き保存・下書き（変えていない）→確定する・stale→計算する',
  na({}) === 'compute' && na({ calc: true, dirty: true }) === 'save' && na({ run: { status: 'draft' } }) === 'confirm' && na({ run: { status: 'draft', stale: true } }) === 'compute' && na({ calc: true, dirty: true, locked: false }) === 'compute' && na({ calc: true, dirty: true, run: { status: 'draft', stale: true } }) === 'save');
t('給与: 3つのボタンの文言・data-act・並び・押せる条件はそのまま（塗りだけ付け替え）', /'" data-act="compute"' \+ \(c \? '' : ' disabled'\) \+ '>計算する<\/button>';\s*h \+= '<button type="button" class="' \+ pr\('save'\) \+ '" data-act="save"' \+ \(calc && dirty && bs\.kintai\.locked \? '' : ' disabled'\) \+ '>下書き保存<\/button>';\s*h \+= '<button type="button" class="' \+ pr\('confirm'\) \+ '" data-act="confirm"' \+ \(status\(\) === 'draft' && !dirty \? '' : ' disabled'\) \+ '>確定する<\/button>';/.test(fn(PJ, 'runHtml')));
t('給与: 警告のある人だけ（aria-pressed・件数）を合計の帯と見出しの行の間に・警告0件では出さず絞りも効かせない', /sumHtml\(list\) \+ warnFilterHtml\(list\) \+ '<div class="ihd"/.test(fn(PJ, 'runHtml')) && /var wOnly = warnOnly && warnN\(list\) > 0;/.test(fn(PJ, 'runHtml')) && /if \(!n\) return '';/.test(fn(PJ, 'warnFilterHtml')) && /aria-pressed="' \+ \(warnOnly \? 'true' : 'false'\) \+ '">警告のある人だけ（' \+ n \+ '）/.test(fn(PJ, 'warnFilterHtml')));
t('給与: 給与明細の空の状態に「今月の給与を開く」（タブを run に切り替えるだけ）', /この月分の明細はまだありません。「今月の給与」で計算してください。<p class="no-print"><button type="button" class="btn pri" data-tab="run">今月の給与を開く<\/button><\/p><\/div>/.test(fn(PJ, 'slipTabHtml')));

console.log('\n— 6. 見た目の上積み（2026-11-26） —');
t('押した手応え: transition は色の2つだけ（all を書かない）・120ms・押せない時は縮めない・動きを減らす設定では止める', !/transition:\s*all/.test(body) && /transition: background-color 120ms ease-out, border-color 120ms ease-out;/.test(body) && /\.btn:not\(:disabled\):active/.test(body) && /@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none;[^}]*\}\s*:root\[data-su-theme\] \.btn:not\(:disabled\):active[^{]*\{ transform: none; \}/.test(body));
t('ホームの箱: 左の太い帯をやめ、注意・要対応は地の淡い色（色の名前から混ぜる）・並びは 要対応→注意→なし', /\.hbox \{ border-left-width: 1px;/.test(body) && /\.hbox\.warn \{ background: color-mix\(in srgb, var\(--warn-bg\)/.test(body) && /\.hbox\.alert \{ background: color-mix\(in srgb, var\(--ng-bg\)/.test(body) && /\.hcell:has\(> \.hbox\.alert\) \{ order: -2; \}/.test(body) && /\.hcell:has\(> \.hbox\.ok\) \{ order: 1; \}/.test(body));
t('空の状態は中央寄せ・字は --sub・影は足さない', /\.cd\.empty \{ text-align: center; padding: 32px 16px; color: var\(--sub\); \}/.test(body) && !/box-shadow:(?! 0 1px 0 var\(--line\))/.test(body));

console.log('\n結果: ' + pass + ' 合格 / ' + fail + ' 不合格');
process.exit(fail ? 1 : 0);
