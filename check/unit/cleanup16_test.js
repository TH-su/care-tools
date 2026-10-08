/* 監査10月版 #16（後始末）の検証（2026-10-09）。
   1. 写しの見比べ（shadow-check.js）は氏名を伏せて出す（姓の1字目＋○）。居室と利用者No で見分ける
   2. 動作の速さの記録（perf-report.html）は CSP を持ち、ページの中にスクリプト・見た目・style 属性を書かない
      （処理は perf-report.js、見た目は perf-report.css。公開の許可リストにも載っている） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}
function cut(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つからない: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
}

console.log('\n— 1. 写しの見比べの氏名 —');
{
  const src = read('shadow-check.js');
  const box = { String, Math, Array };
  vm.createContext(box);
  vm.runInContext(cut(src, 'maskName'), box);
  const M = box.maskName;
  t('姓の1字目だけ残し、残りは ○（空白は詰める）', M('架空 太郎') === '架○○○' && M('架空　太郎') === '架○○○', [M('架空 太郎'), M('架空　太郎')]);
  t('長い名前でも ○ は5つまで（長さから人を当てにくくする）', M('架空架空架空太郎') === '架○○○○○', M('架空架空架空太郎'));
  t('1字の名前は1字だけ', M('架') === '架', M('架'));
  t('空なら（氏名なし）', M('') === '（氏名なし）' && M(null) === '（氏名なし）', [M(''), M(null)]);
  const item = cut(src, 'item');
  t('一覧の行は伏せた氏名を出す（r.name をそのまま出さない）', /maskName\(r\.name\)/.test(item) && !/\+ \(r\.name \|\|/.test(item), item);
  t('shadow-check.html は新しい版を読む', /shadow-check\.js\?v=2026-10-09/.test(read('shadow-check.html')));
}

console.log('\n— 2. 動作の速さの記録の CSP —');
{
  const html = read('perf-report.html');
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || '';
  t('CSP がある（スクリプト・見た目は自分のファイルだけ・送り先も自分だけ）', /default-src 'self'/.test(csp) && /script-src 'self'(;|$)/.test(csp) && /style-src 'self'(;|$)/.test(csp) && /connect-src 'self'/.test(csp) && /object-src 'none'/.test(csp), csp);
  t('CSP に unsafe-inline・unsafe-eval が無い', !/unsafe-(inline|eval)/.test(csp), csp);
  t('ページの中にスクリプト・見た目・style 属性・on〜 属性を書かない', !/<script>/.test(bare) && !/<style/.test(bare) && !/\sstyle="/.test(bare) && !/\son[a-z]+="/.test(bare), '');
  t('処理と見た目は別のファイルから読む', /<script src="perf-report\.js\?v=2026-10-09"><\/script>/.test(html) && /<link rel="stylesheet" href="perf-report\.css\?v=2026-10-09">/.test(html), '');
  t('分けたファイルが公開の許可リストに載っている', /^!\/perf-report\.js$/m.test(read('.gitignore')) && /^!\/perf-report\.css$/m.test(read('.gitignore')), '');
  const js = read('perf-report.js');
  t('処理のファイルに style 属性を書く所が無い（CSP で止まる）', !/setAttribute\(['"]style/.test(js) && !/style="/.test(js), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
