/* 勤怠の「資格の失効の警告」の純関数（kintai-cert-calc.js）と画面の組み込み（kintai-cert.js・kintai.js・kintai.html）の試験（2026-11-25 新設・統合 0134）
   実行: node check/unit/kintai_cert_test.js
   守りたいこと:
     1. 入り切り: certAlert が true の時だけ入（既定は切）
     2. 種類の掃除（cleanKinds・checkKind）: 鍵が無い時は既定の一覧（介護支援専門員証は期限あり・5年）・形の違う行・重なり・30件まで・止めた種類
     3. 判定の境目（judgeOne）: 91日前はなし・90日前は注意・31日前は注意・30日前は要対応・期限の日は「今日まで」の要対応・次の日は期限切れ・
        期限の要る種類で期限が無いと注意・期限の要らない種類で期限が無いとなし・設定で変えた日数で効く
     4. 全体（judge・box）: 止めた職員と止めた種類・設定に無い種類は数えない・人数はいちばん重い段で数える・並び（重い→近い→未入力）
     5. 入力の確かめ（checkCert）は DB の kintai_cert_put と同じ決まり・期限の目安（suggestExpiry）・設定の大きさ（UTF-8 で 8192 バイト）
     6. 画面の組み込み: kintai.html が kintai.js の前に読む・タブのボタンを HTML に置かない・切の時はタブと箱を出さず関数を呼ばない・
        端末に残さない（localStorage を使わない）・kintai-calc.js と給与を読まない・資格証の写し（画像）を扱わない
   ★架空データだけ（職員は sX… の番号）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const K = require(path.join(ROOT, 'kintai-cert-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const TODAY = '2026-01-14';
const addD = (d, n) => { const x = new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000); return x.toISOString().slice(0, 10); };

console.log('— 1. 入り切り —');
t('鍵が無い・false・"true"（文字）は切／true だけ入', !K.on({}) && !K.on(null) && !K.on({ certAlert: false }) && !K.on({ certAlert: 'true' }) && K.on({ certAlert: true }));

console.log('— 2. 種類の掃除 —');
{
  const d = K.cleanKinds(undefined);
  const cm = d.items.find((k) => k.code === 'cm');
  t('鍵が無い時は既定の一覧（介護支援専門員証は期限あり・90日・30日・5年）', d.isDefault && cm && cm.name === '介護支援専門員証' && cm.exp && cm.warn === 90 && cm.urgent === 30 && cm.years === 5, cm);
  t('既定の一覧を書き換えても次の呼び出しに残らない（写しを返す）', (() => { K.cleanKinds(undefined).items[0].warn = 1; return K.cleanKinds(undefined).items[0].warn === 90; })());
  const c = K.cleanKinds([{ code: 'a', name: ' 研修A ', exp: true, warn: 60, urgent: 10, years: 3 }, { code: 'a', name: '重なり' }, { code: 'b b', name: 'x' }, { code: 'c', name: '' },
    { code: 'd', name: 'x', warn: 0 }, { code: 'e', name: 'x', warn: 30, urgent: 31 }, { code: 'f', name: 'x', years: 11 }, { code: 'g', name: 'あ'.repeat(21) }, 'x', { code: 'h', name: '止めた', active: false }]);
  t('形の違う行・重なりは外す（先勝ち）・名前の前後の空白を除く・止めた種類は残す', c.items.length === 2 && c.items[0].name === '研修A' && c.items[1].code === 'h' && c.items[1].active === false && c.bad.length === 8, c);
  t('空の配列は空（既定に戻さない）', K.cleanKinds([]).items.length === 0 && !K.cleanKinds([]).isDefault);
  const many = []; for (let i = 0; i < 35; i++) many.push({ code: 'k' + i, name: '種類' + i });
  t('30件まで', K.cleanKinds(many).items.length === 30 && K.cleanKinds(many).bad.filter((b) => b.why === 'max').length === 5);
  t('新しい印は c1・c2…（重ならない）', K.newCode([{ code: 'c1' }, { code: 'c3' }]) === 'c2');
}

console.log('— 3. 判定の境目 —');
{
  const kind = { code: 'cm', name: '介護支援専門員証', exp: true, warn: 90, urgent: 30, active: true };
  const j = (n, k) => K.judgeOne({ expires_on: addD(TODAY, n) }, k || kind, TODAY);
  t('91日前はなし', j(91).level === 'ok' && j(91).days === 91);
  t('90日前は注意', j(90).level === 'warn' && j(90).reason === 'warn');
  t('31日前は注意', j(31).level === 'warn');
  t('30日前は要対応', j(30).level === 'alert' && j(30).reason === 'urgent');
  t('期限の日は要対応（今日まで・まだ切れていない）', j(0).level === 'alert' && j(0).reason === 'urgent' && j(0).days === 0);
  t('期限の次の日は期限切れ', j(-1).level === 'alert' && j(-1).reason === 'expired' && j(-1).days === -1);
  t('期限の要る種類で期限が無いと注意（未入力）', K.judgeOne({ expires_on: null }, kind, TODAY).reason === 'noexp' && K.judgeOne({}, kind, TODAY).level === 'warn');
  t('期限の要らない種類で期限が無いとなし', K.judgeOne({ expires_on: null }, Object.assign({}, kind, { exp: false }), TODAY).level === 'ok');
  t('期限の要らない種類でも期限を入れてあれば判定する', K.judgeOne({ expires_on: addD(TODAY, -3) }, Object.assign({}, kind, { exp: false }), TODAY).reason === 'expired');
  const k2 = Object.assign({}, kind, { warn: 60, urgent: 0 });
  t('設定の日数で効く（注意60日・要対応は期限の日から）', j(61, k2).level === 'ok' && j(60, k2).level === 'warn' && j(1, k2).level === 'warn' && j(0, k2).level === 'alert');
  t('壊れた日付は期限なし扱い（2月30日）', K.judgeOne({ expires_on: '2026-02-30' }, kind, TODAY).reason === 'noexp');
}

console.log('— 4. 全体と箱 —');
{
  const staff = [{ staff_id: 'sX1', name: '架空 一', active: true }, { staff_id: 'sX2', name: '架空 二', display_name: '架空 ふた', active: true }, { staff_id: 'sX3', name: '架空 三', active: false }];
  const kinds = K.kindsOf({ certKinds: [{ code: 'cm', name: '介護支援専門員証', exp: true }, { code: 'car', name: '運転免許', exp: true }, { code: 'old', name: '止めた資格', exp: true, active: false }] });
  const certs = [
    { id: '1', staff_id: 'sX1', code: 'cm', expires_on: addD(TODAY, 80), rev: 1 },
    { id: '2', staff_id: 'sX1', code: 'car', expires_on: addD(TODAY, -2), rev: 1 },
    { id: '3', staff_id: 'sX2', code: 'cm', expires_on: null, rev: 1 },
    { id: '4', staff_id: 'sX2', code: 'car', expires_on: addD(TODAY, 40), rev: 1 },
    { id: '5', staff_id: 'sX3', code: 'cm', expires_on: addD(TODAY, -100), rev: 1 },
    { id: '6', staff_id: 'sX2', code: 'old', expires_on: addD(TODAY, -5), rev: 1 },
    { id: '7', staff_id: 'sX2', code: 'gone', expires_on: addD(TODAY, -5), rev: 1 },
    { id: '8', staff_id: 'sX9', code: 'cm', expires_on: addD(TODAY, -5), rev: 1 }
  ];
  const r = K.judge(staff, certs, kinds, TODAY);
  t('数えるのは使っている職員・使っている種類だけ（資格4件）', r.counts.alert === 1 && r.counts.warn === 3, r.counts);
  t('人数はいちばん重い段で数える（一＝要対応・ふた＝注意）', r.people.alert === 1 && r.people.warn === 1, r.people);
  t('止めた職員・止めた種類・設定に無い種類・名簿に無い人も一覧には出す（数えない）', r.rows.length === 8 && r.rows.filter((x) => !x.counted).length === 4);
  const hit = r.rows.filter((x) => x.counted).map((x) => x.id);
  t('並び: 要対応→注意の近い順→期限が未入力', JSON.stringify(hit) === JSON.stringify(['2', '4', '1', '3']), hit);
  t('表示名を使う・設定に無い種類はそう書く', r.rows.find((x) => x.id === '3').name === '架空 ふた' && /設定に無い種類/.test(r.rows.find((x) => x.id === '7').kindName));
  t('文: 期限切れ（N日過ぎ）・あとN日・期限が未入力', /期限切れ（2日過ぎ/.test(r.rows.find((x) => x.id === '2').text) && /^あと40日/.test(r.rows.find((x) => x.id === '4').text) && r.rows.find((x) => x.id === '3').text === '期限が未入力');
  const b = K.box(r);
  t('箱: 人数2・段は要対応・行は4件（名前と資格と文）', b.key === 'cert' && b.count === 2 && b.level === 'alert' && b.rows.length === 4 && b.rows[0].name === '架空 一' && /運転免許 期限切れ/.test(b.rows[0].text), b);
  const b0 = K.box(K.judge(staff, [], kinds, TODAY));
  t('箱: 何も無い時は0人・なし・注記', b0.count === 0 && b0.level === 'ok' && /ありません/.test(b0.note));
  t('形の違う記録は読み飛ばす（例外を出さない）', K.judge(staff, [null, 'x', { staff_id: 'sX1' }, { code: 'cm' }], kinds, TODAY).rows.length === 0);
}

console.log('— 5. 入力の確かめ・目安・大きさ —');
{
  const ok = (x) => K.checkCert(Object.assign({ code: 'cm' }, x), TODAY);
  t('全部空（種類だけ）は通る・メモの空白だけは null', ok({}).val && ok({ note: '　 ' }).val.note === null);
  t('種類の印の形', K.checkCert({ code: '' }, TODAY).why === 'code' && K.checkCert({ code: 'a'.repeat(25) }, TODAY).why === 'code' && !!K.checkCert({ code: 'a'.repeat(24) }, TODAY).val);
  t('取得日は今日まで・1950年から', ok({ acquired_on: addD(TODAY, 1) }).why === 'acquired' && ok({ acquired_on: '1949-12-31' }).why === 'acquired' && !!ok({ acquired_on: TODAY }).val);
  t('期限は20年（7300日）先まで・取得日より前は不可・同じ日は可', ok({ expires_on: addD(TODAY, 7301) }).why === 'expires' && !!ok({ expires_on: addD(TODAY, 7300) }).val && ok({ acquired_on: '2025-05-02', expires_on: '2025-05-01' }).why === 'order' && !!ok({ acquired_on: '2025-05-01', expires_on: '2025-05-01' }).val);
  t('メモは100字まで・改行とタブは不可', ok({ note: 'あ'.repeat(101) }).why === 'note' && ok({ note: 'あ\nい' }).why === 'note' && ok({ note: 'あ\tい' }).why === 'note' && !!ok({ note: 'あ'.repeat(100) }).val);
  t('期限の目安: 取得日＋年の前の日（5年）', K.suggestExpiry('2021-04-01', 5) === '2026-03-31' && K.suggestExpiry('2024-02-29', 1) === '2025-02-28' && K.suggestExpiry('2021-04-01', 0) === '' && K.suggestExpiry('', 5) === '');
  const HOL = require(path.join(ROOT, 'kintai-holiday.js'));
  const big = { legal_holiday: 0, certAlert: true, certKinds: K.DEFAULT_KINDS, companyHolidays: [{ date: '2026-12-29', to: '2027-01-03', name: '年末年始', office: '', active: true }] };
  t('設定の大きさは DB の jsonb の数え方で見積もる（kintai-holiday.js の jsonbBytes と同じ数・JSON の文字より大きい）', K.byteLen('あa') === 4 && K.jsonbBytes(big) === HOL.jsonbBytes(big) && K.jsonbBytes(big) > K.byteLen(JSON.stringify(big)), [K.jsonbBytes(big), HOL.jsonbBytes(big)]);
  t('余白 256 バイトを残す（7936 まで通す・それを超えると断る）', (() => { const pad = (n) => ({ x: 'a'.repeat(n) }); let n = 0; while (K.jsonbBytes(pad(n + 1)) <= 8192 - 256) n++; return K.fitsConfig(pad(n)) && !K.fitsConfig(pad(n + 1)) && K.jsonbBytes(pad(n)) === 7936; })());
  t('既定の一覧を全部入れても設定の大きさに十分収まる（2KB 未満）', K.byteLen(JSON.stringify({ certKinds: K.DEFAULT_KINDS })) < 2048);
}

console.log('— 6. 画面の組み込み —');
{
  const H = read('kintai.html'), J = read('kintai.js'), V = read('kintai-cert.js'), CC = read('kintai-cert-calc.js');
  const iC = H.indexOf('kintai-cert-calc.js?v='), iV = H.indexOf('kintai-cert.js?v='), iJ = H.indexOf('kintai.js?v=');
  t('kintai.html は kintai-cert-calc.js → kintai-cert.js → kintai.js の順に ?v= つきで読む', iC > 0 && iV > iC && iJ > iV);
  t('タブのボタンを HTML に置かない（切の時は今の画面のまま）', !/data-tab="cert"/.test(H));
  t('kintai.js: TABS の社保の後に cert（代替休暇の daitai は cert の後）・切や部品が無い時はホームへ', /'shaho', 'cert'(?:, 'daitai')?\];/.test(J) && /if \(tab === 'cert' && data && !\(\(typeof CT !== 'undefined' && CT\) && CT\.on\(rawCfg\(\)\)\)\) tab = 'home';/.test(J));
  t('kintai.js: 部品が無い時は何もしない（CT はすべて typeof で確かめる）', (J.match(/\bCT\./g) || []).length > 0 && !/[^.\w]CT\s*&&|if \(CT\)|\bCT \?/.test(J.replace(/\(typeof CT !== 'undefined' && CT\)/g, '')));
  t('部品: 切の時は箱を出さず読みに行かない（homeBox の頭で on を見る）', /function homeBox\(ctx, boxHtml, waitBox\) \{\s*if \(!on\(ctx\.cfg\(\)\)\) return '';\s*load\(ctx, false\);/.test(V));
  t('部品: タブは入の時だけ足す', /if \(isOn && !b\)/.test(V) && /else if \(!isOn && b\) \{ b\.parentNode\.removeChild\(b\)/.test(V));
  t('部品: 関数が無い（noDb）時は1回だけ読み、不具合の記録に残さない', /if \(busy \|\| noDb \|\|/.test(V) && /if \(nd\) noDb = true; else if/.test(V));
  t('端末に残さない（localStorage・sessionStorage を使わない）', !/localStorage|sessionStorage|lsSet/.test(V) && !/localStorage|sessionStorage/.test(CC));
  t('console を使わない', !/console\./.test(V) && !/console\./.test(CC));
  const code = (V + CC).replace(/\/\*[\s\S]*?\*\//g, '');   /* 注記を除いたコード */
  t('kintai-calc.js・給与を読まない・資格証の写し（画像・ファイル）を扱わない', !/KintaiCalc|payroll|Payroll|kintai-calc/.test(code) && !/type="file"|FileReader|<img/.test(V));
  t('innerHTML を部品の中で使わない（文を返すだけ）', !/innerHTML/.test(V + CC));
  t('設定の保存に certAlert を入れる・切のまま鍵が無ければ作らない', /\.concat\(cts \? cts\.keys : \[\]\)/.test(J) && /if \(cts\) for \(k in cts\.vals\) outCfg\[k\] = cts\.vals\[k\];/.test(V.length ? J : '') && /else if \(cfg && Object\.prototype\.hasOwnProperty\.call\(cfg, 'certAlert'\)\) vals\.certAlert = false;/.test(V));
  t('種類の保存は送る前に設定の大きさを確かめる・ほかの鍵を残す', /if \(!K\.fitsConfig\(out\)\)/.test(V) && /for \(k in cfg\) if \(Object\.prototype\.hasOwnProperty\.call\(cfg, k\)\) out\[k\] = cfg\[k\];/.test(V));
  t('反証レビュー 2026-11-25: 上の「読み直す」（drop）で関数の有無を確かめ直す・2000件を超えた時は帯・取得日と種類の欄では全体を描き直さない・書きかけの確かめは種類の欄を全部見る・止めた職員と名簿に無い人も選べる・失敗した時は書きかけも捨てる・成功の後は送った職員の時だけ消す',
    /function drop\(\) \{ st = null; gen\+\+; busy = false; noDb = false; \}/.test(V) && /if \(st\.more\)/.test(V) && /if \(id === 'ct-code' \|\| id === 'ct-acq'\) \{ keep\(e\); hintNow\(ctx\); return true; \}/.test(V)
    && /Object\.keys\(kdraft\)\.length\); \}/.test(V) && /optgroup label="数えていない人"/.test(V) && /e\.kintai === 'notfound'\)\) \{ clearDraft\(\);/.test(V) && /if \(selSid === sid0\) clearDraft\(\);/.test(V));
  t('DB と同じ断りの語を職員向けの文に置き換える（notfound・conflict・exists・baddate・badvalue・badcode・toomany）', ['notfound', 'conflict', 'exists', 'baddate', 'badvalue', 'badcode', 'toomany'].every((w) => new RegExp(w + ": '").test(V)));
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
