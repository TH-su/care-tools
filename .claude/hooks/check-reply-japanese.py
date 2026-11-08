#!/usr/bin/env python3
"""Stopフック: 返信の日本語ガード（2026-09-25 新設・2026-11-07 リポジトリにも置いた）

置き場  : 正本は代表者の Mac の ~/.claude/scripts/check-reply-japanese.py（claude-config）。クラウドのセッションは Mac の設定を
         読まないため、2026-11-07 にクラウドで英語の返信が何度も出た（本人に何度も直させた）。そこでこの写しを
         リポジトリの .claude/hooks/ に置き、.claude/settings.json の Stop フックから呼ぶ。中身は正本と同じにする。

目的   : Claude の最終返信が英語のままターンを終えるのを機械的に止める。
         2026-09-25、care-tools のセッションで報告が2回続けて英語で出て、
         本人に「日本語に直せ」と2度言わせた（CLAUDE.md の「日本語で応答」は文章の規約だけでは守られなかった）。

検査2  : 日本では使わない字（簡体字）が地の文に1字でもあれば止める（2026-10-05 追加・下の chinese_only_chars）。
検査   : 最終 assistant メッセージの本文から、コードフェンス・インラインコード・URL・Markdown リンクの href を除き、
         残りの「かな・漢字の字数」と「英字の字数」を数える。本文が一定量あり、日本語の割合が低ければ英語の返信とみなす。
         パス・関数名・コマンドはコード表記の中に置く運用なので、除外後の英字は地の文の英語とみなしてよい。

例外   : 直前のユーザー発言に「英語」「English」「英訳」が含まれる時は、英語での返答を求められたとみなして通す。

挙動   : 検出時 exit 2（ブロック）で日本語で出し直す指示を返す。修正後の続行ターンは
         stop_hook_active=true で素通し（無限ループ防止・check-reply-links.py と同型）。
方針   : fail-open（例外・パース不能はすべて exit 0）。stdout には何も出さない。
無効化 : ~/.claude/tmp/jaguard_off を作成（キルスイッチ）。
テスト : REPLYJA_TRANSCRIPT 環境変数でトランスクリプトを差し替え可能（stdin 不要で単体試験できる）。
"""
import json
import os
import re
import sys

KILL = os.path.expanduser("~/.claude/tmp/jaguard_off")

MIN_BODY = 120      # 除外後の本文がこれより短い返信は判定しない（「了解」等の短文で誤検知しない）
MIN_JA_RATIO = 0.3  # 日本語字数 /（日本語字数 + 英字数）がこれ未満なら英語の返信とみなす
                    # 2026-09-25 実測（直近60セッション・1,024返信）: 英語の返信は 0.20 以下、日本語は 0.45 以上で、あいだは0件

FENCE = re.compile(r"```.*?```", re.S)
INLINE = re.compile(r"`[^`\n]*`")
MDLINK_HREF = re.compile(r"\]\([^)]*\)")
URL = re.compile(r"https?://\S+")
JA = re.compile(r"[぀-ヿ㐀-鿿ｦ-ﾟ]")
LATIN = re.compile(r"[A-Za-z]")
ASK_EN = re.compile(r"英語|英訳|English", re.I)

# 簡体字の検査（2026-10-05 追加）: 日本語の返信に、日本では使わない字（簡体字）が混ざるのを止める。
# 10/04 の評価で冒頭の「検証」を「检证」と書いた（Opus・記録 20261004-234322）。
# 日本の字か＝JIS X 0213（shift_jis_2004）か Windows の日本語の字（cp932・髙 等の名前の異体字）で表せるか。
# 鉤括弧・引用符・コードの中は引用として除く（誤字を話題にする時に止めない）。
# 実測: この会話の返信 435件・規約や記憶の文書 177件（約48万字）で誤検出 0。簡体字 59字のうち 55字を検出（残り4字は日本でも使う字）
HAN = re.compile("[\u3400-\u4DBF\u4E00-\u9FFF]")
QUOTED = re.compile("「[^」\n]*」|『[^』\n]*』|“[^”\n]*”", re.S)


def chinese_only_chars(text):
    body = QUOTED.sub("", INLINE.sub("", FENCE.sub("", text)))
    out = []
    for c in HAN.findall(body):
        for enc in ("shift_jis_2004", "cp932"):
            try:
                c.encode(enc)
                break
            except UnicodeEncodeError:
                continue
        else:
            out.append(c)
    return out


def _texts(ev):
    content = (ev.get("message") or {}).get("content")
    if isinstance(content, str):
        return [content]
    return [b.get("text", "") for b in (content or [])
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text")]


def last_turn(path):
    """(最終 assistant の text, その前の最後の本物のユーザー発言) を返す。"""
    try:
        with open(path, "rb") as f:
            lines = f.readlines()[-800:]
    except OSError:
        return None, None
    reply, prompt = None, None
    for raw in reversed(lines):
        try:
            ev = json.loads(raw)
        except Exception:
            continue
        t = ev.get("type")
        if reply is None and t == "assistant":
            tx = _texts(ev)
            if tx:
                reply = "\n".join(tx)
            continue
        if reply is not None and t == "user":
            tx = [s for s in _texts(ev) if s and not s.lstrip().startswith("<")]
            if tx:
                prompt = "\n".join(tx)
                break
    return reply, prompt


def ja_ratio(text):
    body = FENCE.sub("", text)
    body = INLINE.sub("", body)
    body = MDLINK_HREF.sub("]", body)
    body = URL.sub("", body)
    ja = len(JA.findall(body))
    la = len(LATIN.findall(body))
    return ja, la


def main():
    if os.path.exists(KILL):
        return 0
    transcript = os.environ.get("REPLYJA_TRANSCRIPT")
    if not transcript:
        try:
            payload = json.load(sys.stdin)
        except Exception:
            return 0
        if payload.get("stop_hook_active"):
            return 0
        transcript = payload.get("transcript_path") or ""
    if not transcript or not os.path.isfile(transcript):
        return 0
    reply, prompt = last_turn(transcript)
    if not reply:
        return 0
    if prompt and ASK_EN.search(prompt):
        return 0
    zh = chinese_only_chars(reply)
    if zh:
        sys.stderr.write(
            "🛑 日本語ガード: 返信に日本では使わない字（簡体字）が混ざっています: %s\n"
            "→ 日本の漢字に直して、同じ内容を出し直してください（例: 检证→検証、这→這、们→達 など）。"
            "誤字を話題にする時は「」で囲めば検査しません。\n"
            "（誤検知の場合のみ: touch ~/.claude/tmp/jaguard_off で無効化できます）\n" % "".join(dict.fromkeys(zh))[:20]
        )
        return 2
    ja, la = ja_ratio(reply)
    if ja + la < MIN_BODY:
        return 0
    if ja / float(ja + la) >= MIN_JA_RATIO:
        return 0
    sys.stderr.write(
        "🛑 日本語ガード: 最終返信が英語になっています（日本語 %d 字・英字 %d 字）。"
        "本人への応答は日本語が原則です（2026-09-25 に英語の報告が2回続いた再発防止）。\n"
        "→ 同じ内容を日本語で出し直してください。コマンド・パス・関数名はコード表記のままでかまいません。\n"
        "（英語での回答を求められていた等の誤検知の場合のみ: touch ~/.claude/tmp/jaguard_off で無効化できます）\n"
        % (ja, la)
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
