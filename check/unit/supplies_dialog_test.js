/* 消耗品管理（supplies.html）：止めて知らせる窓を画面の中の窓（su-dialog.js）にする（2026-11-13 第6段 SP-02・代表者の指示）。
   守りたいこと:
     1. 画面の中の窓の部品を画面のスクリプトより前に読み、読めない時はブラウザの窓に落とす受け口がある
     2. 確かめの窓10か所は SUDialog.confirm で聞き、文は一字一句変えない
     3. 残すブラウザの窓は5か所だけ（新しい品目の窓を Esc・閉じる時の2か所＝その場で答えが要る／メニュー・使い方へ移る時の2か所＝help_link_test が決めている／
        未送信の一覧へ移る時の1か所＝押した瞬間に移るのを止めるため答えをその場で要る・unsent_entry_test が決めている・2026-11-14）
     4. 窓の答えの後に、開いている物・状態が変わっていたら何もしない（品目の非表示・締めの保存・型をすべて消す・月の付け直し）
     5. キャンセルなら何も送らない・OK なら今までと同じ物を送る
   画面の実関数を名前で切り出して vm で動かす。外部ライブラリなし・実データなし（架空の品目だけ）。
   実行: node check/unit/supplies_dialog_test.js（読む HTML は環境変数 SPL_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.SPL_HTML || path.join(__dirname, '..', '..', 'supplies.html');
const src = fs.readFileSync(HTML, 'utf8');
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
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/* 画面の中の窓の代役。聞かれた文を控え、答えは試験が決める（answer）。窓の間に起きることは before で差し込む */
function makeDialog() {
  const d = { asked: [], answer: true, before: null };
  d.SUDialog = {
    confirm(m) {
      d.asked.push(String(m));
      return new Promise((res) => setTimeout(() => { if (d.before) d.before(); res(d.answer); }, 0));
    },
    alert(m) { d.asked.push(String(m)); return Promise.resolve(); },
    busy() { return false; }, idle() { return Promise.resolve(); }
  };
  return d;
}

async function run() {
  console.log('— 1. 部品と受け口 —');
  t('1-1 画面の中の窓の部品を、画面のスクリプトより前に読む（版はほかの画面と同じ）',
    /<script src="su-dialog\.js\?v=2026-11-14\.2"><\/script>\n<script>\n'use strict';/.test(src));
  t('1-2 読めない時の受け口がある（ブラウザの窓に落とす）',
    src.indexOf("if (!window.SUDialog) window.SUDialog = {\n  alert: function (m) { try { window.alert(m); } catch (_) {} return Promise.resolve(); },\n  confirm: function (m) { var r = false; try { r = !!window.confirm(m); } catch (_) {} return Promise.resolve(r); },") >= 0);

  console.log('— 2・3. 窓の数と文 —');
  const noComment = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const raw = (noComment.match(/(?<![.\w$])(alert|confirm|prompt)\s*\(|\bwindow\.(alert|confirm|prompt)\s*\(/g) || []).length;
  t('3-1 ブラウザの窓は受け口の2か所と、残す5か所だけ', raw === 7, raw);
  t('3-2 残す4か所: 新しい品目の窓の Esc・閉じる時（その場で答えが要る）', (src.match(/!window\.confirm\(ND_UNSAVED_MSG\)/g) || []).length === 2);
  t('3-3 残す4か所: メニュー・使い方へ移る時（help_link_test が決めている）',
    src.indexOf("if (!window.confirm('保存していない変更があります。メニューへ移ると消えます。移りますか？')) { e.preventDefault(); return; }") >= 0
    && src.indexOf("if (!window.confirm('保存していない変更があります。使い方へ移ると消えます。移りますか？')) { e.preventDefault(); return; }") >= 0);
  t('3-4 残す5か所: 未送信の一覧へ移る時（unsent_entry_test が決めている・2026-11-14）',
    src.indexOf("if (!window.confirm('保存していない変更があります。未送信の一覧へ移ると消えます。移りますか？')) { e.preventDefault(); return; }") >= 0);
  [
    "SUDialog.confirm('「' + it.name + '」を非表示にします。新しく選べなくなりますが、過去の記録は残ります。よろしいですか？')",
    "SUDialog.confirm('この日付以降に ' + count + ' 件の出庫があります。新しい価格で計算し直しますか？\\n（' + jpDate(from) + '〜' + jpDate(to) + '・在庫は変わりません）')",
    "var ask = (type === 'adj') ? neg + '在庫を' + (adjSign() < 0 ? '減らします' : '増やします') + '。よろしいですか？'\n    : (neg ? neg + '登録してよろしいですか？' : '');",
    "SUDialog.confirm('「' + name + '」の今の仕入は ' + yen(newest.cost)\n        + ' ですが、入庫は ' + yen(m.costEntered) + ' でした。価格を改定しますか？')",
    "SUDialog.confirm(prevYm + ' の月額出庫 ' + src.length + '件を ' + thisYm + '-01 付けで複写します。日数はプロファイルの既定に戻ります。よろしいですか？')",
    "SUDialog.confirm(ym + ' の' + (it ? '「' + it.name + '」の' : 'すべての品目の') + '出庫を、その日付の価格で計算し直します。よろしいですか？')",
    "SUDialog.confirm('この価格を使った出庫が ' + n + '件あります。取り消しますか？\\n（出庫は残ります。取り消したあとは「価格の付け直し」を行ってください）')",
    "SUDialog.confirm('型をすべて削除します。月額の出庫ができなくなります。よろしいですか？')",
    "SUDialog.confirm(msg.join('\\n') + '\\nよろしいですか？')"
  ].forEach((w, i) => t('2-' + (i + 1) + ' 文は一字一句そのまま: ' + w.slice(16, 50), src.indexOf(w) >= 0));
  t('2-10 入出庫の登録は聞く文がある時だけ画面の中の窓で聞く', src.indexOf('SUDialog.confirm(ask).then(function (ok) { if (ok && itemById(it.id)) go(); })') >= 0);
  t('2-11 窓の答えの後の続きで起きた例外は記録へ残す（空の catch で捨てない）', (src.match(/\.catch\(function \(e\) \{ splDlgNote_\('/g) || []).length === 7);   // 品目の非表示・遡及の付け直し・入出庫の登録・入庫の後の改定・月の付け直し・型の削除・締め（複写と価格の取り消しは今までの約束の続きの catch に入る）

  console.log('— 4・5. 品目の非表示（実物の toggleStatus を動かす）—');
  {
    const make = () => {
      const d = makeDialog();
      const items = { a1: { id: 'a1', name: '架空の手袋', status: 'active', rev: 3 } };
      const sent = [];
      const box = { SUDialog: d.SUDialog, itemById: (id) => items[id] || null, saveItemFields: (it, f) => sent.push([it, f]), splDlgNote_: () => {} };
      vm.createContext(box);
      vm.runInContext(grabFn('toggleStatus'), box);
      return { d, items, sent, box };
    };
    let C = make();
    C.d.answer = false; C.box.toggleStatus(C.items.a1); await tick(); await tick();
    t('4-1 キャンセルなら送らない', C.sent.length === 0 && C.d.asked.length === 1 && /架空の手袋/.test(C.d.asked[0]));
    C = make();
    C.box.toggleStatus(C.items.a1); await tick(); await tick();
    t('4-2 OK なら非表示を送る', C.sent.length === 1 && C.sent[0][1].status === 'hidden');
    C = make();
    const fresh = { id: 'a1', name: '架空の手袋', status: 'active', rev: 4 };
    C.d.before = () => { C.items.a1 = fresh; };
    const old = C.items.a1;
    C.box.toggleStatus(old); await tick(); await tick();
    t('4-3 窓の間に一覧を読み直した時は今の品目（新しい rev）で送る', C.sent.length === 1 && C.sent[0][0] === fresh);
    C = make();
    C.d.before = () => { C.items.a1 = { id: 'a1', name: '架空の手袋', status: 'hidden', rev: 4 }; };
    C.box.toggleStatus(C.items.a1); await tick(); await tick();
    t('4-4 窓の間に別の端末で非表示になっていた時は送らない', C.sent.length === 0);
    C = make();
    C.d.before = () => { delete C.items.a1; };
    C.box.toggleStatus(C.items.a1); await tick(); await tick();
    t('4-5 窓の間に品目が無くなった時は送らない', C.sent.length === 0);
    C = make();
    C.items.a1.status = 'hidden';
    C.box.toggleStatus(C.items.a1);
    t('4-6 表示に戻す時は今までどおり聞かずに送る', C.sent.length === 1 && C.sent[0][1].status === 'active' && C.d.asked.length === 0);
  }

  console.log('— 4・5. 締めの保存（実物の saveClosed を動かす）—');
  {
    const make = () => {
      const d = makeDialog();
      const posts = [];
      const ST = { closed: ['2026-09'], closedDraft: ['2026-09', '2026-10'], settingsAt: 'x' };
      const box = {
        SUDialog: d.SUDialog, ST, splDlgNote_: () => {},
        setState() {}, busyOn: () => true, busyOff() {}, loadList() {}, renderClosed() {}, errText: () => '', errHint: () => '',
        apiPost: (a, b) => { posts.push([a, b]); return new Promise(() => {}); }
      };
      vm.createContext(box);
      vm.runInContext(grabFn('saveClosed') + '\n' + grabFn('sendClosed_'), box);
      return { d, posts, ST, box };
    };
    let C = make();
    C.box.saveClosed(); await tick(); await tick();
    t('4-7 OK なら締める月を送る（聞く文は今までどおり）', C.posts.length === 1 && C.posts[0][0] === 'setClosedMonths' && C.posts[0][1].closedMonths.join(',') === '2026-09,2026-10'
      && C.d.asked[0] === '締める: 2026-10\nよろしいですか？', C.d.asked);
    C = make(); C.d.answer = false;
    C.box.saveClosed(); await tick(); await tick();
    t('4-8 キャンセルなら送らない', C.posts.length === 0);
    C = make();
    C.d.before = () => { C.ST.closedDraft.push('2026-11'); };
    C.box.saveClosed(); await tick(); await tick();
    t('4-9 窓の間に締める月の下書きが変わった時は送らない', C.posts.length === 0);
  }

  console.log('— 4・5. 型をすべて消す（実物の saveProfiles を動かす）—');
  {
    const make = () => {
      const d = makeDialog();
      const posts = [];
      const ST = { item: 'p1', profDraft: [], profiles: [] };
      const items = { p1: { id: 'p1', name: '架空のパッド', rev: 7 } };
      const box = {
        SUDialog: d.SUDialog, ST, splDlgNote_: () => {}, itemById: (id) => items[id] || null,
        setState() {}, busyOn: () => true, busyOff() {}, loadList() {}, renderProfiles() {}, renderList() {}, errText: () => '', errHint: () => '',
        parseDec1: Number, parseIntStrict: Number, txt: (s) => (s == null ? '' : String(s)),
        apiPost: (a, b) => { posts.push([a, b]); return new Promise(() => {}); }
      };
      vm.createContext(box);
      vm.runInContext(grabFn('saveProfiles') + '\n' + grabFn('sendProfiles_'), box);
      return { d, posts, ST, box };
    };
    let C = make();
    C.box.saveProfiles(); await tick(); await tick();
    t('4-10 OK なら全部消すことを送る', C.posts.length === 1 && C.posts[0][1].clear === true && C.posts[0][1].rev === 7);
    C = make(); C.d.answer = false;
    C.box.saveProfiles(); await tick(); await tick();
    t('4-11 キャンセルなら送らない', C.posts.length === 0);
    C = make();
    C.d.before = () => { C.ST.item = 'p2'; };
    C.box.saveProfiles(); await tick(); await tick();
    t('4-12 窓の間に別の品目を開いた時は送らない', C.posts.length === 0);
    C = make();
    C.d.before = () => { C.ST.profDraft = [{ name: '架空の型' }]; };
    C.box.saveProfiles(); await tick(); await tick();
    t('4-13 窓の間に型の下書きが変わった時は送らない', C.posts.length === 0);
  }

  console.log('— 4・5. 月の付け直し（実物の repriceMonth を動かす）—');
  {
    const make = () => {
      const d = makeDialog();
      const posts = [];
      const el = { sumMonth: { value: '2026-10' }, repItem: { value: '' } };
      const box = {
        SUDialog: d.SUDialog, ST: { sumMonth: '' }, splDlgNote_: () => {}, YM_RE: /^\d{4}-\d{2}$/,
        $: (id) => el[id], txt: (s) => (s == null ? '' : String(s)), isClosed: () => false, itemById: () => null,
        SPL: () => ({ monthRange: (ym) => ({ from: ym + '-01', to: ym + '-31' }) }),
        setState() {}, loadSummary() {}, errText: () => '', errHint: () => '',
        apiPost: (a, b) => { posts.push([a, b]); return new Promise(() => {}); }
      };
      vm.createContext(box);
      vm.runInContext(grabFn('repriceMonth'), box);
      return { d, posts, el, box };
    };
    let C = make();
    C.box.repriceMonth(); await tick(); await tick();
    t('4-14 OK なら付け直しを送る', C.posts.length === 1 && C.posts[0][0] === 'repriceMoves' && C.posts[0][1].from === '2026-10-01');
    C = make(); C.d.answer = false;
    C.box.repriceMonth(); await tick(); await tick();
    t('4-15 キャンセルなら送らない', C.posts.length === 0);
    C = make();
    C.d.before = () => { C.el.sumMonth.value = '2026-11'; };
    C.box.repriceMonth(); await tick(); await tick();
    t('4-16 窓の間に月を選び直した時は送らない', C.posts.length === 0);
  }

  process.stdout.write('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────\n');
  process.exit(ng ? 1 : 0);
}
run().catch((e) => { process.stdout.write('試験が止まりました: ' + (e && e.message) + '\n'); process.exit(1); });
