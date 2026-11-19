/* ログイン（login.js）: 事務所のアカウントの2段階認証の欄の試験（2026-11-19 本人指示）
   実行: node check/unit/login_office_mfa_test.js
   守ること:
     1. 欄を出すのは、事務所のアカウントで、今のログインが2段階認証を済ませていない（aal2 でない）時だけ
        （管理者・現場・済ませた人には出さない）
     2. 認証アプリを登録済みなら「6桁を入れる」、まだなら「登録する」
     3. 登録の一覧を読めない時・確かめている間に画面が変わった時は、欄を出さない
     4. 欄から戻る「あとで」は、今の確かめの答えのまま戻る（役割の名前を「2段階認証なし」に変えない）
     5. 管理者の流れ（登録・6桁）の文は今までのまま
   画面のコードは書き換えず、関数をそのまま切り出して動かす。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const LOGIN = fs.readFileSync(path.join(ROOT, 'login.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');

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

function el() { return { hidden: true, textContent: '', dataset: {} }; }
function box(factors) {
  const els = { 'ok-mfa': el(), 'b-ok-mfa': el() };
  const sb = {
    $: (id) => els[id],
    els,
    SUAuth: { client: () => ({ auth: { mfa: { listFactors: async () => {
      if (factors === 'error') return { error: { message: 'x' } };
      if (factors === 'throw') throw new Error('net');
      return { data: { totp: factors || [] } };
    } } } }) },
    okGen: 0, current: null
  };
  vm.createContext(sb);
  vm.runInContext('var okGen = 0; var current = null;\n' + 'officeMfa = async ' + cutF(LOGIN, 'officeMfa'), sb);
  return sb;
}
async function run(st, factors, mutate) {
  const b = box(factors);
  vm.runInContext('current = __st', Object.assign(b, { __st: st }));
  const p = b.officeMfa(st);
  if (mutate) mutate(b);
  await p;
  return b.els;
}

(async function () {
  console.log('\n— 1. 欄を出す相手 —');
  {
    const office = { status: 'ok', role: 'office', aal: 'aal1' };
    let e = await run(office, []);
    t('事務所・aal1・登録なし → 欄を出し「2段階認証を登録する」', !e['ok-mfa'].hidden && e['b-ok-mfa'].textContent === '2段階認証を登録する' && e['ok-mfa'].dataset.factor === '', e);
    e = await run(office, [{ id: 'f1', status: 'verified' }]);
    t('事務所・aal1・登録済み → 「認証アプリの6桁を入れる」と登録の id', !e['ok-mfa'].hidden && e['b-ok-mfa'].textContent === '認証アプリの6桁を入れる' && e['ok-mfa'].dataset.factor === 'f1', e);
    e = await run(office, [{ id: 'f0', status: 'unverified' }]);
    t('途中でやめた登録（未確認）だけ → 「登録する」', !e['ok-mfa'].hidden && e['ok-mfa'].dataset.factor === '', e);
    e = await run({ status: 'ok', role: 'office', aal: 'aal2' }, []);
    t('事務所・aal2（済ませた）→ 欄を出さない', e['ok-mfa'].hidden, e);
    e = await run({ status: 'ok', role: 'admin', aal: 'aal2' }, []);
    t('管理者 → 欄を出さない', e['ok-mfa'].hidden, e);
    e = await run({ status: 'ok', role: 'field', aal: 'aal1' }, []);
    t('現場 → 欄を出さない', e['ok-mfa'].hidden, e);
  }

  console.log('\n— 2. 確かめられない時 —');
  {
    const office = { status: 'ok', role: 'office', aal: 'aal1' };
    let e = await run(office, 'error');
    t('登録の一覧が断られた → 欄を出さない', e['ok-mfa'].hidden, e);
    e = await run(office, 'throw');
    t('通信の失敗 → 欄を出さず例外も出さない', e['ok-mfa'].hidden, e);
    e = await run(office, [], (b) => { vm.runInContext('okGen++', b); });
    t('確かめている間に画面が変わった（世代が進んだ）→ 欄を出さない', e['ok-mfa'].hidden, e);
    e = await run(office, [], (b) => { vm.runInContext('current = { role: "office" }', b); });
    t('確かめている間にログインの答えが変わった → 欄を出さない', e['ok-mfa'].hidden, e);
  }

  console.log('\n— 3. 戻る・文 —');
  {
    // 「あとで」の行き先（skipTo）を切り出して動かす
    const sk = { Object, S: { OK: 'ok' }, SUAuth: { ROLE_LABEL: { office: '事務所' } } };
    vm.createContext(sk);
    vm.runInContext('skipTo = ' + cutF(LOGIN, 'skipTo'), sk);
    const officeSt = { status: 'ok', role: 'office', roleLabel: '事務所', aal: 'aal1' };
    t('事務所のアカウントの「あとで」は、同じ確かめの答え（同じもの）に戻る', sk.skipTo(officeSt) === officeSt, sk.skipTo(officeSt));
    for (const status of ['mfa_enroll', 'mfa_verify']) {
      const adm = { status, email: 'x', factorId: 'f' };
      const r = sk.skipTo(adm);
      t('管理者が6桁を入れずに進む（' + status + '）→ 今までどおり事務所（2段階認証なし）・元の答えは書き換えない',
        r !== adm && r.role === 'office' && r.roleLabel === '事務所（2段階認証なし）' && adm.role === undefined, r);
    }
    t('「あとで」は skipTo を通して showOk に渡す', /if \(act === 'skip' && current\) \{\s*msg\(''\);\s*showOk\(skipTo\(current\)\);/.test(LOGIN), '');
    // 文の切り替え（mfaFor）を切り出して動かす: 事務所→管理者の順で呼んでも管理者の文に戻る
    const ids2 = ['enroll-admin-note', 'enroll-office-note', 'enroll-skip-note', 'verify-skip-note', 'enroll-skip', 'verify-skip', 'enroll-warn-admin', 'enroll-warn-office', 'enroll-qr-skip'];
    const els = {}; ids2.forEach((id) => { els[id] = { hidden: false, textContent: '' }; });
    const mf = { $: (id) => els[id] };
    vm.createContext(mf);
    vm.runInContext('mfaFor = ' + cutF(LOGIN, 'mfaFor'), mf);
    mf.mfaFor(true);
    t('事務所向け: 事務所の文・注意書き・QR の段の「あとで」を出し、管理者の文を隠す',
      els['enroll-admin-note'].hidden && !els['enroll-office-note'].hidden && els['enroll-warn-admin'].hidden && !els['enroll-warn-office'].hidden
      && !els['enroll-qr-skip'].hidden && els['enroll-skip'].textContent === 'あとで登録する' && els['verify-skip'].textContent === 'あとで入れる', els);
    mf.mfaFor(false);
    t('その後に管理者向け: 今までの文・注意書きに戻り、QR の段の「あとで」は隠す',
      !els['enroll-admin-note'].hidden && els['enroll-office-note'].hidden && !els['enroll-skip-note'].hidden && !els['verify-skip-note'].hidden
      && !els['enroll-warn-admin'].hidden && els['enroll-warn-office'].hidden && els['enroll-qr-skip'].hidden
      && els['enroll-skip'].textContent === 'あとで登録する（事務所として進む）' && els['verify-skip'].textContent === '事務所として進む', els);
    t('欄のボタンは事務所のアカウントの OK の時だけ動く',
      /\$\('b-ok-mfa'\)\.addEventListener\('click', function \(\) \{\s*if \(!current \|\| current\.status !== S\.OK \|\| current\.role !== 'office'\) return;/.test(LOGIN), '');
    t('管理者の流れでは管理者向けの文に戻す（登録・6桁の両方）',
      /case S\.MFA_ENROLL:\s*mfaFor\(false\);/.test(LOGIN) && /case S\.MFA_VERIFY: mfaFor\(false\);/.test(LOGIN), '');
    const ids = ['enroll-admin-note', 'enroll-office-note', 'enroll-skip-note', 'enroll-skip', 'verify-skip-note', 'verify-skip', 'enroll-warn-admin', 'enroll-warn-office', 'enroll-qr-skip', 'ok-mfa', 'b-ok-mfa'];
    const miss = ids.filter((id) => HTML.indexOf('id="' + id + '"') < 0);
    t('画面に欄の部品がそろう', miss.length === 0, miss);
    t('事務所向けの欄は初めは隠す', /<div id="ok-mfa" hidden>/.test(HTML) && /id="enroll-office-note" hidden/.test(HTML), '');
    t('管理者向けの文は今までのまま', HTML.indexOf('管理者は Google に加えて、スマートフォンの認証アプリの6桁を入れた時だけ管理者として使えます。') >= 0
      && HTML.indexOf('>あとで登録する（事務所として進む）<') >= 0 && HTML.indexOf('>事務所として進む<') >= 0, '');
  }

  console.log('\n' + (fail ? '✗ ' : '✓ ') + 'login_office_mfa: ' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})();
