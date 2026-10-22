/* facility_names_zero_test.js — 公開リポジトリに施設名・事業所名・会社名と、事業所番号・電話・住所を書かない（2026-10-16・販売ゲート2「固有データ0件」）
 *
 * 監査10月版（第3・第4版）の数え方と同じ5語を、公開リポジトリに入るテキストのファイル全部で数え、0件であることを固定する。
 * 施設の名前は画面では施設情報（facility-profile.json・配信の時に Secret から置く）から読む。コメント・見本・試験にも書かない。
 * ★この試験の中にも語そのものは書かない（つなぎ合わせて作る）。非公開の gas/ は .gitignore で公開に入らないので数えない。
 *
 * 2026-10-22（改善プロンプト第3弾の10・設定化計画 v1 の「進める順番」の1）:
 * ・見るファイルの拡張子に gs・command・webmanifest・sh・plist を足す
 * ・事業所番号・電話・住所の形も数える。見本（000 で始まる・架空・見本の語）は通す。
 *   - 事業所番号: 10桁の数字が、同じ行の「事業所番号」や officeNo などの近くに出たら止める（10桁の数字だけでは止めない＝圧縮した部品の中身で誤って止まるため）
 *   - 電話: 市外局番の形（0 から始まる3つの数字の組）。最初の組か真ん中の組が 0 だけなら見本として通す。区切りの無い 10〜11桁は、同じ行に電話・TEL・FAX がある時だけ止める
 *   - 住所: 都道府県・市区町村の名前に「丁目・番地・数字-数字」が続く形。市の名前だけでは止めない（職員マスタの自治体の切り替えが市の名前を使うため）
 * ★検査の確かめに使う番号・住所も、行の中に形がそのまま出ないよう、実行時につなぎ合わせて作る。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const WORDS = [['ラウレア', 'ハレ'], ['いず', 'み'], ['せせ', 'らぎ'], ['シルバー', 'ユニックス'], ['silver', '-unix']].map(a => a.join(''));
const TEXT = /\.(html?|js|mjs|cjs|jsx|ts|css|md|json|ya?ml|txt|svg|gs|command|webmanifest|sh|plist)$/i;

let pass = 0, fail = 0;
function t(name, ok, info) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

// ── 事業所番号・電話・住所の検査（1行を受け取り、見つけた形の配列を返す） ──
const D = '[0-9０-９]';
const DASH = '[-‐－ー−]';
const allZero = s => /^[0０]+$/.test(s);

const OFFICE_KEY = /事業所番号|事業所No|事業所ＮＯ|officeNo|office_no|officeNumber|jigyosho/i;
const TEN = new RegExp('(?<!' + D + ')' + D + '{10}(?!' + D + ')', 'g');
function findOfficeNos(line) {
  if (!OFFICE_KEY.test(line)) return [];
  return [...line.matchAll(TEN)].map(m => m[0]).filter(n => !allZero(n.slice(0, 6)));   // 見本は 000000 で始まる
}

const PHONE = new RegExp('(?<![0-9０-９.\\-])([0０]' + D + '{1,4})(?:' + DASH + '|[(（])(' + D + '{1,4})(?:' + DASH + '|[)）])(' + D + '{3,4})(?!' + D + '|' + DASH + ')', 'g');
// 区切りの無い形は、鍵語のすぐ後ろ（30字以内）にある時だけ見る。大文字小文字を区別する（圧縮した部品の hotel・Telemetry などで止めない）
const PHONE_KEY = /電話|ＴＥＬ|ＦＡＸ|\bTEL\b|\bFAX\b|\btel:/g;
const PHONE_FLAT = new RegExp('(?<!' + D + ')[0０]' + D + '{9,10}(?!' + D + ')', 'g');
function findPhones(line) {
  const out = [];
  for (const m of line.matchAll(PHONE)) { if (!allZero(m[1]) && !allZero(m[2])) out.push(m[0]); }
  for (const k of line.matchAll(PHONE_KEY)) {
    const near = line.slice(k.index, k.index + k[0].length + 30);
    for (const m of near.matchAll(PHONE_FLAT)) { if (!allZero(m[0].slice(0, 6))) out.push(m[0]); }
  }
  return out;
}

const KANA = '[一-龥々ぁ-んァ-ヶ]';
const ADDR = new RegExp(KANA + '{1,8}[都道府県市区町村郡]' + KANA + '{0,12}(?:' + D + '+丁目|' + D + '+番地|' + D + '{1,4}' + DASH + D + '{1,4})', 'g');
const ADDR_SAMPLE = /架空|見本|サンプル|〇|○/;
function findAddresses(line) {
  return [...line.matchAll(ADDR)].map(m => m[0]).filter(a => !ADDR_SAMPLE.test(a));
}

// ── 検査そのものの確かめ（つなぎ合わせて作った形で、止めるべきものを止め、見本を通すこと） ──
const j = (...a) => a.join('');
t('事業所番号: 「事業所番号」の近くの10桁を止める', findOfficeNos(j('事業所番号: ', '4371', '23456', '7')).length === 1);
t('事業所番号: officeNo の近くの10桁を止める', findOfficeNos(j('"officeNo": "', '4371', '234567', '"')).length === 1);
t('事業所番号: 見本（000000 で始まる）は通す', findOfficeNos(j('"officeNo": "', '000000', '0001', '"')).length === 0);
t('事業所番号: 鍵語の無い行の10桁は止めない', findOfficeNos(j('var x = ', '12345', '67890', ';')).length === 0);
t('電話: 市外局番の形を止める', findPhones(j('0', '11-2', '34-56', '78')).length === 1);
t('電話: 括弧の形を止める', findPhones(j('0', '11(2', '34)56', '78')).length === 1);
t('電話: 全角の数字も止める', findPhones(j('０', '１１－２', '３４－５', '６７８')).length === 1);
t('電話: 最初の組が 0 だけの見本は通す', findPhones(j('000', '-000-', '0000')).length === 0);
t('電話: 真ん中の組が 0 だけの見本は通す', findPhones(j('0', '11-000', '-1111')).length === 0);
t('電話: 日付・版の番号は止めない', findPhones('2026-10-22 v1.2.3 10-20-30').length === 0);
t('電話: 区切りの無い形は「電話」の行だけ止める', findPhones(j('電話 0', '112', '345678')).length === 1 && findPhones(j('id 0', '112', '345678')).length === 0);
t('電話: 圧縮した部品の英単語（hotel など）の近くの数字は止めない', findPhones(j('hotel=0', '112', '345678;Telemetry 0', '112345678')).length === 0);
t('住所: 市の名前に丁目が続く形を止める', findAddresses(j('甲', '乙市', '中央', '3丁目')).length === 1);
t('住所: 県・市・町に数字-数字が続く形を止める', findAddresses(j('甲', '乙県', '甲乙市', '中町', '1', '-2')).length === 1);
t('住所: 架空・見本の住所は通す', findAddresses(j('架空県架空市', '1-2')).length === 0 && findAddresses(j('見本県見本市見本町', '1-2')).length === 0);
t('住所: 市の名前だけでは止めない', findAddresses(j('甲', '乙市', 'の指針')).length === 0);

function trackedFiles() {
  try {
    return cp.execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
  } catch (e) {
    return null;   // git の無い所では数えられない＝失敗にする（空振りを成功にしない）
  }
}

const files = trackedFiles();
t('公開リポジトリのファイルの一覧を取れる', Array.isArray(files) && files.length > 50, files && files.length);
const hits = [], offices = [], phones = [], addrs = [];
let scanned = 0;
const exts = new Set();
(files || []).filter(f => TEXT.test(f)).forEach(f => {
  let s;
  try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return; }
  scanned++;
  exts.add(path.extname(f).toLowerCase());
  s.split('\n').forEach((line, i) => {
    const at = f + ':' + (i + 1);
    WORDS.forEach(w => { if (line.includes(w)) hits.push(at + '（語' + (WORDS.indexOf(w) + 1) + '）'); });
    // 中身は出さない（場所と種類だけ）。実在の番号・住所を試験の出力に写さないため
    if (findOfficeNos(line).length) offices.push(at);
    if (findPhones(line).length) phones.push(at);
    if (findAddresses(line).length) addrs.push(at);
  });
});
t('テキストのファイルを数えた（空振りでない）', scanned > 50, scanned);
t('足した拡張子（gs・command・webmanifest）のファイルも数えた', ['.gs', '.command', '.webmanifest'].every(e => exts.has(e)), [...exts].sort());
t('施設名・事業所名・会社名（5語）が公開リポジトリに0件', hits.length === 0, hits.slice(0, 10));
t('事業所番号（見本を除く）が公開リポジトリに0件', offices.length === 0, offices.slice(0, 10));
t('電話番号（見本を除く）が公開リポジトリに0件', phones.length === 0, phones.slice(0, 10));
t('住所（架空・見本を除く）が公開リポジトリに0件', addrs.length === 0, addrs.slice(0, 10));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
