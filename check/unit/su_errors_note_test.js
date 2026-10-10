/* su-errors.js の note（画面に出さない記録）と、それを使う3画面（体重・週間計画・入居者マスタ）の検証
   （2026-10-08・監査10月版 #8・本人決定 4a 5a）。実物の su-errors.js を vm で動かし、画面は HTML から読む。

   守りたいこと:
   1. note はトースト・帯を出さない。コンソール（warn）と onReport の記録先（同期ログ・不具合報告）には渡す
   2. note の間引きは組み合わせごと（交互に起きても同じものは30秒に1回）。report の動き（トーストを出す）は変えない
   3. 3画面とも、記録の口（wrNote_・csNote_・rmNote_）を su-errors.js の直後＝ほかのどの script より先に定義する
      （起動中の catch から呼んでも未定義で落ちない）。note が無い古いキャッシュでも例外を出さない
   4. 置き換えた catch は、捕まえた例外をそのまま渡す（別の変数名を渡して未定義にしない） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-errors.js'), 'utf8');

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}

function load(opt) {
  opt = opt || {};
  let now = 1000000;
  const log = { warn: [], error: [], toast: [], banner: 0 };
  const win = {
    addEventListener() {},
    showToast: opt.noToast ? undefined : (m) => log.toast.push(m)
  };
  const ctx = {
    window: win,
    document: {
      body: { appendChild() { log.banner++; } },
      head: { appendChild() {} },
      createElement: () => ({ setAttribute() {}, remove() {} }),
      querySelector: () => null,
      addEventListener() {}
    },
    console: { warn: (m) => log.warn.push(m), error: (m) => log.error.push(m), log() {} },
    Date: { now: () => now },
    setTimeout: () => 0, clearTimeout() {},
    String, Object
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'su-errors.js' });
  return { S: win.SUErrors, log, tick: ms => { now += ms; } };
}

console.log('\n— 1. note は画面に出さず、記録先には渡す —');
{
  const E = load();
  const got = [];
  E.S.onReport((k, b, w) => got.push([k, b, w]));
  E.S.note('保存・同期の失敗', new Error('QuotaExceededError: setItem'), 'weight:未送信の控え');
  t('トーストを出さない', E.log.toast.length === 0, E.log.toast);
  t('自前の帯も出さない', E.log.banner === 0, E.log.banner);
  t('コンソールには warn で残す（error ではない）', E.log.warn.length === 1 && /weight:未送信の控え/.test(E.log.warn[0]) && E.log.error.length === 0, E.log);
  t('記録先（onReport）に種類・要約・場所が渡る', got.length === 1 && got[0][0] === '保存・同期の失敗' && /QuotaExceeded/.test(got[0][1]) && got[0][2] === 'weight:未送信の控え', got);
  const E2 = load({ noToast: true });
  E2.S.note('x', 'y', 'z');
  t('画面にトーストが無くても帯を作らない', E2.log.banner === 0, E2.log.banner);
}

console.log('\n— 2. 間引きは組み合わせごと・report は今までどおり —');
{
  const E = load();
  const got = [];
  E.S.onReport((k, b, w) => got.push(w));
  E.S.note('k', 'm', 'A'); E.S.note('k', 'm', 'B'); E.S.note('k', 'm', 'A'); E.S.note('k', 'm', 'B');
  t('A・B が交互に起きても、それぞれ1回ずつ', got.join() === 'A,B', got);
  E.tick(31000);
  E.S.note('k', 'm', 'A');
  t('30秒過ぎれば同じものもまた残す', got.join() === 'A,B,A', got);
  const R = load();
  R.S.report('スクリプトエラー', 'TypeError: x', 'a.html:1');
  t('report は今までどおりトーストを出す', R.log.toast.length === 1 && R.log.error.length === 1, R.log);
  const B = load();
  const got2 = [];
  B.S.note('k', 'm', 'early');
  B.S.onReport((k, b, w) => got2.push(w));
  t('登録より前の note も、登録した時に渡す（起動中の失敗も自動報告に載る）', got2.join() === 'early', got2);
  let threw = false;
  try { const N = load(); N.S.note(); N.S.note(null, null, null); } catch (e) { threw = true; }
  t('引数が無くても例外を出さない', !threw, threw);
  const M = load();
  const got3 = [];
  M.S.onReport((k, b, w) => got3.push(w));
  for (let i = 0; i < 260; i++) M.S.note('k', 'm', 'w' + i);
  t('組み合わせの控えは増え続けない（200件で作り直す）・その間も記録は止めない', got3.length === 260, got3.length);
}

console.log('\n— 2b. 要約は例外の名前つき・引用符の中（データの断片）は伏せる・起動エラーを押し出さない —');
{
  const E = load();
  const got = [];
  E.S.onReport((k, b, w) => got.push(b));
  const q = new Error("Failed to execute 'setItem' on 'Storage': Setting the value of 'x' exceeded the quota."); q.name = 'QuotaExceededError';
  E.S.note('保存・同期の失敗', q, 'care:本体の保存');
  t('例外の名前（QuotaExceededError）が要約の頭に付く', /^QuotaExceededError: /.test(got[0] || ''), got[0]);
  let pe = null; try { JSON.parse('{"name":"試験太郎","x":}'); } catch (e) { pe = e; }
  E.S.note('保存・同期の失敗', pe, 'care:端末の控えからの復元');
  t('JSON の読み込み失敗の文に入るデータの断片は伏せる', got[1] && !/試験太郎/.test(got[1]) && /SyntaxError/.test(got[1]), got[1]);
  t('コンソールにも伏せた要約だけが出る', !E.log.warn.some(w => /試験太郎/.test(w)), E.log.warn);
  const B = load();
  B.S.report('スクリプトエラー', 'TypeError: boot', 'a.html:1');
  for (let i = 0; i < 8; i++) B.S.note('保存・同期の失敗', 'x', 'care:n' + i);
  const late = [];
  B.S.onReport((k, b, w) => late.push(k + '|' + w));
  t('登録が遅くても、起動時の本物のエラーは note に押し出されずに渡る', late.indexOf('スクリプトエラー|a.html:1') >= 0, late);
  t('登録前の note は直近3件だけ渡る', late.filter(x => /^保存・同期の失敗/.test(x)).length === 3, late);
}

console.log('\n— 2c. 不具合報告（su-report.js）に場所と種類が残る・note は1回の表示で1件だけ自動で送る —');
{
  const RS = fs.readFileSync(path.join(ROOT, 'su-report.js'), 'utf8');
  const cutF = (name) => { const h = RS.indexOf('function ' + name + '('); let i = RS.indexOf('{', h), d = 0; for (; i < RS.length; i++) { if (RS[i] === '{') d++; else if (RS[i] === '}') { d--; if (d === 0) return RS.slice(h, i + 1); } } };
  const box = { String };
  vm.createContext(box);
  vm.runInContext([cutF('errType'), cutF('cleanWhere')].join('\n'), box);
  t('note の場所（画面:何の書き込み）はそのまま残る', box.cleanWhere('care:未送信の印') === 'care:未送信の印' && box.cleanWhere('weight:未送信の控え') === 'weight:未送信の控え', [box.cleanWhere('care:未送信の印')]);
  t('従来の「ファイル名:行」も今までどおり（クエリは落とす）', box.cleanWhere('weight-record.html?masterId=3:120') === 'weight-record.html:120' || box.cleanWhere('weight-record.html:120') === 'weight-record.html:120', box.cleanWhere('weight-record.html:120'));
  t('場所に記号・空白・長すぎる値が混ざれば note の形とみなさない', box.cleanWhere('care:a b') === '' && box.cleanWhere('care:' + 'x'.repeat(50)) === '' && box.cleanWhere('care:"x"') === '', '');
  t('種類は QuotaExceededError のように残る', box.errType('QuotaExceededError: …') === 'QuotaExceededError', box.errType('QuotaExceededError: …'));
  /* autoSend を実物で動かす（送信は数えるだけ） */
  const sent = [];
  const ab = { String, Date, JSON, Object, FILE: 'care-schedule.html', AUTO_LS: 'k', AUTO_GAP_MS: 1800000, AUTO_MAX_PER_LOAD: 10,
    autoSent: 0, NOTE_KIND: '保存・同期の失敗', autoNoteSent: 0,
    localStorage: { getItem() { return null; }, setItem() { throw new Error('quota'); } },
    endpoint: () => 'https://example.invalid/exec', composeAuto: (ty, w) => ty + '|' + w,
    post: (u, b) => { sent.push(b); return { then() {} }; } };
  vm.createContext(ab);
  vm.runInContext([cutF('errType'), cutF('cleanWhere'), cutF('autoThrottled'), cutF('autoSend')].join('\n'), ab);
  ['本体の保存', '書き手の印', '指紋', '未送信の印'].forEach(w => ab.autoSend('保存・同期の失敗', 'QuotaExceededError: x', 'care:' + w));
  ab.autoSend('スクリプトエラー', 'TypeError: y', 'care-schedule.html:10');
  t('容量いっぱいでも note の自動送信は1件だけ', sent.filter(x => /保存・同期の失敗/.test(x)).length === 1, sent);
  t('その後の本物のスクリプトエラーは送られる', sent.some(x => /スクリプトエラー：TypeError\|care-schedule\.html:10/.test(x)), sent);
  /* 手動の報告に載る控え：note は別の控え（3件）に入り、本物のエラー（5件の控え）を押し出さない */
  const pb = { String, ERRORS: [], NOTES: [] };
  vm.createContext(pb);
  vm.runInContext(cutF('pushErr'), pb);
  pb.pushErr('スクリプトエラー：TypeError @care-schedule.html:10');
  for (let i = 0; i < 8; i++) pb.pushErr('保存・同期の失敗：QuotaExceededError @care:n' + i, pb.NOTES, 3);
  t('手動の報告の控え：本物のエラーは note に押し出されない・note は3件まで', pb.ERRORS.length === 1 && pb.NOTES.length === 3, [pb.ERRORS, pb.NOTES]);
  t('onReport の受け口は note を NOTES へ、それ以外を ERRORS へ振り分ける', /if \(String\(kind\) === NOTE_KIND\) pushErr\(line, NOTES, 3\); else pushErr\(line\);/.test(RS), '');
  t('送る note には場所と種類が入る', /保存・同期の失敗：QuotaExceededError\|care:本体の保存/.test(sent[0] || ''), sent[0]);
}

console.log('\n— 3. 3画面の記録の口と置き換え —');
const PAGES = [
  ['weight-record.html', 'wrNote_', 'weight', 15],
  ['care-schedule.html', 'csNote_', 'care', 41],   // 2026-10-10 直した人の印・基準の4か所を足した
  ['resident-master.html', 'rmNote_', 'master', 9]
];
for (const [file, fn, tag, want] of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const tagAt = html.indexOf('<script src="su-errors.js?v=2026-10-08"></script>');
  const defAt = html.indexOf('function ' + fn + '(');
  const firstOther = (() => {
    const re = /<script\b[^>]*>/g; let m;
    const bare = html.replace(/<!--[\s\S]*?-->/g, c => ' '.repeat(c.length));   // 注釈の中の「<script>」の文字は数えない（位置はそのまま）
    while ((m = re.exec(bare))) {
      if (m.index === tagAt) continue;
      if (m.index > tagAt && m.index < defAt) continue;   // 記録の口を定義している script そのもの
      return m.index;
    }
    return -1;
  })();
  t(file + ': su-errors.js を新しい版（?v=2026-10-08）で読む', tagAt > 0 && html.indexOf('su-errors.js?v=2026-10-04') < 0, tagAt);
  t(file + ': 記録の口を su-errors.js の直後、ほかのどの script より先に定義', defAt > tagAt && defAt - tagAt < 800 && (firstOther < 0 || firstOther > defAt), [tagAt, defAt, firstOther]);
  /* 実物の記録の口を切り出して動かす */
  const line = html.slice(defAt, html.indexOf('\n', defAt));
  const calls = [];
  const box = { window: { SUErrors: { note: (k, e, w) => calls.push([k, e && e.message, w]) } } };
  vm.createContext(box);
  vm.runInContext(line, box);
  box[fn]('未送信の控え', new Error('boom'));
  t(file + ': 記録の口は note に「保存・同期の失敗」と画面名つきの場所を渡す', calls.length === 1 && calls[0][0] === '保存・同期の失敗' && calls[0][1] === 'boom' && calls[0][2] === tag + ':未送信の控え', calls);
  const old = { window: { SUErrors: { report() {} } } };
  vm.createContext(old);
  vm.runInContext(line, old);
  let threw = false;
  try { old[fn]('x', new Error('y')); } catch (e) { threw = true; }
  const none = { window: {} };
  vm.createContext(none);
  vm.runInContext(line, none);
  try { none[fn]('x', new Error('y')); } catch (e) { threw = true; }
  t(file + ': note が無い古い su-errors.js・su-errors.js が無い時も例外を出さない', !threw, threw);
  const sites = html.match(new RegExp('catch\\s*\\((\\w+)\\)\\{ ' + fn + "\\('[^']+', (\\w+)\\); \\}", 'g')) || [];
  const bad = sites.filter(s => { const m = s.match(new RegExp('catch\\s*\\((\\w+)\\)\\{ ' + fn + "\\('[^']+', (\\w+)\\)")); return !m || m[1] !== m[2]; });
  t(file + ': 置き換えた catch は ' + want + ' か所・捕まえた例外をそのまま渡す', sites.length === want && bad.length === 0, [sites.length, bad]);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
