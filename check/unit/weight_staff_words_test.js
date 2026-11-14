/* 体重管理（weight-record.html）：職員に見える文から技術用語を減らし、接続が無い時の案内を出す（品質改善 第3期 便4）。
   実物の HTML を読み、変えた文ごとに「前の技術用語が無い」「新しい文がある」を確かめる。
   同期の失敗と合言葉の文は、実物の関数を切り出して動かす（写経しない）。
   対象 HTML は環境変数 WEIGHT_HTML で差し替えられる（直す前の版で落ちることを確かめるため）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.WEIGHT_HTML || path.join(__dirname, '..', '..', 'weight-record.html');
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const has = (s) => src.indexOf(s) >= 0;

/* 関数を名前で切り出す（async 付きは async ごと） */
function cut(name) {
  let head = src.indexOf('function ' + name + '(');
  if (head < 0) return null;
  if (src.slice(Math.max(0, head - 6), head) === 'async ') head -= 6;
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  return null;
}

const GUIDE = 'この端末には、体重を複数の端末で共有するための接続先がありません。管理者から受け取った Google の受け口の URL（https://script.google.com/ で始まるもの）を上の欄に入れて「💾 URLを保存・接続」を押すか、下の「接続設定」の画面の「体重管理」の欄に入れてください（接続設定で入れた時は、この画面を読み込み直してください）。';

console.log('— 1. 設定の文（重複の点検・入出力・共有の連携） —');
t('1-1 重複の点検の説明に「JSON で保存」が無い', !has('まとめる前に、今のデータを JSON で保存します'));
t('1-2 重複の点検の説明は「控えのファイルに保存」', has('まとめる前に、今のデータを控えのファイルに保存します。</p>'));
t('1-3 書き出しのボタンに JSON が無く「控えのファイルに書き出す」', !has('>JSONエクスポート<') && has('id="cfgExport">控えのファイルに書き出す</button>'));
t('1-4 読み込みのボタンに JSON が無く「控えのファイルから読み込む」', !has('>JSONインポート<') && has('id="cfgImport">控えのファイルから読み込む</button>'));
t('1-5 共有の説明に GAS・Web App が無い', !has('Google Apps Script (GAS) で公開した Web App URL'));
t('1-6 共有の説明は「Google の受け口の URL を登録すると」', has('Google の受け口の URL を登録すると'));
t('1-7 URL の欄の見出しに GAS Web App が無い', !has('<label class="fl">GAS Web App URL'));
t('1-8 URL の欄の見出しは「Google の受け口の URL」', has('<label class="fl">Google の受け口の URL <span'));
t('1-9 うまく繋がらない時の項目に doGet・ContentService が無い', !has('doGet が ContentService') && !has('ContentService.createTextOutput(JSON.stringify'));
t('1-10 うまく繋がらない時の項目は「体重管理用の Google の受け口の URL か」', has('<li><b>体重管理用の Google の受け口の URL か</b>'));

console.log('— 2. 接続が無い時の案内 —');
const mSt = src.match(/<div id="apiStatus"[^>]*>\s*([\s\S]*?)\s*<\/div>/);
const stText = mSt ? mSt[1] : '';
t('2-1 初めの案内に GAS・デプロイの語が無い', !!mSt && !/GAS|デプロイ/.test(stText), stText);
t('2-2 初めの案内は「何が足りないか」と「どこに何を入れるか」', stText === GUIDE, stText);
const mLk = src.match(/<div id="apiCsLink"[^>]*>([\s\S]*?)<\/div>/);
t('2-3 案内のすぐ下に接続設定の画面へのリンクがある', !!mLk && /<a href="connection-settings\.html">接続設定の画面を開く<\/a>/.test(mLk[1]) && src.indexOf('id="apiCsLink"') > src.indexOf('id="apiStatus"'));
t('2-4 リンクは「体重管理」の欄を指す', !!mLk && /「体重管理」の欄/.test(mLk[1]));
t('2-5 連携を解除した後も同じ案内に戻す（GAS の語を出さない）', !has("textContent = 'GASをデプロイ") && has("$('#apiStatus').textContent = '" + GUIDE + "';"));
t('2-6 URL の形が違う時の知らせに GAS Web App が無い', !has('GAS Web App のURL') && has("toast('Google の受け口の URL（https://script.google.com/ で始まるもの）を入れてください','err')"));

console.log('— 3. 保存の失敗の知らせ —');
t('3-1 「JSON 不正」を出さない', !has('（JSON 不正）'));
t('3-2 「シリアライズ」を出さない', !has('（シリアライズ）'));
t('3-3 保存の失敗に英語の例外文をつながない', !has("(e.message || e.name || 'unknown')"));
const saveFn = cut('save') || '';
t('3-4 保存の失敗は職員向けの一文にし、元の例外は記録に残す', /この端末にデータを保存できませんでした。画面を読み込み直して、もう一度お試しください/.test(saveFn) && /wrNote_\('端末への保存', e\)/.test(saveFn));
t('3-5 「ストレージ」の語を出さない', !/toast\([^)]*ストレージ/.test(saveFn) && !/'⚠️ ストレージ容量不足/.test(saveFn));
t('3-6 起動時の知らせに「GAS連携」が無い', !has('GAS連携があれば') && has('複数の端末で共有している時は「手動同期」をお試しください'));

console.log('— 4. 控えのファイル・接続先の文（確かめの窓・知らせ） —');
t('4-1 まとめる時の確かめに「JSON で保存」が無い', !has('今のデータを JSON で保存します\\n') && has('・始める前に、今のデータを控えのファイルに保存します\\n'));
t('4-2 持ち主のいない記録を消す確かめに「JSON で保存」が無い', !has('（消す前に、今のデータを JSON で保存します）') && has('（消す前に、今のデータを控えのファイルに保存します）'));
t('4-3 読み込む時の確かめに「GAS 連携URL」が無い', !has('`インポートファイルにも GAS 連携URL') && has('読み込むファイルにも、共有の接続先（Google の受け口の URL）が入っています。'));
t('4-4 全データ削除の知らせに「GAS連携URL」が無い', !has('GAS連携URLは保持') && has("'（共有の接続先の URL は残しました）'"));

console.log('— 5. 合言葉が一致しない時の文（実物の関数を動かす） —');
{
  const fnSrc = cut('apiFriendlyError_');
  const ctx = { apiToken: 'x', apiCaps: { seen: true }, wrIsField: () => false };
  vm.createContext(ctx);
  let msg = '';
  try { vm.runInContext(fnSrc, ctx); msg = ctx.apiFriendlyError_('Error: unauthorized'); } catch (e) { msg = 'ERR ' + e.message; }
  t('5-1 スクリプトプロパティ・API・WEIGHT_TOKEN の語が無い', !/スクリプトプロパティ|API|WEIGHT_TOKEN/.test(msg), msg);
  t('5-2 どこの合言葉を確かめるかを書く', /一致しません/.test(msg) && /「設定」→「🌐 複数端末で共有」/.test(msg) && /Google の受け口/.test(msg) && /空白/.test(msg), msg);
}

console.log('— 6. 同期の失敗の知らせ（実物の関数を動かす） —');
let sec6 = Promise.resolve();
{
  console.log('— 7. 接続設定へのリンクは現場端末では出さない —');
  t('7-1 現場端末の印（wr-field）でリンクを隠す指定がある', /\.wr-field #apiCsLink[^{]*\{display:none !important\}/.test(src));
  const g = cut('applyWeightDeviceGuard') || '';
  const run = (field) => {
    const el = { hidden: false }, nb = { hidden: true };
    const ctx = { wrIsField: () => field, apiUrl: '', wrSyncOn_: () => !!ctx.apiUrl, goto: () => {},
      document: { documentElement: { classList: { toggle: () => {} } }, querySelector: () => null,
        getElementById: (id) => id === 'apiCsLink' ? el : (id === 'wrNoApi' ? nb : null) } };
    vm.createContext(ctx);
    try { vm.runInContext(g, ctx); ctx.applyWeightDeviceGuard(); } catch (e) { return 'ERR ' + e.message; }
    return el.hidden;
  };
  t('7-2 現場端末ではリンクを隠す', run(true) === true, run(true));
  t('7-3 事務所PCではリンクを出す', run(false) === false, run(false));
}
{
  const syncSrc = cut('_syncFromAPIImpl');
  const fe = cut('apiFriendlyError_');
  async function runSync(getImpl, field) {
    const toasts = [], notes = [], status = [];
    const ctx = {
      apiUrl: 'https://script.google.com/macros/s/TEST/exec', apiToken: field ? '' : 'x', apiCaps: { seen: true }, wrSyncOn_: () => !!ctx.apiUrl,
      wrIsField: () => !!field,
      wrSyncLock_: () => {}, ldShow: () => {}, ldHide: () => {},
      apiSetStatus: (st, m) => status.push(m), apiGet: getImpl,
      toast: (m) => toasts.push(m), wrNote_: (w, e) => notes.push(w),
      wrLoadSrvResIds: () => false, window: {}, console
    };
    vm.createContext(ctx);
    ctx.DB = { residents: [{ id: 'r1', name: '架空 一' }], records: [{ id: 'k1', residentId: 'r1', weight: 50 }] };
    const before = JSON.stringify(ctx.DB);
    vm.runInContext(fe + '\n' + (cut('wrStaffText_') || '') + '\n' + syncSrc, ctx);
    const r = await ctx._syncFromAPIImpl(false);
    return { r, toasts, notes, status, dbKept: JSON.stringify(ctx.DB) === before };
  }
  sec6 = (async () => {
    let o = await runSync(async () => { throw new Error('HTTP 500: boom'); });
    t('6-1 通信の失敗で英語・HTTP の文を職員の知らせに出さない', o.toasts.length === 1 && !/HTTP|boom|同期失敗:/.test(o.toasts[0]), o.toasts);
    t('6-2 通信の失敗は「同期できませんでした。この端末の記録は残っています」', o.toasts.length === 1 && /同期できませんでした。この端末の記録は残っています/.test(o.toasts[0]), o.toasts);
    t('6-3 通信の失敗は不具合報告の記録に流さない（圏外の端末で報告の種を増やさない）', o.notes.indexOf('同期') < 0, o.notes);
    t('6-4 設定の接続状態欄（管理者が読む）には元の文を残す', o.status.some(m => /HTTP 500/.test(String(m))), o.status);
    o = await runSync(async () => ({ error: 'Error: unauthorized' }), true);
    t('6-5 現場の端末で合言葉が通らない時は「事務所に連絡」の案内を知らせに出す（消さない）', o.toasts.length === 1 && /事務所に連絡/.test(o.toasts[0]), o.toasts);
    o = await runSync(async () => ({ error: 'conflict xyz' }));
    t('6-6 言い換えの無いサーバーの文は知らせに出さない', o.toasts.length === 1 && !/conflict/.test(o.toasts[0]), o.toasts);
    t('6-7 同期に失敗しても端末の記録（入居者・体重）はそのまま', o.dbKept);
    /* 共通のデータベースの部品（su-weight-live.js）が返す職員向けの断りは、そのまま出す（実物の文を読む） */
    const live = fs.readFileSync(path.join(path.dirname(HTML), 'su-weight-live.js'), 'utf8');
    const msgOf = (k) => { const m = live.match(new RegExp('\\b' + k + ":\\s*'([^']+)'")); return m ? m[1] : ''; };
    for (const k of ['login', 'denied', 'mirror', 'server', 'timeout']) {
      const m = msgOf(k);
      o = await runSync(async () => ({ error: m }));
      t('6-8 部品の断り（' + k + '）をそのまま知らせに出す', !!m && o.toasts.length === 1 && o.toasts[0].indexOf(m) >= 0, o.toasts);
    }
    o = await runSync(async () => ({ error: '保存できません TypeError: x is null' }));
    t('6-9 日本語でも英語の例外文が混じる時は固定の文にする', o.toasts.length === 1 && !/TypeError/.test(o.toasts[0]) && /同期できませんでした。この端末の記録は残っています/.test(o.toasts[0]), o.toasts);
    o = await runSync(async () => { throw new Error('レスポンスが空です'); });
    t('6-10 部品の断りでない例外（通信・応答の形）は日本語でも固定の文にする', o.toasts.length === 1 && !/レスポンス/.test(o.toasts[0]), o.toasts);
  })().catch(e => { t('6-x 同期の関数を動かせる', false, e && e.message); });
}

console.log('— 8. 接続の診断の結果は職員向けの1文＋「管理者向けの詳しい内容」に畳む（2026-11-13 第6段 WR-01・実物の showDiagPanel を動かす） —');
{
  const fn = cut('showDiagPanel');
  t('8-1 showDiagPanel を切り出せた', !!fn);
  t('8-2 診断の枠は pre ではなく div（中に details を入れるため）', has('<div id="apiDiagOut" class="api-diag" style="display:none"></div>') && !has('<pre id="apiDiagOut"'));
  t('8-3 診断の結果を出す3か所はすべて畳む形で出す', (src.match(/showDiagPanel\(diag\.lines, diag\.ok, true\);/g) || []).length === 3 && !/showDiagPanel\(diag\.lines, diag\.ok\);/.test(src));
  function mk(tag) {
    const el = { tag, children: [], className: '', style: {}, _txt: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(...c) { c.forEach(x => this._s.delete(x)); }, has(c) { return this._s.has(c); } },
      appendChild(c) { this.children.push(c); return c; } };
    Object.defineProperty(el, 'textContent', { get() { return this._txt + this.children.map(c => c.textContent).join(''); }, set(v) { this._txt = String(v); this.children = []; } });
    return el;
  }
  function run(lines, ok, asDiag) {
    const panel = mk('div'); panel.style.display = 'none';
    const sb = { $: (q) => (q === '#apiDiagOut' ? panel : null), document: { createElement: mk } };
    vm.createContext(sb);
    vm.runInContext(fn + '\nthis.showDiagPanel = showDiagPanel;', sb);
    sb.showDiagPanel(lines, ok, asDiag);
    return panel;
  }
  const DIAG = ['❌ Google の受け口のエラー: 架空のエラー', '  → 体重管理用の Google の受け口の URL か確かめてください'];
  let P = run(DIAG, false, true);
  const lead = P.children[0], more = P.children[1];
  t('8-4 失敗: 先頭は職員向けの1文', P.style.display === '' && lead && lead.tag === 'p' && lead.textContent === 'うまくつながりませんでした。管理者に伝えてください。', lead && lead.textContent);
  t('8-5 失敗: 診断の行は「管理者向けの詳しい内容」の中に、文を変えずに畳む', more && more.tag === 'details' && more.children[0].tag === 'summary' && more.children[0].textContent === '管理者向けの詳しい内容'
    && more.children[1].tag === 'pre' && more.children[1].textContent === DIAG.join('\n') && P.classList.has('is-err'), more && more.textContent);
  P = run(['✓ 応答取得 OK（residents:0件 / records:0件）'], true, true);
  t('8-6 成功: 先頭は「✅ つながりました。」・行は畳む', (P.children[0] || {}).textContent === '✅ つながりました。' && (P.children[1] || {}).tag === 'details' && P.classList.has('is-ok'), P.textContent);
  P = run(['🔍 診断中…'], true);
  t('8-7 診断の結果でない知らせ（診断中・未保存の合言葉）は今までどおり行をそのまま出す', P.children.length === 1 && (P.children[0] || {}).tag === 'pre' && (P.children[0] || {}).textContent === '🔍 診断中…', P.textContent);
}

console.log('— 9. 設定の接続状態欄も、失敗の時は職員向けの1文＋「管理者向けの詳しい内容」に畳む（2026-11-13 第6段 反証レビュー・実物の apiSetStatus を動かす） —');
{
  const fn = cut('apiSetStatus');
  t('9-1 apiSetStatus を切り出せた', !!fn);
  function mk(tag) {
    const el = { tag, children: [], className: '', innerHTML: '', _txt: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(...c) { c.forEach(x => this._s.delete(x)); } },
      appendChild(c) { this.children.push(c); return c; } };
    Object.defineProperty(el, 'textContent', { get() { return this._txt + this.children.map(c => c.textContent).join(''); }, set(v) { this._txt = String(v); this.children = []; } });
    return el;
  }
  const bd = mk('span'), si = mk('div');
  const sb = { document: { getElementById: (id) => (id === 'apiBd' ? bd : id === 'apiStatus' ? si : null), createElement: mk }, String };
  vm.createContext(sb);
  vm.runInContext(cut('wrStaffText_') + '\n' + fn, sb);
  const RAW = '接続エラー: サーバーが応答しませんでした（HTTP 500・架空）';
  sb.apiSetStatus('er', RAW);
  const lead = si.children[0] || {}, more = si.children[1] || {};
  t('9-2 失敗: 先頭は職員向けの1文', lead.tag === 'p' && lead.textContent === 'うまくつながりませんでした。管理者に伝えてください。', si.textContent);
  t('9-3 失敗: 元の文は「管理者向けの詳しい内容」の中に文を変えずに畳む', more.tag === 'details' && (more.children[0] || {}).textContent === '管理者向けの詳しい内容' && (more.children[1] || {}).textContent === RAW, more.textContent);
  /* 職員がその場で直せる理由は畳まずにそのまま先頭に出す（2026-11-13 2回目の反証レビュー） */
  for (const [nm, m] of [
    ['合言葉が要る', '接続エラー: このサーバーは合言葉が必要ですが、この端末には保存されていません。体重管理アプリの「設定」→「🌐 複数端末で共有」の合言葉欄に入れて「💾 URLを保存・接続」を押してください'],
    ['ログインしていない', 'ログインしていないため、体重をサーバーへ送れません（記録はこの端末に残っています）。ログインの画面でログインしてから、体重管理を開き直してください'],
    ['現場端末は事務所に連絡', '合言葉が通らず、サーバーと同期できません。この端末（現場用）では直せないので、事務所に連絡してください（事務所PCとして開き直し、合言葉を入れ直します）。記録はこの端末に残っています']
  ]) {
    sb.apiSetStatus('er', m, true);
    t('9-6 職員が直せる理由（' + nm + '）はそのまま出し、「管理者に伝えて」に替えない', si.textContent === m && si.children.length === 0, si.textContent);
  }
  t('9-7 呼ぶ3か所は職員向けの文の時に印を付ける（同期＝e.wrStaff か職員向けの文・書き込みの断り＝合言葉の案内に言い換えた時か職員向けの文・書き込みの例外＝e.wrStaff か職員向けの文）',
    has("apiSetStatus('er', '接続エラー: '+ e.message, !!(e && e.wrStaff) || wrStaffText_(e && e.message));")
    && has("apiSetStatus('er', why || '書き込みエラー', !!why && (why !== String(r && r.error) || wrStaffText_(why)));")
    && has("apiSetStatus('er', e.message, !!(e && e.wrStaff) || wrStaffText_(e && e.message));"));
  t('9-8 部品の断り（ログインしていない）の実物の文は職員向けと判定される', sb.wrStaffText_('ログインしていないため、体重をサーバーへ送れません（記録はこの端末に残っています）。ログインの画面でログインしてから、体重管理を開き直してください') === true);
  t('9-10 通信の時間切れの文は職員向け（技術の語・秒数を出さない）', has("reject(new Error('通信が時間内に終わりませんでした。通信を確かめてください'))") && !has("new Error('タイムアウト(")
    && sb.wrStaffText_('通信が時間内に終わりませんでした。通信を確かめてください') === true);
  t('9-11 診断は新しい時間切れの文でも切り分けの手順を出す', has("if(/タイムアウト|時間内に終わりませんでした/.test(errMsg)){"));
  sb.apiSetStatus('er', 'Failed to fetch', false);
  t('9-9 英字の例外文は印が無ければ畳む', (si.children[0] || {}).textContent === 'うまくつながりませんでした。管理者に伝えてください。', si.textContent);
  sb.apiSetStatus('ok', '最終同期: 10:00:00');
  t('9-4 成功の文は今までどおりそのまま出す（畳んだ欄は残らない）', si.textContent === '最終同期: 10:00:00' && si.children.length === 0, si.textContent);
  sb.apiSetStatus('sy');
  t('9-5 文の無い呼び出しは欄を変えない', si.textContent === '最終同期: 10:00:00');
}

console.log('— 10. うまく繋がらない時のチェック項目（受け口の側の確かめは「管理者向けの詳しい内容」に畳む・2026-11-13 第6段 WR-01） —');
{
  const mH = src.match(/<details class="api-help">([\s\S]*?)<\/details>\s*<\/details>/);
  const help = mH ? mH[1] : '';
  const iAdm = help.indexOf('<details class="api-diag-more" id="apiHelpAdmin">');
  const outer = (iAdm >= 0 ? help.slice(0, iAdm) : help).replace(/<!--[\s\S]*?-->/g, '');   /* 注記（コメント）は画面に出ないので除く */
  const inner = iAdm >= 0 ? help.slice(iAdm) : '';
  t('10-1 チェック項目の中に「管理者向けの詳しい内容」の畳んだ欄がある（初めは閉じている）', iAdm > 0 && /<details class="api-diag-more" id="apiHelpAdmin">\s*<summary>管理者向けの詳しい内容<\/summary>/.test(inner) && !/id="apiHelpAdmin"[^>]*\bopen\b/.test(help), iAdm);
  t('10-2 畳む前の項目に Apps Script・デプロイの管理・/dev・初回承認が無い', !!mH && !/Apps Script|デプロイ|\/dev|初回承認/.test(outer), outer);
  t('10-3 職員が自分で確かめられる2項目（受け口の URL か・接続診断）は畳まずに出す', outer.indexOf('<li><b>体重管理用の Google の受け口の URL か</b>') >= 0 && outer.indexOf('<li>うまくいかない時は「🩺 接続診断」を押して具体的な原因を表示</li>') >= 0, outer);
  t('10-4 畳んだ欄に元の3項目が文を変えずに入る', inner.indexOf('Apps Script → デプロイの管理 → 編集（鉛筆）→ 「アクセスできるユーザー = 全員」 → 更新</li>') >= 0
    && inner.indexOf('<code>/dev</code>（テスト用）はオーナー本人しか叩けません</li>') >= 0
    && inner.indexOf('「詳細」→「（プロジェクト名）に移動」→「許可」までやり切ったか確認</li>') >= 0, inner);
  t('10-6 「URL は /exec で終わっているか」は職員がその場で直せるので外に出す（/dev の説明だけ畳む・PR #566 の反証）', outer.indexOf('<li><b>URL は <code>/exec</code> で終わっているか</b></li>') >= 0 && inner.indexOf('/exec') < 0, outer);
  t('10-5 外の欄は閉じたまま（画面の見た目を変えない）', /<details class="api-help">\s*<summary>うまく繋がらない時のチェック項目<\/summary>/.test(src));
}

sec6.then(() => {
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
});
