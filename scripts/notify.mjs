// data/news.json 에서 최근 24시간 기사를 키워드별로 요약해 ntfy 푸시 알림을 보낸다.
// 환경 변수: NTFY_TOPIC (필수), SITE_URL (알림을 눌렀을 때 열 주소)
import { readFile } from "node:fs/promises";

const topic = process.env.NTFY_TOPIC;
if (!topic) {
  console.log("NTFY_TOPIC 이 설정되지 않아 알림을 건너뜁니다.");
  process.exit(0);
}
const siteUrl = process.env.SITE_URL || "";

const data = JSON.parse(await readFile(new URL("../data/news.json", import.meta.url), "utf8"));
const since = Date.now() - 24 * 3600_000;

let total = 0;
const lines = [];
for (const [kw, items] of Object.entries(data.keywords || {})) {
  const recent = items.filter((it) => Date.parse(it.publishedAt) >= since);
  total += recent.length;
  if (!recent.length) {
    lines.push(`▪ ${kw}: 새 기사 없음`);
    continue;
  }
  lines.push(`▪ ${kw} ${recent.length}건`);
  for (const it of recent.slice(0, 3)) lines.push(`  · ${it.title}`);
}

const today = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
}).format(new Date());

let message = lines.join("\n");
if (message.length > 3500) message = message.slice(0, 3500) + "\n…";

const res = await fetch("https://ntfy.sh/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    topic,
    title: `📰 ${today} 뉴스 ${total}건`,
    message,
    tags: ["newspaper"],
    ...(siteUrl && { click: siteUrl, actions: [{ action: "view", label: "사이트 열기", url: siteUrl }] }),
  }),
});
if (!res.ok) {
  console.error(`ntfy 전송 실패: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`알림 전송 완료 (${total}건)`);
