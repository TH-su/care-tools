/* 入居調整（admission-flow.html）：止めて知らせる窓を画面の中の窓（su-dialog.js）にする（2026-11-13 第6段 AF-02・代表者の指示）。
   守りたいこと:
     1. 画面の中の窓の部品を画面のスクリプトより前に読み、読めない時はブラウザの窓に落とす受け口がある
     2. 確かめの窓12か所・知らせの窓4か所は SUDialog で出し、文は一字一句変えない
     3. 残すブラウザの窓はメニュー・使い方へ移る時の2か所だけ（help_link_test が決めている）
     4. 窓の答えの後に、相手（案件・書類・編集）が変わっていたら何もしない
     5. 窓が出ている間は送り始めない・取り直さない（窓が閉じた後に回す）
     6. 同期の設定の窓の受け口の直し方（Apps Script・デプロイ）は管理者のログインの時だけ。確かめが遅れた・確かめられない時は職員向けの1文
   画面の実関数を名前で切り出して vm で動かす。外部ライブラリなし・実データなし（架空の案件だけ）。
   実行: node check/unit/admission_dialog_test.js（読む HTML は環境変数 ADM_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.ADM_HTML || path.join(__dirname, '..', '..', 'admission-flow.html');   // 直す前の HTML で落ちることを確かめる時に差し替える
const src = fs.readFileSync(HTML, 'utf8');
/* コメントを除いた本文（窓の数を数える時にコメントの中の語を数えない） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let ok = 0, ng = 0;
function t(name, cond, info) {
  if (cond) { ok++; process.stdout.write('  ✓ ' + name + '\n'); }
  else { ng++; process.stdout.write('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info)) + '\n'); }
}
function grabFn(name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) { if (src[i] === '\\') i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = (e < 0) ? src.length : e + 1; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = (e < 0) ? src.length : e; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start + 1, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 8; i++) await tick(); }

/* 画面の中の窓の代役。聞かれた文を控え、答えは試験が決める（answer）。窓の間に起きることは before で差し込む */
function makeDialog() {
  const d = { asked: [], answer: true, before: null, busy: false, idled: 0, reject: false };
  d.SUDialog = {
    confirm(m) {
      d.asked.push(String(m));
      return new Promise((res, rej) => setTimeout(() => { if (d.before) d.before(); if (d.reject) rej(new Error('窓の失敗')); else res(d.answer); }, 0));
    },
    alert(m) { d.asked.push(String(m)); return Promise.resolve(); },
    busy() { return d.busy; },
    idle() { d.idled++; return Promise.resolve(); }
  };
  return d;
}

async function run() {
  console.log('— 1. 部品と受け口 —');
  t('1-1 画面の中の窓の部品を、画面のスクリプトより前に読む（版はほかの画面と同じ）',
    /<script src="su-dialog\.js\?v=2026-11-14\.2"><\/script>\n<script>\n\/\* ═══/.test(src));
  t('1-2 読めない時の受け口がある（ブラウザの窓に落とし、約束で答える）',
    src.indexOf("if (!window.SUDialog) window.SUDialog = {\n  alert: function (m) { try { window.alert(m); }") >= 0
    && /confirm: function \(m\) \{ var r = false; try \{ r = !!window\.confirm\(m\); \}/.test(src)
    && /busy: function \(\) \{ return false; \},\n  idle: function \(\) \{ return Promise\.resolve\(\); \}/.test(src));
  t('1-3 窓の後の続きの例外は記録へ残す（afDlgNote_ が su-errors の note を呼ぶ）', /function afDlgNote_\(where, e\) \{ try \{ if \(window\.SUErrors && typeof window\.SUErrors\.note === 'function'\) window\.SUErrors\.note\('画面の中のエラー', e, 'admission:' \+ where\);/.test(src));

  console.log('— 2. 窓の数と文 —');
  const bareConfirm = (code.match(/(?<![\w.])confirm\(/g) || []).length;
  const bareAlert = (code.match(/(?<![\w.])alert\(/g) || []).length;
  t('2-1 ブラウザの確かめの窓を直接呼ぶのは、メニュー・使い方へ移る時の2か所だけ', bareConfirm === 2
    && code.indexOf("if (!confirm('保存していない変更があります。メニューへ移ると消えます。移りますか？'))") >= 0
    && code.indexOf("if (!confirm('保存していない変更があります。使い方へ移ると消えます。移りますか？'))") >= 0, bareConfirm);
  t('2-2 ブラウザの知らせの窓を直接呼ばない（受け口の window.alert だけ）', bareAlert === 0 && (code.match(/window\.alert\(/g) || []).length === 1, bareAlert);
  /* 2026-11-14（#579 の反証）: 合わせる前の控えの［消す］の確かめを足して15か所 */
  /* 2026-11-14: 上書きの確かめの「キャンセル」の後の「サーバーの内容に合わせますか」と、合わせる前の控えから戻す確かめの2か所を足した（代表者の決定 2026-11-14） */
  t('2-3 画面の中の窓で聞く所は15か所・知らせる所は4か所', (code.match(/SUDialog\.confirm\(/g) || []).length === 15 && (code.match(/SUDialog\.alert\(/g) || []).length === 4,
    [(code.match(/SUDialog\.confirm\(/g) || []).length, (code.match(/SUDialog\.alert\(/g) || []).length]);
  const TEXTS = [
    "SUDialog.confirm('バックアップ（' + (slot === CACHE_BAK ? '1世代前' : '2世代前') + '・案件' + n.candidates.length + '件）を読み込みます。\\n\\n' +\n    '今この端末にある内容（' + DB.candidates.length + '件）は消えません（統合します）。よろしいですか？')",
    "SUDialog.alert('⚠️ サーバー側の台帳が大きく減っています。\\n\\n' +\n            'この端末: ' + liveCount(DB) + '件 ／ サーバー: ' + liveCount(remote) + '件\\n\\n' +\n            'この端末の内容を消さないため、取り込みを中止しました。\\n' +\n            '心当たりが無ければ、別の端末で誤った操作が無かったかを確かめてください。');",
    "SUDialog.confirm('⚠ 案件が大きく減るため、サーバーが保存を拒否しました。\\n\\n' +\n        'サーバー: ' + j.was + ' 件 ／ この端末: ' + j.now + ' 件\\n\\n' +\n        '【この端末の画面が正しい場合】「OK」で上書きします。\\n' +\n        '【身に覚えがない場合】「キャンセル」を押し、⟳ で最新を取り直してください。')",
    "SUDialog.alert(j.error === 'toolarge'\n        ? '台帳が大きくなりすぎて保存できません。\\n\\n右上のバッジ →「⬇️ 控えのファイルに書き出す」でファイルに残したうえで、'\n          + '入居済み・見送りの古い案件を削除してください（削除しても「削除済みも表示」から戻せます）。'\n        : '送るデータが空のため、サーバーが保存を拒否しました。\\n\\n画面を再読み込みしてから、もう一度お試しください。');",
    "SUDialog.confirm('タスク「' + t.title + '」を削除しますか？\\n（「↩ 元に戻す」で戻せます）')",
    "SUDialog.confirm('「' + (c.name || 'この案件') + '」を削除しますか？\\n\\n内容は消えません。一覧の「削除済みも表示」から元に戻せます。\\n（見送りの場合は削除ではなく「見送りにする」を使ってください）')",
    "SUDialog.confirm('書類「' + nm + '」を一覧から外しますか？\\n\\nGoogle ドライブの「削除済み」フォルダへ移すだけで、実体は消えません。')",
    "SUDialog.confirm('この行を削除しますか？')",
    "SUDialog.confirm('この連携先を削除しますか？')",
    "SUDialog.confirm('保存していない入力があります。破棄してよろしいですか？')",
    "SUDialog.confirm('入居者マスタに同じお名前の方が ' + same.length + '名 登録されています（利用者No: ' +\n      same.map(function (r) { return r.id; }).join('・') + '）。\\n\\n' +\n      '別人であれば「OK」で登録を続けます。同じ方であれば「キャンセル」を押し、マスタ側で確認してください。')",
    "SUDialog.alert('お名前が入っていないため、入居者マスタへは登録できません。案件にお名前を入れてから、もう一度押してください。')",
    "SUDialog.confirm('この端末の変更を捨てて、サーバーの内容に合わせますか？\\n\\n' +\n          'この端末の内容（' + DB.candidates.length + '件）は、捨てる前に端末のバックアップ「合わせる前の控え」に残します（右上のバッジから戻せます）。\\n\\n' +\n          '【サーバーの内容に合わせる場合】「OK」\\n' +\n          '【このままにする場合】「キャンセル」（この端末の変更は送らずに残します）')",
    "SUDialog.confirm('合わせる前の控え（' + fmtDt(asStr(o.at)) + '・案件' + n.candidates.length + '件）を読み込みます。\\n\\n' +\n    '今この端末にある内容（' + DB.candidates.length + '件）は消えません（統合します）。\\n' +\n    '控えの日時より後にほかの端末で消した内容が戻ることがあります。\\n' +\n    '控えより後に直された欄は、新しい方が残ります（控えは7日間残ります）。よろしいですか？')",
    "SUDialog.confirm('合わせる前の控え（' + fmtDt(asStr(o.at)) + '・案件' + asArr(o.db.candidates).length + '件）を消しますか？\\n\\n消した控えは戻せません。')",
    "SUDialog.confirm('ファイルの ' + incoming.candidates.length + '件 を取り込みます。\\n\\n' +\n      '置き換えではなく統合します（いまの ' + DB.candidates.length + '件 は消えません）。よろしいですか？')",
    "SUDialog.alert('⚠️ この端末の保存データが読めなかったため、バックアップ（' + cacheRecovered + '）から復旧しました。\\n\\n' +\n        '案件 ' + DB.candidates.length + '件を表示しています。内容に不足があれば、⟳ でサーバーから最新を取り直してください。');"
  ];
  TEXTS.forEach((x, i) => t('2-4 文は前のまま（' + (i + 1) + '）', src.indexOf(x) >= 0, x.slice(0, 60)));
  t('2-5 「破棄して移動しますか？」は下の切り替えと新規の2か所', (src.match(/SUDialog\.confirm\('保存していない入力があります。破棄して移動しますか？'\)/g) || []).length === 2);
  t('2-6 起動の鎖を知らせの窓で止めない（バックアップから戻した知らせ・台帳が減った知らせは待たない）',
    !/await SUDialog\.alert|SUDialog\.alert\([^;]*\)\.then\(/.test(code));

  console.log('— 3. 同姓同名の確かめ（preflightDuplicate） —');
  {
    const mk = (roster, rejectGet) => {
      const d = makeDialog();
      const notes = [];
      const b = { SUDialog: d.SUDialog, afDlgNote_: (w) => notes.push(w), Promise, String, Array, Object,
        masterGet: () => rejectGet ? Promise.reject(new Error('通信の失敗')) : Promise.resolve({ roster }) };
      vm.createContext(b);
      vm.runInContext([grabFn('asArr'), grabFn('normName'), grabFn('preflightDuplicate')].join('\n'), b);
      return { b, d, notes };
    };
    const ROSTER = [{ id: 901, name: '架空 一郎' }, { id: 902, name: '架空 花子' }];
    let p = mk(ROSTER, false); p.d.answer = false;
    let r = await p.b.preflightDuplicate({ name: '架空　一郎' });
    t('3-1 同じお名前の方がいて「キャンセル」なら登録しない', r === false && p.d.asked.length === 1 && /利用者No: 901/.test(p.d.asked[0]), [r, p.d.asked]);
    p = mk(ROSTER, false); p.d.answer = true;
    r = await p.b.preflightDuplicate({ name: '架空 一郎' });
    t('3-2 「OK」なら登録を続ける', r === true, r);
    p = mk(ROSTER, false);
    r = await p.b.preflightDuplicate({ name: '架空 三郎' });
    t('3-3 同じお名前の方がいなければ聞かずに続ける', r === true && p.d.asked.length === 0, [r, p.d.asked]);
    p = mk(null, true);
    r = await p.b.preflightDuplicate({ name: '架空 一郎' });
    t('3-4 名簿を照会できない時は止めない（前のまま）', r === true && p.d.asked.length === 0, r);
    p = mk(ROSTER, false); p.d.reject = true;
    r = await p.b.preflightDuplicate({ name: '架空 一郎' });
    t('3-5 窓が失敗した時は登録しない側に倒し、記録へ残す', r === false && p.notes.join() === '同姓同名の確かめ', [r, p.notes]);
    t('3-6 押した後の送信は、確かめの後に案件を取り直し、無くなった・別の案件・登録済みなら送らない',
      /var c2 = findCand\(cid\);\n    if \(!c2 \|\| curId !== cid \|\| \(c2\.masterId != null && c2\.masterId !== ''\)\) \{ \$\('msSendBtn'\)\.disabled = false; return; \}\n    return sendMasterRecord\(c2, adm\);/.test(src));
  }

  console.log('— 4. 書類を一覧から外す（removeFileEntry） —');
  {
    const mk = () => {
      const d = makeDialog();
      const log = { sent: [], toasts: [] };
      const b = { SUDialog: d.SUDialog, afDlgNote_: () => {}, Promise, String, Array, Number, Object, filesBusy: false, filesRev: 0, curId: 'c1',
        FILES: { c1: [{ fid: 'f1', title: '架空の書類' }] }, DB: { candidates: [{ id: 'c1', name: '架空 一郎' }] },
        toast: (m) => log.toasts.push(m), renderView() {}, renderList() {}, afErrWords_: (e) => String(e),
        apiFiles: (q) => { log.sent.push(q); return Promise.resolve({ ok: true, filesRev: 1 }); } };
      vm.createContext(b);
      vm.runInContext([grabFn('asStr'), grabFn('asArr'), grabFn('candFiles'), grabFn('findCand'), grabFn('removeFileEntry'), grabFn('removeFileEntryGo_')].join('\n'), b);
      return { b, d, log };
    };
    let p = mk(); p.d.answer = false;
    p.b.removeFileEntry({ id: 'c1' }, 'f1'); await settle();
    t('4-1 「キャンセル」なら何も送らない', p.log.sent.length === 0 && p.d.asked.length === 1, p.log);
    p = mk(); p.d.answer = true;
    p.b.removeFileEntry({ id: 'c1' }, 'f1'); await settle();
    t('4-2 「OK」なら今までと同じ物を送る', p.log.sent.length === 1 && p.log.sent[0].action === 'removeFile' && p.log.sent[0].cid === 'c1' && p.log.sent[0].fid === 'f1', p.log.sent);
    p = mk(); p.d.before = () => { p.b.FILES.c1 = []; };
    p.b.removeFileEntry({ id: 'c1' }, 'f1'); await settle();
    t('4-3 窓の間に書類が一覧から無くなっていたら何も送らない', p.log.sent.length === 0, p.log);
    p = mk(); p.d.before = () => { vm.runInContext("curId = 'c2';", p.b); };
    p.b.removeFileEntry({ id: 'c1' }, 'f1'); await settle();
    t('4-4 窓の間に別の案件を開いていたら何も送らない', p.log.sent.length === 0, p.log);
    p = mk(); p.d.before = () => { vm.runInContext('filesBusy = true;', p.b); };
    p.b.removeFileEntry({ id: 'c1' }, 'f1'); await settle();
    t('4-5 窓の間にほかの書類の処理が始まったら、最初と同じ断りで止める', p.log.sent.length === 0 && p.log.toasts.join() === 'ほかの書類の処理中です。少し待ってからお試しください', p.log);
  }

  console.log('— 5. 送信（push）：窓が出ている間は送り始めない・上書きの確かめ —');
  {
    const mk = () => {
      const d = makeDialog();
      const log = { puts: [], sync: [], scheduled: 0 };
      const b = { SUDialog: d.SUDialog, afDlgNote_: () => {}, Promise, String, Number, Object,
        dirty: true, pushing: false, afWipeHold_: false, SU_DATA_READY: true, AF_LIVE: true, kvRev: 3, retryWait: 0, pushTimer: null,
        DB: { updatedAt: '2026-11-13T00:00:00.000Z', candidates: [] },
        nowIso: () => '2026-11-13T00:00:09.000Z', syncTarget: () => ({ endpoint: 'x', token: '' }), setSync: (m, c) => log.sync.push([m, c || '']), saveCache() {},
        schedulePushRetry() {}, setTimeout, clearTimeout,
        answers: [], kvPutWithOpts: (db, rev, opts) => { log.puts.push(opts); return Promise.resolve(b.answers.length ? b.answers.shift() : { ok: true, rev: 4 }); } };
      vm.createContext(b);
      vm.runInContext(grabFn('push') + '\nfunction schedulePush() { __log.scheduled++; }', Object.assign(b, { __log: log }));
      return { b, d, log };
    };
    let p = mk(); p.d.busy = true;
    p.b.push(); await settle();
    t('5-1 窓が出ている間は送らず、窓が閉じた後に送り直しを予定する', p.log.puts.length === 0 && p.d.idled === 1 && p.log.scheduled === 1, p.log);
    p = mk(); p.d.busy = true;
    p.b.push(true); await settle();
    t('5-2 上書きの確かめで「OK」と答えた送信（force）は待たない', p.log.puts.length === 1 && p.log.puts[0] && p.log.puts[0].force === true, p.log.puts);
    const WIPE = { ok: false, error: 'admwipe', was: 12, now: 2 };
    p = mk(); p.b.answers = [WIPE]; p.d.answer = false;
    p.b.push(); await settle();
    /* 2026-11-14: キャンセルの後に2段目（サーバーの内容に合わせますか）を聞く。2段目もキャンセルなら今までどおり */
    t('5-3 サーバーが断り「キャンセル」なら上書きしない（未送信のまま）', p.log.puts.length === 1 && p.d.asked.length === 2 && /サーバー: 12 件 ／ この端末: 2 件/.test(p.d.asked[0]) && /^この端末の変更を捨てて、サーバーの内容に合わせますか？/.test(p.d.asked[1]) && JSON.stringify(p.log.sync[p.log.sync.length - 1]) === '["未送信あり","err"]', p.log);
    p = mk(); p.b.answers = [WIPE, { ok: true, rev: 9 }]; p.d.answer = true;
    p.b.push(); await settle();
    t('5-4 「OK」で窓の間に台帳が変わっていなければ上書きする（force）', p.log.puts.length === 2 && p.log.puts[1] && p.log.puts[1].force === true, p.log.puts);
    p = mk(); p.b.answers = [WIPE]; p.d.answer = true;
    p.d.before = () => { p.b.DB.updatedAt = '2026-11-13T00:00:05.000Z'; };
    p.b.push(); await settle();
    t('5-5 「OK」でも窓の間に台帳が変わっていたら上書きせず、いつもの送信に戻す', p.log.puts.length === 1 && p.log.scheduled === 1, p.log);
    /* PR #566 の反証: キャンセルの後、予約から来た送信で同じ確かめを続けて出さない。人が編集・⟳ を押すまで */
    p = mk(); p.b.answers = [WIPE, WIPE]; p.d.answer = false;
    p.b.push(); await settle();
    p.b.push(); await settle();   // 窓の後の予約（idle → schedulePush）から来た送信の代わり
    t('5-6 キャンセルの後の予約の送信では送らず、確かめも聞き直さない', p.log.puts.length === 1 && p.d.asked.length === 2 && p.b.afWipeHold_ === true
      && JSON.stringify(p.log.sync[p.log.sync.length - 1]) === '["未送信あり","err"]', [p.log.puts.length, p.d.asked.length, p.b.afWipeHold_]);
    vm.runInContext(grabFn('markDirty'), p.b);
    p.b.markDirty();
    t('5-7 人が編集したら（markDirty）印を下ろす', p.b.afWipeHold_ === false);
    p.b.push(); await settle();
    t('5-8 編集の後の送信でまた断られたら、もう一度聞く', p.log.puts.length === 2 && p.d.asked.length === 4, [p.log.puts.length, p.d.asked.length]);
    p = mk(); p.b.answers = [WIPE, { ok: true, rev: 9 }]; p.d.answer = false;
    p.b.push(); await settle();
    p.b.push(true); await settle();
    t('5-9 印が立っていても、上書きと答えた送信（force）は止めない', p.log.puts.length === 2 && p.log.puts[1] && p.log.puts[1].force === true, p.log.puts);
    t('5-10 ⟳ とバックアップから戻した時も印を下ろす', /afWipeHold_ = false;[^\n]*\n  pull\(true\)\.then\(/.test(src) && /afWipeHold_ = false;[^\n]*\n    dirty = true; saveCache\(\); renderAll\(\); schedulePush\(\);/.test(src));
  }

  console.log('— 6. 窓が出ている間は取り直さない・取り込まない —');
  t('6-1 画面に戻った時の取り直しは窓の間はしない', /if \(busyEditing\(\)\) return;\n  if \(SUDialog\.busy\(\)\) return;[^\n]*\n  if \(Date\.now\(\) - lastPullAt > 5 \* 60000\) pull\(false\);/.test(src));
  {
    /* つながった時（PR #566 の反証）: 実物の afOnlinePull_ を動かす */
    const d = makeDialog();
    const log = { pulls: 0 };
    const b = { SUDialog: d.SUDialog, afGateOk_: true, dirty: false, lastPullAt: 0, Date, busy: false };
    b.busyEditing = () => b.busy; b.pull = () => { log.pulls++; return Promise.resolve(true); };
    vm.createContext(b);
    vm.runInContext(grabFn('afOnlinePull_'), b);
    let closeWin = null;
    d.SUDialog.idle = () => { d.idled++; return new Promise((r) => { closeWin = () => { d.busy = false; r(); }; }); };   // 窓が閉じた時に解ける
    d.busy = true;
    b.afOnlinePull_(); await settle();
    t('6-2 つながった時の取り直しは、窓の間はしない', d.idled === 1 && log.pulls === 0, [d.idled, log.pulls]);
    closeWin(); await settle();
    t('6-2b 窓が閉じた後に取り直す', log.pulls === 1 && d.idled === 1, [d.idled, log.pulls]);
    b.busy = true; b.lastPullAt = 0;
    b.afOnlinePull_(); await settle();
    t('6-2c 編集中は取り直さない（前のまま）', log.pulls === 1, log);
    b.busy = false; vm.runInContext('dirty = true;', b);
    b.afOnlinePull_(); await settle();
    t('6-2d 未送信がある時は取り直さない（送る方へ回る）', log.pulls === 1, log);
    t('6-2e つながった時は、未送信があれば送り、無ければ afOnlinePull_ を呼ぶ', /if \(!afGateOk_\) return;\n  if \(dirty\) \{ retryWait = 0; push\(\); return; \}[^\n]*\n  afOnlinePull_\(\);/.test(src));
  }
  t('6-3 別タブの控えの取り込みは窓が閉じた後に回す', /setTimeout\(function apply\(\) \{\n    if \(dirty \|\| busyEditing\(\)\) return;\n[^\n]*\n    if \(SUDialog\.busy\(\)\) \{ SUDialog\.idle\(\)\.then\(apply\); return; \}/.test(src));

  console.log('— 7. 窓の後に相手が変わっていたら何もしない（形の確かめ） —');
  t('7-1 タスクの削除は案件とタスクを取り直す', /var c2 = findCand\(cid\);\n        if \(!c2 \|\| curId !== cid \|\| !\$\('sc-view'\)\.classList\.contains\('on'\) \|\| !asArr\(c2\.tasks\)\.some\(function \(x\) \{ return x && x\.id === tid; \}\)\) return;/.test(src));
  t('7-2 案件の削除は案件を取り直し、消えていれば何もしない', /var c2 = findCand\(cid\);\n      if \(!c2 \|\| curId !== cid \|\| !\$\('sc-view'\)\.classList\.contains\('on'\) \|\| c2\.deleted\) return;\n      pushUndoCand\(c2, '案件の削除'\);/.test(src));
  t('7-3 家族の行の削除は同じ編集か・その番目が同じ家族（番号）かを確かめる', /if \(!ok \|\| !editing \|\| editing !== ed\) return;\n        collectEditInputs\(\);\n        var fr = editing\.family\[fi\];\n        if \(!fr \|\| \(fr\.id \|\| ''\) !== fid0\) return;/.test(src)
    && /var saved = fr && fr\.id && asArr\(asObj\(editBase\)\.family\)\.some/.test(src));
  t('7-4 連携先の削除も同じ編集か・同じ連携先かを確かめる', /var ct = editing\.contacts\[ci\];\n        if \(!ct \|\| \(ct\.id \|\| ''\) !== cid0\) return;\n        editing\.contacts\.splice\(ci, 1\);/.test(src));
  t('7-5 編集の取り消し・下の切り替え・新規は、窓の間に別の編集になっていたら何もしない', (src.match(/if \(!ok \|\| editing !== ed\) return;/g) || []).length === 3);

  console.log('— 8. 同期の設定の窓：受け口の直し方は管理者のログインの時だけ —');
  {
    const ADMIN_TXT = '⚠️ サーバー側の消失ガード（admwipe）が有効になっていません。Apps Script でコードを保存しただけになっていないか確認してください（デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ）。';
    const STAFF_TXT = '⚠️ サーバーの守りの設定が済んでいません。管理者に伝えてください。';
    t('8-1 管理者には今までの文・それ以外には職員向けの1文', src.indexOf("(caps && serverOk && !guardOk ? (afIsAdmin_ ? '<p class=\"note err\">" + ADMIN_TXT + "</p>'\n      : '<p class=\"note err\">" + STAFF_TXT + "</p>') : '')") >= 0);
    /* PR #566 の反証: 「サーバー版」「サーバーの防御」（英字の守りの名前）の行も管理者の時だけ。職員には確かめのボタンだけの行 */
    t('8-1b サーバー版・サーバーの防御の行は管理者の時だけ、職員には「サーバー」の行と確かめのボタン',
      src.indexOf("(afIsAdmin_\n      ? '<dt>サーバー版</dt><dd>'") >= 0 && src.indexOf("'<dt>サーバーの防御</dt><dd>' + (caps ? esc(asArr(caps.guards).join('・') || 'なし') : '—') + '</dd>'\n      : '<dt>サーバー</dt><dd>' + (caps ? '確認済み' : '<span style=\"color:var(--g6)\">未確認</span>') +\n        ' <button class=\"btn sm\" id=\"syPing\" type=\"button\">確認する</button></dd>') +") >= 0
      && (src.match(/id="syPing"/g) || []).length === 2);
    t('8-1c 確かめた時の知らせの版の番号も管理者の時だけ', src.indexOf("toast(afIsAdmin_ ? 'サーバー版 ' + asStr(j.codeVersion) : 'サーバーを確認しました');") >= 0);
    t('8-2 既定は管理者ではない（確かめが遅れても職員向け）', /var afIsAdmin_ = false;/.test(src));
    /* 実物の afSetAdmin_・afResolveWho_ を動かす */
    const mk = (hasLogin, check) => {
      const renders = [];
      const b = { Promise, String, Object, Array, afWhoAcct_: '', afWhoGen_: 0, window: { SUAuth: { check } },
        document: { getElementById: () => ({ classList: { contains: () => true } }) },
        renderSyncModal: () => renders.push(1), afNote_() {}, afHasLogin_: () => hasLogin, afAuthLoad_: () => Promise.resolve(), afWhoLabel_: () => 'x' };
      vm.createContext(b);
      vm.runInContext('var afWhoAcct_ = "", afWhoGen_ = 0;\nvar afIsAdmin_ = false;\n' + grabFn('afSetAdmin_') + '\n' + grabFn('afResolveWho_') + '\nthis.adm = function () { return afIsAdmin_; };', b);
      return { b, renders };
    };
    let p = mk(true, () => Promise.resolve({ status: 'ok', role: 'admin', email: 'a@example.test' }));
    p.b.afResolveWho_(); await settle();
    t('8-3 管理者（ok・admin）と確かめられたら管理者の文にし、開いている窓を描き直す', p.b.adm() === true && p.renders.length === 1, [p.b.adm(), p.renders.length]);
    p = mk(true, () => Promise.resolve({ status: 'ok', role: 'office', email: 'o@example.test' }));
    p.b.afResolveWho_(); await settle();
    t('8-4 事務所のアカウントは職員向けの文のまま（描き直さない）', p.b.adm() === false && p.renders.length === 0);
    p = mk(true, () => Promise.resolve({ status: 'mfa_verify', role: 'admin' }));
    p.b.afResolveWho_(); await settle();
    t('8-5 2段階認証を済ませていない管理者は職員向けの文', p.b.adm() === false);
    p = mk(true, () => Promise.reject(new Error('通信の失敗')));
    p.b.afResolveWho_(); await settle();
    t('8-6 確かめられない時は職員向けの文', p.b.adm() === false);
    p = mk(false, () => Promise.resolve({ status: 'ok', role: 'admin' }));
    p.b.afResolveWho_(); await settle();
    t('8-7 ログインしていない端末は職員向けの文', p.b.adm() === false);
    const seq = [{ status: 'ok', role: 'admin' }, { status: 'error' }];
    p = mk(true, () => Promise.resolve(seq.shift()));
    p.b.afResolveWho_(); await settle(); p.b.afResolveWho_(); await settle();
    t('8-8 管理者と分かった後でも、確かめられなくなったら職員向けの文に戻す', p.b.adm() === false && p.renders.length === 2, [p.b.adm(), p.renders.length]);
  }
}

run().then(() => {
  console.log('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
}, (e) => { console.log('  ✗ 試験が最後まで動かなかった: ' + (e && e.stack)); process.exit(1); });
