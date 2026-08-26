// SilverMail 接続診断（ターミナル版）
//
//   npm run diag
//
// 判定そのものは server/diagnose.js が持つ。ここはその結果を端末向けに描くだけ。
// 画面の「接続を診断」も同じ判定を使うので、二つが食い違うことはない。
//
// 出力はそのまま貼って共有できる。シークレットは長さと末尾4文字しか出さない。
import { diagnose } from '../server/diagnose.js';
import { buildLine } from '../server/build.js';

const PORT = Number(process.env.PORT) || 8744;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/api/oauth/google/callback`;

const line = (s = '') => console.log(s);
const RULE = '  ' + '─'.repeat(52);

const result = await diagnose({ redirectUri: REDIRECT_URI });

line();
line('  SilverMail 接続診断');
line(RULE);
line(`  アプリの版      ${buildLine()}`);
line(`  データ保存先    ${result.dataDir}`);
line(`  リダイレクトURI ${result.redirectUri}`);

for (const section of result.sections) {
  line();
  line(`  ● ${section.title}`);
  for (const it of section.items) {
    if (it.heading) { line(`    ${it.label}`); continue; }
    line(`    ${it.ok ? '✓' : '✗'} ${it.label}${it.note ? `  ${it.note}` : ''}`);
    if (it.mono) line(`       ${it.mono}`);
  }
}

line();
line(RULE);
if (result.todos.length === 0) {
  line('  ✓ 問題は見つかりませんでした。');
} else {
  line(`  次にやること（${result.todos.length}件）`);
  result.todos.forEach((t, i) => {
    line(`   ${i + 1}. ${t.what}`);
    if (t.url) line(`      ${t.url}`);
  });
  line();
  line('  直したあと、もう一度 npm run diag を実行してください。');
}
line();
line('  この出力はそのまま貼って共有できます（シークレットは長さと末尾4文字だけです）。');
line();

process.exit(result.todos.length ? 1 : 0);
