// =============================================================
// 医療DX週次ブリーフィング ウィジェット（Scriptable 用）
// -------------------------------------------------------------
// 何をするか：
//   GitHub Pages の podcast.xml（番組フィード）を読み込み、
//   最新回の「回数・日付・尺・要約・章」をホーム画面/ロック画面に表示する。
//   ウィジェットをタップすると最新回の音声を再生（Safari で開く）。
//
// ウィジェットの「Parameter」欄で動作を変えられる：
//   （空欄）  … タップで最新回の音声を再生
//   page      … タップで番組一覧ページを開く
// =============================================================

const FEED_URL = "https://mkkitazawa1105-hue.github.io/dx-weekly-audio/podcast.xml";
const PAGE_URL = "https://mkkitazawa1105-hue.github.io/dx-weekly-audio/";
const COVER_URL = "https://mkkitazawa1105-hue.github.io/dx-weekly-audio/cover.png";

// サイトと同じ配色（紺色系）
const COLOR = {
  bgTop: new Color("#0e2233"),
  bgBottom: new Color("#173248"),
  text: Color.white(),
  sub: new Color("#9fc3dd"),
  accent: new Color("#4fc3f7"),
  badge: new Color("#ff7043"),
};

const fm = FileManager.local();
const CACHE_FILE = fm.joinPath(fm.libraryDirectory(), "dxweekly_cache.json");
const COVER_FILE = fm.joinPath(fm.libraryDirectory(), "dxweekly_cover.png");

// ---------- 1. フィードを読む（失敗したら前回保存分を使う） ----------
async function loadEpisodes() {
  try {
    const req = new Request(FEED_URL);
    req.timeoutInterval = 15;
    const xml = await req.loadString();
    const episodes = parseFeed(xml);
    if (episodes.length === 0) throw new Error("エピソードが見つかりません");
    fm.writeString(CACHE_FILE, JSON.stringify(episodes));
    return { episodes, offline: false };
  } catch (e) {
    if (fm.fileExists(CACHE_FILE)) {
      return { episodes: JSON.parse(fm.readString(CACHE_FILE)), offline: true };
    }
    return { episodes: [], offline: true, error: String(e) };
  }
}

async function loadCover() {
  try {
    if (fm.fileExists(COVER_FILE)) return fm.readImage(COVER_FILE);
    const img = await new Request(COVER_URL).loadImage();
    fm.writeImage(COVER_FILE, img);
    return img;
  } catch (e) {
    return null; // 画像なしでも表示は続ける
  }
}

// ---------- 2. フィード（XML）から必要な情報を取り出す ----------
// 回によって説明文の書式が違うので、複数パターンに対応している
function parseFeed(xml) {
  const items = xml.split("<item>").slice(1).map(s => s.split("</item>")[0]);
  return items.map(parseItem).filter(ep => ep.audio);
}

function parseItem(raw) {
  const pick = re => { const m = raw.match(re); return m ? m[1].trim() : ""; };
  const title = decode(pick(/<title>([\s\S]*?)<\/title>/));
  const audio = pick(/<enclosure[^>]*url="([^"]+)"/);
  const episodeNo = pick(/<itunes:episode>(\d+)<\/itunes:episode>/);
  const subtitle = decode(pick(/<itunes:subtitle>([\s\S]*?)<\/itunes:subtitle>/));
  let desc = pick(/<description>([\s\S]*?)<\/description>/);
  desc = desc.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");

  // 日付は guid / ファイル名の YYYY-MM-DD から確実に取る
  const dm = (raw.match(/(\d{4})-(\d{2})-(\d{2})/) || []);
  const date = dm.length ? { y: +dm[1], m: +dm[2], d: +dm[3] } : null;

  // 説明文を「行」の配列にする（<br/> 区切り）
  const lines = desc.split(/<br\s*\/?>/).map(l => decode(stripTags(l)).trim());
  const chapters = extractChapters(lines);

  return {
    title,
    shortTitle: episodeNo ? `Run #${episodeNo}` : (title.replace(/（.*?）/, "").trim() || title),
    episodeNo,
    audio,
    date,
    summary: extractSummary(lines) || subtitle || chapterDigest(chapters),
    duration: extractDuration(desc),
    chapters,
  };
}

// 要約が無い回は、中身の章タイトルをつないで代わりにする
function chapterDigest(chapters) {
  return chapters.filter(c => !/オープニング|まとめ/.test(c)).join("／");
}

// 「全体要約」の段落を取り出す（"全体要約：" "【全体要約】" "■ 全体要約" に対応）
function extractSummary(lines) {
  const idx = lines.findIndex(l => /全体要約/.test(l));
  if (idx < 0) return "";
  const out = [];
  const sameLine = lines[idx].replace(/^.*?全体要約[】：:\s]*/, "").trim();
  if (sameLine) out.push(sameLine);
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) { if (out.length) break; else continue; } // 空行で段落終わり
    if (/^(【|■|方針|話者|章一覧|第\d+章)/.test(l)) break;
    out.push(l);
  }
  return out.join("");
}

// 尺（例：「合計：14分22秒」「総尺：9分06秒」「約11.3分」）
function extractDuration(text) {
  let m = text.match(/(?:合計|総尺|全体尺|尺)[^0-9]{0,6}(\d+)分(\d+)秒/);
  if (m) return `${+m[1]}分${m[2].padStart(2, "0")}秒`;
  m = text.match(/(?:合計|総尺|全体尺|尺)[^0-9]{0,6}([\d.]+)分/);
  if (m) return `約${Math.round(+m[1])}分`;
  return "";
}

// 章タイトル（例：「第2章 01:27 開始（1分36秒） オンスイク注の…」）
function extractChapters(lines) {
  const out = [];
  for (const l of lines) {
    const m = l.match(/^第\d+章\s*\d{1,2}:\d{2}\s*(?:開始)?\s*(?:（[^）]*）)?\s*(.+)$/);
    if (m) out.push(m[1].replace(/（\d+分\d+秒）\s*$/, "").trim());
  }
  return out;
}

function stripTags(s) { return s.replace(/<[^>]+>/g, ""); }
function decode(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
          .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

// ---------- 3. 日付まわりの表示 ----------
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
function dateLabel(date) {
  if (!date) return "";
  const w = WEEK[new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay()];
  return `${date.m}/${date.d}（${w}）`;
}
// 配信から3日以内なら NEW を付ける（日本時間で計算）
function isNew(date) {
  if (!date) return false;
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const today = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate());
  const days = (today - Date.UTC(date.y, date.m - 1, date.d)) / 86400000;
  return days >= 0 && days <= 3;
}

// ---------- 4. ウィジェットを組み立てる ----------
function addText(parent, str, size, color, opts = {}) {
  const t = parent.addText(str);
  t.font = opts.bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  if (opts.lines) t.lineLimit = opts.lines;
  if (opts.scale) t.minimumScaleFactor = opts.scale;
  return t;
}

function header(w, cover, ep, small) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  if (cover) {
    const img = row.addImage(cover);
    img.imageSize = new Size(small ? 18 : 20, small ? 18 : 20);
    img.cornerRadius = 4;
    row.addSpacer(6);
  }
  addText(row, small ? "医療DX週次" : "医療DX週次ブリーフィング", small ? 11 : 12, COLOR.sub, { bold: true, lines: 1, scale: 0.8 });
  row.addSpacer();
  if (ep && isNew(ep.date)) {
    const badge = row.addStack();
    badge.backgroundColor = COLOR.badge;
    badge.cornerRadius = 6;
    badge.setPadding(1, 5, 1, 5);
    addText(badge, "NEW", 9, Color.white(), { bold: true });
  }
}

function metaLine(ep) {
  return [dateLabel(ep.date), ep.duration].filter(Boolean).join("・");
}

function buildHomeWidget(family, data, cover, param) {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [COLOR.bgTop, COLOR.bgBottom];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 14, 12, 14);

  const ep = data.episodes[0];
  const small = family === "small";
  header(w, cover, ep, small);
  w.addSpacer(small ? 8 : 6);

  if (!ep) {
    addText(w, "番組情報を取得できませんでした", 13, COLOR.text, { bold: true, lines: 2 });
    addText(w, "通信状態を確認してください", 11, COLOR.sub, { lines: 2 });
    w.url = PAGE_URL;
    return w;
  }

  const audioUrl = ep.audio;
  w.url = param === "page" ? PAGE_URL : audioUrl;

  if (small) {
    addText(w, ep.shortTitle, 22, COLOR.text, { bold: true, lines: 1, scale: 0.7 });
    w.addSpacer(2);
    addText(w, dateLabel(ep.date), 12, COLOR.sub, { lines: 1 });
    if (ep.duration) addText(w, ep.duration, 12, COLOR.sub, { lines: 1 });
    w.addSpacer();
    addText(w, param === "page" ? "番組一覧 ›" : "▶ タップで再生", 12, COLOR.accent, { bold: true, lines: 1 });
  } else {
    const titleRow = w.addStack();
    titleRow.layoutHorizontally();
    titleRow.bottomAlignContent();
    addText(titleRow, ep.shortTitle, 18, COLOR.text, { bold: true, lines: 1 });
    titleRow.addSpacer(8);
    addText(titleRow, metaLine(ep), 12, COLOR.sub, { lines: 1 });
    titleRow.addSpacer();
    w.addSpacer(4);

    const large = family === "large" || family === "extraLarge";
    if (ep.summary) addText(w, ep.summary, large ? 13 : 12, COLOR.text, { lines: large ? 7 : 3 });

    if (large && ep.chapters.length) {
      w.addSpacer(8);
      addText(w, "章", 11, COLOR.sub, { bold: true });
      w.addSpacer(2);
      // オープニング・まとめを除いた中身の章を最大5つ
      const body = ep.chapters.filter(c => !/オープニング|まとめ/.test(c)).slice(0, 5);
      for (const c of body) addText(w, "・" + c, 11, COLOR.sub, { lines: 1 });
    }

    w.addSpacer();
    const foot = w.addStack();
    foot.layoutHorizontally();
    const play = addText(foot, "▶ 再生", 12, COLOR.accent, { bold: true });
    play.url = audioUrl;
    foot.addSpacer(14);
    const list = addText(foot, "番組一覧 ›", 12, COLOR.sub);
    list.url = PAGE_URL;
    foot.addSpacer();
    if (data.offline) addText(foot, "オフライン表示", 10, COLOR.sub);
  }

  // iOS が適宜更新するが、3時間後以降の更新を希望しておく
  w.refreshAfterDate = new Date(Date.now() + 3 * 3600 * 1000);
  return w;
}

// ロック画面（iOS 16以降）用
function buildLockWidget(family, data, param) {
  const w = new ListWidget();
  const ep = data.episodes[0];
  if (ep) w.url = param === "page" ? PAGE_URL : ep.audio;
  w.refreshAfterDate = new Date(Date.now() + 3 * 3600 * 1000);

  if (family === "accessoryInline") {
    w.addText(ep ? `医療DX ${ep.shortTitle.replace("Run ", "")} ${ep.date ? ep.date.m + "/" + ep.date.d : ""}` : "医療DX 取得失敗");
    return w;
  }
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const t1 = w.addText("DX");
    t1.font = Font.boldSystemFont(11);
    t1.centerAlignText();
    const t2 = w.addText(ep && ep.episodeNo ? "#" + ep.episodeNo : "—");
    t2.font = Font.boldSystemFont(16);
    t2.minimumScaleFactor = 0.6;
    t2.centerAlignText();
    return w;
  }
  // accessoryRectangular
  const t1 = w.addText(ep ? `医療DX ${ep.shortTitle}` : "医療DX週次");
  t1.font = Font.boldSystemFont(13);
  t1.lineLimit = 1;
  const t2 = w.addText(ep ? metaLine(ep) : "取得できませんでした");
  t2.font = Font.systemFont(11);
  t2.lineLimit = 1;
  if (ep && ep.summary) {
    const t3 = w.addText(ep.summary);
    t3.font = Font.systemFont(11);
    t3.lineLimit = 1;
  }
  return w;
}

// ---------- 5. 実行 ----------
async function main() {
  const param = ((args.widgetParameter || "") + "").trim().toLowerCase();
  const data = await loadEpisodes();
  const family = config.widgetFamily || "medium";

  let widget;
  if (family.startsWith("accessory")) {
    widget = buildLockWidget(family, data, param);
  } else {
    widget = buildHomeWidget(family, data, await loadCover(), param);
  }

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    // アプリ内で実行したときは中サイズのプレビューを表示
    await widget.presentMedium();
  }
  Script.complete();
}

await main();
