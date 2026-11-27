/* 事故報告書の画面（accident-report.html）の守りの試験（2026-11-28 新設・本人指示）
   実行: node check/unit/accident_report_page_test.js
   守ること:
     1. 現場の端末の止め → ログインの役割の確かめ（su-app-gate.js の accident-report）→ 中身を読む、の順。止めの前・確かめの前に何も読まない
     2. 遅れて届いた応答は世代（gen）で捨てる。入居者マスタの1人分は、返ってきた番号が選んだ方と同じ時だけ使う
     3. 保存済みの報告を開いた時は入居者マスタの値で上書きしない（入れ直しのボタンを押した時だけ）
     4. 通信は共通 DB の acc_list・acc_save・acc_cancel と入居者マスタの読み取り（SUResRead）だけ。Google へは送らない
     5. 端末に残すのは入力／紙の見た目の切り替え（acc_pane）だけ。console.log・service worker・外の配信元なし
     6. 印刷は SUPrint の 'accident'（A4 縦）。右上の施設名・印刷日の印は付けない。水色の枠は印刷でも白くしない。紙に zoom・transform を使わない
     7. 見出しの「← メニュー」・使い方（su-shell.js）・不具合の報告（su-report.js）・共通部品の版
     8. 保存していないまま印刷を押したら先に保存し、保存できなければ刷らない。保存していない変更は離れる前に確かめる
   画面のコードは書き換えず、ソースを読むだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const H = fs.readFileSync(path.join(ROOT, 'accident-report.html'), 'utf8');
const GATE = fs.readFileSync(path.join(ROOT, 'su-app-gate.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'su-shell.js'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
const scriptStart = H.indexOf('<script>\n\'use strict\';');
const JS = H.slice(scriptStart, H.indexOf('</script>', scriptStart));
const fn = (name) => { const i = JS.indexOf('\nfunction ' + name + '('); if (i < 0) return ''; const j = JS.indexOf('\nfunction ', i + 10); return JS.slice(i, j < 0 ? undefined : j); };
const CSS = H.slice(H.indexOf('<style>'), H.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, (c) => (/═══ 紙/.test(c) ? '/* ═══ 紙 */' : ''));

console.log('1. 起動の順');
const boot = fn('boot_');
const iField = boot.indexOf('isField()'), iGate = boot.indexOf("SUAppGate.run('accident-report'");
t('端末の用途の止めの後にログインの役割を確かめる', iField > 0 && iGate > iField, { iField, iGate });
t('確かめの前（起動）では中身を読まない', !/rpc_\(|resRead_\(|loadHome_\(|lsGet\(/.test(boot));
t('部品が無い時は開かない（案内だけ）', /if\(!window\.SUAppGate\)/.test(boot) && /読み込めませんでした/.test(boot));
t('開ける時だけ続き（startApp_）を呼び、続きが中身を読む', /if\(!ok\)\{ view='gate'; return 'gate'; \}\s*return startApp_\(\);/.test(boot) && /loadHome_\(\)/.test(fn('startApp_')));
t('su-app-gate.js を画面のスクリプトより前に読む・版は全画面と同じ', (function () {
  const i = H.indexOf('<script src="su-app-gate.js?v='); const v = (H.match(/su-app-gate\.js\?v=([^"]+)"/) || [])[1];
  const other = (fs.readFileSync(path.join(ROOT, 'equip-log.html'), 'utf8').match(/su-app-gate\.js\?v=([^"]+)"/) || [])[1];
  return i > 0 && i < scriptStart && v && v === other;
})());
t('su-app-gate.js の一覧に事故報告書（既定は事務所・管理者だけ・現場は開けない）', /\{ key: 'accident-report', href: 'accident-report\.html', ic: '[^']+', nm: '事故報告書', def: \{ office: true, field: false \} \}/.test(GATE));
t('現場の端末は止めの画面だけ（端末の用途が変わったら読み込み直す）', /function showFieldOnly_\(\)/.test(JS) && /ev\.key===DEVICE_KEY&&isField\(\)&&view!=='field'/.test(JS));

console.log('2. 取り違えの守り');
const pick = fn('pickResident_');
t('入居者を選ぶたびに世代を上げ、応答は世代が同じ時だけ使う', /gen\+\+; var my=gen;/.test(pick) && (pick.match(/if\(my!==gen\) return;/g) || []).length >= 3);
t('入居者マスタの1人分は返ってきた番号が選んだ方と同じ時だけ使う', /if\(!s\|\|String\(s\.id\)!==r\.id\)\{ master=\{missing:true\}; return; \}/.test(pick));
t('報告の一覧は選んだ方の行だけを持つ', /String\(x\.resident_id\)===r\.id/.test(pick));
t('保存・取り消しの応答も世代を見る', /if\(my!==gen\) return false;/.test(fn('save_')) && /if\(my!==gen\) return;/.test(fn('cancelReport_')));
t('競合の読み直しは、選んでいる方・開いている報告と同じ行の時だけ', /String\(row\.resident_id\)!==String\(cur\.id\)\|\|String\(row\.id\)!==String\(draft\.id\)/.test(JS));

console.log('3. 保存済みの報告を入居者マスタで上書きしない');
t('報告を開く時は入居者マスタの値を入れない', fn('openReport_').length > 0 && !/fromResident/.test(fn('openReport_')));
t('入居者マスタから入れるのは、新しい報告と「入れ直す」の時だけ', (JS.match(/C\.fromResident\(/g) || []).length === 2 && /fromResident/.test(fn('newReport_')) && /a==='refill'[\s\S]{0,400}C\.fromResident\(/.test(JS));

console.log('4. 通信');
const rpcs = [...JS.matchAll(/rpc_\('([a-z_]+)'/g)].map((m) => m[1]);
t('共通 DB の関数は acc_list・acc_save・acc_cancel だけ', rpcs.length > 0 && rpcs.every((n) => ['acc_list', 'acc_save', 'acc_cancel'].indexOf(n) >= 0), [...new Set(rpcs)]);
t('入居者マスタは SUResRead で読み、Google へ回る時は断る', /window\.SUResRead\.call\(body,noGas,\{screen:'accident-report'\}\)/.test(JS) && !/script\.google\.com/.test(JS) && !/fetch\(/.test(JS));
t('入居者マスタの読み取りは名簿（getRoster）と1人分の基本の欄（getSection basic）だけ', (JS.match(/resRead_\(\{action:'([a-zA-Z]+)'/g) || []).sort().join() === ["resRead_({action:'getRoster'", "resRead_({action:'getSection'"].sort().join() && /section:'basic'/.test(JS));
t('保存の本文は計算の部品（toSave）で作る＝決まった8つの鍵', /body=C\.toSave\(draft,fac_\(\)\)/.test(JS) && /rpc_\('acc_save',\{p_row:body,p_rev:rev\}\)/.test(JS));

console.log('5. 端末に残す物・書いてはいけない物');
const sets = [...JS.matchAll(/lsSet\(([^,]+),/g)].map((m) => m[1]).filter((k) => k !== 'k');   // k は関数の定義の引数
t('端末に書くのは acc_pane だけ（決まった値）', sets.length > 0 && sets.every((k) => k === 'LS_PANE') && /LS_PANE='acc_pane'/.test(JS) && /localStorage\.setItem/.test(JS) && (JS.match(/localStorage\.setItem/g) || []).length === 1);
t('console.log を書かない', !/console\.(log|info|debug)/.test(H));
t('service worker を入れない', !/serviceWorker/.test(H));
t('外の配信元のスクリプトを読まない', [...H.matchAll(/<script src="([^"]+)"/g)].every((m) => !/^https?:/.test(m[1])));
t('インラインのイベント属性を書かない', !/\son[a-z]+="/i.test(H.replace(/<script>[\s\S]*?<\/script>/g, '')));
t('CSP の指紋がある（node check/csp.mjs で一致を確かめる）', /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/.test(H));

console.log('6. 印刷');
t("SUPrint の 'accident'（A4 縦・余白 10mm）で刷る", /SUPrint\.define\('accident',\{label:'事故報告書',paper:'A4 portrait',margin:10,root:'#a-print'/.test(JS));
t('施設情報を待ってから刷る（facGate）', /window\.SUPrint\.facGate\(go,/.test(fn('print_')));
t('右上の施設名・印刷日の印（data-su-print-head）を付けない', !/data-su-print-head/.test(H) && !/data-su-print-head/.test(fs.readFileSync(path.join(ROOT, 'accident-report-calc.js'), 'utf8')));
t('水色の枠は印刷でも白くしない（print-color-adjust: exact）', /\.ar-c\.ar-bl\{background:#DEEAF8; -webkit-print-color-adjust:exact; print-color-adjust:exact\}/.test(CSS) && /\.ar-red\{[^}]*print-color-adjust:exact/.test(CSS));
t('紙と印刷の CSS に zoom・transform を使わない（縮めるのは画面の見本の .pv だけ）', (function () {
  const paper = CSS.slice(CSS.indexOf('/* ═══ 紙'));
  return !/zoom|transform/.test(paper) && !/zoom/.test(CSS) && (CSS.match(/transform/g) || []).length === (CSS.match(/\.pv\{transform-origin|\.btn:active\{transform|#toast\{[^}]*transform|transform:none/g) || []).length;
})());
t('丸は文字を動かさない楕円（疑似要素を絶対配置）', /\.ar-o\{position:relative; display:inline-block/.test(CSS) && /\.ar-o\.ar-on::before\{content:''; position:absolute;[^}]*border:\.6mm solid #000; border-radius:50%/.test(CSS));
t('改ページはページの箱ごと・別紙は新しいページから', /\.ar-page \+ \.ar-page,\.ar-sheet2\{break-before:page/.test(CSS));
t('欄ごとの文字の大きさと別紙は、印刷の規則が当たった後（measure）で決める', /measure:function\(\)\{\s*var p=\$\('a-print'\); renderPaper_\(p\);/.test(JS) && /pagesOf:function\(\)\{ return printPages; \}/.test(JS));
t('保存していないまま印刷を押したら先に保存し、保存できなければ刷らない', /if\(!draft\.id\|\|isDirty_\(\)\)\{[\s\S]*?return save_\(\)\.then\(function\(ok\)\{ if\(ok\) gate\(\); \}\);/.test(fn('print_')));
t('印刷の紙は後始末で消す（氏名を DOM に残さない）', /after:function\(\)\{ var p=\$\('a-print'\); if\(p\) p\.innerHTML=''; printOn=false; \}/.test(JS));

t('紙の CSS は ar- の型だけを相手にする（入力画面の汎用の型の名前を紙の決まりに使わない）', (function () {
  const paper = CSS.slice(CSS.indexOf('/* ═══ 紙'), CSS.indexOf('#a-print{'));
  const sels = [...paper.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((x) => x && !/^@/.test(x));
  return sels.length > 20 && sels.every((sel) => (sel.match(/\.[a-zA-Z][\w-]*/g) || []).every((c) => /^\.ar-/.test(c)));
})());
t('入力画面の .row は紙の箱に当たらない（紙の箱は ar-row）', /^\.row\{/m.test(CSS) && !/class="ar-b row/.test(H));

console.log('6b. 取り消し・競合・大きく開く');
t('取り消しの応答は、送った報告を今も開いている時だけ画面を片づける', /var same=!!\(draft&&String\(draft\.id\)===String\(id\)\)/.test(fn('cancelReport_')) && /if\(same\)\{ newReport_\(\);/.test(fn('cancelReport_')));
t('取り消しの通信中は、開く・保存・写す・印刷を止める', /if\(cancelling&&\/\^\(pick\|open-recent\|home\|new\|open\|follow-nth\|follow-final\|save\|print/.test(JS) && /b\.disabled=loading\|\|saving\|\|cancelling/.test(JS));
t('方を開く・報告を開く・新しい報告・写す・一覧へ戻るで、競合の「読み直す」を外す', /clearConflict_\(\)/.test(fn('openReport_')) && /clearConflict_\(\)/.test(fn('newReport_')) && /clearConflict_\(\)/.test(fn('pickResident_')) && /clearConflict_\(\)/.test(fn('showHome_')) && /clearConflict_\(\); draft=C\.followUp/.test(JS));
t('「この報告を取り消す」は保存・印刷の帯に置かず、入力の末尾に離して置く', (function () {
  const bar = H.slice(H.indexOf('<div class="bar" id="a-bar">'), H.indexOf('<nav class="panes"'));
  const endI = H.indexOf('id="a-endzone"'), formI = H.indexOf('<div class="form" id="a-form">');
  return bar.indexOf('cancel-report') < 0 && endI > formI && /<button type="button" class="btn warn-line" data-act="cancel-report" id="a-cancel">/.test(H);
})());
t('紙を大きく開く窓（Esc・閉じるで閉じる）', /data-act="big-open"/.test(H) && /<div class="big" id="a-big" role="dialog" aria-modal="true"/.test(H) && /ev\.key==='Escape'&&bigOpen/.test(JS) && /a==='big-close'\) return closeBig_\(\)/.test(JS));
t('紙の上の丸を押す所は見た目より広い（画面の見本だけ）', /\.pv \.ar-o::after\{content:''; position:absolute;/.test(CSS));
t('死亡年月日の入力は「死亡」を選んだ時だけ出す', /<div data-other-of="severity:death" hidden>'\+date_\('deathDate'/.test(JS));

console.log('7. 見出し・共通の部品');
t('見出しに「← メニュー」と役割の札の場所', /<header class="hdr su-shell-hdr">\s*<a class="hdr-btn" href="index\.html">← メニュー<\/a>\s*<h1>事故報告書<\/h1>[\s\S]*<span class="su-shell-role" hidden><\/span>/.test(H));
t('su-shell.js の使い方の表に事故報告書', /'accident-report\.html': 'accident-report'/.test(SHELL));
t('不具合を報告（su-report.js）を </body> の直前に置く', /<script src="su-report\.js\?v=[^"]+" data-tool="事故報告書"><\/script>\s*<\/body>/.test(H));
t('見た目の共通の型（su-theme.css）を当てる', /<html lang="ja" data-su-theme>/.test(H) && /su-theme\.css\?v=/.test(H));
t('保存していない変更は離れる前に確かめる（beforeunload・別の方・一覧へ・新しい報告）', /window\.addEventListener\('beforeunload'/.test(JS) && (JS.match(/保存していない書きかけがあります/g) || []).length >= 3);
t('innerHTML へ入れる値は esc を通す（紙は計算の部品の中で esc）', !/innerHTML=[^;]*\+\s*r\.(name|room|resident_name)\b/.test(JS));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
if (fail) process.exitCode = 1;
