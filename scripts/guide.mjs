// 금일 투자 가이드: 전일 거래대금 상위 종목을 골라 규칙에 따라 단타 시나리오를 계산해 data/guide.json 에 저장한다.
// 투자 권유가 아니라, 정해진 공식(전일 고가·저가, 피벗, 이동평균, ATR, 거래량)으로 만든 참고 자료다.
//
// 데이터: 네이버 증권 (거래대금 상위, 일봉, 종목 뉴스)
import { writeFile, mkdir } from "node:fs/promises";

const TOP_N = 5;
const UA = { "User-Agent": "Mozilla/5.0 (dashboard guide bot)" };
const kstDate = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d).replace(/-/g, "");
const num = (s) => +String(s ?? "").replace(/,/g, "") || 0;

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(`불러오기 실패: ${url}`);
}

// 한국거래소 호가 단위 (2023년 이후 코스피·코스닥 공통)
function tick(p) {
  if (p < 2000) return 1;
  if (p < 5000) return 5;
  if (p < 20000) return 10;
  if (p < 50000) return 50;
  if (p < 200000) return 100;
  if (p < 500000) return 500;
  return 1000;
}
const roundTick = (p, mode = "round") => {
  const t = tick(p);
  return Math[mode](p / t) * t;
};
const won = (n) => Math.round(n).toLocaleString("ko-KR");
const pct = (n, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const eok = (millions) => {
  const e = millions / 100; // 백만원 → 억원
  return e >= 10000 ? `${(e / 10000).toFixed(1)}조원` : `${won(e)}억원`;
};
const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

// 1) 전일 거래대금 상위 (코스피+코스닥, 일반 주식만: ETF·ETN·스팩·우선주 제외)
async function topStocks() {
  const lists = await Promise.all(["KOSPI", "KOSDAQ"].map((m) =>
    getJson(`https://m.stock.naver.com/api/stocks/priceTop/${m}?page=1&pageSize=40`).then((d) => d.stocks.map((s) => ({ ...s, market: m })))));
  return lists.flat()
    .filter((s) => s.stockEndType === "stock" && !/스팩|SPAC/i.test(s.stockName) && !/우[A-C]?$|\d우B?$/.test(s.stockName))
    .map((s) => ({ code: s.itemCode, name: s.stockName, market: s.market, tv: num(s.accumulatedTradingValue), mcap: num(s.marketValue) }))
    .sort((a, b) => b.tv - a.tv)
    .map((s, i) => ({ ...s, rank: i + 1 }))
    .slice(0, TOP_N * 2); // 상장 직후 등 계산이 안 되는 종목을 건너뛸 여유분
}

// 2) 일봉 (최근 약 100거래일). 오늘 장이 이미 열렸다면 오늘 봉은 빼고 '전일' 기준으로 계산
async function dailyCandles(code) {
  const end = kstDate();
  const start = kstDate(new Date(Date.now() - 160 * 86400_000));
  const rows = await getJson(`https://api.stock.naver.com/chart/domestic/item/${code}/day?startDateTime=${start}0000&endDateTime=${end}2359`);
  return rows.filter((r) => r.localDate < end || !marketOpenedToday())
    .map((r) => ({ d: r.localDate, o: r.openPrice, h: r.highPrice, l: r.lowPrice, c: r.closePrice, v: r.accumulatedTradingVolume }));
}
function marketOpenedToday() {
  const hm = +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(":", "");
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(new Date());
  return hm >= 900 && hm < 1540 && !["Sat", "Sun"].includes(wd); // 장중에는 오늘 봉이 미완성
}

async function stockNews(code) {
  try {
    const groups = await getJson(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=5&page=1`);
    return groups.flatMap((g) => g.items || []).slice(0, 3).map((n) => ({
      title: (n.titleFull || n.title || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      url: n.mobileNewsUrl || `https://n.news.naver.com/mnews/article/${n.officeId}/${n.articleId}`,
      office: n.officeName || "", time: n.datetime || "",
    }));
  } catch { return []; }
}

function atr(c, n = 14) {
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  return avg(tr.slice(-n));
}

// 3) 규칙 기반 시나리오
export function scenario(s, c, news) {
  const last = c.at(-1), prev = c.at(-2);
  const { o: O, h: H, l: L, c: C } = last;
  const chg = (C / prev.c - 1) * 100;
  const gap = (O / prev.c - 1) * 100;
  const ma = (n) => avg(c.slice(-n).map((x) => x.c));
  const ma5 = ma(5), ma20 = ma(20), ma60 = c.length >= 60 ? ma(60) : null;
  const volAvg = avg(c.slice(-21, -1).map((x) => x.v));
  const volRatio = volAvg ? last.v / volAvg : 1;
  const hi20 = Math.max(...c.slice(-21, -1).map((x) => x.h));
  const lo20 = Math.min(...c.slice(-21, -1).map((x) => x.l));
  const A = atr(c);
  const clv = H > L ? (C - L) / (H - L) : 0.5;
  const P = (H + L + C) / 3, R1 = 2 * P - L, S1 = 2 * P - H, R2 = P + (H - L), S2 = P - (H - L);
  const T = (x, m) => roundTick(x, m);
  const up = chg >= 0;
  const trendUp = C > ma5 && ma5 > ma20 && (ma60 == null || ma20 > ma60);
  const trendDown = C < ma5 && ma5 < ma20 && (ma60 == null || ma20 < ma60);
  const newHigh = C > hi20;
  const atrPct = (A / C) * 100;

  // ① 핵심 모멘텀
  const momentum = [
    `전일 ${pct(chg, 2)} ${up ? "상승" : "하락"} 마감, 거래대금 ${eok(s.tv)} (거래대금 상위 ${s.rank}위).`,
    `거래량은 20일 평균의 ${volRatio.toFixed(1)}배${volRatio >= 2 ? " — 수급이 몰렸습니다" : volRatio < 1 ? " — 평소보다 적습니다" : ""}.`,
    clv >= 0.7 ? `종가가 하루 범위의 위쪽(${Math.round(clv * 100)}%)에서 끝나 매수세가 끝까지 유지됐습니다.`
      : clv <= 0.3 ? `종가가 하루 범위의 아래쪽(${Math.round(clv * 100)}%)에서 끝나 장중 차익실현·매도 압력이 컸습니다.`
      : `종가가 하루 범위의 중간(${Math.round(clv * 100)}%)이라 방향성은 오늘 장 초반에 확인이 필요합니다.`,
    trendUp ? `주가가 5·20${ma60 ? "·60" : ""}일선 위에 정배열(상승 추세)입니다.`
      : trendDown ? `주가가 5·20${ma60 ? "·60" : ""}일선 아래 역배열(하락 추세)입니다.`
      : `이동평균선이 엇갈려 추세는 혼조입니다 (5일선 ${won(ma5)} · 20일선 ${won(ma20)}).`,
  ];
  if (newHigh) momentum.push(`최근 20거래일 고점(${won(hi20)})을 넘어선 신고가 돌파 구간입니다.`);
  if (Math.abs(gap) >= 3) momentum.push(`전일 시가가 ${pct(gap)} 갭으로 출발했습니다.`);
  const score = (volRatio >= 2) + (clv >= 0.7) + trendUp + newHigh - (clv <= 0.3) - trendDown;
  const sustain = score >= 3 ? "높음" : score >= 1 ? "보통" : "낮음";
  momentum.push(`지속 가능성(규칙 점수 ${Math.max(0, score)}/4): ${sustain} — 거래량·종가 위치·추세·신고가 여부로 계산했습니다. 재료 뉴스의 성격은 아래 뉴스로 직접 확인하세요.`);

  // ② 진입 후보
  const bo = T(H, "ceil"); // 돌파 기준: 전일 고가
  const pbHigh = T(Math.max(P, S1), "round"), pbLow = T(Math.max(S1, L), "round");
  const zoneLo = Math.min(pbLow, pbHigh), zoneHi = Math.max(pbLow, pbHigh);
  const boStop = T(H - 0.5 * A, "floor");
  const pbStop = T(Math.min(S1, L) - 0.25 * A, "floor");
  const boT1 = T(Math.max(R1, H + A), "ceil");
  // 20일 고점이 가까우면(1차 목표 + 2 ATR 이내) 2차 목표로, 너무 멀면 피벗 2차 저항 사용
  const boT2 = T(Math.max(R2, hi20 > boT1 && hi20 <= boT1 + 2 * A ? hi20 : 0, boT1 + 0.5 * A), "ceil");
  const pbT1 = T(Math.max(H, zoneHi + 0.5 * A), "ceil");
  const pbT2 = T(Math.max(R1, pbT1 + 0.5 * A), "ceil");
  const rr = (entry, stop, tgt) => (entry - stop > 0 ? ((tgt - entry) / (entry - stop)).toFixed(1) : "-");
  const entry = [
    `돌파형: ${won(bo)}원(전일 고가) 돌파 시. 돌파하는 봉의 거래량이 직전 5분 평균의 2배 이상이고, 09:00~09:30 누적 거래대금이 전일의 10%(약 ${eok(s.tv * 0.1)}) 이상일 때만 진입. 돌파 후 1~2개 봉이 ${won(bo)}원 위에서 버티는지 확인합니다.`,
    `눌림형: ${won(zoneLo)}~${won(zoneHi)}원(피벗·1차 지지) 구간까지 거래량이 줄며 내려온 뒤, 저점이 높아지고 거래량이 실린 양봉이 나올 때. 5일선(${won(ma5)}원) 지지 여부를 함께 봅니다.`,
    `시가가 ${won(T(R1, "ceil"))}원(1차 저항) 위로 갭상승 출발하면 추격 매수는 피하고, 시가 부근 첫 눌림이 지지되는지 확인한 뒤에만 고려합니다.`,
  ];

  // ③ 손절·무효화
  const stop = [
    `돌파형 손절: ${won(boStop)}원 아래로 다시 내려가면 (5분봉 종가 기준) — 진입가 대비 약 ${pct((boStop / bo - 1) * 100)}.`,
    `눌림형 손절: ${won(pbStop)}원 이탈 시 — 구간 상단 대비 약 ${pct((pbStop / zoneHi - 1) * 100)}.`,
    `시나리오 무효: 시가가 ${won(T(S2, "floor"))}원(2차 지지) 아래에서 출발하거나, 전일 저가 ${won(L)}원을 깨고 10분 안에 회복하지 못하거나, 09:30까지 거래대금이 전일의 5%(약 ${eok(s.tv * 0.05)})에 못 미치면 오늘은 관망합니다.`,
  ];

  // ④ 분할 익절·리스크
  const take = [
    `돌파형: 1차 ${won(boT1)}원에서 1/3 (손익비 ${rr(bo, boStop, boT1)}), 2차 ${won(boT2)}원에서 1/3, 나머지는 고점 대비 ${won(T(0.5 * A))}원(ATR의 절반) 밀리거나 5분봉 20선을 깨면 정리.`,
    `눌림형: 1차 ${won(pbT1)}원(전일 고가 부근)에서 절반 (손익비 ${rr(zoneHi, pbStop, pbT1)}), 2차 ${won(pbT2)}원에서 나머지.`,
  ];
  const risk = [];
  if (chg >= 29) risk.push(`전일 상한가(또는 근접) 다음 날입니다. 갭상승 후 시초에 차익실현 물량이 한꺼번에 나올 수 있어 시가 추격은 특히 위험합니다.`);
  else if (chg >= 15) risk.push(`전일 ${pct(chg)} 급등: 상따·갭상승 뒤 차익실현 매물이 나오기 쉽습니다. 장 시작 5~10분은 관망을 권합니다.`);
  else if (chg >= 7) risk.push(`전일 ${pct(chg)} 상승: 갭상승 출발 시 시초가가 당일 고점이 되는 경우가 잦습니다.`);
  if (chg <= -10) risk.push(`전일 ${pct(chg)} 급락: 기술적 반등이 나올 수 있지만 추가 투매 위험이 커서 손절폭을 짧게 잡아야 합니다.`);
  if (C < 5000 || s.mcap < 3000) risk.push(`저가·소형주${s.mcap ? `(시가총액 ${eok(s.mcap * 100)})` : ""}: 호가 공백이 생기기 쉬워 슬리피지가 큽니다. 시장가 주문은 피하세요.`);
  if (atrPct >= 7) risk.push(`하루 평균 변동폭(ATR)이 ${atrPct.toFixed(1)}%로 큽니다. 비중을 줄이세요.`);
  if (volRatio < 1) risk.push(`거래량이 평소 이하라 돌파 신호의 신뢰도가 낮습니다.`);
  if (newHigh) risk.push(`신고가 구간은 위쪽 매물이 없어 탄력이 크지만, 실패하면 하락도 빠릅니다.`);
  risk.push(`장 시작 직후(09:00~09:05)와 장 마감 직전에는 변동성이 커서 신호가 자주 틀립니다. 재료 공시·뉴스 정정이 나오면 시나리오와 상관없이 정리하세요.`);

  return {
    code: s.code, name: s.name, market: s.market, rank: s.rank,
    date: last.d, price: C, chg, tv: s.tv, volRatio, sustain,
    levels: { open: O, high: H, low: L, close: C, pivot: T(P), r1: T(R1, "ceil"), r2: T(R2, "ceil"), s1: T(S1, "floor"), s2: T(S2, "floor"), ma5: Math.round(ma5), ma20: Math.round(ma20), ma60: ma60 && Math.round(ma60), hi20, lo20, atr: Math.round(A) },
    sections: { momentum, entry, stop, take, risk },
    news,
  };
}

async function main() {
  const top = await topStocks();
  const items = [];
  for (const s of top) {
    if (items.length >= TOP_N) break;
    try {
      const c = await dailyCandles(s.code);
      if (c.length < 25) throw new Error("일봉 부족");
      items.push(scenario(s, c, await stockNews(s.code)));
      console.log(`${s.rank}. ${s.name}: 완료`);
    } catch (e) { console.error(`${s.name}: 실패 - ${e.message}`); }
  }
  if (!items.length) throw new Error("가이드를 만들 종목이 없습니다.");
  await mkdir("data", { recursive: true });
  await writeFile("data/guide.json", JSON.stringify({ updatedAt: new Date().toISOString(), basis: items[0].date, items }, null, 1) + "\n");
  console.log(`가이드 ${items.length}종목 저장 (기준일 ${items[0].date})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
