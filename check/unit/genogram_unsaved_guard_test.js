/* 家族構成図（genogram.html）── 保存していない変更の確認と下書き・削除の順番の試験（2026-10-17 新設・代表者承認の設計）
   実行: node check/unit/genogram_unsaved_guard_test.js
   対象を差し替える: GENO_HTML=/tmp/変異版.html node check/unit/genogram_unsaved_guard_test.js（変異試験用）
   守ること:
     1. 「保存していない変更」は図の中身（nodes・lines・frames・texts）と利用者名の指紋で判定する。読込・端末への保存・新規で控え直す
     2. 一覧から別の図を選んだ時、変更があれば確かめる（キャンセルで開かない）。変更が無ければ確かめずに開く
     3. 下書きは変更がある間だけ genogram:draft に1つ（{v:1, clientName, loadedFrom, at, doc}）。編集の後に間を置いて書く・書けなくても止めない。
        消すのは: 端末への保存の後・破棄して新規／別の図を開いた時・起動時に「戻さない」を選んだ時
     4. 起動時: 保存済みの同じ名前の図と中身が違う下書きだけ確かめる。戻す＝変更ありのまま・戻さない＝消す。同じ中身・壊れた下書きは黙って消す
     5. 現場の端末では下書きを控えず、確かめず、下書きにも触れない
     6. 閉じる・再読み込みでは、変更があればブラウザの確認を出す（下書きもその場で書く）
     7. 削除: クラウドの削除が通ってから端末の図を消す。断られた・食い違いの時は端末の図を残す。通信の失敗は従来どおり保留に積んで消す
   ★画面の本物の関数を切り出し、偽物の DOM・localStorage の上で動かす。氏名は「テスト 一郎」などの架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.GENO_HTML || path.join(ROOT, 'genogram.html'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(name, prefix) {
  const key = (prefix || '') + 'function ' + name + '(';
  const h = SRC.indexOf(key);
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = SRC.indexOf('{', h), d = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) return SRC.slice(h, i + 1); } }
  throw new Error('閉じていません: ' + name);
}
function cutLine(start) {
  const h = SRC.indexOf(start);
  if (h < 0) throw new Error('見つかりません: ' + start);
  return SRC.slice(h, SRC.indexOf('\n', h));
}
const tick = () => new Promise(r => setImmediate(r));
const N1 = 'テスト 一郎', N2 = 'テスト 花子';
const DRAFT = 'genogram:draft';
const docOf = (mark) => ({ nodes: [{ id: mark }], lines: [], frames: [], texts: [] });

/* 画面1枚の模型。opt.field＝現場の端末／opt.cloud＝クラウドの返事（'ok'・'auth'・'conflict'・'offline'・未設定は null） */
function page(opt) {
  const o = opt || {};
  const store = Object.assign({}, o.store || {});
  if (o.field) store.su_device_role = 'field';
  const log = { confirms: [], answers: (o.answers || []).slice(), alerts: [], flashes: [], loads: [], timers: [], cleared: 0,
    status: [], queued: [], delCalls: [], quota: false, renders: 0 };
  const els = { clientName: { value: '', focus() {} }, docList: { value: '' } };
  const ls = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { if (log.quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const CloudSync = {
    isConfigured: () => !!o.cloud,
    markDirty: () => 1, markConfirm() {}, getBase: () => null, setBaseline() {}, getPending: () => [],
    clearPendingFor() {}, queuePending: (x) => { log.queued.push(x); },
    delCurrent: (name) => {
      log.delCalls.push({ name, localAtCall: ls.getItem('genogram:doc:' + name) !== null });
      if (o.cloud === 'ok') return Promise.resolve({ name });
      const e = new Error(o.cloud === 'auth' ? '合言葉が違います' : o.cloud === 'conflict' ? 'conflict' : 'Failed to fetch');
      if (o.cloud === 'auth') e.auth = true;
      if (o.cloud === 'conflict') e.conflict = true;
      return Promise.reject(e);
    }
  };
  const ctx = {
    localStorage: ls, state: { clientName: '', doc: docOf('x0'), selectedId: null, selectedType: null, mode: { type: 'select' }, history: [], zoom: 1 },
    $: id => els[id] || null,
    confirm: m => { log.confirms.push(m); return log.answers.length ? log.answers.shift() : false; },
    alert: m => { log.alerts.push(m); },
    setTimeout: (fn, ms) => { const h = { fn, ms, live: true }; log.timers.push(h); return h; },
    clearTimeout: h => { if (h) { h.live = false; log.cleared++; } },
    render: () => { log.renders++; }, showProperties() {}, setMode() {}, fitStageSize() {}, updateModeStatus() {},
    flashStatus: m => { log.flashes.push(m); }, setSyncStatus: (a, m) => { log.status.push([a, m]); },
    refreshDocList: async () => {}, writeSuGenogram() {}, suGenoMasterIdFor: () => '',
    abortSuBackfill: () => { log.aborts = (log.aborts || 0) + 1; },
    window: { _suMasterId: null, _suMasterName: '' },
    CloudSync, cloudUnverified: new Set(),
    authUnverified: { has: () => false, delete() {}, add() {} },
    LS_INDEX: 'genogram:index', LS_DOC_PREFIX: 'genogram:doc:', LS_LAST: 'genogram:lastClient', STAGE_W: 700, STAGE_H: 450,
    _suBackfillRun: null,
    JSON, Date, String, Array, Object, Math, Error, Promise, Set, Map, isNaN
  };
  vm.createContext(ctx);
  vm.runInContext([
    "let loadedFrom = '';",
    cutLine('var FIELD_READONLY_MSG = '),
    cutF('isFieldDevice'), cutF('makeEmptyDoc'), cutF('hasAnyContent'), cutF('nowISO'), cutF('parseTs'), cutF('fmtTsLabel'), cutF('listDocs'),
    cutLine('const LS_DRAFT = '), cutLine('const DRAFT_DELAY_MS = '), cutLine('let unsavedBase = '), cutLine('let draftTimer = '),
    cutF('docPrint'), cutF('viewNow'), cutF('hasUnsavedChanges'), cutF('clearDraft'), cutF('markClean'), cutF('writeDraftNow'),
    cutF('scheduleDraft'), cutF('readDraft'), cutF('offerDraftRestore'), cutF('onDocListChange'), cutF('onBeforeUnload'),
    cutF('saveDoc', 'async '), cutF('loadDoc', 'async '), cutF('newDoc'), cutF('deleteCurrentDoc', 'async '),
    // 一覧の選択から呼ばれた読込を記録する（本物の loadDoc は api.realLoad で呼ぶ）
    'const realLoad = loadDoc; loadDoc = function (n, op) { __log.loads.push(n); return realLoad(n, op); };',
    'this.api = { docPrint, hasUnsavedChanges, markClean, writeDraftNow, scheduleDraft, readDraft, offerDraftRestore, onDocListChange,',
    '  onBeforeUnload, saveDoc, newDoc, deleteCurrentDoc, loadDoc: (n, op) => realLoad(n, op), setLoaded: (v) => { loadedFrom = v; }, loaded: () => loadedFrom,',
    '  base: () => unsavedBase, timer: () => draftTimer };'
  ].join('\n'), Object.assign(ctx, { __log: log }));
  const api = ctx.api;
  const P = { ctx, api, store, log, els, state: ctx.state };
  P.draft = () => (store[DRAFT] ? JSON.parse(store[DRAFT]) : null);
  P.draw = (mark) => { ctx.state.doc = docOf(mark); };
  P.setName = (n) => { els.clientName.value = n; ctx.state.clientName = n.trim(); };
  P.saveLocal = (name, mark) => { store['genogram:doc:' + name] = JSON.stringify(Object.assign({ clientName: name, updatedAt: '2026-10-01T00:00:00.000+09:00' }, docOf(mark))); };
  P.fire = () => { const live = log.timers.filter(h => h.live); live.forEach(h => { h.live = false; h.fn(); }); return live.length; };
  return P;
}

(async function main() {
  console.log('\n1 保存していない変更の判定（指紋）');
  {
    const P = page();
    t('起動の途中（まだ控えていない）は変更なし', P.api.hasUnsavedChanges() === false);
    P.api.markClean();
    t('控えた直後は変更なし', P.api.hasUnsavedChanges() === false);
    P.state.doc.nodes.push({ id: 'n2' });
    t('人物を足すと変更あり', P.api.hasUnsavedChanges() === true);
    P.state.doc.nodes.pop();
    t('元に戻すと変更なし', P.api.hasUnsavedChanges() === false);
    P.setName(N1);
    t('利用者名だけを変えても変更あり', P.api.hasUnsavedChanges() === true);
    P.setName('');
    for (const k of ['lines', 'frames', 'texts']) {
      P.state.doc[k].push({ id: k });
      t(k + ' の変更も数える', P.api.hasUnsavedChanges() === true);
      P.state.doc[k].pop();
    }
    t('判定は必要な時だけ（タイマーを自分で回さない）', P.log.timers.length === 0);
  }

  console.log('\n2 下書きを控える時機');
  {
    const P = page();
    P.api.markClean();
    P.api.scheduleDraft();
    t('編集の直後には書かない（間を置く）', P.draft() === null && P.log.timers.length === 1 && P.log.timers[0].ms === 1000, P.log.timers.map(h => h.ms));
    P.api.scheduleDraft(); P.api.scheduleDraft();
    t('続けて呼んでも、待つのは最後の1つ', P.log.timers.filter(h => h.live).length === 1);
    P.fire();
    t('変更が無ければ書かない', P.draft() === null);
    P.draw('A1'); P.setName(N1); P.api.setLoaded(N2);
    P.api.scheduleDraft(); P.fire();
    const d = P.draft();
    t('変更があれば1つ書く（形 {v:1, clientName, loadedFrom, at, doc}）', d && d.v === 1 && d.clientName === N1 && d.loadedFrom === N2 && typeof d.at === 'string' && d.at &&
      JSON.stringify(d.doc) === JSON.stringify(docOf('A1')) && Object.keys(d).sort().join() === 'at,clientName,doc,loadedFrom,v', d);
    P.draw('A2'); P.api.scheduleDraft(); P.fire();
    t('書き直しても下書きは1つ（同じキー）', P.draft().doc.nodes[0].id === 'A2' && Object.keys(P.store).filter(k => /draft/.test(k)).length === 1);
    P.draw('x0'); P.setName(''); P.api.setLoaded('');
    P.api.scheduleDraft(); P.fire();
    t('元に戻した＝変更なしになったら下書きを消す', P.draft() === null);
    P.draw('A3'); P.log.quota = true;
    let threw = null;
    try { P.api.scheduleDraft(); P.fire(); } catch (e) { threw = e; }
    t('保存領域がいっぱいでも止まらない（黙ってあきらめる）', threw === null && P.draft() === null, threw && threw.message);
  }

  console.log('\n3 一覧から別の図を選んだ時');
  {
    const P = page({ answers: [] });
    P.saveLocal(N2, 'hanako');
    P.api.markClean();
    P.els.docList.value = N2;
    P.api.onDocListChange({ target: P.els.docList });
    await tick();
    t('変更が無ければ確かめずに開く', P.log.confirms.length === 0 && P.log.loads.join() === N2 && P.els.docList.value === '', P.log);
  }
  {
    const P = page({ answers: [false] });
    P.saveLocal(N2, 'hanako');
    P.api.markClean();
    P.draw('A1'); P.api.writeDraftNow();
    P.els.docList.value = N2;
    P.api.onDocListChange({ target: P.els.docList });
    await tick();
    t('変更があれば確かめる（文言）', P.log.confirms.length === 1 && P.log.confirms[0] === '保存していない変更があります。破棄して「' + N2 + '」を開きますか？', P.log.confirms);
    t('キャンセルなら開かない・図も下書きもそのまま', P.log.loads.length === 0 && P.state.doc.nodes[0].id === 'A1' && P.draft() && P.draft().doc.nodes[0].id === 'A1' && P.els.docList.value === '');
  }
  {
    const P = page({ answers: [true] });
    P.saveLocal(N2, 'hanako');
    P.api.markClean();
    P.draw('A1'); P.api.writeDraftNow();
    P.els.docList.value = N2;
    P.api.onDocListChange({ target: P.els.docList });
    await tick(); await tick();
    t('破棄を選べば開き、下書きを消す', P.log.loads.join() === N2 && P.draft() === null && P.state.doc.nodes[0].id === 'hanako', P.log.loads);
    t('開いた図が新しい基準（変更なし）', P.api.hasUnsavedChanges() === false);
  }
  {
    const P = page({ answers: [] });
    P.els.docList.value = '';
    P.api.onDocListChange({ target: P.els.docList });
    t('空の選択では何もしない', P.log.loads.length === 0 && P.log.confirms.length === 0);
  }

  console.log('\n4 端末への保存・新規・読込で控え直す');
  {
    const P = page();
    P.api.markClean();
    P.draw('A1'); P.setName(N1); P.api.writeDraftNow();
    t('前提 下書きあり', !!P.draft());
    await P.api.saveDoc();
    t('端末への保存が済んだら下書きを消し、変更なしに', P.draft() === null && P.api.hasUnsavedChanges() === false && !!P.store['genogram:doc:' + N1]);
    P.draw('A2'); P.api.writeDraftNow();
    P.log.quota = true;
    await P.api.saveDoc();
    P.log.quota = false;
    t('端末への保存に失敗したら下書きは残し、変更ありのまま', !!P.draft() && P.draft().doc.nodes[0].id === 'A2' && P.api.hasUnsavedChanges() === true && P.log.alerts.length === 1, P.log.alerts);
  }
  {
    const P = page({ answers: [false, true] });
    P.api.markClean();
    P.draw('A1'); P.api.writeDraftNow();
    P.api.newDoc();
    t('新規: 今の確認の文言のまま', P.log.confirms[0] === '現在の内容を破棄して新規作成しますか？\n（保存していない変更は失われます）', P.log.confirms);
    t('新規でキャンセル: 図も下書きもそのまま', P.state.doc.nodes[0].id === 'A1' && !!P.draft());
    P.api.newDoc();
    t('新規で破棄を選んだら空の図・下書きを消す・変更なし', P.state.doc.nodes.length === 0 && P.draft() === null && P.api.hasUnsavedChanges() === false);
  }
  {
    const P = page();
    P.saveLocal(N1, 'ichiro');
    P.api.markClean();
    P.draw('A1'); P.api.writeDraftNow();
    await P.api.loadDoc(N1);
    t('読込が済んだら、読み込んだ図が基準（変更なし）・下書きは消える', P.api.hasUnsavedChanges() === false && P.draft() === null && P.state.doc.nodes[0].id === 'ichiro');
    P.state.doc.nodes[0].label = '父';
    t('読込の後に直すと変更あり', P.api.hasUnsavedChanges() === true);
  }

  console.log('\n5 閉じる・再読み込み');
  {
    const P = page();
    P.api.markClean();
    let prevented = 0;
    const ev = { preventDefault() { prevented++; }, returnValue: undefined };
    P.api.onBeforeUnload(ev);
    t('変更が無ければ確認を出さない', prevented === 0 && ev.returnValue === undefined);
    P.draw('A1'); P.api.scheduleDraft();
    P.api.onBeforeUnload(ev);
    t('変更があればブラウザの確認を出す（preventDefault と returnValue）', prevented === 1 && ev.returnValue === '');
    t('閉じる前に下書きをその場で書く（待っていた分を取り消す）', P.draft() && P.draft().doc.nodes[0].id === 'A1' && P.log.timers.every(h => !h.live));
  }

  console.log('\n6 起動時に下書きを戻すか');
  const draftOf = (o) => JSON.stringify(Object.assign({ v: 1, clientName: N1, loadedFrom: N1, at: '2026-10-17T09:05:00.000+09:00', doc: docOf('draft') }, o || {}));
  {
    const P = page();
    t('下書きが無ければ確かめない', P.api.offerDraftRestore() === false && P.log.confirms.length === 0);
  }
  for (const [label, raw] of [['JSON でない', '{壊れ'], ['v が違う', draftOf({ v: 2 })], ['doc が無い', draftOf({ doc: null })],
    ['nodes が配列でない', draftOf({ doc: { nodes: {}, lines: [], frames: [], texts: [] } })], ['texts が無い', draftOf({ doc: { nodes: [], lines: [], frames: [] } })],
    ['clientName が文字でない', draftOf({ clientName: 3 })], ['null', 'null']]) {
    const P = page({ store: { [DRAFT]: raw } });
    t('壊れた下書き（' + label + '）は黙って消す', P.api.offerDraftRestore() === false && P.log.confirms.length === 0 && P.draft() === null);
  }
  {
    const P = page({ store: { [DRAFT]: draftOf({ doc: docOf('same') }) } });
    P.saveLocal(N1, 'same');
    t('保存済みの同じ名前の図と中身が同じなら黙って消す', P.api.offerDraftRestore() === false && P.log.confirms.length === 0 && P.draft() === null);
  }
  {
    const P = page({ store: { [DRAFT]: draftOf() }, answers: [false] });
    P.saveLocal(N1, 'saved');
    const r = P.api.offerDraftRestore();
    t('中身が違えば確かめる（利用者名・時刻）', P.log.confirms.length === 1 && P.log.confirms[0].indexOf('保存していない編集が残っています（' + N1 + '・') === 0 && /。戻しますか？$/.test(P.log.confirms[0]) && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(P.log.confirms[0]), P.log.confirms);
    t('戻さないなら下書きを消し、図は変えない', r === false && P.draft() === null && P.state.doc.nodes[0].id === 'x0');
  }
  {
    const P = page({ store: { [DRAFT]: draftOf() }, answers: [true] });
    P.saveLocal(N1, 'saved');
    const r = P.api.offerDraftRestore();
    t('戻すなら下書きの中身を開く（名前・出発点も）', r === true && P.state.doc.nodes[0].id === 'draft' && P.state.clientName === N1 && P.els.clientName.value === N1 && P.api.loaded() === N1);
    t('戻した後は変更ありのまま・下書きは残る', P.api.hasUnsavedChanges() === true && !!P.draft());
    await P.api.saveDoc();
    t('戻した図を保存すれば下書きは消え、変更なし', P.draft() === null && P.api.hasUnsavedChanges() === false && JSON.parse(P.store['genogram:doc:' + N1]).nodes[0].id === 'draft');
  }
  {
    const P = page({ store: { [DRAFT]: draftOf({ clientName: '', loadedFrom: '' }) }, answers: [true] });
    const r = P.api.offerDraftRestore();
    t('名前の無い新規の下書きも確かめて戻せる', r === true && P.log.confirms[0].indexOf('（利用者名なし・') > 0 && P.api.hasUnsavedChanges() === true, P.log.confirms);
  }

  console.log('\n7 現場の端末（閲覧専用）');
  {
    const P = page({ field: true, store: { [DRAFT]: draftOf() }, answers: [true, true] });
    P.api.markClean();
    t('前提 現場の端末でも下書きには触れない（起動・控え直しで消さない）', !!P.draft());
    t('起動時に確かめない・下書きもそのまま', P.api.offerDraftRestore() === false && P.log.confirms.length === 0 && !!P.draft());
    P.draw('F1');
    t('変更ありと判定しない', P.api.hasUnsavedChanges() === false);
    P.api.scheduleDraft(); P.api.writeDraftNow();
    t('下書きを控えない', P.log.timers.length === 0 && P.draft().doc.nodes[0].id === 'draft');
    P.saveLocal(N2, 'hanako');
    P.els.docList.value = N2;
    P.api.onDocListChange({ target: P.els.docList });
    await tick();
    t('一覧の選択で確かめない（そのまま開く）', P.log.confirms.length === 0 && P.log.loads.join() === N2);
    let prevented = 0;
    P.api.onBeforeUnload({ preventDefault() { prevented++; } });
    t('閉じる時も確認を出さない', prevented === 0);
  }

  console.log('\n8 まとめ反映の間（他の方の図に差し替わっている）');
  {
    const P = page();
    P.draw('mine'); P.setName(N1);
    P.api.markClean();
    const real = { doc: P.state.doc, name: P.state.clientName };
    P.ctx._suBackfillRun = { real: () => real };
    P.state.doc = docOf('other'); P.state.clientName = N2;
    t('差し替え中の他の方の図を「変更あり」と数えない', P.api.hasUnsavedChanges() === false);
    real.doc.nodes.push({ id: 'edit' });
    P.api.writeDraftNow();
    t('下書きは本人の図で書く（他の方の図を書かない）', P.draft() && P.draft().clientName === N1 && P.draft().doc.nodes.map(n => n.id).join() === 'mine,edit', P.draft());
  }

  console.log('\n9 削除の順番');
  for (const kind of ['ok', 'auth', 'conflict', 'offline']) {
    const P = page({ cloud: kind, answers: [true] });
    P.saveLocal(N1, 'ichiro');
    P.store['genogram:index'] = JSON.stringify([{ name: N1, updatedAt: 'x' }]);
    P.store['genogram:lastClient'] = N1;
    P.els.clientName.value = N1;
    await P.api.deleteCurrentDoc();
    const kept = P.store['genogram:doc:' + N1] !== undefined && JSON.parse(P.store['genogram:index']).length === 1;
    t(kind + ': クラウドの削除を呼んだ時点では端末の図が残っている', P.log.delCalls.length === 1 && P.log.delCalls[0].localAtCall === true, P.log.delCalls);
    if (kind === 'ok') {
      t('ok: 通ったら端末の図・一覧・最後に開いた印を消す', !kept && P.store['genogram:lastClient'] === undefined && P.log.flashes.pop() === '「' + N1 + '」を削除しました');
    } else if (kind === 'offline') {
      t('通信の失敗: 従来どおり保留に積み、端末の図は消す', !kept && P.log.queued.length === 1 && P.log.queued[0].kind === 'delete' && P.log.queued[0].name === N1);
    } else {
      t(kind + ': 失敗したら端末の図と一覧を残す・保留に積まない', kept && P.store['genogram:lastClient'] === N1 && P.log.queued.length === 0);
      t(kind + ': 「削除しました」と出さず、残したことを知らせる', !P.log.flashes.some(m => /を削除しました$/.test(m)) && /残しています/.test(P.log.flashes[P.log.flashes.length - 1]) && P.log.status[P.log.status.length - 1][0] === 'err', P.log.flashes);
    }
  }
  {
    const P = page({ cloud: null, answers: [true] });
    P.saveLocal(N1, 'ichiro');
    P.els.clientName.value = N1;
    await P.api.deleteCurrentDoc();
    t('クラウド未設定: 従来どおり端末だけ消す（クラウドを呼ばない）', P.store['genogram:doc:' + N1] === undefined && P.log.delCalls.length === 0 && P.log.flashes.pop() === '「' + N1 + '」を削除しました');
  }

  console.log('\n' + (fail ? '✗' : '✓') + ' genogram_unsaved_guard_test: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
