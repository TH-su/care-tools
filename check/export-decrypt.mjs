/* check/export-decrypt.mjs — 暗号化した全データの書き出し（.suenc）を、ターミナルで元の ZIP に戻す（2026-10-26 新設・本人指示）
 *
 *   node check/export-decrypt.mjs <書き出し.zip.suenc> [-o 出力.zip]
 *
 * ・パスフレーズは端末のプロンプトで聞く（打った文字は表示しない）。引数では受けない（コマンドの履歴に残るため）。
 *   環境変数 SU_EXPORT_PASS は試験用にだけ読む（ふだんは使わない）
 * ・暗号の方式は画面と同じ su-export-crypt.js を vm で読んで使う（同じ1本＝画面で作った物は必ずここで開ける）
 * ・出力の既定は、入力の名前から .suenc を外した名前（同じフォルダ）。すでにある時は上書きしない
 * ・中身の値・パスフレーズは画面（ターミナル）に出さない。出すのはファイル名と大きさだけ
 * ・外への通信はしない
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage(msg) {
  if (msg) console.error(msg);
  console.error('使い方: node check/export-decrypt.mjs <書き出し.zip.suenc> [-o 出力.zip]');
  process.exit(2);
}

export function loadCrypt() {
  const box = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise, Error, String, crypto: globalThis.crypto };
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'su-export-crypt.js'), 'utf8'), box, { filename: 'su-export-crypt.js' });
  return box.SUExportCrypt;
}

/* 打った文字を表示しないプロンプト（Enter で確定・Ctrl-C で止める） */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('パスフレーズを聞けません（ターミナルから直接実行してください）。')); return; }
    process.stderr.write(question);
    let s = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      if (err) reject(err); else resolve(s);
    };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { done(); return; }
        if (ch === '\u0003') { done(new Error('止めました。')); return; }
        if (ch === '\u007f' || ch === '\b') { s = Array.from(s).slice(0, -1).join(''); continue; }
        if (ch >= ' ') s += ch;
      }
    }
    stdin.on('data', onData);
  });
}

async function main(argv) {
  let input = '', output = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o') { output = argv[++i] || ''; if (!output) usage('-o の後に出力の名前を書いてください。'); }
    else if (argv[i].startsWith('-')) usage('知らない指定です: ' + argv[i]);
    else if (!input) input = argv[i];
    else usage('入力は1つだけです。');
  }
  if (!input) usage();
  if (!fs.existsSync(input)) usage('ファイルがありません: ' + input);
  if (!output) output = /\.suenc$/i.test(input) ? input.replace(/\.suenc$/i, '') : input + '.zip';
  if (path.resolve(output) === path.resolve(input)) usage('出力の名前が入力と同じです。-o で別の名前を指定してください。');
  if (fs.existsSync(output)) usage('出力先にもうファイルがあります（上書きしません）: ' + output);

  const X = loadCrypt();
  const bytes = fs.readFileSync(input);
  let pass = process.env.SU_EXPORT_PASS != null ? process.env.SU_EXPORT_PASS : await askHidden('パスフレーズ: ');
  let plain;
  try {
    plain = await X.decrypt(bytes, pass);
  } finally {
    pass = null;
  }
  fs.writeFileSync(output, plain, { flag: 'wx', mode: 0o600 });
  console.error('戻しました: ' + output + '（' + Math.round(plain.length / 1024) + ' KB）');
}

function isMain() {
  try { return fs.realpathSync(path.resolve(process.argv[1] || '')) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch (e) { return false; }
}
if (isMain()) {
  main(process.argv.slice(2)).catch((e) => {
    /* 例外の文は su-export-crypt.js の決まった文か、この道具の文だけ（値・パスフレーズは入らない） */
    console.error('開けませんでした: ' + (e && e.code && /^[a-z]+$/.test(e.code) ? e.message : (e && e.message && /[ぁ-ん]/.test(e.message) ? e.message : '読み書きに失敗しました')));
    process.exit(1);
  });
}
