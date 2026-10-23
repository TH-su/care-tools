// 薬情よみとり — 事務所の Mac の中だけで、薬情・お薬手帳・調剤明細書の写真と PDF の文字を読む道具。
// 使い方: yakujo-reader <入れるフォルダ> <結果のファイル>
//
// 決まり（本人の決定 2026-10-22）
// - 読むのは Apple の文字読み取り（Vision）。ネットにはつながない。送信の処理は持たない
// - 元の写真・PDF は書き換えない。読み終えた書類（読めない所が無かったもの）だけを、結果のファイルを書けた後に
//   Mac のごみ箱へ移す（消さない＝取り出せる・代表者の決定 2026-10-23）。読めない所があった書類・文字が1行も見つからなかった書類・
//   読まなかったファイルは「入れる」に残す
// - 結果のファイル（読んだ文字・ページの画像＝個人情報）は、本人だけが読める権限（600）で書く
// - 画面（ターミナル）には件数と時間だけを出す。ファイル名・読んだ文字は出さない
// - 読まなかったもの（ファイル・ページ）は、理由を結果に残す。黙って捨てない
import Foundation
import Vision
import ImageIO
import CoreGraphics
import PDFKit
import UniformTypeIdentifiers

let READER_VERSION = "1.2"
let MAX_DOCS = 20                 // 1回に読む書類の数
let MAX_BYTES = 10 * 1024 * 1024  // 1ファイルの大きさ
let MAX_PAGES = 10                // PDF 1つのページ数
let MAX_PIXELS = 60_000_000       // 写真の画素数（展開すると巨大になる画像で止まらないように）
let OCR_LONG_SIDE = 4032          // 読む時の画像の長い辺
let IMG_LONG_SIDE = 2000          // 結果に入れるページの画像の長い辺
let IMG_QUALITY = 0.75
let IMAGE_EXT: Set<String> = ["heic", "heif", "jpg", "jpeg", "png"]

func out(_ s: String) { FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!) }

let args = CommandLine.arguments
guard args.count == 3 else { out("使い方: yakujo-reader <入れるフォルダ> <結果のファイル>"); exit(2) }
let inDir = URL(fileURLWithPath: args[1], isDirectory: true)
let outFile = URL(fileURLWithPath: args[2])

// ---- 画像を作る・縮める ----
func newContext(_ w: Int, _ h: Int) -> CGContext? {
  return CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                   space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
}
func scaled(_ img: CGImage, longSide: Int) -> CGImage? {
  let w = img.width, h = img.height, L = max(w, h)
  if L <= longSide { return img }
  let r = Double(longSide) / Double(L)
  let nw = max(1, Int(Double(w) * r)), nh = max(1, Int(Double(h) * r))
  guard let ctx = newContext(nw, nh) else { return nil }
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: nw, height: nh))
  return ctx.makeImage()
}

// 写真は、写真の情報（縦横の向き）どおりに直してから読む。展開前に画素数を確かめる
enum PhotoResult { case ok(CGImage), tooBig, unreadable }
func photoImage(_ url: URL) -> PhotoResult {
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return .unreadable }
  if let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] {
    let w = (p[kCGImagePropertyPixelWidth] as? Int) ?? 0, h = (p[kCGImagePropertyPixelHeight] as? Int) ?? 0
    if w <= 0 || h <= 0 { return .unreadable }
    if w * h > MAX_PIXELS { return .tooBig }
  } else { return .unreadable }
  let opts: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: OCR_LONG_SIDE,
  ]
  if let im = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) { return .ok(im) }
  return .unreadable
}

// PDF はページごとに白地の画像にする（300dpi 相当・長い辺は OCR_LONG_SIDE まで）。
// PDFKit で描く（入力欄・注釈に書かれた文字も描く）。読めないページは nil のまま返す（ページ番号をずらさない）
func pdfPages(_ url: URL) -> (pages: [CGImage?], total: Int)? {
  guard let doc = PDFDocument(url: url) else { return nil }
  if doc.isLocked && !doc.unlock(withPassword: "") { return nil }
  let n = doc.pageCount
  if n < 1 { return nil }
  var pages: [CGImage?] = []
  for i in 0..<min(n, MAX_PAGES) {
    guard let page = doc.page(at: i) else { pages.append(nil); continue }
    let box = page.bounds(for: .cropBox)
    let rot = ((page.rotation % 360) + 360) % 360
    let pw = (rot == 90 || rot == 270) ? box.height : box.width
    let ph = (rot == 90 || rot == 270) ? box.width : box.height
    if pw <= 0 || ph <= 0 { pages.append(nil); continue }
    var s: CGFloat = 300.0 / 72.0
    if max(pw, ph) * s > CGFloat(OCR_LONG_SIDE) { s = CGFloat(OCR_LONG_SIDE) / max(pw, ph) }
    let w = max(1, Int(pw * s)), h = max(1, Int(ph * s))
    guard let ctx = newContext(w, h) else { pages.append(nil); continue }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    ctx.scaleBy(x: s, y: s)
    page.draw(with: .cropBox, to: ctx)       // ページの回転と原点は draw が合わせる（transform を重ねると二重に回る）
    pages.append(ctx.makeImage())
  }
  return (pages, n)
}

func jpegDataURL(_ img: CGImage) -> String? {
  guard let small = scaled(img, longSide: IMG_LONG_SIDE) else { return nil }
  let data = NSMutableData()
  guard let dst = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
  CGImageDestinationAddImage(dst, small, [kCGImageDestinationLossyCompressionQuality: IMG_QUALITY] as CFDictionary)
  guard CGImageDestinationFinalize(dst) else { return nil }
  return "data:image/jpeg;base64," + (data as Data).base64EncodedString()
}

// ---- 読む ----
func r4(_ v: CGFloat) -> Double { (Double(v) * 10000).rounded() / 10000 }

func readPage(_ img: CGImage) -> [String: Any] {
  var err = ""
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["ja-JP", "en-US"]
  req.usesLanguageCorrection = false        // 補正を入れても薬名の一字一致は増えず、遅くなった（2026-10-22 の試し）
  do { try VNImageRequestHandler(cgImage: img, options: [:]).perform([req]) } catch { err = "文字を読み取れませんでした" }
  var lines: [[String: Any]] = []
  for o in (req.results ?? []) {
    guard let c = o.topCandidates(1).first else { continue }
    let b = o.boundingBox   // 左下が原点 → 左上を原点にそろえる
    lines.append(["t": c.string, "x": r4(b.minX), "y": r4(1 - b.maxY), "w": r4(b.width), "h": r4(b.height),
                  "c": (Double(c.confidence) * 100).rounded() / 100])
  }
  // 並びは上から下。高さの近い行（先頭の行との差が 0.004 以内）をひとまとまりにして、その中は左から右。
  // 傾いた写真では崩れるので、使う側は位置（x・y）で組み直す
  lines.sort { ($0["y"] as! Double) < ($1["y"] as! Double) }
  var sorted: [[String: Any]] = [], band: [[String: Any]] = [], top = -1.0
  for l in lines {
    let y = l["y"] as! Double
    if band.isEmpty || y - top <= 0.004 { if band.isEmpty { top = y }; band.append(l) }
    else { sorted += band.sorted { ($0["x"] as! Double) < ($1["x"] as! Double) }; band = [l]; top = y }
  }
  sorted += band.sorted { ($0["x"] as! Double) < ($1["x"] as! Double) }
  let breq = VNDetectBarcodesRequest()
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([breq])
  let codes = breq.results ?? []
  let qr = codes.filter { $0.symbology == .qr }.count
  return ["w": img.width, "h": img.height, "lines": sorted, "error": err,
          "codes": ["qr": qr, "other": codes.count - qr], "img": jpegDataURL(img) ?? ""]
}

// ---- 入れるフォルダを見る ----
let fm = FileManager.default
var isDir: ObjCBool = false
guard fm.fileExists(atPath: inDir.path, isDirectory: &isDir), isDir.boolValue else { out("入れるフォルダが見つかりません"); exit(3) }
let entries = ((try? fm.contentsOfDirectory(at: inDir, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey], options: [.skipsHiddenFiles])) ?? [])
  .filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
  .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }

var docs: [[String: Any]] = []
var skipped: [[String: Any]] = []
// 読み終えた書類（読めない所が無かったもの）。読んだ時の大きさと更新日時を持ち、ごみ箱へ移す前に同じかを確かめる
struct Done { let url: URL; let size: Int?; let mod: Date? }
var done: [Done] = []
var nPages = 0, nLines = 0, nQR = 0, nErr = 0, nCut = 0, nLater = 0, nBlank = 0
let t0 = Date()
for url in entries {
  let ext = url.pathExtension.lowercased()
  let name = url.lastPathComponent
  let rv0 = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
  let size = rv0?.fileSize ?? 0
  if !(IMAGE_EXT.contains(ext) || ext == "pdf") { skipped.append(["file": name, "why": "写真（HEIC・JPEG・PNG）か PDF ではない"]); continue }
  if size > MAX_BYTES { skipped.append(["file": name, "why": "10MB より大きい"]); continue }
  if docs.count >= MAX_DOCS {
    skipped.append(["file": name, "why": "1回に読めるのは \(MAX_DOCS) 件まで（読み終えた書類はごみ箱へ移るので、もう一度動かすと残りを読む。読めずに「入れる」に残った書類は、確かめて外す）"])
    nLater += 1
    continue
  }
  var doc: [String: Any] = ["no": docs.count + 1, "file": name, "type": ext == "pdf" ? "pdf" : "photo", "pages": [], "error": "", "note": ""]
  autoreleasepool {
    var imgs: [CGImage?] = []
    if ext == "pdf" {
      if let p = pdfPages(url) {
        imgs = p.pages
        doc["pagesTotal"] = p.total
        if p.total > MAX_PAGES { doc["note"] = "\(p.total) ページのうち、はじめの \(MAX_PAGES) ページだけを読みました（残りは読んでいません）"; nCut += 1 }
      } else { doc["error"] = "PDF を開けない（壊れている・パスワード付き）" }
    } else {
      switch photoImage(url) {
      case .ok(let im): imgs = [im]
      case .tooBig: doc["error"] = "写真の画素数が大きすぎる（\(MAX_PIXELS / 1_000_000)00万画素まで）"
      case .unreadable: doc["error"] = "写真を開けない"
      }
    }
    var pages: [[String: Any]] = []
    for (i, im) in imgs.enumerated() {
      var pg: [String: Any]
      if let im = im { pg = readPage(im) }
      else { pg = ["w": 0, "h": 0, "lines": [], "error": "このページを画像にできませんでした", "codes": ["qr": 0, "other": 0], "img": ""] }
      pg["no"] = i + 1          // 元の PDF のページ番号（読めないページも番号を詰めない）
      nLines += (pg["lines"] as? [Any])?.count ?? 0
      nQR += ((pg["codes"] as? [String: Int])?["qr"]) ?? 0
      if (pg["error"] as? String ?? "") != "" { doc["note"] = ((doc["note"] as? String ?? "") + " 読めないページがあります").trimmingCharacters(in: .whitespaces) }
      pages.append(pg)
    }
    doc["pages"] = pages
    nPages += pages.count
  }
  // 文字が1行も見つからなかった書類（ピンぼけ・暗い・白紙）は、撮り直せるように「入れる」に残す
  let docLines = ((doc["pages"] as? [[String: Any]]) ?? []).reduce(0) { $0 + (($1["lines"] as? [Any])?.count ?? 0) }
  if (doc["error"] as? String ?? "") != "" || (doc["note"] as? String ?? "") != "" { nErr += 1 }
  else if docLines == 0 { nBlank += 1 }
  else { done.append(Done(url: url, size: rv0?.fileSize, mod: rv0?.contentModificationDate)) }
  docs.append(doc)
}

let iso = ISO8601DateFormatter()
iso.timeZone = TimeZone(identifier: "Asia/Tokyo")
iso.formatOptions = [.withInternetDateTime]
let result: [String: Any] = [
  "kind": "yakujo-yomitori", "v": 1, "createdAt": iso.string(from: Date()),
  "reader": ["name": "薬情よみとり", "version": READER_VERSION, "engine": "apple-vision", "level": "accurate",
             "langs": ["ja-JP", "en-US"], "correction": false],
  "docs": docs, "skipped": skipped,
]

// ---- 書く（途中で止まっても半端なファイルを残さない・本人だけが読める権限）----
guard let data = try? JSONSerialization.data(withJSONObject: result, options: []) else { out("結果を作れませんでした"); exit(4) }
let tmp = outFile.deletingLastPathComponent().appendingPathComponent("." + outFile.lastPathComponent + ".tmp")
if !fm.createFile(atPath: tmp.path, contents: data, attributes: [.posixPermissions: 0o600]) { out("結果を書けませんでした"); exit(5) }
do {
  if fm.fileExists(atPath: outFile.path) { try fm.removeItem(at: outFile) }
  try fm.moveItem(at: tmp, to: outFile)
} catch { try? fm.removeItem(at: tmp); out("結果を書けませんでした"); exit(5) }

// ---- 読み終えた書類をごみ箱へ移す（代表者の決定 2026-10-23）----
// ★ここに来るのは結果のファイルを書けた時だけ（書けなかった時は上で止まっている）。読めない所が無かった書類だけ。
// ★読んでいる間に置き換わった（大きさ・更新日時が違う）ファイルは移さない。消すのではなく、ごみ箱へ移す（取り出せる）
var nTrash = 0, nKeep = 0
for d in done {
  let now = try? d.url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
  if now == nil || now?.fileSize != d.size || now?.contentModificationDate != d.mod { nKeep += 1; continue }
  do { try fm.trashItem(at: d.url, resultingItemURL: nil); nTrash += 1 } catch { nKeep += 1 }
}

let sec = Date().timeIntervalSince(t0)
out("読んだ書類 \(docs.count) 件（\(nPages) ページ・文字の行 \(nLines)・QR \(nQR)）／読めない所がある書類 \(nErr) 件／読まなかったファイル \(skipped.count) 件／\(String(format: "%.1f", sec)) 秒")
if nCut > 0 { out("※ 11ページ以上の PDF が \(nCut) 件あります。はじめの \(MAX_PAGES) ページだけを読みました（残りは読んでいません）。") }
if nTrash > 0 { out("読み終えた書類 \(nTrash) 件を、Mac のごみ箱へ移しました（取り出せます）。") }
if nKeep > 0 { out("※ ごみ箱へ移せなかった書類が \(nKeep) 件あります（「入れる」に残っています。取り込みが終わったら消してください）。") }
if nErr > 0 { out("※ 読めない所があった書類 \(nErr) 件は、「入れる」に残しています（撮り直すか、確かめてから消してください）。") }
if nBlank > 0 { out("※ 文字が見つからなかった書類 \(nBlank) 件は、「入れる」に残しています（撮り直すか、確かめてから消してください）。") }
if skipped.count > 0 { out("※ 読まなかったファイルが \(skipped.count) 件あります（理由は入居者マスタの取り込みの窓に出ます）。" + (nLater > 0 ? "うち \(nLater) 件は数の上限のためで、もう一度動かすと読みます（読めずに「入れる」に残った書類は、確かめて外してください）。" : "")) }
exit(0)
