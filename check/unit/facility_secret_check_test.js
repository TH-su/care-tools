/* 施設情報の Secret を貼る前の確かめ（check/facility-secret-check.mjs）の試験（2026-10-26 本人指示）。
   守りたいこと:
     A 見本のまま・JSON として読めない・一部分だけ・事業所のそろわない設定・型の違い・電話の形の違い・携帯の番号は NG
     B 架空の正しい設定は OK
     C NG の時に出すのは項目と理由だけで、値（施設名・電話・住所など）は1文字も出さない（Node のエラー文も出さない）
     D 道具として呼んだ時: OK は 0・NG は 1 で終わり、--github では ::error:: の形で出す
     E 公開の手順（pages.yml）が同じ道具を呼ぶ
   値はすべて架空。実行: node check/unit/facility_secret_check_test.js */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'check', 'facility-secret-check.mjs');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const SAMPLE_SRC = read('facility-profile.sample.json');
/* 架空の正しい設定（見本の形をもとに、名前と電話だけを架空の別の値にする） */
function good() {
  const p = JSON.parse(SAMPLE_SRC);
  p.corpName = '試験の丘株式会社';
  p.facilityName = '試験の丘ホーム';
  p.offices.forEach((o, i) => { o.name = '試験の丘' + o.kind; o.tel = i === 1 ? '' : '096-000-22' + (10 + i); });
  p.support = { contactName: '試験の丘ホーム 事務所', contactTel: '096-000-2210', hours: '平日 9:00〜17:00', emergency: '試験の丘ホーム 事務所 096-000-2210（時間外は施設の職員へ）', replyTarget: '受け付けてから3営業日以内' };
  return p;
}
const SECRET_WORDS = ['試験の丘', '096-000-22', '090-0000-0001', '080-0000-0002'];
const leaks = (lines) => lines.filter(l => SECRET_WORDS.some(w => l.includes(w)));

(async () => {
  const { checkFacilityProfile: check } = await import(TOOL);
  const run = (obj) => check(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2), SAMPLE_SRC);
  const has = (r, re) => r.errors.some(e => re.test(e));

  console.log('— B. 正しい設定 —');
  const ok = run(good());
  t('架空の正しい設定は OK', ok.ok && ok.errors.length === 0, ok.errors);
  t('OK の要約に値が出ない', leaks([ok.summary]).length === 0 && /事業所 3 つ/.test(ok.summary) && /問い合わせ先 5\/5/.test(ok.summary), ok.summary);
  const noSup = good(); delete noSup.support;
  t('support が無くても OK（画面は「施設の管理者にお問い合わせください」を出す）', run(noSup).ok);

  console.log('— A. NG になる設定 —');
  const all = [];
  const ng = (name, obj, re) => { const r = run(obj); all.push(...r.errors); t(name, !r.ok && has(r, re), r.errors); return r; };
  ng('見本のまま', SAMPLE_SRC, /見本（架空の施設）のまま/);
  const brokenText = JSON.stringify(good(), null, 2).replace('"facilityName"', '"facilityName" ').replace(/,\n  "municipality"/, '\n  "municipality"');
  const br = ng('カンマが抜けた JSON（行と文字の位置だけを出す）', brokenText, /JSON として読めません（\d+ 行目 \d+ 文字目のあたり）/);
  t('JSON のエラー文（中身の一部を含みうる）を出さない', br.errors.every(e => !/Unexpected|Expected|position|JSON at/.test(e)), br.errors);
  ng('全角の引用符が混ざった JSON は、全角の注意を添える', JSON.stringify(good()).replace('"version"', '“version”'), /全角/);
  ng('空', '   ', /空です/);
  /* 2026-10-26: --clip でコマンドの文字を読んだ時、位置が出ず原因が分からなかった。先頭が { でない時はそう出す */
  const cmd = ng('コマンドの文字を読んだ（先頭が { でない）', 'cd ~/Claude/Repos/care-tools && node check/facility-secret-check.mjs --clip', /^全体：先頭が \{ ではありません/);
  t('先頭が { でない時は、JSON の読み取りの文を重ねない', cmd.errors.length === 1, cmd.errors);
  ng('前に空白や改行があっても { から始まれば読む（壊れていれば位置を出す）', '\n\n  {"corpName": "x",}', /JSON として読めません（\d+ 行目 \d+ 文字目のあたり）/);
  const frag = ng('support の部分だけを貼った', JSON.stringify(good().support), /corpName：ありません/);
  t('一部分だけの時は offices も無いと出す', has(frag, /^offices：ありません/), frag.errors);
  ng('一覧（[ ]）を貼った', [good()], /1つのかたまりではありません/);
  const noDay = good(); noDay.offices = noDay.offices.filter(o => o.kind !== '通所');
  ng('通所が無い', noDay, /施設・訪問・通所 の3つがそろっていません/);
  const dup = good(); dup.offices[2].kind = '施設';
  ng('同じ種類が2つ', dup, /そろっていません/);
  const noName = good(); noName.facilityName = '';
  ng('施設名が空', noName, /^facilityName：文字が入っていません/);
  const numName = good(); numName.corpName = 123;
  ng('法人名が数', numName, /^corpName：文字が入っていません/);
  const badTel = good(); badTel.support.contactTel = '096-000-22';
  ng('問い合わせ先の電話が電話の形でない', badTel, /^support\.contactTel：電話の形ではありません/);
  const mob = good(); mob.support.contactTel = '090-0000-0001';
  ng('問い合わせ先の電話が携帯の形', mob, /^support\.contactTel：携帯の番号の形/);
  const mobE = good(); mobE.support.emergency = '当番 080-0000-0002';
  ng('緊急時の連絡先に携帯の番号', mobE, /^support\.emergency：携帯の番号の形/);
  const ph = good(); ph.support.hours = '【書き換える】例 平日';
  ng('【書き換える】が残っている', ph, /^support\.hours：見本の値/);
  const supArr = good(); supArr.support = ['096-000-2210'];
  ng('support がかたまりでない', supArr, /^support：\{ \} のかたまりではありません/);
  const supNum = good(); supNum.support.replyTarget = 3;
  ng('support の項目が文字でない', supNum, /^support\.replyTarget：文字ではありません/);
  const offTel = good(); offTel.offices[0].tel = '9999';
  ng('事業所の電話が電話の形でない', offTel, /^offices\[0\]\.tel：電話の形ではありません/);
  const fl = good(); fl.floors = [{ no: 0, label: 'x' }];
  ng('階の番号が 1〜9 でない', fl, /^floors\[0\]\.no：/);
  const vc = good(); vc.visitingClinics = [{ aliases: [] }];
  ng('訪問診療の名前が無い', vc, /^visitingClinics\[0\]\.name：/);
  const url = good(); url.corpSettings = { homeGuidelineName: 'x', homeGuidelineUrl: 'http://example.invalid/' };
  ng('指針の URL が https でない', url, /^corpSettings\.homeGuidelineUrl：/);
  const rp = good(); rp.roomPlan = { f1: { rows: 1 } };
  ng('間取り図に cells が無い', rp, /^roomPlan\.f1：/);

  console.log('— C. 値を出さない —');
  t('NG の文のどれにも、架空の施設名・電話・携帯の番号が出ない', leaks(all).length === 0, leaks(all));

  console.log('— D. 道具として呼ぶ —');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fpcheck-'));
  try {
    const okFile = path.join(tmp, 'ok.json'), ngFile = path.join(tmp, 'ng.json');
    fs.writeFileSync(okFile, JSON.stringify(good()));
    fs.writeFileSync(ngFile, JSON.stringify(mob));
    const a = spawnSync(process.execPath, [TOOL, okFile], { encoding: 'utf8' });
    t('正しい設定は 0 で終わり「形はOK」と出す', a.status === 0 && /形はOK/.test(a.stdout) && leaks([a.stdout]).length === 0, [a.status, a.stdout]);
    const b = spawnSync(process.execPath, [TOOL, ngFile], { encoding: 'utf8' });
    t('NG は 1 で終わり、値を出さない', b.status === 1 && /^NG support\.contactTel/m.test(b.stdout) && leaks([b.stdout + b.stderr]).length === 0, [b.status, b.stdout]);
    const c = spawnSync(process.execPath, [TOOL, '--github', ngFile], { encoding: 'utf8' });
    t('--github では ::error:: の形で出す', c.status === 1 && /^::error::施設情報 support\.contactTel/m.test(c.stdout), c.stdout);
    const d = spawnSync(process.execPath, [TOOL], { input: JSON.stringify(good()), encoding: 'utf8' });
    t('標準入力からも確かめられる', d.status === 0 && /形はOK/.test(d.stdout), [d.status, d.stdout]);
    const w = spawnSync(process.execPath, [TOOL, '--clip'], { input: '', encoding: 'utf8', timeout: 10000 });
    t('--clip は、ターミナルでない時（試験・パイプ）は Enter を待たない', w.error === undefined && !/Enter を押して/.test(w.stdout) && [0, 1, 2].includes(w.status), [w.status, w.error && w.error.code]);
    const e = spawnSync(process.execPath, [TOOL, path.join(tmp, 'nothing.json')], { encoding: 'utf8' });
    t('ファイルが無い時は 2 で終わり、パスの中身を読まない', e.status === 2, [e.status, e.stderr]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  console.log('— E. 公開の手順も同じ道具を呼ぶ —');
  const Y = read('.github/workflows/pages.yml');
  t('pages.yml は facility-secret-check.mjs を --github で呼び、別の判定を持たない', /node check\/facility-secret-check\.mjs --github facility-profile\.json/.test(Y) && !/json\.load\(open\('facility-profile\.json'/.test(Y));
  t('道具は公開リポジトリに入る（.gitignore の許可にある）', /^!\/check\/facility-secret-check\.mjs$/m.test(read('.gitignore')));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
