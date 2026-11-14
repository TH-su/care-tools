/* su_health_test.js — 本番の健康（2026-11-14 代表者の依頼・統合 0088）
   実行: node check/unit/su_health_test.js
   守ること:
     1. 判定（su-health-calc.js の judge）: 切り替えた後（live）の種類で、直近24時間の失敗が5件以上（5件ちょうどを含む）か、
        写し返しの残りのいちばん古いものが2時間以上前（2時間ちょうどを含む）の時だけ知らせる。4件・1時間59分は知らせない
     2. 残りが0件なら遅れは無い（最後の写し返しが古くても知らせない）。写しの期間・まだ切り替えていない種類は知らせない
     3. 答えが無い・形が違う・種類が欠けた時は「確かめられません」で、健康とも言わず知らせもしない。体重の端末の写し返しは遅れを確かめられない
     4. 理由の振り分け（su-health.js の reasonOf）: login・perm・timeout・other。切り替える前・競合の断りは数えない（null）
     5. メニューの札（tileBadges）は種類の画面のタイルにまとめる（添付書類は持ち主の画面）。文は数と時間だけ
     6. 出す行の項目は決まった名前だけ（答えに氏名らしい項目が混ざっても出ない）
     7. 8つの保存の入口と、保存する画面・メニュー・写しの見比べが部品をつないでいる
   ★値はすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'su-health-calc.js'));
const H = require(path.join(ROOT, 'su-health.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

const NOW = Date.parse('2026-11-14T03:00:00Z');
const MIN = 60000, HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();
function row(kind, o) {
  return Object.assign({ kind, mode: 'live', ok: 10, fails: {}, pending: 0, oldest_pending_at: null,
                         last_mirror_at: iso(NOW - 30 * MIN), last_kind: 'ack', mirror_seen: true }, o || {});
}
function resp(over) {
  const rows = C.KINDS.map((k) => row(k, (over || {})[k]));
  return { ok: true, now: iso(NOW), rows };
}
const get = (v, k) => v.rows.find((x) => x.kind === k);

console.log('1. 失敗の数のしきい値');
{
  const v = C.judge(resp({ res: { fails: { login: 2, timeout: 2 } }, stf: { fails: { login: 2, perm: 1, timeout: 1, other: 1 } } }), NOW);
  t('4件は知らせない', get(v, 'res').failAlert === false && get(v, 'res').failTotal === 4, get(v, 'res'));
  t('5件ちょうどは知らせる', get(v, 'stf').failAlert === true && get(v, 'stf').failTotal === 5, get(v, 'stf'));
  t('理由ごとの数を返す', JSON.stringify(get(v, 'stf').fails) === JSON.stringify({ login: 2, perm: 1, timeout: 1, other: 1 }));
  t('知らせる種類は1つ（職員マスタ）', v.alerts.length === 1 && v.alerts[0].kind === 'stf', v.alerts);
}

console.log('2. 写し返しの遅れのしきい値');
{
  const v = C.judge(resp({
    res: { pending: 3, oldest_pending_at: iso(NOW - (2 * HOUR - MIN)) },
    tp: { pending: 1, oldest_pending_at: iso(NOW - 2 * HOUR) },
    adm: { pending: 0, oldest_pending_at: null, last_mirror_at: iso(NOW - 30 * HOUR) }
  }), NOW);
  t('1時間59分は知らせない', get(v, 'res').lagAlert === false && get(v, 'res').lagMs === 2 * HOUR - MIN);
  t('2時間ちょうどは知らせる', get(v, 'tp').lagAlert === true);
  t('残りが0件なら最後の写し返しが30時間前でも知らせない（夜に保存が無いだけ）', get(v, 'adm').lagAlert === false && get(v, 'adm').lagMs === 0);
  t('遅れの文: 2時間 / 1時間59分 / 45分', C.lagText(2 * HOUR) === '2時間' && C.lagText(2 * HOUR - MIN) === '1時間59分' && C.lagText(45 * MIN) === '45分');
}

console.log('3. 切り替え前・確かめられない時');
{
  const v = C.judge(resp({ sa: { mode: 'shadow', fails: { other: 9 }, pending: 5, oldest_pending_at: iso(NOW - 9 * HOUR) },
                           geno: { mode: null, mirror_seen: false, pending: 0 },
                           weight: { mirror_seen: false, pending: null, fails: {} } }), NOW);
  t('写しの期間は失敗9件・遅れ9時間でも知らせない', get(v, 'sa').state === 'shadow' && !get(v, 'sa').failAlert && !get(v, 'sa').lagAlert);
  t('印の無い種類は none', get(v, 'geno').state === 'none' && !get(v, 'geno').lagKnown);
  t('体重の端末の写し返しは遅れを確かめられない（知らせない）', get(v, 'weight').lagKnown === false && get(v, 'weight').lagAlert === false);
  t('答えが null なら全部「確かめられません」・知らせない',
    (() => { const x = C.judge(null, NOW); return x.ok === false && x.rows.length === 10 && x.rows.every((r) => r.state === 'unknown') && x.alerts.length === 0; })());
  t('ok が true でない答えは確かめられない', C.judge({ ok: false, rows: [] }, NOW).ok === false);
  t('種類が欠けた答えは、その種類だけ確かめられない',
    (() => { const r = resp(); r.rows = r.rows.filter((x) => x.kind !== 'doc_adm'); const x = C.judge(r, NOW); return x.ok && get(x, 'doc_adm').state === 'unknown' && get(x, 'res').state === 'live'; })());
  t('数が負・小数・文字の行は確かめられない（健康と言わない）',
    ['-1', 1.5, '3'].every((bad) => get(C.judge(resp({ res: { ok: bad } }), NOW), 'res').state === 'unknown'));
  t('知らない理由の名前が入った行は確かめられない', get(C.judge(resp({ res: { fails: { name: 3 } } }), NOW), 'res').state === 'unknown');
  t('残りがあるのにいちばん古い時刻が無い行は確かめられない', get(C.judge(resp({ res: { pending: 2, oldest_pending_at: null } }), NOW), 'res').state === 'unknown');
  t('時刻が読めない行は確かめられない', get(C.judge(resp({ res: { last_mirror_at: 'きのう' } }), NOW), 'res').state === 'unknown');
  t('今の時刻を渡さない時は答えの now を使う', C.judge(resp({ tp: { pending: 1, oldest_pending_at: iso(NOW - 3 * HOUR) } })).rows[1].lagAlert === true);
}

console.log('4. 理由の振り分け');
{
  const r = H.reasonOf;
  t('時間切れ・届かない → timeout', r({ timeout: true }) === 'timeout' && r({ network: true }) === 'timeout');
  t('ログイン（code login・signed_out・401・PGRST301）→ login', ['login', 'signed_out'].every((c) => r({ code: c }) === 'login') && r({ status: 401 }) === 'login' && r({ pg: 'PGRST301' }) === 'login');
  t('権限（code role・denied・403・42501）→ perm', ['role', 'denied'].every((c) => r({ code: c }) === 'perm') && r({ status: 403 }) === 'perm' && r({ pg: '42501' }) === 'perm');
  t('受け口のそのほかの断り（db・gas・busy・size）→ other', ['db', 'gas', 'busy', 'size', ''].every((c) => r({ code: c }) === 'other'));
  t('切り替える前・競合（shadow・files_google・missing・stale・conflict）は数えない',
    ['shadow', 'files_google', 'missing', 'stale', 'conflict'].every((c) => r({ code: c }) === null));
  t('様子が無い時は other', r(null) === 'other' && r({}) === 'other');
}

console.log('5. メニューの札');
{
  const v = C.judge(resp({ stf: { fails: { other: 3 } }, doc_stf: { fails: { login: 4 }, pending: 1, oldest_pending_at: iso(NOW - (3 * HOUR + 5 * MIN)) },
                           weight: { fails: { timeout: 6 } } }), NOW);
  const b = C.tileBadges(v);
  t('添付書類（職員マスタ）は失敗4件だが遅れで知らせる', b['staff-master.html'] === '写し返しが3時間5分遅れ', b);
  t('体重は失敗6件の札', b['weight-record.html'] === '保存の失敗6件（24時間）', b);
  t('知らせが無いタイルには出ない', Object.keys(b).length === 2, b);
  t('確かめられない時は札を出さない', JSON.stringify(C.tileBadges(C.judge(null, NOW))) === '{}');
}

console.log('6. 出す項目');
{
  const r = resp({ res: { name: '見本 一郎', email: 'x@example.invalid' } });
  const v = C.judge(r, NOW);
  const keys = new Set(['kind', 'label', 'state', 'ok', 'fails', 'failTotal', 'pending', 'lagMs', 'lagKnown', 'lastMirrorMs', 'lastKind', 'failAlert', 'lagAlert']);
  t('行の項目は決まった名前だけ', v.rows.every((x) => Object.keys(x).every((k) => keys.has(k))), Object.keys(get(v, 'res')));
  t('判定の結果に氏名・メールが出ない', !/見本|example/.test(JSON.stringify(v)));
}

console.log('7. つなぎ');
{
  const hooks = { 'su-res-read.js': "SUHealth.fail('res'", 'su-data-supabase.js': "training: 'tp', admission: 'adm'", 'su-stf.js': "SUHealth.fail('stf'",
                  'su-sup.js': "SUHealth.fail('sup'", 'su-sa.js': "SUHealth.fail('sa'", 'su-geno.js': "SUHealth.fail('geno'",
                  'su-doc-live.js': "SUHealth.fail('doc_' + kind", 'su-weight-live.js': "SUHealth.fail('weight'" };
  Object.keys(hooks).forEach((f) => t(f + ' が失敗を数える', read(f).includes(hooks[f])));
  ['resident-master', 'admission-flow', 'care-meeting', 'care-schedule', 'training-plan', 'staff-master', 'ats', 'supplies', 'genogram', 'weight-record']
    .forEach((p) => t(p + '.html が su-health.js を読む', /<script src="su-health\.js\?v=2026-11-14"><\/script>/.test(read(p + '.html'))));
  const idx = read('index.html');
  t('メニューが判定と札の部品を読み、組み立て直した後に付け直す',
    idx.includes('<script src="su-health-calc.js?v=2026-11-14"></script>') && idx.includes('<script src="su-health-badge.js?v=2026-11-14"></script>') && /staleApply\(\);\s*hlApply\(\);/.test(idx));
  const sc = read('shadow-check.html'), sj = read('shadow-check.js');
  t('写しの見比べが判定の部品を読み、管理者だけに表を出す',
    sc.includes('<script src="su-health-calc.js?v=2026-11-14"></script>') && sc.includes('id="hl-box" hidden') && /box\.hidden = !\(me && me\.role === 'admin'\)/.test(sj));
  const badge = read('su-health-badge.js');
  t('札は管理者だけ・現場端末では読まない・端末に書かない',
    /st\.role === 'admin'/.test(badge) && /deviceRole\(\) === 'field'/.test(badge) && !/localStorage\.setItem/.test(badge));
  const hj = read('su-health.js');
  t('控えるのは種類・理由・時刻の3つだけ', /q\.push\(\[kind, r, Date\.now\(\)\]\)/.test(hj));
  t('.gitignore に3つの部品がある', ['su-health-calc.js', 'su-health.js', 'su-health-badge.js'].every((f) => read('.gitignore').includes('!/' + f)));
}

console.log(`\n合格 ${pass} / 不合格 ${fail}`);
process.exit(fail ? 1 : 0);
