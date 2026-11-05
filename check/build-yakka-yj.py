#!/usr/bin/env python3
# check/build-yakka-yj.py — 薬価基準の「同じ成分・剤形・規格」のまとまり（meds-yakka-yj.js）を作る（2026-11-05 新設）
#
#   python3 -I check/build-yakka-yj.py <厚労省の薬価基準収載品目リスト（内用薬）の .xlsx> > meds-yakka-yj.js
#
# 何に使うか: 入居者マスタの「📥 薬情の取り込み」で、施設の定期薬の名前（先発の商品名が多い）と、薬情の名前（後発品が多い）が
#   同じ薬かを、薬価基準収載医薬品コード（YJ コード）の先頭9桁（薬効分類4・成分3・剤形1・規格1）で見る。
#   先頭9桁が同じ品目は、同じ成分・同じ剤形・同じ規格。
# 出典: 厚生労働省 薬価基準収載品目リスト及び後発医薬品に関する情報（内用薬）
#   https://www.mhlw.go.jp/topics/2026/04/tp20260401-01.html
#   公共データ利用規約（第1.0版・PDL1.0）に基づき利用。
# 加工: 品名の全角英数字を半角へ・空白を外す／品名末尾の「屋号」と（かっこ書き）を外す／同じコード9桁の品名を1行にまとめる。
#   薬価・コード全体・メーカー名・先発後発の区分は持たない。
# ★入居者の処方は1文字も含まない（公開の一覧だけから作る）。外の部品（openpyxl 等）は使わない。
import sys, re, zipfile, unicodedata, json
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def cells(path):
    z = zipfile.ZipFile(path)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(NS + 'si'):
            ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    sheet = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))[0]
    for row in ET.fromstring(z.read(sheet)).iter(NS + 'row'):
        r = {}
        for c in row.findall(NS + 'c'):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            v, t = c.find(NS + 'v'), c.get('t')
            if t == 'inlineStr':
                r[col] = ''.join(x.text or '' for x in c.iter(NS + 't'))
            elif v is None:
                r[col] = ''
            else:
                r[col] = ss[int(v.text)] if t == 's' else v.text
        yield r


def main():
    groups = {}
    head = None
    for r in cells(sys.argv[1]):
        if head is None:
            head = r
            continue
        yj = str(r.get('B', ''))[:9]
        if not re.match(r'^[0-9A-Z]{9}$', yj):
            continue
        name = unicodedata.normalize('NFKC', str(r.get('H', '')))
        name = re.sub(r'\s+', '', name)
        name = re.sub(r'「[^」]*」$', '', name)
        name = re.sub(r'[(（][^)）]*[)）]$', '', name)
        if not name:
            continue
        groups.setdefault(yj, [])
        if name not in groups[yj]:
            groups[yj].append(name)
    lines = [k + '\t' + '|'.join(groups[k]) for k in sorted(groups)]
    body = '\n'.join(lines)
    print('/* 出典：厚生労働省 薬価基準収載品目リスト（内用薬）を加工して作成（check/build-yakka-yj.py）')
    print(' *   https://www.mhlw.go.jp/topics/2026/04/tp20260401-01.html （令和8年11月1日適用の一覧）')
    print(' *   公共データ利用規約（第1.0版・PDL1.0）に基づき利用。')
    print(' *   加工の内容: 薬価基準収載医薬品コードの先頭9桁（成分・剤形・規格）ごとに、品名（全角英数字を半角・屋号とかっこ書きを外す）をまとめた。')
    print(' *   薬価・メーカー名・先発後発の区分は持たない。')
    print(' * 使う側: yakujo-calc.js（薬情の取り込みで、先発の商品名と後発品の名前を同じ成分・剤形・規格の薬として結ぶ）')
    print(' * 1行＝「コード9桁<TAB>品名|品名|…」。入居者の処方は1文字も含まない。 */')
    print('(function (root) { root.MedsYakkaYJ = { v: "2026-11-01", text: ' + json.dumps(body, ensure_ascii=False) + ' }; })(typeof window !== "undefined" ? window : this);')


if __name__ == '__main__':
    main()
