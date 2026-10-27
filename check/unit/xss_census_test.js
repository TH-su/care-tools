/* xss_census_test.js — 公開中の全 .html・.js の HTML の代入の点検表（2026-10-25・本人指示）
 *
 * 公開されるファイル（.gitignore のホワイトリストで公開されるもの＝git ls-files に出る .html・.js）を全部読み、
 * innerHTML・outerHTML への代入（+= を含む）と insertAdjacentHTML の呼び出しを1か所ずつ拾い、下の点検表と突き合わせる。
 *   (a) 公開中の対象ファイルが全部、点検表に載っている（新しいファイルは点検表に足すまで落ちる。消えたファイルが表に残っていても落ちる）
 *   (b) ファイルごとに、実物の代入の一覧と点検表の一覧が一致する（増えた・減った・文が変わったで落ちる。合わない文をそのまま出す）
 *   (c) 区分が3つのどれか
 * ★区分が正しいか（本当に esc を通っているか・本当に数だけか）は、点検した人の責任。この試験が見るのは「登録と実物の一致」だけ。
 *   代入を足した・直した時は、入る値を読んで区分を決めてから点検表を直す。利用者・職員の入力やサーバーの文が
 *   esc を通らずに入る代入は、区分を偽って載せない（直すか、代表者に知らせる）。
 *
 * 区分（3つだけ）
 *   固定の文    … 空文字・固定の文字列・固定の骨組み（値は後から textContent 等で入れる）
 *   esc を通る  … 記録・名簿・利用者・職員・自由入力・サーバーの文が esc・escHtml・escapeHtml・escText 等を通って入る
 *   数だけ      … 数・日付の数・決まった表の値（画面の中の定数の表）だけで組み立てる
 *
 * 文の取り方（行番号は使わない）
 *   ・.html は <script> の中（src の無いもの。application/json・importmap は除く）、.js はファイル全体を読む
 *   ・コメント・文字列・正規表現の中は数えない。ただし、コメント・文字列の中に代入の形が出てきたら落とす
 *     （読み取りの誤りで本物の代入を見落とさないため。そういう書き方をした時は書き方を変える）
 *   ・1文 ＝ 代入の左辺の始まり（同じ行の直前の ; { } , または行頭の後）から右辺の終わり（; , 閉じ括弧・式が続かない改行）まで。
 *     insertAdjacentHTML は対応する ) まで。前後の空白を落とし、連続する空白（改行を含む）を1つの空白にする
 *   ・<script> の外（HTML の属性など）に代入の形があったら落とす（CSP で onclick 等は使わない決まり）
 *
 * 除外（同梱した外部の部品。介護ツール自身のコードは除外しない）は下の EXCLUDE_* に理由つきで書く。
 * 除外に当たる物が見つからなくなった時も落とす（除外の一覧が古いまま残らないように）。
 * 架空データ・本番データは使わない（公開ファイルのソースだけを読む）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const T0 = Date.now();

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + String(info).slice(0, 4000))); }
}

/* ══════════════ 除外（同梱した外部の部品）══════════════ */
/* ファイルごと除外する部品。名前の形と、中身の先頭の印の両方が合った時だけ除外する（名前だけ似せたファイルは数える） */
const EXCLUDE_FILES = [
  { re: /^supabase-js-[\d.]+\.js$/, head: '@supabase/supabase-js', why: 'Supabase の公式部品（npm の原本をそのまま同梱）' },
  { re: /^jspdf-[\d.]+\.umd\.js$/, head: 'jsPDF', why: 'jsPDF（PDF を作る部品・原本のまま）' },
  { re: /^chart-js-[\d.]+\.umd\.js$/, head: 'chart.js', why: 'Chart.js（グラフの部品・npm の原本のまま）' },
  { re: /^universe-sandbox\/vendor\/three\.module\.js$/, head: 'Three.js Authors', why: 'three.js（3D の部品・原本のまま）' },
  { re: /^universe-sandbox\/vendor\/OrbitControls\.js$/, head: 'OrbitControls performs orbiting', why: 'three.js の OrbitControls（原本のまま）' }
];
/* フォルダごと除外する物 */
const EXCLUDE_DIRS = [
  { dir: 'check/', why: '検証道具（試験・撮影の道具。画面からは読まれない。試験の中の偽の document や、この点検表の文字列自体を数えてしまうため）' }
];
/* HTML の中に丸ごと埋め込んだ部品（その <script> 1つを除外）。先頭の印の両方が合った時だけ */
const EXCLUDE_BLOCKS = [
  { file: 'genogram.html', heads: ['.Konva=e()', 'Konva JavaScript Framework'], why: '家族構成図に埋め込んだ Konva（描画の部品・圧縮済みの原本）' }
];
/* 部品をまとめた成果物の中の、部品側の文（ちょうどこの文だけを除外する） */
const EXCLUDE_STMTS = [
  { file: 'mailer/public/app.js', stmt: 'if(e.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in e)e.innerHTML=t', why: 'SilverMail の画面の束（esbuild）に入った React（react-dom）の内部。dangerouslySetInnerHTML を入れる所' },
  { file: 'mailer/public/app.js', stmt: 'Io.innerHTML="<svg>"+t.valueOf().toString()+"</svg>"', why: '同上（react-dom の SVG 用の内部）' },
  { file: 'mailer/public/app.js', stmt: 'e.innerHTML="<script><\\/script>"', why: '同上（react-dom が script 要素を作る内部）' }
];

/* ══════════════ 文の取り出し（EXTRACT-BEGIN）══════════════ */
const KW = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
/* コードの文字だけ 1 にする（コメント・文字列・テンプレートの文字の所・正規表現は 0。テンプレートの ${ } の中はコード） */
function codeMask(s) {
  const n = s.length, m = new Uint8Array(n), stack = [];
  let i = 0, brace = 0, last = '';
  function tmpl() {
    while (i < n) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; last = 'x'; return; }
      if (c === '$' && s[i + 1] === '{') { i += 2; stack.push(brace); brace++; last = '{'; return; }
      i++;
    }
  }
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      i++;
      while (i < n && s[i] !== c && s[i] !== '\n') { if (s[i] === '\\') i++; i++; }
      i++; last = 'x'; continue;
    }
    if (c === '`') { i++; tmpl(); continue; }
    if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || KW.has(last))) {
      i++; let cls = false;
      while (i < n && s[i] !== '\n') {
        const e = s[i];
        if (e === '\\') { i += 2; continue; }
        if (e === '[') cls = true; else if (e === ']') cls = false;
        else if (e === '/' && !cls) break;
        i++;
      }
      i++; while (i < n && /[a-z]/.test(s[i])) i++;
      last = 'x'; continue;
    }
    if (c === '{') brace++;
    if (c === '}') {
      if (stack.length && stack[stack.length - 1] === brace - 1) { stack.pop(); brace--; i++; tmpl(); continue; }
      brace--;
    }
    m[i] = 1;
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_$]/.test(s[j])) { m[j] = 1; j++; }
      last = s.slice(i, j); if (!KW.has(last)) last = 'x';
      i = j; continue;
    }
    if (!/\s/.test(c)) last = (c === ')' || c === ']') ? 'x' : c;
    i++;
  }
  return m;
}
const CONT_END = '+-*/%?:=&|^<>~!,.([{';   /* 行の終わりがこれなら式は次の行へ続く */
const CONT_START = '+-*/%?:=&|^<>.,';      /* 次の行の始まりがこれなら式は続いている */
function stmtAt(s, m, at, kind, after) {
  let b = at, depth = 0;
  for (let k = at - 1; k >= 0; k--) {
    const c = s[k];
    if (!m[k]) continue;
    if (c === ')' || c === ']') { depth++; b = k; continue; }
    if (c === '(' || c === '[') { if (depth === 0) { b = k + 1; break; } depth--; b = k; continue; }
    if (depth === 0 && (c === ';' || c === '\n' || c === ',' || c === '{' || c === '}')) { b = k + 1; break; }
    b = k;
  }
  let e = s.length; depth = 0;
  if (kind === 'call') {
    for (let k = after - 1; k < s.length; k++) {
      if (!m[k]) continue;
      const c = s[k];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { depth--; if (depth === 0) { e = k + 1; break; } }
    }
  } else {
    let lastCode = '=';
    for (let k = after; k < s.length; k++) {
      const c = s[k];
      if (!m[k]) { if (!/\s/.test(c)) lastCode = 'x'; continue; }
      if ('([{'.includes(c)) { depth++; lastCode = c; continue; }
      if (')]}'.includes(c)) { if (depth === 0) { e = k; break; } depth--; lastCode = 'x'; continue; }
      if (depth === 0 && (c === ';' || c === ',')) { e = k; break; }
      if (depth === 0 && c === '\n') {
        if (CONT_END.includes(lastCode)) continue;
        let j = k + 1; while (j < s.length && /\s/.test(s[j])) j++;
        if (j < s.length && m[j] && CONT_START.includes(s[j]) && !(s[j] === '/' && (s[j + 1] === '/' || s[j + 1] === '*'))) continue;
        e = k; break;
      }
      if (!/\s/.test(c)) lastCode = c;
    }
  }
  return s.slice(b, e).replace(/\s+/g, ' ').trim();
}
/* 代入の形。[ 'innerHTML' ] の書き方も拾う */
const SINK = /(?:\.\s*(?:innerHTML|outerHTML)|\[\s*['"](?:innerHTML|outerHTML)['"]\s*\])\s*\+?=(?!=)|(?:\.\s*insertAdjacentHTML|\[\s*['"]insertAdjacentHTML['"]\s*\])\s*\(/g;
function extractJs(src) {
  const m = codeMask(src), out = [], hidden = [];
  SINK.lastIndex = 0; let r;
  while ((r = SINK.exec(src))) {
    if (!m[r.index]) { hidden.push(src.slice(Math.max(0, r.index - 60), r.index + 60).replace(/\s+/g, ' ')); continue; }
    out.push(stmtAt(src, m, r.index, r[0].includes('insertAdjacentHTML') ? 'call' : 'assign', r.index + r[0].length));
  }
  return { out, hidden };
}
function scriptBlocks(html) {
  const res = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let r;
  while ((r = re.exec(html))) {
    if (/\bsrc\s*=/i.test(r[1])) continue;
    if (/type\s*=\s*["']?(application\/json|importmap)/i.test(r[1])) continue;
    res.push({ body: r[2], start: r.index + r[0].indexOf('>') + 1, end: r.index + r[0].length });
  }
  return res;
}
/* EXTRACT-END */

/* ══════════════ 点検表 ══════════════ */
const F = '固定の文', E = 'esc を通る', N = '数だけ';
const KINDS = [F, E, N];
const CENSUS = {
  "accounts.html": [],
  "accounts-export.js": [],
  "accounts.js": [],
  "admission-flow.html": [
    [N, "$('sumbar').innerHTML = fpill('month', '今月の問い合わせ', inThisMonth) + fpill('working', '進行中', working) + fpill('movein', '今月入居予定', moveThisMonth) + fpill('nudge', '連絡待ち', nudgeAll, 'border-color:#ffcc80') + fpill('over', '期限超過', overAll, 'border-color:#f5c6c0') + (listFilter ? '<button class=\"pill f\" id=\"clearF\" type=\"button\">✕ しぼりこみを解除</button>' : '') + (delCount ? '<button class=\"pill\" id=\"toggleDel\" type=\"button\" style=\"cursor:pointer\">' + (showDeleted ? '削除済みを隠す' : '削除済みも表示 (' + delCount + ')') + '</button>' : '') + (canUndo() ? '<button class=\"pill\" id=\"undoBtn\" type=\"button\" style=\"cursor:pointer\">↩ 元に戻す</button>' : '')"],   /* 件数と固定のボタン */
    [F, "box.innerHTML = (listQ || listFilter) ? '<div class=\"empty\">条件に合う案件がありません。<br>検索語を消すか、しぼりこみを解除してください。</div>' : '<div class=\"empty\">まだ案件がありません。<br>問い合わせが来たら右下の「＋」で起票してください。</div>'"],
    [E, "box.innerHTML = h"],
    [E, "$('todayBox').innerHTML = h"],
    [E, "$('viewBox').innerHTML = h"],
    [E, "$('tplBox').innerHTML = '<p class=\"note\">いまのステージ（' + esc(stageLabel(c.stage)) + '）までに必要なものへ最初からチェックが入っています。先の段階のものも必要なら入れてください。</p>' + h"],
    [E, "$('cnBody').innerHTML = (nudge ? '<p class=\"note warn\"><b>' + esc(nudge.title) + '</b><br>' + esc(nudge.why) + '</p>' : '') + (href || (ct && ct.fax) ? '<div class=\"acts\" style=\"display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px\">' + (href ? '<a class=\"btn sm pri\" href=\"' + esc(href) + '\">📞 ' + esc(ct.tel) + ' へ発信</a>' : '') + (ct && ct.fax ? '<button class=\"btn sm\" type=\"button\" id=\"cnFax\">📠 FAX ' + esc(ct.fax) + ' をコピー</button>' : '') + '</div>' : '') + '<div class=\"frow\">' + '<div class=\"fld\"><label for=\"cnAt\">日時</label><input id=\"cnAt\" type=\"datetime-local\"></div>' + '<div class=\"fld\"><label for=\"cnPartner\">相手</label><input id=\"cnPartner\" type=\"text\" value=\"' + esc(partner) + '\"></div>' + '<div class=\"fld\"><label for=\"cnMethod\">手段</label><select id=\"cnMethod\">' + METHODS.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('') + '</select></div>' + '</div><div class=\"fld\" style=\"margin-top:8px\"><label for=\"cnSummary\">内容（1行）</label>' + '<input id=\"cnSummary\" type=\"text\" value=\"' + esc(summary) + '\"></div>'"],
    [N, "sel.innerHTML = FILE_KINDS.map(function (p) { return '<option value=\"' + esc(p[0]) + '\">' + esc(p[1]) + '</option>'; }).join('')"],
    [E, "$('editBox').innerHTML = h"],
    [E, "box.innerHTML = '<div class=\"viewbar\"><button class=\"btn sm\" id=\"shBack\" type=\"button\">← 詳細へ</button><span class=\"sp\"></span>' + (canUndo() ? '<button class=\"btn sm\" id=\"shUndo\" type=\"button\">↩ 元に戻す</button>' : '') + '<button class=\"btn sm\" id=\"shPrint\" type=\"button\">🖨 印刷</button></div>' + '<p class=\"note\">値の欄を押すと、その場で書き換えられます。紙の様式とまったく同じ並びです。</p>' + '<div class=\"shwrap\">' + renderSheetGrid(c, 'edit') + '</div>'"],
    [F, "$('msBody').innerHTML = '<p class=\"note err\">入居者マスタの接続先が未設定です。<a href=\"connection-settings.html\">接続設定</a>で「入居者マスタ」のURL・合言葉を設定してください。</p>'"],
    [E, "$('msBody').innerHTML = '<p style=\"font-size:0.84375rem\">以下の内容で入居者マスタに<b>新規登録</b>します。登録後の変更はマスタ側で行ってください。</p>' + '<table>' + rows.join('') + '</table>' + '<div class=\"fld\" style=\"max-width:16em\"><label for=\"msAdm\">入居日（予定）</label>' + dateCellHtml('msAdm', '', adm, '入居日（予定）') + '</div>' + '<p class=\"note warn\"><b>登録するとその方は週間計画・デイ利用表に「入居済」として出ます。</b>' + '入居者マスタには「入居前」という区別がないためです。入居日より前に登録する場合は、登録後に' + '<a href=\"care-schedule.html\">週間計画</a>でその方を開き「入居前」を押してください。</p>' + (undone.length ? '<p class=\"note warn\">未完了の連携タスクが ' + undone.length + ' 件あります（登録は可能です。未完了の一覧はマスタの「入居までの経過」欄に注記されます）。</p>' : '')"],
    [E, "box.innerHTML = renderPrintSheet(c)"],
    [F, "box.innerHTML = ''"],
    [E, "$('kpiBox').innerHTML = h"],
    [E, "$('syncBody').innerHTML = '<dl class=\"kv\">' + '<dt>台帳の同期先</dt><dd>' + (t.endpoint ? '設定済み（入居調整の専用サーバー）' : '<span style=\"color:var(--err)\">未設定</span>') + '</dd>' + '<dt>入居者マスタ</dt><dd>' + (m.url ? '設定済み' : '<span style=\"color:var(--err)\">未設定</span>') + '</dd>' + '<dt>状態</dt><dd>' + esc($('syncChip').textContent) + (dirty ? '（未送信の変更あり）' : '') + '</dd>' + '<dt>案件</dt><dd>' + DB.candidates.filter(function (c) { return !c.deleted; }).length + '件（削除済み ' + DB.candidates.filter(function (c) { return c.deleted; }).length + '件）</dd>' + '<dt>サーバー版</dt><dd>' + (caps ? esc(asStr(caps.codeVersion) || '不明') : '<span style=\"color:var(--g6)\">未確認</span>') + ' <button class=\"btn sm\" id=\"syPing\" type=\"button\">確認する</button></dd>' + '<dt>サーバーの防御</dt><dd>' + (caps ? esc(asArr(caps.guards).join('・') || 'なし') : '—') + '</dd>' + '</dl>' + (caps && !serverOk ? '<p class=\"note err\">🛑 <b>接続先が入居調整の専用サーバーではありません</b>（応答した名札: ' + esc(asStr(caps.server) || '不明') + '）。<a href=\"connection-settings.html\">接続設定</a>の「入居調整」に、' + '入居調整データAPI の /exec URL が入っているか確認してください。このまま保存すると、相談者の情報が別の置き場へ書き込まれます。</p>' : '') + (caps && serverOk && !guardOk ? '<p class=\"note err\">⚠️ サーバー側の消失ガード（admwipe）が有効になっていません。Apps Script でコードを保存しただけになっていないか確認してください（デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ）。</p>' : '') + '<p class=\"note\">接続先の設定は <a href=\"connection-settings.html\">接続設定</a> で行います（このアプリはそこで入れた値を読むだけです）。</p>' + '<h2 style=\"font-size:0.9375rem;margin:12px 0 6px\">端末のバックアップ</h2>' + '<dl class=\"kv\">' + '<dt>いまの保存</dt><dd>' + (cu ? cu.n + '件（' + esc(fmtDt(cu.at)) + '）' : 'なし') + '</dd>' + '<dt>1世代前</dt><dd>' + (b1 ? b1.n + '件（' + esc(fmtDt(b1.at)) + '）<button class=\"btn sm\" id=\"syR1\" type=\"button\" style=\"margin-left:6px\">復元</button>' : 'なし') + '</dd>' + '<dt>2世代前</dt><dd>' + (b2 ? b2.n + '件（' + esc(fmtDt(b2.at)) + '）<button class=\"btn sm\" id=\"syR2\" type=\"button\" style=\"margin-left:6px\">復元</button>' : 'なし') + '</dd>' + '</dl>' + '<div class=\"btn-row\" style=\"justify-content:flex-start\">' + '<button class=\"btn sm\" id=\"syExport\" type=\"button\">⬇️ 書き出し（JSON）</button>' + '<button class=\"btn sm\" id=\"syImport\" type=\"button\">⬆️ 取り込み（JSON）</button></div>' + '<p class=\"note\">書き出したファイルには合言葉は含まれません。取り込みは<b>置き換えではなく統合</b>です（今ある案件は消えません）。</p>'"]
  ],
  "ats-calc.js": [],
  "ats.html": [
    [F, "g.innerHTML='<h2>この画面は事務所のパソコンで使います</h2><p>この端末は「現場」として設定されているため、採用管理は開きません。</p><p><a class=\"btn\" href=\"index.html\">メニューへ戻る</a></p>'"],
    [E, "g.innerHTML='<h2>管理者だけが使える画面です</h2><p>'+esc(why)+'</p><p><a class=\"btn pri\" href=\"login.html?next=ats.html\">ログインの画面へ</a></p>'"],
    [F, "$('a-pane').innerHTML=''"],
    [F, "$('a-print').innerHTML=''"],
    [E, "if(p) p.innerHTML=boardHtml_()"],
    [E, "u.innerHTML='<span>'+esc(text)+'</span><button type=\"button\" class=\"btn sm\" data-act=\"undo\">元に戻す</button>'"],
    [F, "u.innerHTML=''"],
    [F, "p.innerHTML=''"],
    [F, "p.innerHTML=''"],
    [E, "p.innerHTML=detailHtml_(a)"],
    [E, "if(d&&evalCtx) d.innerHTML=evalHtml_()"],
    [F, "d.innerHTML=''"],
    [F, "d.innerHTML=''"],
    [E, "p.innerHTML=html"],
    [E, "p.innerHTML=html"],
    [E, "p.innerHTML=html"],
    [E, "p.innerHTML=html"],
    [E, "if(p) p.innerHTML=printSchedHtml_()"],
    [F, "if(p) p.innerHTML=''"],
    [F, "if(p) p.innerHTML=''"],
    [E, "if(p) p.innerHTML=printSheetHtml_(printIv)"],
    [F, "p.innerHTML='<h2>集計</h2><p class=\"muted\">読み込んでいます…</p>'"],
    [E, "p.innerHTML=h+'</div>'"],
    [E, "d.innerHTML='<div class=\"dlg-in\"><h2 id=\"a-dlg-h\">'+esc(o.title)+'</h2>'+(o.lines||[]).map(function(l){ return '<p>'+esc(l)+'</p>'; }).join('')+(o.bodyHtml||'')+ '<div class=\"dlg-btns\"><button type=\"button\" class=\"btn\" data-dlg=\"no\">やめる</button><button type=\"button\" class=\"btn '+(o.danger?'ngf':'pri')+'\" data-dlg=\"ok\">'+esc(o.ok)+'</button></div></div>'"]
  ],
  "care-meeting-calc.js": [],
  "care-meeting.html": [
    [F, "if(el) el.innerHTML=''"],
    [F, "if(g) g.innerHTML='<p>担当者会議の記録は事務所PCだけで使えます</p>'"],
    [F, "if(kind==='nocfg') g.innerHTML='<p>接続設定で入居者マスタの接続先を入れてください</p><p><a class=\"btn\" href=\"connection-settings.html\">接続設定を開く</a></p>'"],
    [E, "el.innerHTML=pickerHtml_(roster,summary,summaryState,summaryErr)"],
    [E, "if(el) el.innerHTML=whoHtml_(cur)"],
    [F, "el.innerHTML=''"],
    [F, "el.innerHTML='<p class=\"al-none\">記録の一覧を読めていないため、期限の知らせは出していません。</p>'"],
    [E, "el.innerHTML=alertsHtml_(alertsFor_(cur,meetings,CareMeetingCalc.todayJST()))"],
    [E, "if(el) el.innerHTML=cur?listHtml_(meetings,ed&&ed.mode==='edit'?ed.meetingId:'',listState,listErr):''"],
    [F, "el.innerHTML=''"],
    [E, "el.innerHTML=prevHtml_(prevOf_(meetings,ed))"],
    [E, "box.innerHTML=editorHtml_(ed,cur)"],
    [E, "if(st&&ed&&!ed.view) st.innerHTML=nameStateHtml_(ed)"],
    [E, "d.innerHTML='<div class=\"dlg-in\"><h2 id=\"cm-dlg-h\">'+esc(o.title)+'</h2>'+o.lines.map(function(l){return '<p>'+esc(l)+'</p>'}).join('')+ (o.input?'<label class=\"fl\" for=\"cm-dlg-tx\">理由</label><textarea id=\"cm-dlg-tx\" rows=\"3\" aria-describedby=\"cm-dlg-cnt\"></textarea><span class=\"cnt\" id=\"cm-dlg-cnt\">残り '+NOTE_MAX+' 字</span>':'')+ '<div class=\"dlg-btns\"><button type=\"button\" class=\"btn\" data-dlg=\"no\">やめる</button><button type=\"button\" class=\"btn '+(o.danger?'ng':'pri')+'\" data-dlg=\"ok\"'+(o.input?' disabled':'')+'>'+esc(o.ok)+'</button></div></div>'"],
    [F, "d.innerHTML=''"],
    [E, "if(p&&ed&&cur) p.innerHTML=printHtml_(cur,ed.rec,ed.status)"],
    [F, "if(p) p.innerHTML=''"]
  ],
  "care-schedule.html": [
    [F, "cb.innerHTML = ''"],
    [F, "box.innerHTML = '<div class=\"evlist-empty\">まだ控えがありません（保存すると残ります）</div>'"],
    [N, "box.innerHTML = html"],
    [F, "box.innerHTML = '<div class=\"evlist-empty\">試算中は使えません</div>'"],
    [F, "box.innerHTML = '<div class=\"evlist-empty\">同期先が未設定です（設定 → クラウド同期）</div>'"],
    [F, "box.innerHTML = '<div class=\"evlist-empty\">読み込み中…</div>'"],
    [E, "box.innerHTML = '<div class=\"evlist-empty\">クラウドの履歴を読めませんでした' + why + '</div>'"],
    [F, "box.innerHTML = '<div class=\"evlist-empty\">クラウドに過去の姿がありません</div>'"],
    [N, "box.innerHTML = html"],
    [E, "sel.innerHTML = '<option value=\"\">-- 利用者を選択 --</option>' + csVisibleResidents().slice().sort(csResidentSort).map(r => `<option value=\"${escHtml(r.id)}\" ${r.id === cur ? 'selected' : ''}>${escHtml(r.name)}</option>` ).join('')"],
    [F, "ul.innerHTML = '<li style=\"font-size: 0.8125rem;color:var(--g6);padding:8px 0\">' + (DB.residents.length ? '対象の利用者がいません（「対象外も表示」で全員表示）' : '利用者が登録されていません') + '</li>'"],
    [E, "ul.innerHTML = vis.slice().sort(csResidentSort).map(r => `<li class=\"res-item ${r.id === DB.currentResidentId ? 'active' : ''}\"> <span>${escHtml(r.name)}${r.external ? ' <span style=\"font-size: 0.6875rem;color:#1565c0\">（外部）</span>' : ''}${(r.targetSchedule === false) ? ' <span style=\"font-size: 0.6875rem;color:var(--g6)\">（対象外）</span>' : ''}${r.movedOut ? ' <span style=\"font-size: 0.6875rem;color:var(--ng)\">（退去）</span>' : ''}${r.preAdmitted ? ' <span style=\"font-size: 0.6875rem;color:var(--pre)\">（入居前）</span>' : ''}${r.hospitalized ? ' <span style=\"font-size: 0.6875rem;color:#e65100\">（入院中）</span>' : ''}</span> ${r.movedOut ? `<button class=\"del-res\" ${csOutStyle(r, 'var(--pri)')}${csOutAttr(r)} data-on-click=\"restoreResident\" data-args='[\"${String(r.id).replace(/[^A-Za-z0-9_-]/g,'')}\"]'>復帰</button>` : `<button class=\"del-res\" style=\"color:#e65100\" data-on-click=\"toggleHospitalized\" data-args='[\"${String(r.id).replace(/[^A-Za-z0-9_-]/g,'')}\"]'>${r.hospitalized ? '退院' : '入院'}</button> <button class=\"del-res\" ${csOutStyle(r, 'var(--g7)')}${csOutAttr(r)} data-on-click=\"moveOutResident\" data-args='[\"${String(r.id).replace(/[^A-Za-z0-9_-]/g,'')}\"]'>退去</button> <button class=\"del-res\" style=\"color:var(--pre)\" data-on-click=\"togglePreAdmission\" data-args='[\"${String(r.id).replace(/[^A-Za-z0-9_-]/g,'')}\"]'>${r.preAdmitted ? '入居済' : '入居前'}</button>`} <button class=\"del-res res-del-x\" ${csOutStyle(r, 'var(--ng)')}${csOutAttr(r)} data-on-click=\"removeResident\" data-args='[\"${String(r.id).replace(/[^A-Za-z0-9_-]/g,'')}\"]' aria-label=\"この利用者を削除\"${csMasterOwned(r) ? '' : ' title=\"この利用者を削除\"'}>✕</button> </li>` ).join('')"],
    [N, "$('#col-header').innerHTML = DAYS_JA.map((d, i) => { let unitsHtml = ''; if (res && res.events) { const dayEvents = res.events.filter(ev => ev.dayOfWeek === i); if (dayEvents.length > 0) { // 日合計は減算（同一建物減算）と処遇改善加算を含まない単位数（総合事業＝月額は週次日計から除外） const dayTotal = dayEvents.reduce((s, ev) => SOGO_VISIT_CODES[ev.category] ? s : s + sumDisplayUnits(getUnitBreakdown(ev, res)), 0); /* 限度額超過判定は coverage を利用。ただし coverage が 0 になる理由は2つあり、 「限度額を使い切って賄えなかった」だけでなく「そもそも単位が0＝算定対象外」でも 0 になる。 後者（要支援・自立・介護度未設定の通所）まで超過（赤字）にすると誤警告が画面と紙に出るため、 表示単位が正のイベントに限って超過とみなす。 */ const isOver = !!(coverage && dayEvents.some(ev => coverage.get(ev.id) === 0 && sumDisplayUnits(getUnitBreakdown(ev, res)) > 0)); if (dayTotal > 0 || isOver) { const overClass = isOver ? ' over' : ''; unitsHtml = `<span class=\"day-units${overClass}\">${dayTotal}単位</span>`; } } } return `<div class=\"day-cell ${i===5?'sat':i===6?'sun':''}\">${d}${unitsHtml}</div>`; }).join('')"],
    [F, "inner.innerHTML = ''"],
    [F, "inner.innerHTML = ''"],
    [F, "container.innerHTML = ''"],
    [E, "block.innerHTML = innerHtml"],
    [E, "ghost.innerHTML = drag.blockEl.querySelector('.ev-text').outerHTML"],   /* 画面に出ている支援の札（.ev-text）の写し。札の中身は escHtml を通して作ったもので、outerHTML は文字を & < > へ戻して書き出す */
    [F, "box.innerHTML = ''"],
    [E, "sel.innerHTML = (ent.opts || []) .map(p => `<option value=\"${escHtml(String(p[0]))}\">${escHtml(String(p[1]))}</option>`).join('')"],
    [E, "g.innerHTML = Object.keys(sv).map(code => { const s = sv[code]; const txt = `${s.name} ${s.label}${(Number(s.units) || 0).toLocaleString()}単位`; return `<option value=\"${escHtml(code)}\">${escHtml(txt)}</option>`; }).join('')"],
    [N, "fsel.innerHTML = Object.keys(FACILITY_TYPE_LABELS) .map(k => `<option value=\"${k}\">${escHtml(FACILITY_TYPE_LABELS[k])}</option>`).join('')"],
    [E, "fw.innerHTML = '⚠ 読み込んだ報酬マスタに不足・不正がありました。次の項目は既定値で補っています：<br>' + RM_FILLED_AT_LOAD.map(s => '・' + escHtml(s)).join('<br>')"],
    [F, "fw.innerHTML = ''"],
    [E, "$('#rm-tables').innerHTML = h"],
    [E, "$('#rm-preview-body').innerHTML = h"],
    [F, "body.innerHTML = '<div class=\"evlist-empty\">利用者が選択されていません</div>'"],
    [F, "body.innerHTML = '<div class=\"evlist-empty\">予定が登録されていません</div>'"],
    [E, "body.innerHTML = (_evlistView === 'svc') ? renderEventListBySvc(sorted) : (_evlistView === 'simple') ? renderSimplePlanList(sorted) : renderEventListByDay(sorted)"],
    [N, "desc.innerHTML = '各利用者の介護度・負担・利用状況の横断一覧。月〜土＝通所(デイ)利用日に○。' + `報酬額＝使用単位数(月)×${escHtml(String(FEE_PER_UNIT))}円（福祉用具は含まない）。`"],
    [F, "tbody.innerHTML = '<tr><td id=\"rl-empty\" colspan=\"15\">表示対象の利用者がいません</td></tr>'"],
    [F, "if (tfoot) tfoot.innerHTML = ''"],
    [F, "if (totalEl) totalEl.innerHTML = ''"],
    [E, "tbody.innerHTML = h"],
    [N, "totalEl.innerHTML = '報酬額 総合計' + `<span class=\"rl-total-amt\">¥${totalFee.toLocaleString()}</span>` + '<span class=\"rl-total-exp-label\">想定</span>' + `<span class=\"rl-total-exp\">¥${totalFeeExp.toLocaleString()}</span>` + `<span class=\"rl-total-sub\">対象 ${list.length}名・報酬額＝使用単位数(月)×${FEE_PER_UNIT}円（福祉用具除く）` + '／想定＝負担限度額で頭打ちにした単位から福祉用具を引いた額</span>'"],
    [N, "tfoot.innerHTML = '<tr>' + '<td class=\"rl-foot-label\" colspan=\"13\">報酬額 合計</td>' + `<td class=\"rl-fee\">${totalFee.toLocaleString()}</td>` + `<td class=\"rl-fee rl-fee-exp\">${totalFeeExp.toLocaleString()}</td>` + '</tr>'"],
    [F, "tbody.innerHTML = '<tr><td colspan=\"8\" style=\"padding:16px;text-align:center;color:var(--g6)\">対象の利用者がいません</td></tr>'"],
    [E, "tbody.innerHTML = h"],
    [F, "if (wkBox) wkBox.innerHTML = ''"],
    [E, "box.innerHTML = buildWeeklySheetHtml_(res)"],
    [F, "if (b) b.innerHTML = ''"],
    [F, "btnsEl.innerHTML = ''"]
  ],
  "connection-settings.html": [],
  "daycare-roster.html": [],
  "facesheet.html": [
    [E, "box.innerHTML=mealHtml(q)"],
    [F, "box.innerHTML='<div class=\"empty\">'+(roster.length?'該当する入居者がいません':'入居者がいません。入居者マスタで登録するか「設定」で接続してください')+'</div>'"],
    [E, "box.innerHTML=html"],
    [F, "$('hlBand').innerHTML=''"],
    [F, "$('ftabs').innerHTML=''"],
    [F, "$('viewBox').innerHTML='<div class=\"loading\">読み込み中…</div>'"],
    [F, "$('viewBox').innerHTML='<div class=\"empty\">「設定」で接続URLを入力してください</div>'"],
    [E, "$('viewBox').innerHTML='<div class=\"empty\">取得に失敗しました: '+esc(e.message)+'</div>'"],
    [E, "if(c.getAttribute('data-meds-id')===key) c.innerHTML=fullMedsBody('薬剤情報（定期）',curRec.medsRegular)"],
    [E, "$('hlBand').innerHTML=hl.length?'<div class=\"hlband\" role=\"group\" aria-label=\"安全上の注意\">'+hl.join('')+'</div>':''"],
    [E, "if(e.getAttribute('data-du-id')===key)e.innerHTML=html"],
    [F, "box.innerHTML=''"],
    [F, "$('ftabs').innerHTML=''"],
    [E, "$('viewBox').innerHTML='<div class=\"fpanel on\" data-panel=\"safe\">'+sheet(body)+'</div>'"],
    [N, "$('ftabs').innerHTML=TABS.map(function(t){return'<button class=\"ftab'+(t[0]===actTab?' on':'')+'\" role=\"tab\" aria-selected=\"'+(t[0]===actTab?'true':'false')+'\" aria-controls=\"panel-'+t[0]+'\" data-tab=\"'+t[0]+'\">'+esc(t[1])+'</button>'}).join('')"],
    [E, "$('viewBox').innerHTML=TABS.map(function(t){return'<div class=\"fpanel'+(t[0]===actTab?' on':'')+'\" role=\"tabpanel\" id=\"panel-'+t[0]+'\" aria-label=\"'+esc(t[1])+'\" data-panel=\"'+t[0]+'\">'+(P[t[0]]||'')+'</div>'}).join('')"],
    [F, "bar.innerHTML=''"],
    [E, "bar.innerHTML='<span>'+msg+'</span><button type=\"button\" id=\"fromMasterClose\">一覧に戻る</button>'"]
  ],
  "genogram.html": [
    [F, "sel.innerHTML = '<option value=\"\">— 保存済みから読込 —</option>'"]
  ],
  "help.html": [],
  "index.html": [],
  "kotowaza-jiten.html": [],
  "login.html": [],
  "login.js": [],
  "mailer/public/app.js": [],
  "mailer/public/index.html": [],
  "mailer/server/api.js": [],
  "mailer/server/build.js": [],
  "mailer/server/calendar.js": [],
  "mailer/server/datetime.js": [],
  "mailer/server/demo.js": [],
  "mailer/server/diagnose.js": [],
  "mailer/server/google.js": [],
  "mailer/server/ics.js": [],
  "mailer/server/imap.js": [],
  "mailer/server/index.js": [],
  "mailer/server/mail-service.js": [],
  "mailer/server/sanitize.js": [],
  "mailer/server/schedule-extract.js": [],
  "mailer/server/smtp.js": [],
  "mailer/server/store.js": [],
  "mailer/server/tasks.js": [],
  "mailer/src/api.js": [],
  "mailer/src/calendar-util.js": [],
  "mailer/src/util.js": [],
  "meds-effect-dict.js": [],
  "meds-yakka-naiyo.js": [],
  "menu-settings.html": [],
  "menu-settings.js": [],
  "moushiokuri-viewer.html": [],
  "overview-compare.html": [],
  "patch-calendar.html": [],
  "perf-report.html": [],
  "perf-report.js": [
    [N, "$('kpis').innerHTML = kpi('記録した回数', s.n, '回') + kpi('画面が出るまで（中央値）', fmt(s.dcl50), '秒') + kpi('読み込みが終わるまで（中央値）', fmt(s.done50), '秒') + kpi('通信1回（中央値）', fmt(s.one50), '秒')"],
    [F, "$('tApp').innerHTML = '<tr><td class=\"empty\" colspan=\"12\">記録がありません</td></tr>'"],
    [E, "$('tApp').innerHTML = '<thead><tr><th>アプリ</th><th>回数</th><th>画面が出るまで<br>中央値</th><th>遅い時</th>' + '<th>使えるまで<br>中央値</th>' + '<th>起動時の<br>通信回数<br>(GAS/SB/JSON)</th><th>読み込み完了<br>中央値</th><th>遅い時</th><th>通信1回<br>中央値</th>' + '<th>固まり<br>中央値</th><th>画面ファイル<br>大きさ(KB)</th><th>丸ごと<br>取り直し</th></tr></thead><tbody>' + s.apps.map(function (a) { return '<tr><td>' + esc(a.name) + '</td><td>' + a.n + '</td>' + cell(a.dcl50, TH.dcl) + cell(a.dcl90, TH.dcl) + cell(a.ready50, null) + '<td>' + cntText(a) + '</td>' + cell(a.done50, TH.done) + cell(a.done90, TH.done) + cell(a.one50, TH.one) + cell(a.tbt50, TH.tbt) + '<td>' + (a.kb == null ? '—' : Math.round(a.kb)) + '</td><td>' + a.full + '</td></tr>'; }).join('') + '</tbody>'"],
    [E, "$('tEp').innerHTML = s.eps.length ? '<thead><tr><th>接続先</th><th>回数</th><th>中央値</th><th>遅い時</th><th>最長</th></tr></thead><tbody>' + s.eps.map(function (e) { return '<tr><td>' + esc(e.ep) + '</td><td>' + e.n + '</td>' + cell(e.p50, TH.one) + cell(e.p90, TH.one) + cell(e.max, null) + '</tr>'; }).join('') + '</tbody>' : '<tr><td class=\"empty\">記録がありません</td></tr>'"],
    [E, "$('tKind').innerHTML = vs.kinds.length ? '<thead><tr><th>アプリ</th><th>GAS の種類</th><th>見えている時<br>回数</th><th>裏にある時<br>回数</th></tr></thead><tbody>' + vs.kinds.map(function (k) { return '<tr><td>' + esc(k.name) + '</td><td>' + esc(k.k) + '</td><td>' + k.v + '</td><td>' + k.h + '</td></tr>'; }).join('') + '</tbody>' : none"],
    [E, "$('tFile').innerHTML = vs.files.length ? '<thead><tr><th>アプリ</th><th>ファイル</th><th>見えている時<br>回数</th><th>裏にある時<br>回数</th></tr></thead><tbody>' + vs.files.map(function (k) { return '<tr><td>' + esc(k.name) + '</td><td>' + esc(k.k) + '</td><td>' + k.v + '</td><td>' + k.h + '</td></tr>'; }).join('') + '</tbody>' : none"],
    [E, "$('tVis').innerHTML = catRows.length ? '<thead><tr><th>アプリ</th><th>記録した<br>回数</th><th>分類</th><th>見えている時<br>回数</th><th>見えている時<br>合計秒</th>' + '<th>裏にある時<br>回数</th><th>裏にある時<br>合計秒</th></tr></thead><tbody>' + catRows.join('') + '</tbody>' : none"]
  ],
  "resident-master.html": [
    [E, "box.innerHTML=items.map(function(a){ return '<a href=\"'+esc(a.href)+'\" target=\"_blank\" rel=\"noopener\">'+ '<span class=\"ai\" aria-hidden=\"true\">'+esc(a.ic)+'</span>'+ '<span class=\"at\"><span>'+esc(facFill(a.name))+'</span><span class=\"ad\">'+esc(facFill(a.desc))+'</span></span></a>'; }).join('')"],
    [F, "if(!vma) box.innerHTML+='<p class=\"applead\" style=\"margin:4px 0 0\">訪問診療アプリは「☁️同期設定」でURLを登録すると表示されます。</p>'"],
    [E, "box.innerHTML=mealHtml(q)"],
    [E, "box.innerHTML=mfHtml()"],
    [F, "box.innerHTML='<div class=\"empty\">'+(roster.length?'該当する入居者がいません':'入居者がいません。「同期設定」でURLを設定するか「新規」で登録してください')+'</div>'"],
    [E, "box.innerHTML=html"],
    [E, "a.innerHTML=esc(st.msg||'')+(st.login ? ' <a href=\"login.html?next=resident-master.html\" target=\"_blank\" rel=\"noopener\">ログイン画面を開く（別のタブ）</a>'+ '<br>ログインしたら、この小窓の「🔄 もう一度確かめる」を押してください。' : '')"],
    [E, "$('msScroll').innerHTML='<table class=\"ms-tbl\"><thead><tr><th>居室</th><th>氏名</th><th>時間帯（定期薬から）</th>'+ '<th>確認が必要な行・読み取れない行</th><th>care-log の今</th><th>差分</th></tr></thead><tbody id=\"msBody\">'+ msRows.map(msRowHtml_).join('')+'</tbody></table>'"],
    [N, "cell.innerHTML=msDfHtml_(row, d)"],   /* 決まった表（MED_SLOT_LBL）の時間帯の名前だけ */
    [E, "bar.innerHTML=show?('<button type=\"button\" class=\"mc-open\" id=\"mcOpen\"'+(n?'':' disabled')+'>💊 薬の変更候補（'+n+'件）</button>'+ (note?'<span class=\"mc-note\">'+esc(note)+'</span>':'')):''"],
    [E, "if(dm.innerHTML!==want) dm.innerHTML=want"],
    [F, "$('mcListBox').innerHTML=''"],
    [F, "$('mcWork').innerHTML=''"],
    [F, "$('mcBar').innerHTML=''"],
    [F, "if($('mcDMark')) $('mcDMark').innerHTML=''"],
    [F, "$('mcListBox').innerHTML=''"],
    [F, "$('mcWork').innerHTML=''"],
    [E, "$('mcListBox').innerHTML=lh"],
    [E, "$('mcWork').innerHTML=mcBulk?mcBulkHtml_():(mcCur?mcWorkHtml_():'<p class=\"mc-empty\">左の一覧から候補を選んでください。</p>')"],
    [E, "if(dv) dv.innerHTML=mcDiffHtml_()"],
    [E, "if(dv) dv.innerHTML=mcDiffHtml_()"],
    [F, "$('yjBody').innerHTML=''"],
    [F, "$('yjBody').innerHTML=''"],
    [F, "box.innerHTML=''"],
    [E, "box.innerHTML=h"],
    [F, "b.innerHTML=''"],
    [E, "b.innerHTML=h"],
    [F, "if(b) b.innerHTML=''"],
    [F, "$('viewBox').innerHTML='<div class=\"loading\">読み込み中…</div>'"],
    [F, "$('viewBox').innerHTML='<div class=\"empty\">同期設定のURLが未設定です</div>'"],
    [E, "$('viewBox').innerHTML='<div class=\"empty\">取得に失敗しました: '+esc(e.message)+ (e&&e.gone?'':'<div style=\"margin-top:12px\"><button class=\"btn btn-sec\" id=\"viewRetry\" type=\"button\">🔄 もう一度読み込む</button></div>'+ '<div style=\"margin-top:8px;font-size:0.8125rem;color:var(--g6)\">混み合う時間帯は、どなたかの保存が終わるまで数十秒かかることがあります。</div>')+ '</div>'"],
    [E, "if(c.getAttribute('data-meds-id')===key) c.innerHTML=medsRegularCell(curResident.medsRegular)"],
    [F, "box.innerHTML='<div class=\"sheet\"><div class=\"sec\"><div class=\"sec-lbl\">薬剤情報</div><div class=\"sec-body\"><div class=\"row-cells\">'+ '<div class=\"cell\" style=\"flex:65\" data-two></div>'+ '<div class=\"cell\" style=\"flex:35;border-right:none\"></div>'+ '</div></div></div></div>'"],
    [E, "cellTwo.innerHTML=medsRegularCell(raw, map||null)"],
    [F, "out.innerHTML='<p class=\"muted\" style=\"color:var(--ng)\">'+esc(MEDS_FX_NG)+'</p>'"],
    [F, "out.innerHTML='<p class=\"muted\" style=\"color:var(--ng)\">先に同期設定のURLと合言葉を保存してください。</p>'"],
    [F, "out.innerHTML='<p class=\"muted\">名簿が空です。先に一覧を読み込んでください。</p>'"],
    [F, "out.innerHTML='<p class=\"muted\">薬効辞書を読み込み中…</p>'"],
    [E, "out.innerHTML='<p class=\"muted\" style=\"color:var(--ng)\">薬効辞書（med_dict）を読み込めないため点検できません'+ esc((mdErr||(e&&e.message))?('（'+(mdErr||e.message)+'）'):'')+'。時間をおいてもう一度お試しください。</p>'"],
    [N, "out.innerHTML='<p class=\"muted\">点検を中止しました（'+i+' / '+targets.length+' 名まで読み取り。1文字も書いていません）。</p>'"],
    [N, "out.innerHTML='<p class=\"muted\">点検中… '+i+' / '+targets.length+' 名</p>' +'<button class=\"btn btn-gray\" type=\"button\" id=\"medsAuditStopBtn\">中止</button>'"],
    [E, "out.innerHTML=h+'</div>'"],
    [E, "if(el&&el.getAttribute('data-id')===id) el.innerHTML=yjlHtml_(r.rows)"],
    [F, "b.innerHTML=''"],
    [E, "$('wisheet').innerHTML=wiHtml_(curResident)"],
    [F, "nav.innerHTML=''"],
    [E, "nav.innerHTML=secs.map(function(s,i){ return '<button type=\"button\" data-vgo=\"'+i+'\">'+esc(viewSecName_(s))+'</button>'; }).join('')+ '<button type=\"button\" class=\"all\" data-vall=\"open\">すべて開く</button>'+ '<button type=\"button\" class=\"all\" data-vall=\"fold\">すべてたたむ</button>'"],
    [E, "$('viewBox').innerHTML=glanceHtml_(r)+h"],
    [E, "$('editBox').innerHTML=h"],
    [N, "box.insertAdjacentHTML('beforeend',bfDisRowsEdit([{}],n))"],   /* 空の既往歴の行（[{}]）と行の番号だけ */
    [F, "bar.innerHTML=''"],
    [E, "bar.innerHTML=html"],
    [E, "box.innerHTML=h"],
    [F, "box.innerHTML='<button class=\"btn btn-sec\" id=\"supportLess\" type=\"button\">直近1年だけ表示に戻す</button>'"],
    [N, "box.innerHTML='<button class=\"btn btn-sec\" id=\"supportMoreBtn\" type=\"button\">以前の記録も編集する（'+hiddenCount+'件）</button>'"],
    [F, "else box.innerHTML=''"],
    [F, "box.innerHTML=''"],
    [E, "if(ls) ls.innerHTML=body"],
    [E, "box.innerHTML='<details class=\"slog-past\"><summary>'+esc(cap)+'</summary>'+ '<div class=\"slog-ro\">'+body+'</div></details>'"],
    [E, "box.innerHTML=h"],
    [E, "box.innerHTML=h"],
    [E, "box.innerHTML=h"],
    [E, "box.innerHTML=h"],
    [E, "if(e.getAttribute('data-du-id')===key)e.innerHTML=html"],
    [F, "box.innerHTML=''"],
    [E, "$('a4sheet').innerHTML=h"],
    [F, "if(b)b.innerHTML=''"],
    [F, "$('bulkScroll').innerHTML='<div class=\"loading\">読み込み中…</div>'"],
    [F, "$('bulkScroll').innerHTML='<div class=\"empty\">対象の方がいません</div>'"],
    [E, "$('bulkScroll').innerHTML='<div class=\"empty\">取得に失敗しました: '+esc(e.message)+'</div>'"],
    [N, "$('bulkTabs').innerHTML=BULK_GROUPS.map(function(g){ return '<button class=\"chip'+(g[0]===bulkGroup?' on':'')+'\" type=\"button\" data-bg=\"'+esc(g[0])+'\">'+esc(g[1])+'</button>'; }).join('')"],
    [E, "$('bulkScroll').innerHTML=h"],
    [E, "$('nameWarnBody').innerHTML= '<p>次の <b>'+nmv.keyChanged.length+'名</b> の氏名を、スペースではなく<b>文字そのもの</b>を変えます。</p>'+ '<div class=\"nw-names\">'+names+'</div>'+ (nmv.dup.length?('<p class=\"nw-danger\"><b>⚠️ 直した後に同姓同名になります: '+esc(nmv.dup.join('・'))+'</b><br>'+ '同姓同名の方は、家族構成図や体重の最新値が同じ方のものとして扱われます。</p>'):'')+ '<p class=\"nw-danger\"><b>① デイ利用日が、紙の上で誤って読まれることがあります（いちばん重い）</b><br>'+ 'A4様式・詳細画面の印刷・フェイスシートで「▲ 未確認」になります。'+ '<b>週間計画側の記録が利用者Noで紐づいていない方は「未確認」ではなく【空欄】</b>になり、'+ '紙の上で「デイ利用なし」と読まれます。この様式は救急搬送先や処方と同じ紙で'+ '<b>外部（居宅・病院）へ渡ります</b>。<br>'+ '→ <b>印刷の前に、週間計画アプリでも同じ氏名に直してください。</b></p>'+ '<p>スペースの調整と違い、文字が変わると次のことも起きます（<b>エラーは出ません。「無い」ように見えるだけです</b>）。</p>'+ '<ol>'+ '<li><b>排泄ケア記録のマスタ連携が止まります。</b>以後この方をマスタで入院・退去にしても届かず、'+ '居室・ふりがな・介護度も更新されません。<b>自然には戻りません</b>'+ '（排泄ケア記録で氏名を揃えるか「表記ゆれ確認済み」にすると戻ります）</li>'+ '<li><b>家族構成図</b>が「未作成」になります（図そのものは消えていません。'+ 'ジェノグラムで新しい氏名で保存し直すと戻ります）</li>'+ '<li><b>支援経過の取込</b>が見送られます（元のスプレッドシートの氏名も直してください）</li>'+ '<li><b>申送ビューア</b>で居室が出ず、五十音の並びが変わります</li>'+ '<li><b>体重の最新値</b>が古い値に戻ります（体重管理アプリ側が利用者Noで紐づいていない方だけ）</li>'+ '</ol>'+ '<p class=\"muted\">週間計画・ワークスケジュールの表示は自動では変わりません（旧表記のまま残ります）。'+ '週間計画側に利用者Noで紐づいていない行があると、予定ゼロの行が新しく作られることがあります。</p>'"]
  ],
  "shadow-check.html": [],
  "shadow-check.js": [],
  "shift-analyzer.html": [
    [F, "out.innerHTML = '<p class=\"muted\">勤務表を貼り付けて「集計」を押してください。</p>'"],
    [E, "out.innerHTML = '<p class=\"err\">読み取りに失敗しました: ' + esc(e.message) + '</p>'"],
    [E, "out.innerHTML = '<p class=\"err\">' + esc(parsed.error) + '</p>'"],
    [E, "out.innerHTML = '<p class=\"err\">集計中にエラーが発生しました: ' + esc(e2.message) + '</p>'"],
    [E, "$('results').innerHTML = html"],
    [F, "if (res0) res0.insertAdjacentHTML('afterbegin', oldMethodNoticeHTML())"],
    [F, "box.innerHTML = '<p class=\"muted\">保存済みの月はありません。各月を集計→「この月を保存」で蓄積すると、いつでも「表示」で見返せます（このツール専用の保存先。ライブのシフトは汚しません）。</p>'"],
    [E, "box.innerHTML = html"],
    [F, "box.innerHTML = ''"],
    [N, "box.innerHTML = '<section class=\"card accent\"><h3>選択 ' + sel.length + ' 月の期間平均（前3月・前年度判定用）</h3>' + '<div class=\"grid\">' + cell('合算（時間ベース）介福割合', '<b class=\"big\">' + pct(combined) + ' %</b>') + cell('合算 介福＋実務者割合', pct(combinedJ) + ' %') + cell('各月割合の単純平均', pct(simpleAvg) + ' %') + '</div><p class=\"note\">合算＝Σ介福実働÷Σ訪問実働（常勤換算の期間平均に相当）。自治体・様式により採用する平均の取り方が異なる場合はご確認ください。</p></section>'"],
    [E, "box.innerHTML = html"],
    [F, "$('results').innerHTML = ''"]
  ],
  "shift-app.html": [
    [E, "wrap.innerHTML = this.buildSheet(ctx, pm, dcw, null, '')"],
    [E, "wrap.innerHTML = '<div class=\"psplit-page psplit-a\">' + this.buildSheet(ctx, true, dcw, [1, 15], 'sheet-a') + '</div>' + '<div class=\"psplit-page psplit-b\">' + this.buildSheet(ctx, true, dcw, [16, last], 'sheet-b') + '</div>'"],
    [N, "bar.innerHTML = h"],
    [E, "pal.innerHTML = h"],
    [F, "el.innerHTML = '<p class=\"muted\">退避データはありません。</p>'"],
    [E, "el.innerHTML = h + '</table>'"],
    [E, "el.innerHTML = h"],
    [E, "document.getElementById('edSymsList').innerHTML = self.symCheckboxHtml(checkedSet)"],
    [E, "el.innerHTML = h"],
    [E, "document.getElementById('staffImportPreview').innerHTML = h"],
    [N, "document.getElementById('staffImportPreview').innerHTML = '<p>✓ 取込完了: 新規 ' + added + '名 / 更新 ' + updated + '名 / 除外 ' + r.excluded.length + '名' + ((r.skipped && r.skipped.length) ? ' / 形式外 ' + r.skipped.length + '名（未取込・一覧を確認してください）' : '') + '</p>'"],
    [E, "document.getElementById('settingsForm').innerHTML = h"],
    [E, "document.getElementById('drawer').innerHTML = html"],
    [E, "el.innerHTML = h"],
    [E, "document.getElementById('reqPreview').innerHTML = h"],
    [N, "document.getElementById('reqPreview').innerHTML = '<p>✓ ' + n + '名分を登録しました</p>'"],
    [N, "out.innerHTML = '<div class=\"panel\"><p class=\"muted\">勤務表を読んでいます（' + months.length + 'か月分）…</p></div>'"],
    [E, "out.innerHTML = self.tokuteiHtml_(ym, W, months, r)"],
    [E, "out.innerHTML = '<div class=\"panel\"><p class=\"muted\">数えられませんでした（' + esc(String(e && e.message || e)) + '）。</p></div>'"],
    [F, "tkOut.innerHTML = ''"],
    [E, "document.getElementById('officialTable').innerHTML = h"],
    [E, "el.innerHTML = h"],
    [E, "el.innerHTML = h"],
    [E, "dlg.innerHTML = h"],
    [E, "wrap.innerHTML = h"],
    [E, "dr.innerHTML = h"],
    [E, "document.body.insertAdjacentHTML('afterbegin', '<div style=\"background:#c0392b;color:#fff;padding:10px\">初期化エラー: ' + escText(String(e.message || e)) + '</div>')"]
  ],
  "staff-master-calc.js": [],
  "staff-master.html": [],
  "su-annot.js": [
    [F, "root.innerHTML = '<div class=\"sua-board\"></div><div class=\"sua-hover\"></div><div class=\"sua-cur\"></div><div class=\"sua-marks\"></div>' + '<div class=\"sua-bar\" role=\"toolbar\" aria-label=\"画面の指摘\">' + '<span class=\"sua-t\" aria-live=\"polite\"></span>' + '<button class=\"sua-btn sub\" type=\"button\" data-a=\"move\">帯を下へ</button>' + '<button class=\"sua-btn pri\" type=\"button\" data-a=\"done\">できた</button>' + '<button class=\"sua-btn sub\" type=\"button\" data-a=\"quit\">やめる</button>' + '</div>'"],
    [F, "marksBox.innerHTML = ''"],
    [N, "box.innerHTML = '<h3>指摘 ' + n + '<span class=\"sua-tag\"></span></h3>' + '<textarea maxlength=\"' + MAX_NOTE + '\" placeholder=\"例：ここの文字が切れる／この枠を右に揃えたい\" aria-label=\"この場所について一言\"></textarea>' + '<p class=\"sua-w\">氏名・居室番号・病名は書かないでください。</p>' + '<p class=\"sua-e\" hidden></p>' + '<div class=\"sua-row\">' + '<button class=\"sua-btn pri\" type=\"button\" data-a=\"ok\">決める</button>' + '<button class=\"sua-btn\" type=\"button\" data-a=\"up\">外側を選ぶ</button>' + '<button class=\"sua-btn\" type=\"button\" data-a=\"del\">' + (mark ? 'この指摘を消す' : '取り消す') + '</button>' + '</div>'"]
  ],
  "su-auth.js": [],
  "su-cfg-hint.js": [],
  "su-data-gas.js": [],
  "su-data-supabase.js": [],
  "su-data.js": [],
  "su-errors.js": [],
  "su-export-crypt.js": [],
  "su-export.js": [],
  "su-facility.js": [],
  "su-itomari.js": [],
  "su-kv-shadow.js": [],
  "su-kv.js": [],
  "su-master-shadow.js": [],
  "su-menu.js": [],
  "su-patch-sync.js": [],
  "su-perf.js": [],
  "su-print.js": [
    [E, "dlg.innerHTML = '<form method=\"dialog\" class=\"su-pd\">' + '<h2>印刷の設定 <small>' + h(spec.label || name) + '</small></h2>' + (allow.indexOf('paper') >= 0 ? '<label>用紙<select name=\"paper\">' + opts(papers, cur.paper) + '</select></label>' : '') + (allow.indexOf('margin') >= 0 ? '<label>余白<select name=\"margin\">' + opts(MARGIN_CHOICES, mrg) + '</select></label>' : '') + (allow.indexOf('fit') >= 0 && canFit ? '<label>収め方<select name=\"fit\">' + opts(FIT_CHOICES, cur.fit) + '</select></label>' : '') + '<p class=\"su-pd-est\" aria-live=\"polite\"></p>' + '<label class=\"su-pd-remember\"><input type=\"checkbox\" name=\"remember\" checked> この設定を次回も使う（この端末）</label>' + '<div class=\"su-pd-btns\"><button value=\"reset\" type=\"button\">既定に戻す</button><span></span>' + '<button value=\"cancel\" type=\"button\">キャンセル</button><button value=\"print\" type=\"submit\" class=\"su-pd-primary\">印刷</button></div>' + '</form>'"]
  ],
  "su-report.js": [
    [F, "dlg.innerHTML = '<div class=\"sur-in\">' + '<h2>不具合を報告する</h2>' + '<p>何が起きたかを書いてください。端末やエラーの情報は自動で付きます。</p>' + '<p class=\"sur-warn\">この報告は、直す担当が見る場所に載ります。入居者・職員の氏名、居室番号、病名は書かないでください。</p>' + '<label for=\"sur-sym\">何が起きましたか</label>' + '<textarea id=\"sur-sym\" placeholder=\"例：印刷すると右端が切れる／保存を押しても戻ってしまう\"></textarea>' + '<div class=\"sur-ann\" id=\"sur-ann\" hidden>' + '<button class=\"sur-btn\" id=\"sur-pick\" type=\"button\">画面の場所を指して報告</button>' + '<div id=\"sur-ann-box\" hidden>' + '<label>画面の指摘</label><ol id=\"sur-ann-list\"></ol>' + '<canvas id=\"sur-ann-cv\" role=\"img\" aria-label=\"一緒に送る配置図（文字は塗りつぶし）\"></canvas>' + '<div class=\"sur-note\">この絵（配置図）も一緒に送ります。部品の四角と、文字がある所の帯だけです。文字・入力の値・写真は入っていません。</div>' + '<div class=\"sur-row\"><button class=\"sur-btn\" id=\"sur-repick\" type=\"button\">指し直す</button>' + '<button class=\"sur-btn\" id=\"sur-unpick\" type=\"button\">指摘を消す</button></div>' + '</div></div>' + '<label>送る内容（これがそのまま渡ります）</label>' + '<div class=\"sur-pre\" id=\"sur-prev\"></div>' + '<div class=\"sur-row\">' + '<button class=\"sur-btn pri\" id=\"sur-copy\" type=\"button\">この内容をコピー</button>' + '<button class=\"sur-btn\" id=\"sur-send\" type=\"button\" hidden>そのまま送信</button>' + '<button class=\"sur-btn\" id=\"sur-close\" type=\"button\">とじる</button>' + '</div><div class=\"sur-ok\" id=\"sur-msg\" hidden></div>' + '<div class=\"sur-note\" id=\"sur-note\" hidden>この端末はログインしているか送信先が設定されているため、画面でエラーが起きた時は、エラーの種類・ファイル名・行番号・端末の種類だけが自動で送られます（エラーの文の中身、氏名、記録、合言葉は送りません。ログインしている時は、送った人のアカウントが記録に残ります）。</div>' + '</div>'"],
    [F, "list.innerHTML = ''"]
  ],
  "su-roster.js": [],
  "su-staff-names.js": [],
  "su-sync-stale.js": [],
  "su-weight-shadow.js": [],
  "supplies-calc.js": [],
  "supplies.html": [],
  "support-overview.html": [],
  "training-plan-form.js": [],
  "training-plan.html": [],
  "universe-sandbox/index.html": [],
  "universe-sandbox/js/app.js": [
    [F, "document.getElementById('bodyList').innerHTML = ''"],
    [N, "li.innerHTML = `<span class=\"dot\" style=\"background:#${b.color.toString(16).padStart(6, '0')}\"></span>${b.name}`"],
    [F, "ul.innerHTML = ''"],
    [N, "li.innerHTML = `<span class=\"dot\" style=\"background:#${b.color.toString(16).padStart(6, '0')}\"></span>${b.name}`"],
    [F, "box.innerHTML = '<p class=\"muted\">天体をタップで選択</p>'"],
    [N, "box.innerHTML = ` <div class=\"info-name\" style=\"color:#${b.color.toString(16).padStart(6, '0')}\">${b.name}</div> <div class=\"info-row\"><span>太陽からの距離</span><b>${sunDist.toFixed(3)} AU</b></div> ${parentRow} <div class=\"info-row\"><span>${spdLabel}</span><b>${kms.toFixed(1)} km/s</b></div> <label class=\"info-edit\">質量 (地球比) <input id=\"massEdit\" type=\"number\" step=\"0.1\" min=\"0.001\" value=\"${(sim.mass[i] / EARTH_MASS).toFixed(3)}\"> </label> <button id=\"focusBtn\" class=\"btn small\">この天体を中心に表示</button> `"]
  ],
  "universe-sandbox/js/data.js": [],
  "universe-sandbox/js/physics.js": [],
  "universe-sandbox/sw.js": [],
  "visit-overview.html": [],
  "weight-record.html": [
    [F, "b.innerHTML = '✅ 同期中'"],
    [F, "b.innerHTML = '⚠️ 接続エラー'"],
    [F, "b.innerHTML = '<span class=\"spin\">🔄</span> 同期中'"],
    [E, "sel.innerHTML = '<option value=\"\">選択してください</option>' + list.map(r=>{ const tag = isDischarged(r) ? '[退去] ' : ''; const cls = isDischarged(r) ? ' class=\"is-discharged\"' : ''; return `<option value=\"${escapeHtml(r.id)}\"${cls}>${tag}${r.room?`[${escapeHtml(r.room)}] `:''}${escapeHtml(r.name||'')}</option>`; }).join('')"],
    [E, "ov.innerHTML = sheetHtml"],
    [F, "body.innerHTML = ''"],
    [E, "tr.innerHTML = ` <td class=\"nm c-nm\"><span class=\"nm-link\" data-go-input-rid=\"${escapeHtml(r.id)}\" title=\"${escapeHtml(r.name)}さんの入力画面を開く\">${escapeHtml(r.name)}</span><div class=\"ls-sub\"><span class=\"rm\">${r.room?`室 ${escapeHtml(r.room)}`:''}</span>${hasMf ? `${r.room ? ' · ' : ''}${mfHtml}` : ''}</div></td> <td class=\"c-sp\">${wrSparkSvg(r.id, listMonth)}</td> <td class=\"c-wt\">${wtHtml}</td> <td class=\"c-d1\" data-l=\"前月比\">${a ? diffHtml(a.diff1, a.pct1) + ((a.diff1==null && a.prev3 !== undefined && (a.prev3 || a.prev6)) ? '<div class=\"ls-sub\">前月の記録なし</div>' : '') : '—'}</td> <td class=\"c-d6\" data-l=\"6ヶ月比\">${a ? diffHtml(a.diff6, a.pct6) + (a.diff6!=null && wrCmpNote(a.prev6, 6, listMonth) ? `<div class=\"ls-sub\">${escapeHtml(wrCmpNote(a.prev6, 6, listMonth))}</div>` : '') : '—'}</td> <td class=\"c-st\">${stateHtml}</td> `"],
    [F, "body.innerHTML = `<tr><td colspan=\"6\" class=\"empty\">該当する入居者がいません</td></tr>`"],
    [E, "tbl.innerHTML = head + '<tbody>' + rows + '</tbody>'"],
    [E, "m.innerHTML = `<div class=\"gr-menu-h\">${escapeHtml(r ? r.name : '')}</div>` + `<button type=\"button\" role=\"menuitem\" data-gm=\"input\">${escapeHtml(ymGridLabel(gridMonth))}の体重を入力</button>` + `<button type=\"button\" role=\"menuitem\" data-gm=\"indiv\">個別のグラフを見る</button>` + `<button type=\"button\" role=\"menuitem\" data-gm=\"3y\">3年分の表を見る</button>`"],
    [F, "box.innerHTML = `<div style=\"padding:20px;text-align:center;color:var(--g6);font-size:0.9375rem\">入居者が登録されていません</div>`"],
    [E, "box.innerHTML = residents.map(r=>{ const existingRec = getRecordByDate(r.id, date); // exact-date duplicate const latestAny = getLatestRecordAny(r.id); const isChair = (r.wheelchairKg != null && r.wheelchairKg > 0); const chairKg = isChair ? wcLatestKg_(r.id, ym, date) : null; // 最新の重さ（設定の「最新」の行） // show previous weight (absolute latest) and its date, if any let prevHtml = '<span style=\"color:var(--g5)\">未登録</span>'; if(latestAny){ const dstr = latestAny.measuredOn || ymFmt(latestAny.yearMonth); prevHtml = `<div>前回<br><b>${latestAny.weight.toFixed(1)}</b><small>kg</small></div><div style=\"color:var(--g6);font-size:0.9375rem\">${escapeHtml(dstr)}</div>`; } const chairBadge = isChair ? `<span class=\"bk-wc\">車椅子 ${chairKg.toFixed(1)}kg</span>` : ''; const existBadge = existingRec ? `<span class=\"bk-ex\">${escapeHtml(date)} に既存記録あり（上書き）</span>` : ''; const chairHint = isChair ? `<span class=\"bk-ch\">実測</span>` : ''; const placeholder = latestAny ? (isChair ? (latestAny.rawWeight != null ? latestAny.rawWeight.toFixed(1) : (latestAny.weight + (chairKg||0)).toFixed(1)) : latestAny.weight.toFixed(1)) : ''; return ` <div class=\"bk-row${existingRec?' existing':''}\" data-rid=\"${escapeHtml(r.id)}\" data-existing=\"${existingRec?escapeHtml(existingRec.id):''}\" data-chair=\"${isChair?'1':'0'}\"> <div class=\"bk-nm\"> ${escapeHtml(r.name)} <span class=\"bk-rm\">${r.room?`室 ${escapeHtml(r.room)}`:''}</span> ${chairBadge} </div> <div class=\"bk-prev\">${prevHtml}</div> <div class=\"bk-in\"> <input type=\"number\" step=\"0.1\" min=\"20\" max=\"200\" placeholder=\"${placeholder}\" inputmode=\"decimal\"> <span class=\"bk-unit\">kg</span> </div> <div class=\"bk-badge\"> ${chairHint} ${existBadge} </div> <div class=\"bk-act\"> <button type=\"button\" class=\"bk-save\" data-rid=\"${escapeHtml(r.id)}\" title=\"この入居者だけ保存\">保存</button> </div> </div>`; }).join('')"],
    [N, "$('#bulkSummary').innerHTML = `入力済み: <b>${filled}</b> 名${existing?` （うち<b>${existing}</b>名は既存記録を上書き）`:''}`"],
    [N, "wrap.innerHTML = html"],
    [F, "c.innerHTML = ''"],
    [N, "b.innerHTML = `${d.n}${d.s?`<small>${d.s}</small>`:''}`"],
    [F, "c.innerHTML = ''"],
    [N, "b.innerHTML = `${t.n}<small>${t.short}</small>`"],
    [F, "if(inMode==='chair') $('#inWeightHint').innerHTML = ''"],
    [F, "else $('#inChairWeightHint').innerHTML = ''"],
    [N, "hint.innerHTML = bmiPart"],
    [N, "hint.innerHTML = `<span style=\"color:var(--g5)\">前回記録なし</span> ${bmiPart}`"],
    [E, "hint.innerHTML = `前回（${escapeHtml(prevLabel)} ${prevRec.weight.toFixed(1)}kg）比 <b style=\"color:${col}\">${sign}${diff.toFixed(1)}kg (${sign}${pct.toFixed(1)}%)</b> ${bmiPart}`"],
    [F, "box.innerHTML = ''"],
    [F, "box.innerHTML = `<div class=\"iex-empty\">この入居者の記録はまだありません。</div>`"],
    [E, "box.innerHTML = `<div class=\"iex-hd\">入力済み記録 <small>${list.length}件</small></div>${rows}${more}`"],
    [F, "el.innerHTML = `<div class=\"empty\" style=\"grid-column:1/-1\">データがまだありません。入力タブから記録してください。</div>`"],
    [E, "el.innerHTML = cell('最新体重', `${last.weight.toFixed(1)} <small style=\"font-size:0.9375rem;color:var(--g6)\">kg</small>`, ymFmt(last.yearMonth)) + bmiCell + cell('前月比', a?.diff1!=null ? `${a.diff1>0?'+':''}${a.diff1.toFixed(1)}` : '—', a?.diff1!=null ? `${a.pct1>0?'+':''}${a.pct1.toFixed(1)}%` : (recs.length > 1 ? '前月の記録なし' : ''), d1Cls) + cell('6ヶ月比', a?.diff6!=null ? `${a.diff6>0?'+':''}${a.diff6.toFixed(1)}` : '—', a?.diff6!=null ? `${a.pct6>0?'+':''}${a.pct6.toFixed(1)}%${escapeHtml(wrCmpNote(a.prev6, 6, last.yearMonth))}` : '', d6Cls) + (()=>{ const rk = wrNutritionRisk(rid, last.yearMonth); if(!rk || !rk.level) return cell('低栄養リスク', '—', '比べる記録・身長が無い', '', 'color:var(--g5)'); const cls = rk.level === 'high' ? 'rk-v-high' : rk.level === 'mid' ? 'rk-v-mid' : ''; const sub = rk.reasons.length ? escapeHtml(rk.reasons.join('・')) : (rk.compared ? '3%以上の減少なし' : 'BMIのみ（比べる記録なし）'); return `<div class=\"st-i\" title=\"体重とBMIだけで判定（血清アルブミン・食事摂取量は含みません）\"><div class=\"st-l\">低栄養リスク</div><div class=\"st-v ${cls}\">${rk.label}</div><div class=\"st-s\">${sub}</div></div>`; })() + cell('記録期間中', `${min.toFixed(1)}〜${max.toFixed(1)}`, `開始${first.weight.toFixed(1)}→現${last.weight.toFixed(1)} (${diffTotal>0?'+':''}${diffTotal.toFixed(1)}kg)`)"],
    [F, "body.innerHTML = ''"],
    [F, "body.innerHTML = `<tr><td colspan=\"9\" class=\"empty\">記録がありません</td></tr>`"],
    [E, "tr.innerHTML = ` <td style=\"text-align:start;padding-left:10px\">${dateLabel}</td> <td><b>${wrWeightOk(r) ? r.weight.toFixed(1) : '—'}</b>${chairBadge?`<br>${chairBadge}`:''}${r.recheck === 'confirmed' ? '<br><span class=\"rc-badge\" title=\"前回から大きく変わったため、測り直して同じ値だったことを確かめた記録\">測り直し済み</span>' : ''}</td> <td>${bmiHtml}</td> <td>${diffHtml}</td> <td>${mainLabel(r.stapleForm)}${r.stapleAmount!=null?`<span class=\"sa-chip\">${escapeHtml(r.stapleAmount)}g</span>`:''}</td> <td>${sideLabel(r.sideForm)}</td> <td>${TOGGLES.filter(t=>r[t.k]).map(t=>`<span class=\"tg-chip\">${t.short}</span>`).join('') || '<span style=\"color:var(--g5)\">—</span>'}</td> <td style=\"text-align:start;max-width:180px;word-break:break-word;white-space:normal\">${r.note?escapeHtml(r.note):'<span style=\"color:var(--g5)\">—</span>'}</td> <td class=\"hist-act\"> <button class=\"bn bo bsm\" data-edit-id=\"${escapeHtml(r.id)}\">編集</button> </td> `"],
    [F, "list.innerHTML = ''"],
    [F, "list.innerHTML = `<div class=\"empty\"> <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><path d=\"M20 6 9 17l-5-5\"/></svg> <div>対象のアラートはありません</div> </div>`"],
    [E, "div.innerHTML = ` <div class=\"al-ic\">${dir==='dn'?'↓':'↑'}</div> <div class=\"al-body\"> <div class=\"al-nm\">${escapeHtml(resident.name)}<span class=\"rm\">${resident.room?'室 '+escapeHtml(resident.room):''}</span><span class=\"eb ${a.level==='ng'?'eb-ng':'eb-w'}\">${a.level==='ng'?'警告':'注意'}</span></div> <div class=\"al-ms\"> ${a.reasons.map(x=>`<div>${x}</div>`).join('')} ${ack ? `<div class=\"al-ack-info\">✓ ${escapeHtml(wrAckText(ack))}</div>` : ''} <div style=\"margin-top:4px;color:var(--g6)\">対象月：<b>${ymFmt(ym)}</b> 体重：<b>${a.cur.weight.toFixed(1)}kg</b>${(()=>{const b=bmiOf(a.cur.weight,resident.heightCm);return b!=null?` BMI：<b>${b.toFixed(1)}</b>`:'';})()} 食事：<b>${mainLabel(a.cur.stapleForm)}${a.cur.stapleAmount!=null?` ${escapeHtml(a.cur.stapleAmount)}g`:''}/${sideLabel(a.cur.sideForm)}</b>${(()=>{const t=TOGGLES.filter(x=>a.cur[x.k]).map(x=>x.n);return t.length?` <b>${t.join('・')}</b>`:'';})()}</div> </div> </div> `"],
    [F, "act.innerHTML = ack ? `<button type=\"button\" class=\"bn bs bsm\" data-al-undo>確認を取り消す</button>` : `<button type=\"button\" class=\"bn bo bsm\" data-al-ack>確認した（対応を残す）</button>`"],
    [E, "f.innerHTML = `<label class=\"sr-only\" for=\"alAct_${escapeHtml(resident.id)}_${dir}\">対応</label>` + `<select id=\"alAct_${escapeHtml(resident.id)}_${dir}\">${WR_ACK_ACTIONS.map(x=>`<option>${escapeHtml(x)}</option>`).join('')}</select>` + `<input type=\"text\" maxlength=\"200\" placeholder=\"ひとこと（任意）\" aria-label=\"ひとこと（任意）\">` + `<button type=\"button\" class=\"bn bp bsm\" data-al-save>保存</button><button type=\"button\" class=\"bn bs bsm\" data-al-cancel>やめる</button>`"],
    [N, "doneBox.innerHTML = `<summary>確認済み（${doneItems.length}件）</summary>`"],
    [F, "c.innerHTML = ''"],
    [N, "b.innerHTML = `${d.n}${d.s?`<small>${d.s}</small>`:''}`"],
    [F, "c.innerHTML = ''"],
    [N, "b.innerHTML = `${t.n}<small>${t.short}</small>`"],
    [F, "tbl.innerHTML = ` <dt>主食</dt><dd class=\"empty\">—</dd> <dt>副食</dt><dd class=\"empty\">—</dd> <dt>オプション</dt><dd class=\"empty\">—</dd>`"],
    [E, "tbl.innerHTML = ` <dt>主食</dt><dd>${stapleStr}</dd> <dt>副食</dt><dd>${sideStr}</dd> <dt>オプション</dt><dd>${togStr}</dd>`"],
    [F, "box.innerHTML = '<div class=\"dup-none\">重複している入居者・氏名の無い行・持ち主のいない記録・登録を見送った人はいません。</div>'"],
    [E, "box.innerHTML = html"],
    [F, "list.innerHTML = ''"],
    [F, "list.innerHTML = `<div class=\"empty\">入居者が登録されていません。<br>「＋ 追加」または「サンプル投入」から開始してください。</div>`"],
    [E, "div.innerHTML = ` <div class=\"rli-l\"> <div class=\"rli-n\">${escapeHtml(r.name)}${dcTag}</div> <div class=\"rli-s\">${r.room ? '部屋 ' + escapeHtml(r.room) + ' / ' : ''}${hStr}記録 ${n} 件</div> </div> <div class=\"rli-btns\"> <button class=\"bn bo bsm\" data-ed=\"${escapeHtml(r.id)}\">編集</button> </div> `"],
    [E, "body.innerHTML = THR_ROWS.map(({k,label})=>{ const t = THR[k]; const mk = (field, step) => `<input type=\"number\" min=\"0\" step=\"${step}\" data-thr=\"${k}.${field}\" value=\"${escapeHtml(t[field])}\">`; return `<tr> <td>${label}</td> <td class=\"th-w\">${mk('wKg','0.1')}</td> <td class=\"th-w\">${mk('wPct','0.1')}</td> <td class=\"th-ng\">${mk('ngKg','0.1')}</td> <td class=\"th-ng\">${mk('ngPct','0.1')}</td> </tr>`; }).join('')"],
    [N, "el.innerHTML = `<b>検知ルール：</b>${part('前月比', THR.m1)}<br>${part('3ヶ月比', THR.m3)}<br>${part('6ヶ月比', THR.m6)}` + `<br><span style=\"color:var(--g6)\">比べる相手は暦の月です（前月比＝1か月前、3ヶ月比＝3か月前・無ければ2か月前、6ヶ月比＝6か月前・無ければ5→4か月前）。それより前へはさかのぼりません。</span>` + `<br><span style=\"color:var(--g6)\">低栄養リスク（厚労省の区切り・体重とBMIだけで判定）：高＝1か月5%・3か月7.5%・6か月10%以上の減少／中＝どれかの期間で3%以上の減少かBMI 18.5未満。一覧と個別に札を出し、アラートには高リスクだけを上げます。</span>` + `<br><span style=\"color:var(--g6)\">前回の測定から5%以上か2.5kg以上変わった値は、保存の前に「測り直しましたか」と確かめます。</span>`"],   /* しきい値は kg > 0・pct > 0 を満たす時だけ出る＝数に読める値だけ */
    [F, "box.innerHTML = '<div class=\"wc-log-empty\">履歴はありません。車椅子重量を入れると、今日の日付で1行足されます。</div>'"],
    [E, "box.innerHTML = order.map(i=>{ const e = mdChairLog[i]; const latest = (i === latestIdx); return ` <div class=\"wc-log-item${latest ? ' latest' : ''}\"> ${latest ? '<span class=\"wc-log-tag\">最新</span>' : ''} <div class=\"wc-log-row\"> <input type=\"date\" data-wcl-on=\"${i}\" value=\"${escapeHtml(e.on || '')}\" aria-label=\"${latest ? '最新の' : ''}変更日\"> <input type=\"number\" data-wcl-kg=\"${i}\" step=\"0.1\" min=\"1\" max=\"50\" inputmode=\"decimal\" value=\"${e.kg > 0 ? Number(e.kg).toFixed(1) : ''}\" aria-label=\"車椅子の重さ（kg）\"> <span class=\"wc-log-u\">kg</span> <button type=\"button\" class=\"wc-log-del\" data-wcl-del=\"${i}\" aria-label=\"この行を消す\">削除</button> </div> </div>`; }).join('')"],
    [F, "bar.innerHTML=''"],
    [E, "bar.innerHTML=`<span>${msg}</span><button type=\"button\" id=\"fromMasterClose\">${state==='ok'?'解除':'閉じる'}</button>`"]
  ],
  "work-schedule.html": [
    [F, "if (html !== undefined) e.innerHTML = html"],   /* 盤面の部品 el(tag, cls, html) の第3引数。今は3引数で呼ぶ所が無い（xss_work_schedule_test の W10 が確かめる） */
    [F, "boardEl.innerHTML = ''"],
    [F, "host.innerHTML = ''"],
    [F, "d.innerHTML = '<span class=\"am\"></span><span class=\"as\"></span><span class=\"alt-btns\"></span>'"],
    [F, "e0.innerHTML = '<span class=\"am\">この日の案はまだありません</span>'"],
    [F, "$('altList').innerHTML = '<div class=\"ai\"><span class=\"am\">読み込み中…</span></div>'"],
    [F, "$('altList').innerHTML = ''"],
    [F, "sh.innerHTML = ''"],
    [F, "ch.innerHTML = ''"],
    [F, "d.innerHTML = '<span class=\"am\"></span><span class=\"as\"></span><button class=\"tray-btn\"></button>'"],
    [F, "ch.innerHTML = '<div class=\"ai\"><span class=\"am\">未配置の支援はありません</span></div>'"],
    [F, "d.innerHTML = '<span class=\"am\"></span><span class=\"as\"></span><span class=\"alt-btns\"></span>'"],
    [F, "wrap.innerHTML = ''"],
    [F, "c.innerHTML = '<span class=\"c-name\"></span><br><span class=\"c-sub\"></span>'"],
    [N, "host.innerHTML = html"],
    [N, "$('calGrid').innerHTML = h"],
    [F, "sel.innerHTML = ''"],
    [F, "sel.innerHTML = ''"],
    [F, "dl.innerHTML = ''"],
    [F, "box.innerHTML = ''"],
    [F, "wrap.innerHTML = ''"],
    [F, "wrap.innerHTML = ''"],
    [F, "sel.innerHTML = ''"],
    [F, "wrap.innerHTML = ''"],
    [F, "un.innerHTML = ''"],
    [F, "if (!alerts.unassigned.length) un.innerHTML = '<div class=\"ai\"><span class=\"am\">なし 🎉</span></div>'"],
    [F, "d.innerHTML = '<span class=\"am\"></span><span class=\"as\"></span>'"],
    [F, "br.innerHTML = ''"],
    [F, "if (!alerts.noBreak.length) br.innerHTML = '<div class=\"ai\"><span class=\"am\">なし 🎉</span></div>'"],
    [F, "d.innerHTML = '<span class=\"am\"></span><button class=\"tray-btn\">空き時間に休憩1hを配置</button>'"],
    [F, "bump.innerHTML = ''"],
    [F, "if (!bl.length) bump.innerHTML = '<div class=\"ai\"><span class=\"am\">なし 🎉</span></div>'"],
    [F, "d.innerHTML = '<span class=\"am\"></span><span class=\"as\"></span>'"],
    [F, "oo.innerHTML = ''"],
    [F, "if (!ohl.length) oo.innerHTML = '<div class=\"ai\"><span class=\"am\">なし 🎉</span></div>'"],
    [F, "d.innerHTML = '<span class=\"am\"></span><span class=\"as\"></span>'"],
    [F, "ov.innerHTML = ''"],
    [F, "if (!ol.length) ov.innerHTML = '<div class=\"ai\"><span class=\"am\">なし 🎉</span></div>'"],
    [F, "d.innerHTML = '<span class=\"am\"></span><span class=\"as\"></span>'"],
    [F, "if (outEl) outEl.innerHTML = ''"],
    [N, "if (outEl) outEl.innerHTML = res.html"],
    /* 24時間配置・食事対応表（2026-10-27）。氏名・枠の名前・施設名・案の名前は WSStaffing.paperHtml の esc と画面の escH_ を通る（xss_work_schedule_test の W11 が確かめる） */
    [F, "if (p) p.innerHTML = ''"],
    [F, "if (sl) sl.innerHTML = ''"],
    [E, "$('rpMsg').innerHTML = '<span class=\"ng\">' + escH_(st.err) + '</span>'"],
    [F, "prev.innerHTML = ''"],
    [E, "$('rpMsg').innerHTML = msg.join('<br>')"],
    [E, "prev.innerHTML = WSStaffing.paperHtml(r, st.info)"],
    [F, "host.innerHTML = '<span class=\"off\">選べる職員がいません（職員名簿が読めない・名簿の1人に決まらない職員は選べません）</span>'"],
    [E, "host.innerHTML = h.join('')"],
    [F, "if (p) p.innerHTML = ''"],
    [F, "if (sl) sl.innerHTML = ''"],
    [E, "$('rp-print').innerHTML = st.err ? '' : WSStaffing.paperHtml(st.r, st.info)"],
    [F, "$('rp-print').innerHTML = ''"]
  ],
  "yakujo-calc.js": []
};

/* ══════════════ 公開中のファイルを数える ══════════════ */
console.log('— 公開中の .html・.js —');
let files = [];
try {
  files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\n').filter((f) => /\.(html|js)$/.test(f));
} catch (e) {
  t('git ls-files で公開中のファイルを数えられる', false, e.message);
}
t('公開中の .html・.js を数えられた（0件で空振りにしない）', files.length > 0, files.length);

const exclUsed = { file: new Set(), block: new Set(), stmt: new Set() };
const excludedFiles = [];
const targets = [];
for (const f of files) {
  if (EXCLUDE_DIRS.some((d) => f.startsWith(d.dir))) continue;
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const ex = EXCLUDE_FILES.find((x) => x.re.test(f) && src.slice(0, 2000).includes(x.head));
  if (ex) { exclUsed.file.add(ex); excludedFiles.push(f); continue; }
  targets.push({ f, src });
}

/* 実物の代入の一覧 */
const actual = {};
let total = 0;
for (const { f, src } of targets) {
  let out = [], hidden = [], outside = [];
  if (f.endsWith('.html')) {
    const blocks = scriptBlocks(src);
    let rest = '', pos = 0;
    for (const b of blocks) {
      rest += src.slice(pos, b.start); pos = b.end;
      const eb = EXCLUDE_BLOCKS.find((x) => x.file === f && x.heads.every((h) => b.body.slice(0, 600).includes(h)));
      if (eb) { exclUsed.block.add(eb); continue; }
      const x = extractJs(b.body); out = out.concat(x.out); hidden = hidden.concat(x.hidden);
    }
    rest += src.slice(pos);
    rest = rest.replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '');
    SINK.lastIndex = 0; let r;
    while ((r = SINK.exec(rest))) outside.push(rest.slice(Math.max(0, r.index - 60), r.index + 60).replace(/\s+/g, ' '));
  } else {
    const x = extractJs(src); out = x.out; hidden = x.hidden;
  }
  out = out.filter((s) => {
    const es = EXCLUDE_STMTS.find((x) => x.file === f && x.stmt === s);
    if (es) { exclUsed.stmt.add(es); return false; }
    return true;
  });
  if (hidden.length) t(f + '：コメント・文字列の中に代入の形が無い（読み違いで本物を見落とさないため）', false, hidden.join(' ／ '));
  if (outside.length) t(f + '：<script> の外に代入の形が無い', false, outside.join(' ／ '));
  actual[f] = out;
  total += out.length;
}

/* ══════════════ (a) 全部のファイルが点検表に載っている ══════════════ */
console.log('— (a) 点検表に載っているか —');
const missing = targets.map((x) => x.f).filter((f) => !Object.prototype.hasOwnProperty.call(CENSUS, f));
t('公開中の対象ファイル ' + targets.length + ' 本が全部、点検表に載っている（新しいファイルは点検して足す）', missing.length === 0,
  '点検表に無いファイル: ' + missing.map((f) => f + '（代入 ' + actual[f].length + 'か所）').join('、'));
const stale = Object.keys(CENSUS).filter((f) => !actual[f]);
t('点検表に、公開中に無いファイルが残っていない', stale.length === 0, '公開中に無い: ' + stale.join('、'));

/* ══════════════ (b) ファイルごとに一致する ══════════════ */
console.log('— (b) ファイルごとの代入の一覧が点検表と一致するか —');
let nOk = 0;
for (const f of Object.keys(actual).sort()) {
  if (!Object.prototype.hasOwnProperty.call(CENSUS, f)) continue;
  const want = new Map();
  for (const [, s] of CENSUS[f]) want.set(s, (want.get(s) || 0) + 1);
  const got = new Map();
  for (const s of actual[f]) got.set(s, (got.get(s) || 0) + 1);
  const plus = [], minus = [];
  for (const [s, n] of got) for (let i = (want.get(s) || 0); i < n; i++) plus.push(s);
  for (const [s, n] of want) for (let i = (got.get(s) || 0); i < n; i++) minus.push(s);
  if (!plus.length && !minus.length) { nOk++; continue; }
  t(f + '：代入 ' + actual[f].length + 'か所が点検表（' + CENSUS[f].length + 'か所）と一致する', false,
    '\n      点検表に無い（増えた・文が変わった）:\n' + plus.map((s) => '        + ' + s).join('\n') +
    '\n      実物に無い（減った・文が変わった）:\n' + minus.map((s) => '        - ' + s).join('\n'));
}
t('点検表と一致したファイル ' + nOk + ' 本（代入の総数 ' + total + 'か所）', nOk === Object.keys(actual).filter((f) => CENSUS[f]).length, nOk);

/* ══════════════ (c) 区分が3つのどれか ══════════════ */
console.log('— (c) 区分 —');
const badKind = [];
const sum = { [F]: 0, [E]: 0, [N]: 0 };
for (const f of Object.keys(CENSUS)) for (const row of CENSUS[f]) {
  if (!Array.isArray(row) || row.length !== 2 || !KINDS.includes(row[0]) || typeof row[1] !== 'string') badKind.push(f + ': ' + JSON.stringify(row).slice(0, 200));
  else sum[row[0]]++;
}
t('区分は「固定の文」「esc を通る」「数だけ」のどれか', badKind.length === 0, badKind.join(' ／ '));
console.log('    内訳: 固定の文 ' + sum[F] + '／esc を通る ' + sum[E] + '／数だけ ' + sum[N]);

/* ══════════════ 除外の一覧が古くなっていない ══════════════ */
console.log('— 除外 —');
EXCLUDE_FILES.forEach((x) => t('除外の部品が今もある: ' + x.re.source + '（' + x.why + '）', exclUsed.file.has(x)));
EXCLUDE_BLOCKS.forEach((x) => t('除外の埋め込み部品が今もある: ' + x.file + '（' + x.why + '）', exclUsed.block.has(x)));
EXCLUDE_STMTS.forEach((x) => t('除外の文が今もある: ' + x.file + ' ' + x.stmt.slice(0, 40) + '（' + x.why + '）', exclUsed.stmt.has(x)));
console.log('    除外したファイル: ' + excludedFiles.join('、'));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗（' + ((Date.now() - T0) / 1000).toFixed(1) + '秒） ──────────');
process.exit(fail ? 1 : 0);
