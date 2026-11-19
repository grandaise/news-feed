// keywords.json 의 키워드마다 Google 뉴스 RSS 를 가져와 data/news.json 으로 저장한다.
// 의존성 없음 (Node 18+ 내장 fetch 사용).
import { readFile, writeFile, mkdir } from "node:fs/promises";

const KEEP_DAYS = 7; // 이 기간보다 오래된 기사는 버린다
const MAX_PER_KEYWORD = 200;
const DATA_PATH = new URL("../data/news.json", import.meta.url);
const KEYWORDS_PATH = new URL("../keywords.json", import.meta.url);

const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const source = tag(it, "source");
    let title = tag(it, "title");
    // Google 뉴스 제목은 "제목 - 언론사" 형식이므로 언론사 부분을 떼어낸다
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3));
    }
    const pub = new Date(tag(it, "pubDate"));
    items.push({
      title,
      link: tag(it, "link"),
      source,
      publishedAt: isNaN(pub) ? new Date().toISOString() : pub.toISOString(),
    });
  }
  return items;
}

async function fetchKeyword(keyword) {
  const q = encodeURIComponent(`"${keyword}" when:2d`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (news-feed RSS collector)" },
  });
  if (!res.ok) throw new Error(`${keyword}: HTTP ${res.status}`);
  return parseRss(await res.text());
}

const normTitle = (t) => t.replace(/\s+/g, "").replace(/[^\p{L}\p{N}]/gu, "");

async function main() {
  const keywords = JSON.parse(await readFile(KEYWORDS_PATH, "utf8"));
  let prev = { keywords: {} };
  try {
    prev = JSON.parse(await readFile(DATA_PATH, "utf8"));
  } catch {}

  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  const out = { updatedAt: new Date().toISOString(), keywords: {}, errors: {} };

  for (const kw of keywords) {
    const old = prev.keywords?.[kw] ?? [];
    let fresh = [];
    try {
      fresh = await fetchKeyword(kw);
    } catch (e) {
      console.error(e.message);
      out.errors[kw] = e.message;
    }
    // 새 기사 + 기존 기사 병합, 제목 기준 중복 제거
    const seen = new Set();
    const merged = [];
    for (const item of [...fresh, ...old]) {
      const key = normTitle(item.title);
      if (!key || seen.has(key)) continue;
      if (Date.parse(item.publishedAt) < cutoff) continue;
      seen.add(key);
      merged.push(item);
    }
    merged.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    out.keywords[kw] = merged.slice(0, MAX_PER_KEYWORD);
    console.log(`${kw}: 새로 ${fresh.length}건 / 보관 ${out.keywords[kw].length}건`);
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!Object.keys(out.errors).length) delete out.errors;
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(out, null, 1) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
