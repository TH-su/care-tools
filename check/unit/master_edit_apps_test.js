/* 入居者マスタ（resident-master.html）の1人ずつの編集画面の「対象アプリ」（2026-11-11）の試験。
   守りたいこと:
     1 3つ全部外した保存は、送る前に止めて知らせる（全部外すと名簿の対象アプリの列が空になり、
       すべてのアプリに表示される扱いに戻るため。一括編集と同じ決まり）
     2 1つでもチェックがあれば止めない
     3 チェック欄が描かれていない時は、空の配列にせず開いた時の値を引き継ぐ
   実データは1件も含まない。
   実行: node check/unit/master_edit_apps_test.js（読む HTML は環境変数 MASTER_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');

function grabFn(name){
  const start = src.indexOf('\nfunction ' + name + '(');
  if(start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false, q = null;
  for(let i = start; i < src.length; i++){
    const c = src[i], p = src[i-1];
    if(q){ if(c === q && p !== '\\') q = null; continue; }
    if(c === "'" || c === '"'){ q = c; continue; }
    if(c === '{'){ depth++; seen = true; }
    else if(c === '}'){ depth--; if(seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}

let ok = 0, ng = 0;
function t(label, cond){ if(cond) ok++; else { ng++; process.stdout.write('  ✗ ' + label + '\n'); } }

/* saveResident を、collectForm と通信を偽物にして動かす。止まったか（alert）と、先へ進んだか（rmOn_ を呼んだか）を見る */
function runSave(targetApps){
  const log = { alert: [], reachedConn: false };
  const ctx = {
    collectForm: () => ({ name: '架空 一郎', targetApps }),
    toast: () => {},
    alert: (m) => { log.alert.push(String(m)); },
    /* 2026-11-13: 確かめ・知らせは画面の中の窓（su-dialog.js）になり、答えを約束（Promise）で返す。記録と答え方は今までどおり */
    SUDialog: { alert: (m) => { log.alert.push(String(m)); return Promise.resolve(); } },
    rmOn_: () => { log.reachedConn = true; return false; },   // 接続先なしで止めて、通信には進ませない
  };
  vm.createContext(ctx);
  vm.runInContext(grabFn('saveResident') + '\nsaveResident();', ctx);
  return log;
}

const none = runSave([]);
t('1 3つ全部外すと止まる（知らせが1回）', none.alert.length === 1);
t('1 止めた時は保存へ進まない', none.reachedConn === false);
t('1 知らせの文に「チェックを1つ以上入れてください」がある', /チェックを1つ以上入れてください/.test(none.alert[0] || ''));

const one = runSave(['weight']);
t('2 1つでもチェックがあれば止めない', one.alert.length === 0 && one.reachedConn === true);
const unset = runSave(undefined);
t('2 対象アプリを持たない記録は止めない', unset.alert.length === 0 && unset.reachedConn === true);

/* 3 collectForm の対象アプリの集め方。チェック欄が無い時は開いた時の値を引き継ぐ */
const cf = grabFn('collectForm');
const seg = cf.slice(cf.indexOf("querySelectorAll('[data-target]')") - 80, cf.indexOf("querySelectorAll('[data-target]')") + 420);
t('3 チェック欄がある時だけ欄から集める', /if\(tgEls\.length\)\{\s*rec\.targetApps=\[\];/.test(seg));
t('3 欄が無い時は開いた時の値を引き継ぐ', /else if\(Array\.isArray\(editing\.targetApps\)\)rec\.targetApps=editing\.targetApps\.slice\(\);/.test(seg));

process.stdout.write('入居者マスタ 編集画面の対象アプリ: 合格 ' + ok + ' / 不合格 ' + ng + '\n');
process.exit(ng ? 1 : 0);
