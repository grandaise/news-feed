// 아침 브리핑: 오늘 일정·할 일(비공개 my-data) + 최근 24시간 뉴스 요약을 ntfy 푸시로 보낸다.
// 환경 변수: NTFY_TOPIC (필수), SITE_URL (알림을 눌렀을 때 열 주소),
//           MY_DATA_DIR (my-data 저장소를 체크아웃한 폴더, 없으면 일정 생략)
import { readFile } from "node:fs/promises";

const topic = process.env.NTFY_TOPIC;
if (!topic) {
  console.log("NTFY_TOPIC 이 설정되지 않아 알림을 건너뜁니다.");
  process.exit(0);
}
const siteUrl = process.env.SITE_URL || "";

const dayFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" });
const todayStr = dayFmt.format(new Date());
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`;

// ---- 일정·할 일 ----
const lines = [];
let eventCount = 0;
let todoCount = 0;
if (process.env.MY_DATA_DIR) {
  try {
    const priv = JSON.parse(await readFile(`${process.env.MY_DATA_DIR}/data.json`, "utf8"));
    // 구글 캘린더에서 가져온 일정도 합친다 (여러 날 일정은 기간 중이면 포함)
    let google = [];
    try {
      const g = JSON.parse(await readFile(`${process.env.MY_DATA_DIR}/gcal.json`, "utf8"));
      google = (g.events || [])
        .filter((e) => e.date === todayStr || (e.endDate && e.date <= todayStr && todayStr <= e.endDate))
        .map((e) => ({ ...e, cat: "구글" }));
    } catch {}
    const events = [...(priv.events || []).filter((e) => e.date === todayStr), ...google]
      .sort((a, b) => (a.time || "00").localeCompare(b.time || "00"));
    eventCount = events.length;
    lines.push(`📅 오늘 일정 ${events.length ? `${events.length}건` : "없음"}`);
    for (const e of events) {
      const time = e.time ? `${e.time}${e.endTime ? `~${e.endTime}` : ""}` : "종일";
      lines.push(`  ${time}  ${e.title}${e.location ? ` @${e.location}` : ""}${e.cat ? ` [${e.cat}]` : ""}`);
    }

    const todos = (priv.todos || []).filter((t) => !t.done)
      .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    todoCount = todos.length;
    if (todos.length) {
      lines.push(`✅ 할 일 ${todos.length}개`);
      for (const t of todos.slice(0, 5)) {
        const tag = !t.due ? "" : t.due < todayStr ? ` (마감 ${md(t.due)} 지남)` : t.due === todayStr ? " (오늘 마감)" : ` (~${md(t.due)})`;
        lines.push(`  · ${t.title}${tag}`);
      }
      if (todos.length > 5) lines.push(`  …외 ${todos.length - 5}개`);
    }
    lines.push("");
  } catch (e) {
    console.error(`개인 데이터를 읽지 못해 일정은 생략합니다: ${e.message}`);
  }
}

// ---- 뉴스 ----
const data = JSON.parse(await readFile(new URL("../data/news.json", import.meta.url), "utf8"));
const since = Date.now() - 24 * 3600_000;
let total = 0;
lines.push("📰 뉴스 (최근 24시간)");
for (const [kw, items] of Object.entries(data.keywords || {})) {
  const recent = items.filter((it) => Date.parse(it.publishedAt) >= since);
  total += recent.length;
  if (!recent.length) {
    lines.push(`▪ ${kw}: 새 기사 없음`);
    continue;
  }
  lines.push(`▪ ${kw} ${recent.length}건`);
  for (const it of recent.slice(0, 2)) lines.push(`  · ${it.title}`);
}

const today = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
}).format(new Date());

let message = lines.join("\n");
if (message.length > 3800) message = message.slice(0, 3800) + "\n…";

const summary = process.env.MY_DATA_DIR
  ? `일정 ${eventCount} · 할 일 ${todoCount} · 뉴스 ${total}건`
  : `뉴스 ${total}건`;

const res = await fetch("https://ntfy.sh/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    topic,
    title: `☀️ ${today} · ${summary}`,
    message,
    tags: ["sunny"],
    ...(siteUrl && { click: siteUrl, actions: [{ action: "view", label: "대시보드 열기", url: siteUrl }] }),
  }),
});
if (!res.ok) {
  console.error(`ntfy 전송 실패: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`알림 전송 완료 (${summary})`);
