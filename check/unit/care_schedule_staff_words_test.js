/* 週間計画：職員に見える文から技術用語を外し、同期先が無い時に次にすることと接続設定へのリンクを出す試験（2026-11-02 新設）
   実行: node check/unit/care_schedule_staff_words_test.js
        （CS_HTML で対象ファイルを差し替えられる＝直す前の版・条件を抜いた版を試す時に使う）

   何を守るか:
     1. ボタン・断りの文・同期の記録に「JSON」「GAS」「トークン」「/exec」「HTTP」、英語の例外文（e.message）をそのまま出さない
     2. 同期先が入っていない時は、何が足りないか（同期先）と次にすること（接続設定の「週間計画・ワースケ・シフト」）を出し、
        事務所PCには接続設定へのリンクを付け、現場の端末には付けない
     3. 断りの文を直しても「待っても直らない失敗」の見分け（isConfirmedEndpointFailMsg）は今までどおり効く
     4. 利用者一覧の使用単位%の色に、画面だけの凡例がある（色の分け方は表と同じ・印刷では消す）
   ★公開リポジトリの試験。氏名などは使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 300) : '')); }
}

/* ── 切り出し（care_schedule_colors_test.js と同じ方式）── */
function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabAt(marker) {
  const start = SRC.indexOf(marker);
  if (start < 0) return '';
  const end = scanBlock(SRC, start, '{', '}');
  return end < 0 ? '' : SRC.slice(start, end + 1);
}
const grabFn = name => grabAt('\nfunction ' + name + '(');
const grabMethod = name => { const s = grabAt('\n  ' + name + '('); return s || grabAt('\n  async ' + name + '('); };
/* 文字列だけを取り出す（コメントは除く）＝画面に出る文の候補 */
function strings(code) {
  const out = []; let q = null, buf = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i], n = code[i + 1], p = code[i - 1];
    if (q) { if (c === q && p !== '\\') { out.push(buf); q = null; buf = ''; } else buf += c; continue; }
    if (c === '/' && n === '/') { const e = code.indexOf('\n', i); i = e < 0 ? code.length : e; continue; }
    if (c === '/' && n === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; buf = ''; }
  }
  return out;
}
const TECH = /GAS|JSON|トークン|\/exec|HTTP|Web App|ws_settings|Supabase|\baction\b/;

console.log('— 1. ボタンと読み込みの断り（控えのファイル）—');
{
  const hdr = (SRC.match(/<button[^>]*data-on-click="exportJSON"[^>]*>/) || [''])[0];
  t('見出しの ⬇ ボタンの名前に JSON が無い', hdr && !/JSON/.test(hdr.replace('data-on-click="exportJSON"', '')), hdr);
  t('見出しの ⬇ ボタンは「予定を控えのファイルに書き出す」', /aria-label="予定を控えのファイルに書き出す"/.test(hdr) && /title="予定を控えのファイルに書き出す"/.test(hdr), hdr);
  const rmEx = (SRC.match(/data-on-click="rmExportJSON">([^<]*)</) || [])[1] || '';
  const rmIm = (SRC.match(/data-on-click="csPickRmImport_">([^<]*)</) || [])[1] || '';
  t('報酬マスタの書き出しボタンは「報酬マスタを控えのファイルに書き出す」', rmEx === '報酬マスタを控えのファイルに書き出す', rmEx);
  t('報酬マスタの読み込みボタンは「控えのファイルから報酬マスタを読み込む」', rmIm === '控えのファイルから報酬マスタを読み込む', rmIm);
  const imp = grabFn('rmImportJSON');
  const impStr = strings(imp).filter(s => /[ぁ-んァ-ヶ一-龠]/.test(s));
  t('報酬マスタの読み込みの断り・見出しに JSON が無い', impStr.length >= 4 && impStr.every(s => !/JSON/.test(s)), impStr.filter(s => /JSON/.test(s)));
  t('壊れたファイルの断りは職員向けの文', /ファイルが壊れているか、報酬マスタの控えのファイルではありません/.test(imp), '');
  t('形の違うファイルの断りは、新しいボタンの名前を指す', /「報酬マスタを控えのファイルに書き出す」で作ったファイルを選んでください/.test(imp), '');
  t('読み込みの確かめの見出しは「読み込んだ控えのファイル」', /rmOpenPreview_\(norm\.master, '読み込んだ控えのファイル'/.test(imp), '');
  const ex = grabFn('exportJSON');
  t('予定の書き出しの知らせは「控えのファイルに書き出しました」', /showToast\('控えのファイルに書き出しました'\)/.test(ex) && !/エクスポート/.test(ex), '');
}

console.log('— 2. 端末への保存の失敗 —');
{
  const sdb = grabFn('saveDB');
  t('保存の失敗の知らせに e.message を出さない', sdb && !/showToast\([^;]*e\.message/.test(sdb), '');
  t('保存の失敗は職員向けの文で知らせる', /showToast\('この端末に保存できませんでした。もう一度「💾 保存」を押してください。続く時は管理者に知らせてください'\)/.test(sdb), '');
  t('元の文は記録（csNote_）に残す', /csNote_\('端末への保存', e\)/.test(sdb), '');
}

console.log('— 3. 同期の設定画面の欄の名前 —');
{
  const lab = (SRC.match(/<label for="sync-token">([^<]*)<\/label>/) || [])[1] || '';
  t('合言葉の欄は「同期の合言葉」', lab === '同期の合言葉', lab);
  const ph = (SRC.match(/id="sync-token"[\s\S]{0,80}?placeholder="([^"]*)"/) || [])[1] || '';
  t('合言葉の欄の見本にトークンと書かない', ph === 'ワークスケジュールと同じ合言葉', ph);
  t('URL の欄は「同期先の URL（Google の受け口）」', /<span>同期先の URL（Google の受け口）<\/span>/.test(SRC) && !/<span>Apps Script Web App URL<\/span>/.test(SRC), '');
  // 2026-11-03: セットアップ手順と古い受け口のコード（守りの無い写し）は画面から外した（片付け計画 K1）。手順の文が戻ってこないこと・古い欄名も出ないことを確かめる
  t('セットアップ手順と古い受け口のコードを画面に出さない（受け口は開発の担当が配る）', !/セットアップ手順（初心者向け）/.test(SRC) && !/id="gas-code"/.test(SRC) && !/copyGasCode/.test(SRC)
    && /受け口のコードは開発の担当が配ります（画面からは配りません）/.test(SRC) && !/上の「Apps Script Web App URL」欄/.test(SRC), '');
}

console.log('— 4. 断りの翻訳（friendlyErr）—');
{
  const fe = grabMethod('friendlyErr');
  const ic = grabMethod('isConfirmedEndpointFailMsg');
  let S = null;
  try {
    const box = {};
    vm.createContext(box);
    vm.runInContext('var S = {' + fe + ',' + ic + '};', box);
    S = box.S;
  } catch (e) { S = null; }
  t('friendlyErr を動かせる', !!(S && typeof S.friendlyErr === 'function'), '');
  if (S) {
    const codes = ['unauthorized', 'deadendpoint', 'unknown action', '不明なaction', 'HTTP 404', 'HTTP 500', 'HTTP 503',
      'bathwipe', 'visitwipe', 'login', 'forbidden', 'Failed to fetch', 'Load failed', 'TypeError: x is undefined', 'no such generation', '', undefined];
    const bad = codes.map(c => [c, S.friendlyErr(c)]).filter(([, m]) => TECH.test(String(m)) || !/[ぁ-んァ-ヶ一-龠]/.test(String(m)));
    t('どの符号にも技術用語の無い日本語の文を返す', bad.length === 0, bad);
    t('合言葉違いは「合言葉が一致しません」', /^合言葉が一致しません/.test(S.friendlyErr('unauthorized')), S.friendlyErr('unauthorized'));
    t('消えた版（no such generation）は「その版はもうクラウドにありません」', /^その版はもうクラウドにありません/.test(S.friendlyErr('no such generation')), S.friendlyErr('no such generation'));
    t('ログインしていない時は、ログインを促す', /ログインしていないため同期できません/.test(S.friendlyErr('login')), S.friendlyErr('login'));
    t('書けないアカウントの時は、事務所のアカウントを促す', /事務所のアカウントでログインしてください/.test(S.friendlyErr('forbidden')), S.friendlyErr('forbidden'));
    t('HTTP 500 は「しばらくしてからもう一度」', /しばらくしてからもう一度お試しください/.test(S.friendlyErr('HTTP 500')), S.friendlyErr('HTTP 500'));
    t('日本語の断り（通信失敗など）はそのまま出す', S.friendlyErr('通信失敗') === '通信失敗' && S.friendlyErr('試算モード中は送信しません') === '試算モード中は送信しません', '');
    t('二度通しても変わらない（catch で翻訳済みの文をもう一度通す所がある）',
      ['deadendpoint', 'unknown action', '不明なaction', 'HTTP 500', 'login', 'Failed to fetch'].every(c => S.friendlyErr(S.friendlyErr(c)) === S.friendlyErr(c)), '');
    t('「待っても直らない失敗」の見分けは今までどおり効く',
      S.isConfirmedEndpointFailMsg(S.friendlyErr('deadendpoint')) && S.isConfirmedEndpointFailMsg(S.friendlyErr('不明なaction'))
      && S.isConfirmedEndpointFailMsg(S.friendlyErr('unknown action')) && !S.isConfirmedEndpointFailMsg(S.friendlyErr('HTTP 500'))
      && !S.isConfirmedEndpointFailMsg('通信失敗'), '');
  }
}

console.log('— 5. 同期の記録の文 —');
{
  const syncLogs = SRC.split('\n').filter(l => /\b(this|SYNC)\.log\(/.test(l));
  const raw = syncLogs.filter(l => /\.log\([^;]*\+ e\.message/.test(l));
  t('同期の記録に e.message をそのまま足さない', raw.length === 0, raw.map(s => s.trim().slice(0, 80)));
  for (const [name, re] of [['取得失敗', /取得失敗: ' \+ this\.friendlyErr\(e && e\.message\)/], ['保存失敗', /保存失敗: ' \+ this\.friendlyErr\(e && e\.message\)/],
                            ['起動時同期の確認に失敗', /起動時同期の確認に失敗: ' \+ this\.friendlyErr\(e && e\.message\)/], ['接続失敗', /接続失敗: ' \+ this\.friendlyErr\(e && e\.message\)/]]) {
    t('「' + name + '」は翻訳した文を出す', re.test(SRC), '');
  }
  t('取り消し後の確認の失敗は職員向けの文（元の文は記録へ）', /csNote_\('取り消し後の確認', e\); SYNC\.log\('❌ 取り消し後の確認に失敗しました。画面の内容を確かめてください'\)/.test(SRC), '');
  const old = ['接続先GASが旧形式', '統合GASが正常に応答', '稼働中のURL(ws_settings)', 'URLと同期トークンを貼り直して', '防御：…planhistory', '同期先が未設定です（ワースケ設定'];
  t('古い技術の文が残っていない', old.every(s => SRC.indexOf(s) < 0), old.filter(s => SRC.indexOf(s) >= 0));
  t('接続OKの文に GAS と書かない', /接続OK：同期先（Google の受け口）が正常に応答しました'\)/.test(SRC), '');
  t('自動で切り替えた時の文に設定の名前（ws_settings）を出さない', /ワークスケジュールで使っている同期先へ自動で切り替えました/.test(SRC), '');
  t('受け口が古い時の文は、管理者に頼むことと接続設定を案内する', /同期先の Google の受け口が古い形のため同期できません。管理者に受け口の更新を頼むか、接続設定の「週間計画・ワースケ・シフト」を確かめてください/.test(SRC), '');
  const tm = grabFn('csSyncTargetMessage');
  const tmStr = strings(tm).filter(s => /[ぁ-んァ-ヶ一-龠]/.test(s));
  t('同期先の確かめの文（csSyncTargetMessage）に GAS・トークンが無い', tmStr.length >= 4 && tmStr.every(s => !TECH.test(s)), tmStr.filter(s => TECH.test(s)));
  const hist = grabAt('\nasync function loadCloudHistory_(');
  const rst = grabAt('\nasync function restoreFromCloud_(');
  t('クラウドの版から戻す時の断りも翻訳して出す（符号をそのまま出さない）',
    /showToast\('その版を読めませんでした' \+ \(j && j\.error \? '（' \+ SYNC\.friendlyErr\(String\(j\.error\)\) \+ '）' : ''\)\)/.test(rst) && !/'（' \+ j\.error \+ '）'/.test(rst), '');
  t('クラウドの履歴の断りは翻訳して出す（符号をそのまま出さない）', /escHtml\(SYNC\.friendlyErr\(String\(j\.error\)\)\)/.test(hist) && !/planhistory/.test(hist), '');
}

console.log('— 6. 同期先が入っていない時の案内 —');
{
  const msg = (SRC.match(/var CS_NO_TARGET_MSG = '([^']*)'/) || [])[1] || '';
  t('案内の文は「何が足りないか」と「接続設定のどこに何を入れるか」を言う',
    /^同期先が入っていません。/.test(msg) && /接続設定の「週間計画・ワースケ・シフト」に接続先のURLと合言葉を入れてください/.test(msg) && !TECH.test(msg), msg);
  const useMsg = (SRC.match(/this\.log\('❌ ' \+ CS_NO_TARGET_MSG\)/g) || []).length;
  t('取得・起動時・保存・接続テストの4か所が同じ案内を出す', useMsg === 4, useMsg);
  t('クラウドの履歴から戻す時の知らせも同じ案内', /if \(!SYNC\.hasTarget\(\)\) \{ showToast\(CS_NO_TARGET_MSG\); return; \}/.test(SRC), '');
  t('クラウドの履歴の欄にも接続設定を案内する', /同期先が入っていないため、クラウドの履歴は読めません。接続設定の「週間計画・ワースケ・シフト」に接続先のURLと合言葉を入れてください/.test(SRC), '');
  t('同期の設定画面に案内の置き場（#sync-noconn）がある・最初は隠れている', /<div class="hint-box warn" id="sync-noconn" style="display:none;/.test(SRC), '');
  t('同期の設定画面の表示を直すたびに案内を作り直す', /function refreshSyncIndicator\(text, color\) \{\s*csRenderNoConnHint_\(\);/.test(SRC), '');

  const fn = grabFn('csRenderNoConnHint_');
  function run(hasTarget, role) {
    function node(tag) {
      return { tag, kids: [], href: '', style: {}, _t: '',
        set textContent(v) { this._t = String(v); this.kids = []; }, get textContent() { return this._t + this.kids.map(k => k.textContent).join(''); },
        appendChild(k) { this.kids.push(k); return k; } };
    }
    const box = node('div'); box.style.display = 'none';
    const ctx = {
      $: sel => (sel === '#sync-noconn' ? box : null),
      SYNC: { hasTarget: () => hasTarget },
      suGetDeviceRole: () => role,
      document: { createElement: node, createTextNode: s => ({ textContent: String(s) }) }
    };
    vm.createContext(ctx);
    vm.runInContext(fn + '\ncsRenderNoConnHint_();', ctx);
    return box;
  }
  if (!fn) t('案内を作る関数（csRenderNoConnHint_）がある', false, '');
  else {
    const off = run(false, 'office');
    const link = off.kids.find(k => k.tag === 'a');
    t('事務所PC・同期先なし: 案内を出す', off.style.display === '', off.style.display);
    t('事務所PC・同期先なし: 何が足りないか（同期先）と、届かないことを言う', /まだ同期先が入っていないため、予定はこの端末の中にだけ保存されています/.test(off.textContent), off.textContent);
    t('事務所PC・同期先なし: 接続設定へのリンクがある', !!link && link.href === 'connection-settings.html' && link.textContent === '接続設定', link);
    t('事務所PC・同期先なし: どの欄に何を入れるかを言う', /接続設定の「週間計画・ワースケ・シフト」に接続先のURLと合言葉を入れてください/.test(off.textContent), off.textContent);
    t('事務所PC・同期先なし: 技術用語が無い', !TECH.test(off.textContent), off.textContent);
    const fld = run(false, 'field');
    t('現場の端末・同期先なし: リンクを付けない', !fld.kids.some(k => k.tag === 'a'), '');
    t('現場の端末・同期先なし: 「事務所に知らせてください」', /事務所に知らせてください/.test(fld.textContent) && fld.style.display === '', fld.textContent);
    const ok = run(true, 'office');
    t('同期先あり: 案内を隠し、中身も空にする', ok.style.display === 'none' && ok.textContent === '', ok.textContent);
  }
}

console.log('— 7. 利用者一覧の使用単位%の色の凡例（画面だけ）—');
{
  const lg = (SRC.match(/<p id="rl-pct-legend"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
  t('凡例がある', !!lg, '');
  const col = cls => ((SRC.match(new RegExp('#rl-table \\.rl-pct\\.' + cls + '\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{6})')) || [])[1] || '').toLowerCase();
  const over = col('over'), warn = col('warn'), okc = col('ok');
  t('凡例の色は表の色と同じ（赤・橙・緑）', !!over && !!warn && !!okc
    && new RegExp('color:' + over + '[^>]*>■</span>赤＝100%以上（限度額に達しています）', 'i').test(lg)
    && new RegExp('color:' + warn + '[^>]*>■</span>橙＝80%以上100%未満', 'i').test(lg)
    && new RegExp('color:' + okc + '[^>]*>■</span>緑＝80%未満', 'i').test(lg), [over, warn, okc]);
  t('色の分け方（100%・80%）は表の作り方と同じ', /const cls = s\.pct >= 100 \? 'over' : s\.pct >= 80 \? 'warn' : 'ok';/.test(SRC), '');
  t('印刷では凡例を消す（紙面は変えない）', /@media print \{\s*#rl-pct-legend \{ display: none !important; \}\s*\}/.test(SRC), '');
  t('凡例は一覧の説明（#rl-desc）の中に入れない＝A3印刷の説明文は今のまま', !/rl-pct-legend/.test(grabFn('renderResidentListTable')), '');
}

console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
if (fail) { console.log('✗ 合格 ' + pass + ' / 不合格 ' + fail); process.exit(1); }
console.log('✓ 合格 ' + pass + ' / 不合格 0');
