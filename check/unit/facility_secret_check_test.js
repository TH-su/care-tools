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

  /* 適格請求書の登録番号（2026-11-13 第6段 SP-03 反証）: 書き損じは止める・読む部品と同じ読み方（空白・ハイフン・全角は直して読む） */
  const inv = (v) => { const o = good(); o.invoiceNo = v; return o; };
  const ngInv = ng('登録番号の桁が足りない', inv('T000000000001'), /^invoiceNo：T と13桁の数字の形ではありません/);
  t('登録番号の NG の文に番号そのものを出さない', ngInv.errors.every(e => e.indexOf('T000000000001') < 0 && e.indexOf('000000000001') < 0), ngInv.errors);
  ng('登録番号に T が無い', inv('0000000000001'), /^invoiceNo：T と13桁/);
  ng('登録番号が文字でない', inv(1234567890123), /^invoiceNo：文字ではありません/);
  t('登録番号は空白・ハイフン・全角の英数字を直して読めれば OK', run(inv('Ｔ０００-0000 00000１')).ok && run(inv('T0000000000001')).ok, run(inv('Ｔ０００-0000 00000１')).errors);
  t('登録番号が空・項目が無い時は OK（紙に出さないだけ）', run(inv('')).ok && run(good()).ok);
  /* 読む部品（su-facility.js）と同じ判定か: 同じ値を両方に通し、OK と「番号が出る」が一致する */
  {
    const vm = require('vm');
    const read = (v) => { const store = { su_facility_json_v1: JSON.stringify(inv(v)) }; const win = {};
      const ctx = { window: win, localStorage: { getItem: k => (k in store ? store[k] : null), setItem() {} }, JSON, Math, String, Array, Object, parseInt };
      vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'su-facility.js'), 'utf8'), ctx); return win.SUFacility.invoiceNo(); };
    const cases = ['T0000000000001', 'Ｔ０００-0000 00000１', 'T000000000001', 't0000000000001', 'T0000000000001X', ' T0000-0000-00001 '];
    const bad = cases.filter(v => run(inv(v)).ok !== (read(v) !== ''));
    t('確かめる道具と読む部品で同じ判定（6通り）', bad.length === 0, bad);
  }

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

  console.log('— F. 貼り薬カレンダーの施設情報（patchCalendar）は画面と同じ決まりで止める —');
  {
    const { patchRules } = await import(TOOL);
    const pc = patchRules();
    t('画面（patch-calendar.html）から決まりの関数を切り出せる', !!pc && typeof pc.pcCfgOf === 'function' && typeof pc.pcKindsOf === 'function');
    const withPc = (v) => { const p = good(); p.patchCalendar = v; return run(p); };
    const S4 = [{ name: '貼甲' }, { name: '貼乙' }, { name: '貼丙' }, { name: '貼丁' }];
    const okCases = [
      ['薬の名前だけ', { drug: '試験テープ' }],
      ['場所だけ（4か所）', { sites: S4 }],
      ['名前・場所・別の種類2つ', { drug: '試験テープ', sites: S4, kinds: [{ no: 2, drug: '試験パッチ' }, { no: 3, drug: '試験シート', sites: [{ name: '貼戊', short: '戊' }, { name: '貼己', short: '己' }] }] }],
      ['別の種類だけ', { kinds: [{ no: 8, drug: '試験パッチ' }] }],
    ];
    for (const [n, v] of okCases) { const r = withPc(v); t('OK: ' + n, r.ok, r.errors); }
    const ngCases = [
      ['かたまりでない', [1, 2], /^patchCalendar：/],
      ['何も書いていない', {}, /^patchCalendar：.*どれも書いていません/],
      ['薬の名前が21字', { drug: 'あ'.repeat(21) }, /^patchCalendar：/],
      ['薬の名前に < がある', { drug: '試験<テープ' }, /^patchCalendar：/],
      ['場所が1か所', { sites: [{ name: '貼甲' }] }, /^patchCalendar：/],
      ['場所が9か所', { sites: Array.from({ length: 9 }, (_, i) => ({ name: '場所' + i })) }, /^patchCalendar：/],
      ['場所の名前が重なる', { sites: [{ name: '貼甲' }, { name: '貼甲' }] }, /^patchCalendar：/],
      ['7字の場所の名前に短い名前が無い', { sites: [{ name: 'ぬぬぬぬぬぬぬ' }, { name: '貼乙' }] }, /^patchCalendar：/],
      ['種類の番号が1', { kinds: [{ no: 1, drug: '試験パッチ' }] }, /^patchCalendar\.kinds：/],
      ['種類の番号が重なる', { kinds: [{ no: 2, drug: 'A剤' }, { no: 2, drug: 'B剤' }] }, /^patchCalendar\.kinds：/],
      ['種類の番号が小数', { kinds: [{ no: 2.5, drug: 'A剤' }] }, /^patchCalendar\.kinds：/],
      ['種類に薬の名前が無い', { kinds: [{ no: 2 }] }, /^patchCalendar\.kinds：/],
      ['種類が8つ', { kinds: Array.from({ length: 8 }, (_, i) => ({ no: 2 + (i % 7), drug: '剤' + i })) }, /^patchCalendar\.kinds：/],
      ['種類が空の一覧', { kinds: [] }, /^patchCalendar\.kinds：/],
      ['種類の場所が崩れている', { kinds: [{ no: 2, drug: 'A剤', sites: [{ name: '貼戊' }] }] }, /^patchCalendar\.kinds：/],
    ];
    const pcErr = [];
    for (const [n, v, re] of ngCases) { const r = withPc(v); pcErr.push(...r.errors); t('NG: ' + n, !r.ok && has(r, re), r.errors); }
    t('既定の部分が正しく kinds だけ崩れている時は kinds だけを NG にする', (() => { const r = withPc({ drug: '試験テープ', kinds: [{ no: 1, drug: 'A剤' }] }); return !r.ok && r.errors.length === 1 && /^patchCalendar\.kinds：/.test(r.errors[0]); })());
    /* 画面と同じ決まりか: 道具の OK／NG と、画面の関数が読めるか（読めなければ画面は既定に戻る）がそろう */
    const all2 = okCases.map(c => [c[1], true]).concat(ngCases.slice(2).map(c => [c[1], false]));
    t('道具の判定は画面の関数の判定とそろう', all2.every(([v, want]) => {
      const scr = (v.drug === undefined && v.sites === undefined || !!pc.pcCfgOf({ drug: v.drug, sites: v.sites })) && (v.kinds === undefined || !!pc.pcKindsOf(v));
      return scr === want && withPc(v).ok === want;
    }));
    t('NG の文に値（薬の名前・場所の名前）を出さない', !pcErr.some(e => /試験|貼甲|ぬぬぬ|A剤|あああ/.test(e)), pcErr);
    t('5万字を超える塊は NG（su-facility.js の SECTION_MAX で塊ごと捨てられるため）', (() => { const r = withPc({ drug: '試験テープ', memo: 'x'.repeat(60000) }); return !r.ok && has(r, /^patchCalendar：大きすぎます/); })() && /SECTION_MAX = 50000/.test(read('su-facility.js')));
    {
      const { setPatchRulesForTest } = await import(TOOL);
      setPatchRulesForTest(null);
      const r = withPc({ drug: '試験テープ' });
      const r0 = run(good());
      setPatchRulesForTest(undefined);
      t('決まりの関数を切り出せない時は、patchCalendar を書いた設定を止める（黙って通さない）', !r.ok && has(r, /^patchCalendar：確かめる決まり/), r.errors);
      t('決まりの関数を切り出せない時も、patchCalendar を書いていない設定は今までどおり OK', r0.ok, r0.errors);
      t('差し替えを戻すと元の決まりで動く', withPc({ drug: '試験テープ' }).ok);
    }
    t('見本（facility-profile.sample.json）に patchCalendar を書いていない時も今までどおり', !('patchCalendar' in JSON.parse(SAMPLE_SRC)) && run(good()).ok);
  }

  console.log('— G. 事故報告書の紙だけの事業所名・所在地（accidentReport）は画面と同じ決まりで止める（代表者の決定 2026-11-28） —');
  {
    const withAr = (v) => { const p = good(); p.accidentReport = v; return run(p); };
    const okCases = [
      ['名前と所在地を3つとも', { officeNames: { 施設: '見本ホーム事業所', 訪問: '見本ヘルパー事業所', 通所: '見本デイ事業所' }, officeAddresses: { 施設: '見本町１－２－３', 訪問: '見本町１－２－３', 通所: '見本町１－２－３' } }],
      ['名前を1つだけ', { officeNames: { 施設: '見本ホーム事業所' } }],
      ['所在地だけ（前後の空白は除いて数える）', { officeAddresses: { 通所: '  見本町１－２－３ ' } }],
      ['中身が空の塊', {}],
    ];
    for (const [n, v] of okCases) { const r = withAr(v); t('OK: ' + n, r.ok, r.errors); }
    const ngCases = [
      ['塊でない（文字）', '見本', /^accidentReport：/],
      ['塊でない（一覧）', [1], /^accidentReport：/],
      ['null', null, /^accidentReport：/],
      ['知らない項目', { officeTel: {} }, /^accidentReport：知らない項目/],
      ['officeNames が塊でない', { officeNames: '見本' }, /^accidentReport\.officeNames：/],
      ['知らない kind', { officeNames: { 居宅: '見本居宅' } }, /^accidentReport\.officeNames：知らない鍵/],
      ['名前が61字', { officeNames: { 施設: 'あ'.repeat(61) } }, /^accidentReport\.officeNames\.施設：/],
      ['所在地が81字', { officeAddresses: { 施設: 'あ'.repeat(81) } }, /^accidentReport\.officeAddresses\.施設：/],
      ['空白だけ', { officeNames: { 訪問: '　 ' } }, /^accidentReport\.officeNames\.訪問：/],
      ['改行', { officeNames: { 訪問: '見本\n事業所' } }, /^accidentReport\.officeNames\.訪問：/],
      ['< がある', { officeAddresses: { 通所: '見本<町' } }, /^accidentReport\.officeAddresses\.通所：/],
      ['{ がある', { officeNames: { 通所: '見本{事業所' } }, /^accidentReport\.officeNames\.通所：/],
      ['文字でない', { officeNames: { 施設: 5 } }, /^accidentReport\.officeNames\.施設：/],
      ['C1 の制御文字', { officeNames: { 施設: '見本\u0085事業所' } }, /^accidentReport\.officeNames\.施設：/],
      ['行の区切り U+2028', { officeAddresses: { 訪問: '見本町\u2028１－２' } }, /^accidentReport\.officeAddresses\.訪問：/],
    ];
    for (const [n, v, re] of ngCases) { const r = withAr(v); t('NG: ' + n, !r.ok && has(r, re), r.errors); }
    t('崩れた鍵だけを NG にする（ほかの鍵は数えない）', (() => { const r = withAr({ officeNames: { 施設: '見本ホーム事業所', 訪問: 'あ'.repeat(61) } }); return !r.ok && r.errors.length === 1; })());
    t('offices に無い kind の鍵は NG', (() => { const p = good(); p.offices = p.offices.filter((o) => o.kind !== '通所'); p.accidentReport = { officeNames: { 通所: '見本デイ事業所' } }; const r = run(p); return has(r, /^accidentReport\.officeNames\.通所：.*offices にありません/); })());
    t('鍵と値を取り違えても NG の文に名前を出さない', (() => { const r = withAr({ officeNames: { '試験の丘ホーム': '施設' }, ['試験の丘']: {} }); return !r.ok && leaks(r.errors).length === 0 && r.errors.length === 2; })(), (() => { const r = withAr({ officeNames: { '試験の丘ホーム': '施設' }, ['試験の丘']: {} }); return r.errors.length; })());
    t('NG の文に値を出さない', (() => { const r = withAr({ officeNames: { 施設: '試験の丘' + 'あ'.repeat(60) } }); return !r.ok && leaks(r.errors).length === 0; })());
    t('見本（facility-profile.sample.json）に accidentReport を書いていない時も今までどおり', !('accidentReport' in JSON.parse(SAMPLE_SRC)) && run(good()).ok);
  }

  console.log('— E. 公開の手順も同じ道具を呼ぶ —');
  const Y = read('.github/workflows/pages.yml');
  t('pages.yml は facility-secret-check.mjs を --github で呼び、別の判定を持たない', /node check\/facility-secret-check\.mjs --github facility-profile\.json/.test(Y) && !/json\.load\(open\('facility-profile\.json'/.test(Y));
  t('道具は公開リポジトリに入る（.gitignore の許可にある）', /^!\/check\/facility-secret-check\.mjs$/m.test(read('.gitignore')));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
