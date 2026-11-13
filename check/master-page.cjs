/* 入居者マスタの画面の文字を、スクリプトを分ける前（2026-11-13 より前）と同じ形に戻して読む道具（試験が使う・画面は使わない）。
 *
 * 2026-11-13 に resident-master.html の中の大きなスクリプトを resident-master.js へ移した（代表者の決定 2026-11-12「1. スクリプトを分ける」）。
 * 薬の変更候補の判定の区間（MC-JUDGE-BEGIN〜END）だけは、朝回診の定期タスクが HTML から取り出すため HTML の中に残している。
 * HTML の文字を読んで確かめる試験は、ここで「区間＋読み込みの札」を移す前の1本の <script> に戻してから読む
 * （戻した文字は移す前の HTML と同じ。確かめる中身は変えない）。
 *
 *   const { readMaster, masterPage } = require('../master-page.cjs');
 *   readMaster(file)   … file を読み、分けた形なら同じフォルダの resident-master.js を使って戻す（分ける前の版のファイルはそのまま返す）
 *   masterPage(html, js) … 文字だけで戻す（js を省くとリポジトリの resident-master.js を読む）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TAG_RE = /<!-- 薬の変更候補の判定の区間。[\s\S]*?-->\n<script>\n(\/\* ==== 薬の変更候補の判定ここから（MC-JUDGE-BEGIN）[\s\S]*?\/\* ==== 薬の変更候補の判定ここまで（MC-JUDGE-END） ==== \*\/\n)<\/script>\n<script src="resident-master\.js\?v=[^"]*"><\/script>/;
const ANCHOR = '/* 開ける候補すべて（変更らしい候補＋畳んだ候補） */\nfunction mcAll_';

function masterPage(html, js) {
  const src = String(html);
  const m = TAG_RE.exec(src);
  if (!m) return src;   // 分ける前の版
  const code = js != null ? String(js) : fs.readFileSync(path.join(ROOT, 'resident-master.js'), 'utf8');
  const at = code.indexOf(ANCHOR);
  if (at < 0 || code.indexOf(ANCHOR, at + 1) >= 0) throw new Error('resident-master.js に区間を戻す目印が1つだけ見つかりません');
  const whole = code.slice(0, at) + m[1] + code.slice(at);
  return src.slice(0, m.index) + '<script>\n' + whole + '</script>' + src.slice(m.index + m[0].length);
}

function readMaster(file) {
  const f = file || path.join(ROOT, 'resident-master.html');
  const html = fs.readFileSync(f, 'utf8');
  if (!TAG_RE.test(html)) return html;
  return masterPage(html, fs.readFileSync(path.join(path.dirname(f), 'resident-master.js'), 'utf8'));
}

module.exports = { masterPage, readMaster };
