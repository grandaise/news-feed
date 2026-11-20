// 아침 자산·시장 알림 (평일): 자산 전일 대비 변동, 금일 투자 가이드 요약, 관심 아파트 새로 신고된 실거래를 ntfy 로 보낸다.
//
// 보안: ntfy 기본 서버는 토픽 이름만 알면 누구나 구독할 수 있으므로
//       총자산·평가금액 같은 절대 금액은 보내지 않고 '변동률과 증감'만 보낸다.
//
// 환경 변수: NTFY_TOPIC (필수), SITE_URL, MY_DATA_DIR (비공개 my-data 체크아웃 폴더), FORCE=1 (주말에도 보냄)
import { readFile } from "node:fs/promises";

const topic = process.env.NTFY_TOPIC;
if (!topic) { console.log("NTFY_TOPIC 이 설정되지 않아 건너뜁니다."); process.exit(0); }
const dir = process.env.MY_DATA_DIR;
const siteUrl = process.env.SITE_URL || "";

const now = new Date();
const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(now);
if (["Sat", "Sun"].includes(wd) && !process.env.FORCE) { console.log("주말이라 자산·시장 알림은 보내지 않습니다."); process.exit(0); }

const readJson = async (p) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; } };
const pct = (n, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
// 증감액만 만원 단위로 (절대 금액은 보내지 않음)
const manDiff = (n) => {
  const m = Math.round(n / 10000);
  const a = Math.abs(m);
  const s = a >= 10000 ? `${Math.floor(a / 10000)}억${a % 10000 ? ` ${(a % 10000).toLocaleString("ko-KR")}만` : ""}` : `${a.toLocaleString("ko-KR")}만`;
  return `${m > 0 ? "+" : m < 0 ? "-" : "±"}${s}원`;
};
const eok = (won) => {
  const man = Math.round(won / 10000), e = Math.floor(man / 10000), r = man % 10000;
  return e ? `${e}억${r ? ` ${r.toLocaleString("ko-KR")}` : ""}` : `${r.toLocaleString("ko-KR")}만`;
};

const lines = [];
let titleBits = [];

// ---- 1) 자산 전일 대비 ----
const hist = dir ? await readJson(`${dir}/history.json`) : null;
const days = hist?.days || [];
if (days.length >= 2) {
  const cur = days.at(-1), prev = days.at(-2);
  const diff = cur.value - prev.value;
  const rate = prev.value ? (diff / prev.value) * 100 : 0;
  titleBits.push(`자산 ${pct(rate, 2)}`);
  const groups = Object.keys({ ...prev.groups, ...cur.groups })
    .map((g) => {
      const a = prev.groups?.[g] || 0, b = cur.groups?.[g] || 0;
      return a ? `${g.split("·")[0]} ${pct(((b - a) / a) * 100)}` : null;
    }).filter(Boolean);
  lines.push(`💰 자산 ${pct(rate, 2)} (${manDiff(diff)}) · ${md(prev.d)} 대비`);
  if (groups.length) lines.push(`   ${groups.join(" · ")}`);
  if (cur.cost && prev.cost) {
    const r1 = (cur.pnl / cur.cost) * 100, r0 = (prev.pnl / prev.cost) * 100;
    lines.push(`   누적 수익률 ${pct(r1)} (전일 ${pct(r0)})`);
  }
} else {
  lines.push(`💰 자산 추이: 기록 ${days.length}일째 — 이틀째부터 전일 대비를 알려 드립니다.`);
}

// ---- 2) 금일 투자 가이드 ----
const guide = await readJson(new URL("../data/guide.json", import.meta.url));
const guideFresh = guide?.updatedAt && new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date(guide.updatedAt)) === todayStr;
if (guide?.items?.length && guideFresh) {
  lines.push("", `🎯 금일 투자 가이드 (${md(guide.basis.slice(0, 4) + "-" + guide.basis.slice(4, 6) + "-" + guide.basis.slice(6))} 종가 기준 · 참고용)`);
  for (const it of guide.items.slice(0, 3)) {
    lines.push(`   ${it.name} ${pct(it.chg)} · 돌파 ${it.levels.high.toLocaleString("ko-KR")} · 지지 ${it.levels.s1.toLocaleString("ko-KR")} · 지속 ${it.sustain}`);
  }
} else {
  lines.push("", "🎯 금일 투자 가이드: 아직 준비되지 않았습니다 (대시보드에서 확인).");
}

// ---- 3) 관심 아파트: 어제 이후 새로 신고·해제된 거래 ----
const apt = dir ? await readJson(`${dir}/apt.json`) : null;
for (const t of apt?.targets || []) {
  if (!t.found) continue;
  const fresh = (t.deals || []).filter((x) => x.firstSeen === todayStr && !x.canceled);
  const canceled = (t.deals || []).filter((x) => x.canceled && x.canceledSeen === todayStr);
  if (!fresh.length && !canceled.length) continue;
  lines.push("", `🏠 ${t.name} 34·35평 새 신고 ${fresh.length}건${canceled.length ? ` · 해제 ${canceled.length}건` : ""}`);
  const label = (x) => `${md(x.date)} 계약 ${[(x.apt.match(/(\d+)\s*단지/) || [])[1] ? `${x.apt.match(/(\d+)\s*단지/)[1]}단지` : "", x.floor ? `${x.floor}층` : ""].filter(Boolean).join(" ")} ${eok(x.price)}`;
  for (const x of fresh.slice(0, 5)) lines.push(`   · ${label(x)}`);
  for (const x of canceled.slice(0, 3)) lines.push(`   · (해제) ${label(x)}`);
  titleBits.push(`실거래 ${fresh.length}건`);
}

const today = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(now);
const title = `📈 ${today}${titleBits.length ? ` · ${titleBits.join(" · ")}` : " · 자산·시장"}`;
const message = lines.join("\n").slice(0, 3800);
const url = siteUrl ? `${siteUrl}#invest` : "";

const res = await fetch("https://ntfy.sh/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    topic, title, message, tags: ["chart_with_upwards_trend"],
    ...(url && { click: url, actions: [{ action: "view", label: "투자 보기", url }, { action: "view", label: "부동산", url: `${siteUrl}#apt` }] }),
  }),
});
if (!res.ok) { console.error(`ntfy 전송 실패: HTTP ${res.status} ${await res.text()}`); process.exit(1); }
console.log(`자산·시장 알림 전송 완료 (${titleBits.join(", ") || "기본"})`);
