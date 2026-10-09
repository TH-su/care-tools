/* メニュー（index.html）を定義（JSON）から組み立てることの検証（2026-10-09・監査10月版 #15・本人決定 3a）。
   1. 定義が JSON として読め、以前の手書きの20枚（区分4つ）がそのまま入っている（名前・行き先・現場端末の出し分け）
   2. 組み立ては textContent で行い、定義の文字を HTML として実行しない。fetch・トークン・氏名を持ち込まない
   3. 「困った時」の区分（help.html）は現場端末でも出す。help.html に電話番号・メールなどの連絡先を書かない */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}

const html = read('index.html');
const m = html.match(/<script type="application\/json" id="menuDef">([\s\S]*?)<\/script>/);
let def = null;
try { def = JSON.parse(m[1]); } catch (e) { def = null; }

console.log('\n— 1. 定義の中身 —');
t('定義が JSON として読める', !!def && Array.isArray(def.sections), m ? 'parse error' : 'no def');
const secs = def ? def.sections : [];
t('区分は 職員・入居者・厨房・設定・困った時 の順', secs.map(s => s.title).join() === '職員,入居者,厨房,設定,困った時', secs.map(s => s.title));
const tiles = [].concat.apply([], secs.map(s => s.tiles));
t('タイルは21枚（以前の20枚＋困った時）', tiles.length === 21, tiles.length);
const want = ['shift-app.html', 'work-schedule.html', 'shift-analyzer.html', 'staff-master.html',
  'https://th-su.github.io/haiben-record/haiben-record.html', 'weight-record.html', 'care-schedule.html', 'daycare-roster.html', 'visit-overview.html',
  'facesheet.html', 'genogram.html', 'resident-master.html', 'patch-calendar.html', 'moushiokuri-viewer.html', 'resident-master.html?view=bday',
  'admission-flow.html', 'training-plan.html', 'supplies.html', 'https://th-su.github.io/kitchen-app/', 'connection-settings.html', 'help.html'];
t('行き先と並び順が以前と同じ（最後に help.html）', tiles.map(x => x.href).join('|') === want.join('|'), tiles.map(x => x.href));
const office = tiles.filter(x => x.officeOnly).map(x => x.href).sort().join();
t('現場端末で出さないタイルは以前と同じ4枚（職員マスタ・誕生日一覧・入居調整・訓練計画）＋設定の区分', office === ['admission-flow.html', 'resident-master.html?view=bday', 'staff-master.html', 'training-plan.html'].sort().join()
  && secs.find(s => s.id === 'sec-setup').officeOnly === true, office);
t('別サイトの印（ext）は排泄ケア記録・厨房の2枚', tiles.filter(x => x.ext).length === 2, tiles.filter(x => x.ext).map(x => x.nm));
t('新しい行から始める印（newrow）はフェイスシートだけ', tiles.filter(x => x.newrow).map(x => x.href).join() === 'facesheet.html', '');
t('訓練計画の説明は事業所名を施設情報から入れる（{{通所}}）', /^\{\{通所\}\}/.test(tiles.find(x => x.href === 'training-plan.html').note), '');
t('どのタイルにも名前・絵文字・説明がある', tiles.every(x => x.nm && x.ic && typeof x.note === 'string'), '');

console.log('\n— 2. 組み立て方 —');
const body = html.slice(html.indexOf('<body>'));
t('メニューの本体は空の <main id="menu"> だけ（手書きのタイルは残っていない）', /<main id="menu"><\/main>/.test(html) && !/<a class="tile/.test(body), '');
t('文字は textContent で入れる（innerHTML を使わない）', !/innerHTML/.test(body), '');
t('fetch・XMLHttpRequest・localStorage の書き込みを持ち込まない', !/fetch\(|XMLHttpRequest|setItem\(/.test(html), '');
t('組み立てに失敗した時は、案内を出して不具合として知らせる', /メニューを組み立てられませんでした/.test(html) && /SUErrors\.report\('メニュー'/.test(html), '');
t('事業所名を差し込む処理（data-fac-name）は組み立ての後に走る', html.indexOf('id="menuDef"') < html.indexOf("querySelectorAll('[data-fac-name]')"), '');

console.log('\n— 3. 困った時 —');
const help = secs.find(s => s.id === 'sec-help');
t('困った時の区分は現場端末でも出す（officeOnly なし）', !!help && !help.officeOnly && !help.tiles[0].officeOnly, help);
const hp = read('help.html');
t('help.html に電話番号・メールアドレスを書かない（本人決定 3a）', !/\d{2,4}-\d{2,4}-\d{3,4}/.test(hp) && !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(hp), '');
t('help.html は「不具合を報告」の案内と、氏名・居室番号・病名を書かない注意を載せる', /不具合を報告/.test(hp) && /氏名、居室番号、病名は書かないでください/.test(hp), '');
t('★送り先が無い端末（「この内容をコピー」だけ）の時の案内もある', /この内容をコピー<\/span> だけが出ます/.test(hp), '');
t('help.html の CSP は管理者のログイン確認（Supabase）を止めない', /connect-src[^;]*https:\/\/jhbernqawjrzqwrmqrih\.supabase\.co/.test(hp), '');
t('help.html は不具合報告の部品を読み込む', /<script src="su-report\.js\?v=[^"]+" data-tool="使い方・困った時"><\/script>/.test(hp), '');
t('help.html が公開の許可リストに載っている', /^!\/help\.html$/m.test(read('.gitignore')), '');

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
