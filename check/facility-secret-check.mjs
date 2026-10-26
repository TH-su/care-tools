#!/usr/bin/env node
// 施設情報の Secret（FACILITY_PROFILE_JSON）を貼る前に手元で確かめる道具（2026-10-26 本人指示）
//
// 公開の手順（.github/workflows/pages.yml の「本番の施設情報を置く」）も、この判定（checkFacilityProfile）を使う。
// 手元で OK なら、公開の手順でも同じ理由では止まらない。
//
// ★値は出さない。NG の時に出すのは「どの項目が、どう違うか」だけ（施設名・電話・住所などの中身は1文字も出さない）。
//   JSON として読めない時も、Node のエラー文（中身の一部を含むことがある）は出さず、行と文字の位置だけを出す。
//
// 使い方（ターミナル・care-tools のフォルダで）:
//   node check/facility-secret-check.mjs 施設情報.json      … ファイルを確かめる
//   node check/facility-secret-check.mjs --clip             … クリップボードの中身を確かめる（Mac の pbpaste）
//   pbpaste | node check/facility-secret-check.mjs          … 標準入力から
//   --github を付けると NG を ::error:: の形で出す（公開の手順用）
//   終了コード: 0＝OK／1＝NG／2＝使い方の誤り・ファイルが読めない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = ['施設', '訪問', '通所'];
const SUPPORT_KEYS = ['contactName', 'contactTel', 'hours', 'emergency', 'replyTarget'];
// 固定電話・IP電話・フリーダイヤルの形（ハイフンあり・なし）。携帯（070・080・090）は別に断る
const TEL_RE = /^(0\d{1,4}-\d{1,4}-\d{3,4}|0\d{9,10})$/;
const MOBILE_RE = /^0[789]0/;
const TEL_IN_TEXT_RE = /0\d{1,4}-?\d{1,4}-?\d{3,4}/g;
const PLACEHOLDER_RE = /【書き換える】|000-000-0000/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const filled = (v) => isStr(v) && v.trim() !== '';

/* JSON の位置（文字数）から行と文字の位置を出す。エラー文の中身は使わない */
function posOf(text, err) {
  const m = /position (\d+)/.exec(String(err && err.message));
  if (!m) return '';
  const at = Math.min(Number(m[1]), text.length);
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const col = at - before.lastIndexOf('\n');
  return `（${line} 行目 ${col} 文字目のあたり）`;
}

/**
 * 施設情報の JSON の文字列を確かめる。値は返さない。
 * @param {string} text 確かめる JSON の文字列
 * @param {string} sampleText 見本 facility-profile.sample.json の文字列（見本のままかの判定に使う）
 * @returns {{ok: boolean, errors: string[], summary: string}}
 */
export function checkFacilityProfile(text, sampleText) {
  const errors = [];
  const ng = (where, why) => errors.push(`${where}：${why}`);
  if (!isStr(text) || text.trim() === '') return { ok: false, errors: ['全体：空です（何も貼られていません）'], summary: '' };
  let p;
  try { p = JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    const fw = /[“”＂：，｛｝]/.test(text) ? '。全角の “ ” ： ， ｛ ｝ が混ざっていないかも見てください' : '';
    return { ok: false, errors: [`全体：JSON として読めません${posOf(text, e)}。カンマの抜け・余り、かっこの対応を見てください${fw}`], summary: '' };
  }
  if (!isObj(p)) return { ok: false, errors: ['全体：{ } で囲んだ1つのかたまりではありません（一部分だけを貼っていないか）'], summary: '' };
  let s = {};
  try { s = JSON.parse(sampleText || '{}'); } catch (e) { s = {}; }

  // 必須の項目
  for (const k of ['corpName', 'facilityName']) {
    if (!(k in p)) ng(k, 'ありません（必須）');
    else if (!filled(p[k])) ng(k, '文字が入っていません（必須・文字）');
  }
  if (!Array.isArray(p.offices)) ng('offices', (('offices' in p) ? '一覧（[ ]）ではありません' : 'ありません（必須）'));
  else {
    p.offices.forEach((o, i) => {
      const w = `offices[${i}]`;
      if (!isObj(o)) { ng(w, '{ } のかたまりではありません'); return; }
      if (!filled(o.kind)) ng(`${w}.kind`, '文字が入っていません');
      if (!filled(o.name)) ng(`${w}.name`, '文字が入っていません');
      if ('tel' in o && !isStr(o.tel)) ng(`${w}.tel`, '文字ではありません');
      else if (filled(o.tel) && !TEL_RE.test(o.tel.trim())) ng(`${w}.tel`, '電話の形ではありません（例 096-000-0000 の形・空でもよい）');
    });
    const kinds = p.offices.filter(isObj).map((o) => o.kind).sort();
    if (JSON.stringify(kinds) !== JSON.stringify([...KINDS].sort())) ng('offices', '施設・訪問・通所 の3つがそろっていません（kind が1つずつ）');
  }

  // 見本のまま
  if ((filled(s.facilityName) && p.facilityName === s.facilityName) || (filled(s.corpName) && p.corpName === s.corpName)) {
    ng('corpName / facilityName', '見本（架空の施設）のままです');
  }

  // 型だけ確かめる項目（無くてもよい）
  if ('version' in p && typeof p.version !== 'number') ng('version', '数ではありません');
  if ('municipality' in p && !isStr(p.municipality)) ng('municipality', '文字ではありません');
  if ('corpSettings' in p) {
    if (!isObj(p.corpSettings)) ng('corpSettings', '{ } のかたまりではありません');
    else {
      const u = p.corpSettings.homeGuidelineUrl;
      if (u !== undefined && !isStr(u)) ng('corpSettings.homeGuidelineUrl', '文字ではありません');
      else if (filled(u) && !/^https:\/\/[^\s"<>]+$/.test(u.trim())) ng('corpSettings.homeGuidelineUrl', 'https:// で始まる URL ではありません（画面には出ません）');
    }
  }
  if ('floors' in p) {
    if (!Array.isArray(p.floors)) ng('floors', '一覧（[ ]）ではありません');
    else p.floors.forEach((f, i) => {
      if (!isObj(f) || typeof f.no !== 'number' || !Number.isInteger(f.no) || f.no < 1 || f.no > 9) ng(`floors[${i}].no`, '1〜9 の整数ではありません');
    });
  }
  if ('visitingClinics' in p) {
    if (!Array.isArray(p.visitingClinics)) ng('visitingClinics', '一覧（[ ]）ではありません');
    else p.visitingClinics.forEach((c, i) => { if (!isObj(c) || !filled(c.name)) ng(`visitingClinics[${i}].name`, '文字が入っていません'); });
  }
  if ('roomPlan' in p && p.roomPlan !== null) {
    if (!isObj(p.roomPlan)) ng('roomPlan', '{ } のかたまりではありません');
    else for (const k of Object.keys(p.roomPlan)) {
      if (!isObj(p.roomPlan[k]) || !Array.isArray(p.roomPlan[k].cells)) ng(`roomPlan.${k}`, 'cells の一覧がありません');
    }
  }

  // 問い合わせ先（support）
  if ('support' in p) {
    if (!isObj(p.support)) ng('support', '{ } のかたまりではありません');
    else {
      for (const k of SUPPORT_KEYS) {
        const v = p.support[k];
        if (v !== undefined && !isStr(v)) { ng(`support.${k}`, '文字ではありません'); continue; }
        if (filled(v) && PLACEHOLDER_RE.test(v)) ng(`support.${k}`, '見本の値（000-000-0000）か【書き換える】が残っています');
      }
      const tel = p.support.contactTel;
      if (filled(tel) && !PLACEHOLDER_RE.test(tel)) {
        const t = tel.trim();
        if (!TEL_RE.test(t)) ng('support.contactTel', '電話の形ではありません（例 096-000-0000 の形）');
        else if (MOBILE_RE.test(t)) ng('support.contactTel', '携帯の番号の形（070・080・090）です。公表済みの事業所の番号だけを入れる決まりです');
      }
      if (filled(p.support.emergency) && (p.support.emergency.match(TEL_IN_TEXT_RE) || []).some((n) => MOBILE_RE.test(n))) {
        ng('support.emergency', '携帯の番号の形（070・080・090）が入っています。公表済みの事業所の番号だけを入れる決まりです');
      }
    }
  }

  const nSup = isObj(p.support) ? SUPPORT_KEYS.filter((k) => filled(p.support[k])).length : 0;
  const summary = `事業所 ${Array.isArray(p.offices) ? p.offices.length : 0} つ・項目 ${Object.keys(p).filter((k) => !k.startsWith('_')).length} 個・問い合わせ先 ${nSup}/5 項目・見本ではない`;
  return { ok: errors.length === 0, errors, summary };
}

/* ── 手元・公開の手順から呼ぶ入口 ── */
function main(argv) {
  const gh = argv.includes('--github');
  const clip = argv.includes('--clip');
  const files = argv.filter((a) => !a.startsWith('--'));
  let text;
  try {
    if (clip) text = execFileSync('pbpaste', { encoding: 'utf8' });
    else if (files[0]) text = fs.readFileSync(files[0], 'utf8');
    else if (!process.stdin.isTTY) text = fs.readFileSync(0, 'utf8');
    else { console.error('使い方: node check/facility-secret-check.mjs <ファイル>｜--clip｜（標準入力）'); return 2; }
  } catch (e) { console.error('読めませんでした（' + (e.code || 'エラー') + '）'); return 2; }
  let sample = '';
  try { sample = fs.readFileSync(path.join(ROOT, 'facility-profile.sample.json'), 'utf8'); } catch (e) { sample = ''; }
  const r = checkFacilityProfile(text, sample);
  if (r.ok) { console.log('施設情報: 形はOK（' + r.summary + '）'); return 0; }
  for (const e of r.errors) console.log(gh ? '::error::施設情報 ' + e : 'NG ' + e);
  console.log(`施設情報: ${r.errors.length} 件の違いがあります。直してから、もう一度確かめてください（値は表示していません）`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
