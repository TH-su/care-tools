/* 貼り薬カレンダーの薬の名前と貼る場所を施設情報（facility-profile.json の patchCalendar）で差し替える試験（代表者の決定 2026-11-13）
   実行: node check/unit/patch_config_test.js
   対象を差し替える: PATCH_HTML=/tmp/変異版.html node check/unit/patch_config_test.js（変異試験用）

   守ること:
     1. 書いていない・崩れている時は null（画面は今の1種類・背中8箇所のまま）。崩れは丸ごと捨てる（一部だけ使わない）
     2. 場所は2〜8か所（保存の番号が 1〜8 しか持てないため 9か所以上は捨てる）・名前は12字まで・ますの名前は6字まで・同じ名前は捨てる
     3. 薬の名前だけ・場所だけでも使える。番号は並びどおり 1 から振る
     4. 番号の枠の図（2〜8か所）は図の入れ物（背中の図と同じ大きさ）の中に収まり、赤枠も外へ出ない
     5. 書いていない時は図も文も元のまま（背中の写真の図を使い、文を書き換えない）
     6. 施設情報の部品を画面のスクリプトより前に読む・塊の名前 patchCalendar が部品にある・印刷の前に施設情報を待つ
     7. 外からの文字を innerHTML で入れない
     8. 保存の形（送る中身・控えの形・番号の上限 8）は変えていない
   ★このファイルは公開リポジトリの check/unit にある。架空の値だけ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.PATCH_HTML || path.join(ROOT, 'patch-calendar.html'), 'utf8');
const FAC = fs.readFileSync(path.join(ROOT, 'su-facility.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'su-patch-sync.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) return '';
  return SRC.slice(start, scanBlock(SRC, start) + 1);
}
function grabVar(name) {
  const m = SRC.match(new RegExp('\\nvar ' + name + ' = [^\\n]*'));
  return m ? m[0] : '';
}

/* 画面の本物の関数を切り出して動かす */
const box = {};
vm.createContext(box);
vm.runInContext([
  grabVar('PC_SITE_MIN'), grabVar('PC_BAD_CH'), grabVar('IMG_W'), grabVar('PAD'),
  grabVar('PG_W'), grabFn('pcStr'), grabFn('pcCfgOf'), grabFn('pcBoxAt'),
].join('\n'), box);
const cfg = box.pcCfgOf;
const sites = (n) => Array.from({ length: n }, (_, i) => ({ name: '場所' + (i + 1) }));

console.log('— 1〜3. 施設情報の塊を確かめる —');
t('書いていない（undefined・null）は null', cfg(undefined) === null && cfg(null) === null);
t('塊でない値（文字・数・配列）は null', cfg('x') === null && cfg(3) === null && cfg([{ drug: 'a' }]) === null);
t('空の塊・知らない項目だけは null', cfg({}) === null && cfg({ color: 'red' }) === null);
{
  const c = cfg({ drug: '架空テープ', sites: sites(6) });
  t('6か所＋薬の名前は使う・番号は並びどおり 1 から', c && c.drug === '架空テープ' && c.sites.length === 6 && c.sites[0].n === 1 && c.sites[5].n === 6 && c.sites[2].full === '場所3', c);
  t('短い名前が無く名前が6字以内なら、ますの名前は名前のまま', c && c.sites[0].short === '場所1', c && c.sites[0]);
}
t('2か所・8か所は使う', !!cfg({ sites: sites(2) }) && cfg({ sites: sites(8) }).sites.length === 8);
t('1か所・9か所・10か所は捨てる（保存の番号は 1〜8 だけ）', cfg({ sites: sites(1) }) === null && cfg({ sites: sites(9) }) === null && cfg({ sites: sites(10) }) === null);
t('薬の名前だけでも使う（場所は既定のまま＝sites は null）', (() => { const c = cfg({ drug: '架空テープ' }); return c && c.sites === null && c.drug === '架空テープ'; })());
t('場所だけでも使う（薬の名前は既定のまま＝空）', (() => { const c = cfg({ sites: sites(3) }); return c && c.drug === '' && c.sites.length === 3; })());
t('前後の空白は落とす', cfg({ drug: '  架空テープ ' }).drug === '架空テープ');
t('薬の名前が空・21字・数・タグ・改行なら丸ごと捨てる',
  cfg({ drug: '', sites: sites(4) }) === null && cfg({ drug: 'あ'.repeat(21) }) === null && cfg({ drug: 5 }) === null
  && cfg({ drug: '<b>x</b>' }) === null && cfg({ drug: 'a\nb' }) === null);
t('薬の名前は20字まで', !!cfg({ drug: 'あ'.repeat(20) }));
t('場所の名前が13字・空・数なら丸ごと捨てる',
  cfg({ sites: [{ name: 'あ'.repeat(13) }, { name: '右' }] }) === null && cfg({ sites: [{ name: '' }, { name: '右' }] }) === null && cfg({ sites: [{ name: 1 }, { name: '右' }] }) === null);
t('場所の名前は12字まで（短い名前を書けば7字以上でもよい）', !!cfg({ sites: [{ name: 'あ'.repeat(12), short: '左' }, { name: '右' }] }));
t('短い名前が無く名前が7字以上なら捨てる・短い名前が7字以上でも捨てる',
  cfg({ sites: [{ name: 'あ'.repeat(7) }, { name: '右' }] }) === null && cfg({ sites: [{ name: '左', short: 'あ'.repeat(7) }, { name: '右' }] }) === null);
t('同じ名前の場所が2つなら捨てる', cfg({ sites: [{ name: '左' }, { name: '左' }] }) === null);
t('場所の1つが塊でない・配列なら捨てる', cfg({ sites: ['左', '右'] }) === null && cfg({ sites: [{ name: '左' }, ['右']] }) === null && cfg({ sites: [{ name: '左' }, null] }) === null);
t('sites が配列でなければ捨てる', cfg({ sites: '左,右' }) === null && cfg({ sites: { a: { name: '左' } } }) === null);
t('場所が崩れていれば、正しい薬の名前があっても丸ごと捨てる', cfg({ drug: '架空テープ', sites: sites(9) }) === null);
t('記号（&・引用符）は文字として通す（画面は textContent で入れる）', cfg({ drug: '架空"&\'テープ' }).drug === '架空"&\'テープ');

console.log('\n— 4. 番号の枠の図が入れ物に収まる —');
{
  const W = box.IMG_W, H = vm.runInContext('IMG_H', box), PAD = box.PAD, PW = box.PG_W, PH = vm.runInContext('PG_H', box);
  const out = [];
  for (let n = 2; n <= 8; n++) {
    for (let i = 0; i < n; i++) {
      const b = box.pcBoxAt(i, n);
      if (b.x - PAD < 0 || b.y - PAD < 0 || b.x + PW + PAD > W || b.y + PH + PAD > H) out.push([n, i, b]);
    }
    /* 枠どうしが重ならない（赤枠のふくらみの分を除く） */
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = box.pcBoxAt(i, n), c = box.pcBoxAt(j, n);
      if (a.x < c.x + PW && c.x < a.x + PW && a.y < c.y + PH && c.y < a.y + PH) out.push(['重なり', n, i, j]);
    }
  }
  t('2〜8か所の番号の枠と赤枠が図の入れ物の中に収まり、重ならない', out.length === 0, out);
  t('奇数は左・偶数は右（今の背中の図と同じ並び）', box.pcBoxAt(0, 6).c === 0 && box.pcBoxAt(1, 6).c === 1 && box.pcBoxAt(4, 6).c === 0);
}

console.log('\n— 5. 書いていない時は元のまま —');
{
  const bf = grabFn('backFig'), rg = grabFn('renderGuide');
  t('背中の写真の図は、場所が既定（DEF_SITES）の時だけ使う', /if \(SITES !== DEF_SITES\) return pcGenFig\(no, isOff, false\);/.test(bf) && /SITES !== DEF_SITES \? pcGenFig\(0, false, true\) : backFig\(0, false\)/.test(rg));
  const ap = grabFn('pcApplyCfg');
  t('同じ設定なら何もしない（変わった時だけ作り直す）', /if \(sig === pcCfgSig\) return false;/.test(ap) && /SITES = \(cfg && cfg\.sites\) \? cfg\.sites : DEF_SITES;/.test(ap));
  t('起動の時の設定は、変わった時だけ文を入れ直す（書いていない施設では文に触れない）', /var PCFG = null, pcCfgSig = '';/.test(SRC));
  /* 元の文（HTML）は一字一句そのまま */
  t('元の見出しと注意書きの文は残っている',
    SRC.indexOf('<p class="sub" id="pcSub">アリドネパッチの貼付部位（背中8箇所ローテーション）</p>') > 0
    && SRC.indexOf('<span class="drug" id="pcDrug">アリドネ<sup>®</sup>パッチ／背中8箇所</span>') > 0
    && SRC.indexOf('<div class="cap" id="pcCap">背中（貼る順番）</div>') > 0
    && SRC.indexOf('<span class="ln big" id="pcLnUse">アリドネ<sup>®</sup>パッチは 1日1回1枚。<b>1→2→…→8</b> の順に貼り、8が終わったら再び1に戻ります。</span>') > 0
    && SRC.indexOf('<span class="ln" id="pcLnBack"><span class="ast">※</span>同じ場所に戻るのは8日後です（間隔7日）。</span>') > 0
    && SRC.indexOf('<span class="ln" id="pcLnView"><span class="ast">※</span>図は<b>背中側から見た向き</b>です（図の左＝ご本人の左）。</span>') > 0);
  t('既定の場所は背中8箇所のまま', /var DEF_SITES = \[\s*\{ n: 1, full: '左・1段目', short: '左1段' \}/.test(SRC) && (SRC.match(/\{ n: \d, full: '[左右]・\d段目', short: '[左右]\d段' \}/g) || []).length === 8);
  t('隠した行は確実に隠れる（.ln の display:block に勝つ）', /\.notes \.ln\[hidden\] \{ display: none; \}/.test(SRC));
}

console.log('\n— 6. 読み込みの順・部品・印刷の前の待ち —');
{
  const fi = SRC.search(/<script src="su-facility\.js\?v=[0-9A-Za-z._-]+"><\/script>/);
  const main = SRC.indexOf("<script>\n'use strict';");
  t('施設情報の部品を画面のスクリプトより前に読む（端末の控えで最初から描ける）', fi > 0 && main > fi, [fi, main]);
  t('施設情報の部品に塊の名前 patchCalendar がある（最上位から読む）', /patchCalendar: function \(p\) \{ return p\.patchCalendar; \}/.test(FAC));
  t('画面は SUFacility.section(\'patchCalendar\') で読む', /SUFacility\.section\('patchCalendar'\)/.test(grabFn('pcReadCfg')));
  t('読み終えた時に確かめ直す（onReady）', /SUFacility\.onReady\(function \(\) \{ if \(pcApplyCfg\(pcReadCfg\(\)\)\) pcRebuild\(\); \}\)/.test(SRC));
  const ready = grabFn('suFacReady_');
  const dcr = fs.readFileSync(path.join(ROOT, 'daycare-roster.html'), 'utf8');
  const s = dcr.indexOf('\nfunction suFacReady_(');
  t('印刷の前の待ち（suFacReady_）はデイ利用表と一字一句同じ', ready.length > 0 && s > 0 && dcr.slice(s, scanBlock(dcr, s) + 1) === ready);
  t('読めない時は刷らずに知らせる', /if \(!ok\) \{ window\.alert\(PC_FAC_NG_MSG\); return; \}/.test(SRC) && /施設情報が読めません/.test(grabVar('PC_FAC_NG_MSG')));
}

console.log('\n— 7. 外からの文字を innerHTML で入れない —');
{
  const block = ['pcFill', 'pcApplyTexts', 'pcGenFig', 'pcRebuild'].map(grabFn).join('\n');
  t('差し替えの関数に innerHTML・insertAdjacentHTML・outerHTML が無い', block.length > 500 && !/innerHTML|insertAdjacentHTML|outerHTML/.test(block));
  t('文は textContent・createTextNode で入れる', /createTextNode\(p\)/.test(grabFn('pcFill')) && /e\.textContent = p\.tx;/.test(grabFn('pcFill')) && /tn\.textContent = nm;/.test(grabFn('pcGenFig')));
}

console.log('\n— 8. 保存の形は変えていない —');
{
  t('番号の確かめは場所の数（CYCLE）まで＝8か所以下なら今の上限の内側', /n < lo \|\| n > CYCLE/.test(grabFn('parseNo')));
  t('部品の受け取りは今までどおり 1〜8（su-patch-sync.js は変えていない）', /n >= lo && n <= 8;/.test(SYNC));
  t('控えに書く形は start・no・prev・by・at のまま', /all\[state\.rid\] = \{ start: state\.start\.iso, no: state\.no, prev: state\.prev, by: by, at: at \};/.test(SRC));
  t('上限 PC_SITE_MAX は 8', /PC_SITE_MAX = 8/.test(grabVar('PC_SITE_MIN')));
}

console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
