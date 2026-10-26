/* 業務画面の CSP（2026-10-15 新設・代表者の依頼）
   実行: node check/unit/csp_test.js

   守ること:
     1 対象の業務画面はすべて CSP の meta を <meta charset> の直後（どのスクリプトよりも前）に持ち、
       画面の中のスクリプトの指紋（sha256）が今の中身と合っている（直したら node check/csp.mjs --write を回す）
     2 スクリプトは自サイトと指紋だけ（'unsafe-inline'・'unsafe-eval'・外のサイトを許さない）。通信は自サイト・Google の受け口・Supabase だけ
     3 画面にインラインのイベント属性（onclick= など）と javascript: の URL を書かない（CSP で止まる）
     4 指紋の計算はコメントの中の「<script>」を数えず、src 付き・JSON の札は数えない。英字以外の小文字化で位置がずれない
     5 配信で作る3画面（ワークスケジュール・シフト作成・シフト分析）は、CSP があれば中身と合っていること（次の配信で入る）
   ★実際のブラウザで止まるかは、PR の画素の見比べ（画面の例外）と手元のヘッドレス Chrome で確かめた（2026-10-15） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

(async () => {
  const C = await import(path.join(ROOT, 'check', 'csp.mjs'));

  console.log('\n— 1・2. 対象の画面の CSP —');
  for (const p of C.PAGES) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    const why = C.checkPage(html);
    t(p + ': CSP があり、指紋が中身と合う（置き場所も正しい）', why === '', why);
    const m = /data-su-csp content="([^"]*)"/.exec(html);
    const pol = m ? m[1] : '';
    const dir = n => (pol.split(';').map(x => x.trim()).find(x => x.startsWith(n + ' ')) || '');
    t(p + ': スクリプトは自サイトと指紋だけ', /^script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')*$/.test(dir('script-src')), dir('script-src'));
    t(p + ': 通信は自サイト・Google の受け口・Supabase だけ',
      dir('connect-src') === "connect-src 'self' https://script.google.com https://script.googleusercontent.com https://jhbernqawjrzqwrmqrih.supabase.co wss://jhbernqawjrzqwrmqrih.supabase.co", dir('connect-src'));
    t(p + ': 既定は自サイト・object は無し・base は無し', dir('default-src') === "default-src 'self'" && dir('object-src') === "object-src 'none'" && dir('base-uri') === "base-uri 'none'");
  }
  t('対象は業務画面19（すでに自分の CSP を持つ画面と配信で作る画面は別。採用管理 2026-10-26）', C.PAGES.length === 19, C.PAGES.length);

  console.log('\n— 3. インラインのイベント属性・javascript: の URL を書かない —');
  for (const p of C.PAGES.concat(['shift-app.html'])) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    if (p === 'shift-app.html' && !/data-su-csp/.test(html)) continue;   // シフト作成は次の配信で CSP が入ってから見る
    const at = [...html.matchAll(/[\s"'`]on(click|change|input|submit|keydown|keyup|load|error|focus|blur|mouseover|mouseout|dblclick|contextmenu)=\\?["']/g)].map(x => x[0].trim());
    t(p + ': onclick= などを書いていない', at.length === 0, at.slice(0, 5));
    t(p + ': javascript: の URL が無い', !/href=\\?["']javascript:/i.test(html));
    t(p + ': 属性で on○○ を後から足していない', !/setAttribute\(\s*['"]on[a-z]+['"]/.test(html));
  }

  console.log('\n— 4. 指紋の計算 —');
  const sample = '<!doctype html><meta charset="utf-8">\n<!-- 例: <script>alert(1)</script> -->\n<SCRIPT>a()</SCRIPT><script src="x.js"></script><script type="application/json">{"a":1}</script><script type="module">b()</script>';
  t('コメントの中・src 付き・JSON は数えず、大文字の札とモジュールは数える', JSON.stringify(C.inlineScripts(sample)) === JSON.stringify(['a()', 'b()']), C.inlineScripts(sample));
  t('英字以外の小文字化で位置がずれない（İ を含む）', JSON.stringify(C.inlineScripts('<meta charset="utf-8"><p>İİİ</p><script>c()</script>')) === JSON.stringify(['c()']));
  const crypto = require('crypto');
  t('指紋はブラウザと同じ形（sha256 の base64）', C.hashOf('a()') === "'sha256-" + crypto.createHash('sha256').update('a()').digest('base64') + "'");
  const w = C.withMeta(sample);
  t('meta は <meta charset> の直後に入り、2回書いても1つだけ', C.checkPage(w) === '' && C.withMeta(w) === w && (w.match(/data-su-csp/g) || []).length === 1, C.checkPage(w));
  t('中身を1文字変えると「合っていない」になる', /合っていません/.test(C.checkPage(w.replace('a()', 'a( )'))));

  console.log('\n— 5. 配信で作る3画面 —');
  for (const p of C.DEPLOY_BUILT) {
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f)) { t(p + ': 無い', false); continue; }
    const html = fs.readFileSync(f, 'utf8');
    if (!/data-su-csp/.test(html)) { console.log('  ・' + p + ': CSP はまだ（正本の組み立てに入れた。次の配信で入る）'); continue; }
    const why = C.checkPage(html);
    t(p + ': CSP の指紋が中身と合う', why === '', why);
  }

  console.log('\n— 6. 読み込みの順番で表示が変わらない（2026-10-15 の画素の見比べで見つけた）—');
  {
    const cs = fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8');
    t('接続設定: 説明文の {{通所}} などは、施設情報が後から届いた時にも作り直す（CSP で順番が変わっても同じ表示）',
      /appsP\.setAttribute\('data-fac-tpl', sys\.apps\)/.test(cs) &&
      /SUFacility\.onReady\(function\(\)\{\n    try\{ Array\.prototype\.forEach\.call\(document\.querySelectorAll\('\[data-fac-tpl\]'\), function\(p\)\{ p\.textContent = facText\(p\.getAttribute\('data-fac-tpl'\)\); \}\); \}catch\(e\)\{\}/.test(cs));
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
