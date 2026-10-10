/* ログイン（login.js）と使える人の管理（accounts.js）の純関数の試験（2026-10-10 新設・監査10月版 第2版 14）
   実行: node check/unit/login_accounts_test.js
   守ること:
     ①ログイン後の戻り先は、このサイトの「英小文字・数字・ハイフン.html」と、決め打ちの一覧（care-log）だけ
       （よそのサイト・別の階層・スクリプトへ飛ばす罠リンクに使わせない）
     ②ログインの方法の表示（Google・ID とパスワード・2段階認証）
     ③メールアドレスの形の判定（追加の前に断る）
     ④データベースの断り文句を、画面で意味の通る言葉に言い換える
   画面のコードは書き換えず、関数をそのまま切り出して動かす。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const LOGIN = fs.readFileSync(path.join(ROOT, 'login.js'), 'utf8');
const ACC = fs.readFileSync(path.join(ROOT, 'accounts.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
function line(src, re) { const m = re.exec(src); if (!m) throw new Error('行が見つかりません: ' + re); return m[0]; }

/* ── ①戻り先 ── */
function loginBox(stored) {
  const ss = Object.assign({}, stored);
  const box = { Object, sessionStorage: { getItem: k => (k in ss ? ss[k] : null), setItem: (k, v) => { ss[k] = String(v); } } };
  vm.createContext(box);
  vm.runInContext([line(LOGIN, /var NEXT_KEY = [^\n]*/), line(LOGIN, /var RETURN_KEY = [^\n]*/), line(LOGIN, /var RETURNS = [^\n]*/),
                   cutF(LOGIN, 'nextPage'), cutF(LOGIN, 'returnTarget'), cutF(LOGIN, 'howText')].join('\n'), box);
  return box;
}
/* 起動時に ?next= を覚える式も、nextPage と同じ形でなければならない（覚える側だけ緩いと、読む側で捨てられて戻れない） */
const NEXT_RE_SRC = (/if \(n && (\/[^/]+\/)\.test\(n\)\) sessionStorage\.setItem\(NEXT_KEY, n\);/.exec(LOGIN) || [])[1];
const nextRe = NEXT_RE_SRC ? eval(NEXT_RE_SRC) : null;

console.log('\n— 1. ログイン後の戻り先 —');
{
  const ok = ['weight-record.html', 'care-schedule.html', 'index.html', 'a1.html'];
  const ng = ['https://evil.example/x.html', '//evil.example/x.html', '../x.html', 'sub/x.html', 'X.html', '-x.html',
              'x.html?a=1', 'x.html#h', 'javascript:alert(1)', 'x.htm', 'x.html.evil', '', ' x.html', 'x_y.html', 'ｘ.html'];
  t('覚える側と読む側の式が同じ', !!nextRe && NEXT_RE_SRC === (/return n && (\/[^/]+\/)\.test\(n\)/.exec(cutF(LOGIN, 'nextPage')) || [])[1], NEXT_RE_SRC);
  t('このサイトの画面（英小文字・数字・ハイフン.html）は戻り先にできる', ok.every(n => loginBox({ su_auth_next: n }).nextPage() === n), ok.map(n => loginBox({ su_auth_next: n }).nextPage()));
  const leaked = ng.filter(n => loginBox({ su_auth_next: n }).nextPage() !== '' || (nextRe && nextRe.test(n)));
  t('よそのサイト・別の階層・クエリ・大文字・スクリプトは戻り先にしない（' + ng.length + '通り）', leaked.length === 0, leaked);
  t('覚えていなければ戻り先なし', loginBox({}).nextPage() === '', '');
  const bad = { getItem() { throw new Error('denied'); } };
  const b2 = loginBox({}); b2.sessionStorage = bad;
  t('sessionStorage が使えない端末でも例外を出さず、戻り先なし', b2.nextPage() === '' && b2.returnTarget() === '', '');
  t('別アプリの戻り先は一覧（care-log）だけ', loginBox({ su_auth_return: 'care-log' }).returnTarget() === '../care-log/', loginBox({ su_auth_return: 'care-log' }).returnTarget());
  t('一覧に無い名前・継承された名前（toString・__proto__）は戻り先にしない',
    ['evil', 'toString', '__proto__', 'constructor', '../care-log/', ''].every(r => loginBox({ su_auth_return: r }).returnTarget() === ''), '');
}

console.log('\n— 2. ログインの方法の表示 —');
{
  const b = loginBox({});
  t('Google だけ', b.howText({ methods: ['oauth'] }) === 'Google', b.howText({ methods: ['oauth'] }));
  t('Google ＋ 2段階認証（totp）', b.howText({ methods: ['oauth', 'totp'] }) === 'Google ＋ 2段階認証', '');
  t('aal2 なら methods に totp が無くても 2段階認証', b.howText({ methods: ['password'], aal: 'aal2' }) === 'ID とパスワード ＋ 2段階認証', '');
  t('何も無ければ「—」', b.howText({}) === '—' && b.howText({ methods: [] }) === '—', '');
}

console.log('\n— 3. メールアドレスの形 —');
{
  const re = eval((/var EMAIL_RE = (\/[^\n]+\/);/.exec(ACC) || [])[1] || 'null');
  const ok = ['staff-a@example.com', 'a.b+c@sub.example.co.jp', 'x_1%y@ex-ample.org'];
  const ng = ['', 'staff', 'staff@', '@example.com', 'a@b', 'a@b.c', 'a b@example.com', 'a@example.com ', 'Staff@Example.com', 'a@@example.com', 'a@example.com\n', '"a"@example.com'];
  t('よくある形は通す', !!re && ok.every(x => re.test(x)), ok.filter(x => !(re && re.test(x))));
  t('空・@ が無い・ドメインが短い・空白・大文字・改行は断る（' + ng.length + '通り）', !!re && ng.every(x => !re.test(x)), ng.filter(x => re && re.test(x)));
  t('入力は前後の空白を落として小文字にしてから判定する', /\$\('f-email'\)\.value\.trim\(\)\.toLowerCase\(\)/.test(ACC), '');
}

console.log('\n— 4. 断り文句の言い換え —');
{
  const box = { String };
  vm.createContext(box);
  vm.runInContext(cutF(ACC, 'friendly'), box);
  const f = box.friendly;
  t('重複（23505）', f({ code: '23505', message: 'duplicate key' }) === 'このメールアドレスはすでに登録されています。', f({ code: '23505' }));
  t('最後の管理者の保護（23514）はデータベースの文をそのまま出す', f({ code: '23514', message: '最後の管理者は外せません' }) === '最後の管理者は外せません', '');
  t('ほかの 23514 は形・役割の確認を促す', /メールアドレスの形や役割/.test(f({ code: '23514', message: 'check violation' })), '');
  t('権限（42501・RLS の文）は2段階認証まで済んでいるかを促す',
    /権限がありません/.test(f({ code: '42501' })) && /権限がありません/.test(f({ message: 'new row violates row-level security policy' })) && /権限がありません/.test(f({ message: 'Permission denied' })), '');
  t('通信の失敗は電波・Wi-Fi を促す', ['Failed to fetch', 'NetworkError', 'Load failed'].every(m => /通信できませんでした/.test(f({ message: m }))), '');
  t('分からない時は元の文・空なら既定の文', f({ message: 'xyz' }) === 'xyz' && f(null) === 'うまくいきませんでした。' && f('') === 'うまくいきませんでした。', [f(null), f('')]);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
