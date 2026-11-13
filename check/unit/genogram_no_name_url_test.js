/* 家族構成図へ氏名を URL で渡さない試験（代表者の決定 2026-11-13・台帳 FS-04・GN-04）
   実行: node check/unit/genogram_no_name_url_test.js（GENO_HTML で別の genogram.html を当てられる）
   ねらい:
     ・入口（フェイスシート・入居者マスタ・この方の画面）は ?resident=<番号> だけを渡し、氏名を URL に載せない
     ・家族構成図は番号から共有名簿（su_residents_common）で氏名を引く。決められない時は空にして帯で知らせる
     ・古い URL（?name= 付き）で開かれても動き、開いたらすぐ URL から name を消す（何より先に）
     ・氏名の分からない時は、前回の図・下書き（別の方のものかもしれない）を開かない
     ・新しく足した記録（SUErrors.note）・コンソールに氏名を書かない
   ★氏名は全部架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const GENO = fs.readFileSync(process.env.GENO_HTML || path.join(ROOT, 'genogram.html'), 'utf8');
const FACE = fs.readFileSync(path.join(ROOT, 'facesheet.html'), 'utf8');
const RMJS = fs.readFileSync(path.join(ROOT, 'resident-master.js'), 'utf8');
const RMHTML = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');

let ok = 0, ng = 0;
function t(label, cond, info) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { ng++; console.log('  ✗ ' + label + (info !== undefined ? '  … ' + JSON.stringify(info).slice(0, 300) : '')); }
}
/* 波かっこを数えて関数を切り出す（文字列の中のかっこは数えない） */
function grabFn(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false, q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
const box = { window: {}, URLSearchParams };
vm.runInNewContext([grabFn(GENO, 'suGenoNameFromRoster'), grabFn(GENO, 'suGenoUrlWithoutName'), grabFn(GENO, 'suGenoMasterIdFor'),
  'this.nameOf = suGenoNameFromRoster; this.strip = suGenoUrlWithoutName; this.midFor = suGenoMasterIdFor;'].join('\n'), box);

console.log('1 番号から共有名簿で氏名を引く（suGenoNameFromRoster）');
const roster = [{ masterId: 'A1', name: '見本 一郎' }, { masterId: 'B2', name: '架空 花子' }, { masterId: 'D4', name: '' }, { masterId: 'E5', name: '重複 一' }, { masterId: 'E5', name: '重複 二' }];
t('1a 番号が1名にだけ一致すればその氏名', box.nameOf('B2', roster) === '架空 花子', box.nameOf('B2', roster));
t('1b 数字の番号も文字の番号と同じに扱う', box.nameOf(7, [{ masterId: '7', name: '見本 七' }]) === '見本 七');
t('1c 名簿に無い番号は空', box.nameOf('Z9', roster) === '');
t('1d 同じ番号が2名あれば空（どちらか決めない）', box.nameOf('E5', roster) === '');
t('1e 氏名の入っていない行は空', box.nameOf('D4', roster) === '');
t('1f 名簿が無い・壊れている・番号が無い時は空', box.nameOf('A1', null) === '' && box.nameOf('A1', { residents: [] }) === '' && box.nameOf(null, roster) === '' && box.nameOf('', roster) === '');
t('1g 名簿の中の壊れた行で止まらない', box.nameOf('A1', [null, 1, 'x', { masterId: 'A1', name: '見本 一郎' }]) === '見本 一郎');

console.log('2 古い URL の name を消した住所（suGenoUrlWithoutName）');
const nm = encodeURIComponent('見本 一郎');
const u1 = box.strip('?resident=12&name=' + nm, '/care-tools/genogram.html', '');
t('2a name を消し、resident は残す', u1 === '/care-tools/genogram.html?resident=12', u1);
t('2b 消した住所に氏名（そのまま・符号化）が残らない', u1.indexOf('見本') < 0 && u1.indexOf(nm) < 0, u1);
t('2c name が先頭・# の後ろもそのまま', box.strip('?name=' + nm + '&resident=3', '/g.html', '#x') === '/g.html?resident=3#x');
t('2d name だけの時は ? も残さない', box.strip('?name=' + nm, '/g.html', '') === '/g.html');
t('2e name が無ければ書き換えない（null）', box.strip('?resident=12', '/g.html', '') === null && box.strip('', '/g.html', '') === null);
t('2f name が2つ付いていても全部消す', box.strip('?name=a&resident=1&name=b', '/g.html', '') === '/g.html?resident=1');

console.log('3 家族構成図の起動（init）');
const init = GENO.slice(GENO.indexOf('async function init() {'), GENO.indexOf('\ninit();'));
const iStrip = init.indexOf('history.replaceState(history.state, \'\', suClean)');
t('3a init が URL から name を消す（history.replaceState）', iStrip > 0);
t('3b 消すのは何より先（UI の配線・受け口の確かめ・一覧の読込より前）',
  iStrip > 0 && iStrip < init.indexOf('bindUIEvents();') && iStrip < init.indexOf('CloudSync.authWatch()') && iStrip < init.indexOf('refreshDocList();'));
t('3c 氏名は共有名簿の番号で引き、名簿に無い時だけ古い URL の氏名を使う',
  /suName = suGenoNameFromRoster\(window\._suMasterId, suRr && suRr\.residents\);[\s\S]{0,60}if \(!suName\) suName = suOldName;/.test(init));
t('3d 古い URL の氏名の控えは使った後に捨てる', /if \(!suName\) suName = suOldName;\s*suOldName = '';/.test(init));
t('3e 番号はあって氏名を引けない時の印（_suNameMissing）', /window\._suNameMissing = !!\(window\._suMasterId && !suName\);/.test(init));
t('3f 氏名を引けない時は下書きを尋ねない（別の方の下書きを戻さない）', /const draftAsk = window\._suNameMissing \? Promise\.resolve\(false\) : offerDraftRestore\(suName\);/.test(init));
t('3g 氏名を引けない時は前回の図（LS_LAST）を開かず空の新規で始める',
  /\} else if \(window\._suNameMissing\) \{[\s\S]{0,200}render\(\);\s*markClean\(\);\s*\} else \{\s*const last = localStorage\.getItem\(LS_LAST\);/.test(init));
t('3h 名簿の氏名は今までどおり束縛に使う（window._suMasterName = suName）', init.indexOf('window._suMasterName = suName') > 0);
t('3i URL の resident はそのまま読む（再読み込みで同じ方を開く）', /window\._suMasterId = suParams \? \(suParams\.get\('resident'\) \|\| null\) : null;/.test(init));

console.log('4 知らせの帯');
t('4a 氏名を引けない間は帯（role=status）に職員向けの文を出す',
  /const SU_NAME_MISSING_MSG = '入居者マスタの名簿から、この方のお名前を読めませんでした。[^']*';/.test(GENO) && /if \(miss\) \{ bar\.textContent = SU_NAME_MISSING_MSG; bar\.hidden = false; \}/.test(GENO)
  && /id="suHopBar" role="status"/.test(GENO));
t('4b 帯は文字として入れる（innerHTML を使わない）', !/suHopBar[^\n]*innerHTML|bar\.innerHTML/.test(GENO));

console.log('5 氏名が空のまま保存しても番号の鍵を書かない（suGenoMasterIdFor）');
box.window._suGenoBound = null; box.window._suGenoBlocked = null;
t('5a 束縛の氏名が空なら、どの文書名でも番号を返さない', box.midFor('見本 一郎', 'A1', '') === '' && box.midFor('', 'A1', '') === '');
t('5b 名簿の氏名と同じ文書名の時だけ番号（今までどおり）', box.midFor('見本一郎', 'A1', '見本 一郎') === 'A1' && box.midFor('架空 花子', 'A1', '見本 一郎') === '');

console.log('6 入口は番号だけを渡す');
t('6a フェイスシート: 家族構成図へ ?resident= だけで移る', /location\.href=GENOGRAM_APP\+'\?resident='\+encodeURIComponent\(id\);/.test(FACE));
t('6b 入居者マスタ: 家族構成図の枠から ?resident= だけで移る', /function openGenogram\(id\)\{\s*if\(id==null\)return;\s*location\.href=GENOGRAM_APP\+'\?resident='\+encodeURIComponent\(id\);/.test(RMJS));
t('6c 入居者マスタ: 「この方を各アプリで開く」の家族構成図も ?resident= だけ', /if\(href==='genogram\.html'\)\{\s*return href\+'\?resident='\+encodeURIComponent\(id\);\s*\}/.test(RMJS));
for (const [nmf, src] of [['facesheet.html', FACE], ['resident-master.js', RMJS], ['resident-master.html', RMHTML]]) {
  t('6d ' + nmf + ': 家族構成図への URL に name= を組み立てない', !/['"]&name='|\?name='/.test(src));
  t('6e ' + nmf + ': 家族構成図の枠に氏名の属性（data-name）を持たない', !/class="geno-box"[^>]*data-name=/.test(src));
}
/* 動かして確かめる: 入居者マスタの residentLink */
const rbox = {};
const pra = RMJS.indexOf('var PER_RESIDENT_APPS=');
vm.runInNewContext([RMJS.slice(pra, RMJS.indexOf('};', pra) + 2), grabFn(RMJS, 'residentLink'), 'this.link = residentLink;'].join('\n'), rbox);
const gl = rbox.link('genogram.html', '12', '見本 一郎');
t('6f residentLink の家族構成図は genogram.html?resident=12 だけ', gl === 'genogram.html?resident=12', gl);

console.log('7 記録・コンソールに氏名を書かない');
const added = init.slice(0, init.indexOf('bindUIEvents();'));
t('7a URL を消す所の記録は場所の名前だけ（氏名・文書名を渡さない）', /SUErrors\.note\('起動の失敗', e, 'genogram:URL の名前を消す'\)/.test(added) && !/note\([^)]*(suOldName|suName|suParams)/.test(added));
t('7b 家族構成図の画面は console.log を使わない', !/console\.log\(/.test(GENO));
t('7c 名簿で氏名を引く所は記録もコンソールも使わない', !/console\.|SUErrors/.test(grabFn(GENO, 'suGenoNameFromRoster')));

console.log('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
process.exit(ng ? 1 : 0);
