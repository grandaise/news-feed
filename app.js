// 내 대시보드: 뉴스(공개 저장소) + 일정·할 일·투자(비공개 저장소)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- 설정 ----------
function defaultRepo() {
  const h = location.hostname;
  if (h.endsWith(".github.io")) {
    const owner = h.split(".")[0];
    return `${owner}/${location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`}`;
  }
  return "";
}
const cfg = {
  get repo() { return store.get("repo") || defaultRepo(); },
  get dataRepo() { return store.get("dataRepo") || (cfg.repo ? `${cfg.repo.split("/")[0]}/my-data` : ""); },
  get token() { return store.get("token") || ""; },
};

// ---------- 날짜 (한국시간) ----------
const TZ = "Asia/Seoul";
const dayFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const kstDay = (d) => dayFmt.format(new Date(d));
const today = () => kstDay(Date.now());
const addDays = (day, n) => { const d = new Date(day + "T12:00:00+09:00"); d.setUTCDate(d.getUTCDate() + n); return kstDay(d); };
const WD = "일월화수목금토";
const weekday = (day) => WD[new Date(day + "T12:00:00+09:00").getUTCDay()];
function dayLabel(day) {
  if (day === today()) return "오늘";
  if (day === addDays(today(), -1)) return "어제";
  if (day === addDays(today(), 1)) return "내일";
  const [, m, d] = day.split("-");
  return `${+m}월 ${+d}일 (${weekday(day)})`;
}
function rel(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return timeFmt.format(new Date(iso));
}
const won = (n) => (n == null || isNaN(n) ? "-" : Math.round(n).toLocaleString("ko-KR"));
const pct = (n) => (n == null || isNaN(n) ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const sign = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
const fmtNum = (n, max = 4) => (n == null || isNaN(n) ? "-" : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: max }));

// ---------- GitHub API ----------
function b64encode(s) {
  // 큰 문자열에서 스택이 넘치지 않도록 나눠서 변환
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

async function gh(repo, path, opts = {}) {
  if (!repo || !cfg.token) throw new Error("설정에서 이 기기를 먼저 연결하세요.");
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).message || res.statusText;
    if (res.status === 401) throw new Error("토큰이 잘못되었거나 만료되었습니다. 새 토큰을 연결해 주세요.");
    if (res.status === 403 || (res.status === 404 && opts.method)) {
      const perm = path.startsWith("/actions") ? "Actions" : "Contents";
      throw new Error(`토큰 권한 부족(${repo}): ${perm} 권한을 'Read and write'로 바꿔 주세요. (${res.status})`);
    }
    if (res.status === 404) throw Object.assign(new Error(`${repo} 저장소에 접근할 수 없습니다. 토큰의 Repository access에 추가해 주세요.`), { status: 404 });
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

async function ghFile(repo, path) {
  const r = await gh(repo, `/contents/${path}?ref=main&t=${Date.now()}`);
  return { json: JSON.parse(b64decode(r.content)), sha: r.sha };
}

async function ghPut(repo, path, obj, sha, message) {
  return gh(repo, `/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64encode(JSON.stringify(obj, null, 2) + "\n"), sha }),
  });
}

// 공개 파일: 토큰이 있으면 API(캐시 없음), 없으면 Pages 파일
async function loadPublic(path) {
  if (cfg.token && cfg.repo) {
    try { return (await ghFile(cfg.repo, path)).json; } catch (e) { console.warn(e); }
  }
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 불러오기 실패`);
  return res.json();
}

// ---------- 상태 ----------
const state = {
  view: store.get("view", "home"),
  news: { keywords: {} },
  keywords: [],
  tab: store.get("tab", "__all"),
  range: +store.get("range", "1"),
  q: "",
  lastVisit: +store.get("lastVisit", "0"),
  priv: null,            // { events, todos, holdings }
  privError: null,
  prices: { prices: {}, fx: {} },
  gcal: null,            // 구글 캘린더에서 가져온 일정 (my-data/gcal.json)
  live: {},              // 빗썸 실시간 코인 시세
  selDay: today(),
  calMonth: today().slice(0, 7),
};

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---------- 비공개 데이터 ----------
const EMPTY = () => ({ events: [], todos: [], holdings: [] });

async function loadPrivate() {
  if (!cfg.token || !cfg.dataRepo) { state.priv = null; return; }
  try {
    const [d, p, g] = await Promise.all([
      ghFile(cfg.dataRepo, "data.json"),
      ghFile(cfg.dataRepo, "prices.json").catch(() => null),
      ghFile(cfg.dataRepo, "gcal.json").catch(() => null),
    ]);
    state.priv = { ...EMPTY(), ...d.json };
    if (p) state.prices = p.json;
    state.gcal = g ? g.json : null;
    state.privError = null;
  } catch (e) {
    state.priv = null;
    state.privError = e.message;
  }
}

// 최신 data.json을 받아 변경 함수를 적용하고 저장 (다른 기기에서 바꾼 내용 보존)
let saving = Promise.resolve();
function mutate(message, fn) {
  saving = saving.then(async () => {
    try {
      const { json, sha } = await ghFile(cfg.dataRepo, "data.json");
      const next = { ...EMPTY(), ...json };
      fn(next);
      await ghPut(cfg.dataRepo, "data.json", next, sha, message);
      state.priv = next;
      renderAll();
    } catch (e) {
      toast(e.message, 6000);
    }
  });
  return saving;
}

async function loadLiveCoins() {
  const coins = [...new Set((state.priv?.holdings || []).filter((h) => h.type === "coin").map((h) => h.symbol.toUpperCase()))];
  if (!coins.length) return;
  // 빗썸 원화마켓 실시간 시세. 한 번에 실패하면(상장 안 된 코인 포함 등) 하나씩 다시 시도
  const get = async (list) => {
    const res = await fetch(`https://api.bithumb.com/v1/ticker?markets=${list.map((c) => `KRW-${c}`).join(",")}`);
    if (!res.ok) throw new Error(res.status);
    for (const t of await res.json()) state.live[t.market.slice(4)] = { price: t.trade_price, changePct: t.signed_change_rate * 100 };
  };
  try { await get(coins); }
  catch { await Promise.all(coins.map((c) => get([c]).catch(() => {}))); }
}

// ---------- 투자 계산 ----------
const TYPE = {
  kr: { label: "국내", group: "주식·ETF", color: "var(--c-stock)", cur: "원", unit: "주" },
  us: { label: "해외", group: "주식·ETF", color: "var(--c-stock)", cur: "$", unit: "주" },
  gold: { label: "금", group: "금", color: "var(--c-gold)", cur: "원", unit: "g" },
  coin: { label: "코인", group: "코인", color: "var(--c-coin)", cur: "원", unit: "개" },
  etc: { label: "기타", group: "기타·현금", color: "var(--c-etc)", cur: "원", unit: "" },
};
const priceKey = (h) => `${h.type}:${h.type === "coin" ? h.symbol.toUpperCase() : h.symbol}`;

function calc(h) {
  const fx = h.type === "us" ? state.prices.fx?.USD || null : 1;
  const p = state.prices.prices?.[priceKey(h)];
  const live = h.type === "coin" ? state.live[h.symbol.toUpperCase()] : null;
  const price = h.manualPrice || live?.price || p?.price || null;
  const changePct = h.manualPrice ? null : live?.changePct ?? p?.changePct ?? null;
  const qty = +h.qty || 0, avg = +h.avg || 0;
  // 평단가를 입력하지 않은 종목은 매입금액·손익을 계산하지 않는다
  // 해외 종목을 원화 평단으로 넣었으면 환율을 곱하지 않는다 (환차손익이 손익에 포함됨)
  const avgKrw = h.type === "us" && h.avgCur === "KRW";
  const cost = fx && avg ? qty * avg * (avgKrw ? 1 : fx) : null;
  const value = price != null && fx ? qty * price * fx : null;
  const pnl = value != null && cost != null ? value - cost : null;
  const annualDiv = h.dps && fx ? qty * h.dps * fx : 0;
  return {
    h, fx, price, changePct, cost, value, pnl,
    rate: pnl != null && cost ? (pnl / cost) * 100 : null,
    annualDiv,
    name: h.name || p?.name || h.symbol || "이름 없음",
  };
}

function portfolio() {
  const rows = (state.priv?.holdings || []).map(calc);
  const valued = rows.filter((r) => r.value != null);
  const value = valued.reduce((s, r) => s + r.value, 0);
  // 손익·수익률은 평단가가 있는 종목만으로 계산
  const priced = valued.filter((r) => r.cost != null);
  const cost = priced.reduce((s, r) => s + r.cost, 0);
  const pricedValue = priced.reduce((s, r) => s + r.value, 0);
  const groups = {};
  for (const r of valued) {
    const g = TYPE[r.h.type].group;
    groups[g] = groups[g] || { value: 0, color: TYPE[r.h.type].color };
    groups[g].value += r.value;
  }
  const monthly = Array(12).fill(0);
  for (const r of rows) {
    const ms = r.h.divMonths || [];
    if (!r.annualDiv || !ms.length) continue;
    for (const m of ms) monthly[m - 1] += r.annualDiv / ms.length;
  }
  return {
    rows, cost, value, pnl: pricedValue - cost, rate: cost ? ((pricedValue - cost) / cost) * 100 : 0,
    annualDiv: rows.reduce((s, r) => s + r.annualDiv, 0),
    groups, monthly, missing: rows.length - valued.length,
    noAvg: rows.filter((r) => !(+r.h.avg)).length,
  };
}

// ---------- 공통 렌더 조각 ----------
const metric = (lb, v, cls = "") => `<div class="metric"><div class="lb">${lb}</div><div class="v ${cls}">${v}</div></div>`;

function allocHtml(pf) {
  const entries = Object.entries(pf.groups).sort((a, b) => b[1].value - a[1].value);
  if (!entries.length) return `<div class="empty">종목을 추가하면 자산 배분이 표시됩니다.</div>`;
  return `<div class="bar">${entries.map(([, g]) => `<div style="width:${(g.value / pf.value) * 100}%;background:${g.color}"></div>`).join("")}</div>
    <div class="legend">${entries.map(([name, g]) =>
      `<div><span><span class="sw" style="background:${g.color}"></span>${esc(name)}</span><span>${won(g.value)}원 · ${((g.value / pf.value) * 100).toFixed(1)}%</span></div>`).join("")}</div>`;
}

function divChartHtml(pf) {
  const max = Math.max(...pf.monthly);
  if (!max) return `<div class="empty">종목에 배당금과 지급 월을 넣으면 월별 예상이 표시됩니다.</div>`;
  const nowM = +today().slice(5, 7);
  return `<div class="divchart">${pf.monthly.map((v, i) =>
      `<div class="${i + 1 === nowM ? "now" : ""}" style="height:${Math.max(2, (v / max) * 90)}px" title="${i + 1}월 ${won(v)}원"></div>`).join("")}</div>
    <div class="divlbl">${pf.monthly.map((_, i) => `<span>${i + 1}</span>`).join("")}</div>
    <p class="muted sm" style="margin:8px 0 0">이번 달 ${won(pf.monthly[nowM - 1])}원 · 연간 ${won(pf.annualDiv)}원 (세전)</p>`;
}

// 내 일정 + 구글 캘린더 일정 (여러 날 일정은 기간 내 매일 표시)
function eventsOn(day) {
  const mine = (state.priv?.events || []).filter((e) => e.date === day);
  const google = (state.gcal?.events || [])
    .filter((e) => e.date === day || (e.endDate && e.date <= day && day <= e.endDate))
    .map((e) => ({ ...e, cat: "구글", src: "google" }));
  return [...mine, ...google].sort((a, b) => (a.time || "00").localeCompare(b.time || "00"));
}

// 구글 캘린더 "일정 만들기" 화면 주소 (내용이 미리 채워짐)
function gcalAddUrl(e) {
  const d = e.date.replace(/-/g, "");
  let dates;
  if (e.time) {
    const [h, m] = e.time.split(":").map(Number);
    const end = `${String((h + 1) % 24).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
    dates = `${d}T${e.time.replace(":", "")}00/${h === 23 ? addDays(e.date, 1).replace(/-/g, "") : d}T${end}`;
  } else {
    dates = `${d}/${addDays(e.date, 1).replace(/-/g, "")}`;
  }
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates, ctz: TZ, details: `분류: ${e.cat}` });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function eventHtml(e, { del = true } = {}) {
  const google = e.src === "google";
  const range = google && e.endDate ? `~${+e.endDate.slice(5, 7)}/${+e.endDate.slice(8)}` : google && e.endTime ? `~${e.endTime}` : "";
  return `<div class="ev"><span class="tm">${esc(e.time || "종일")}</span>
    <span class="tt">${esc(e.title)}<span class="cat cat-${esc(e.cat)}">${esc(e.cat)}</span>
      ${range || e.location ? `<span class="muted sm" style="display:block">${esc([range, e.location].filter(Boolean).join(" · "))}</span>` : ""}</span>
    ${!google && del ? `<a class="gadd" href="${esc(gcalAddUrl(e))}" target="_blank" rel="noopener" title="구글 캘린더에 추가">G+</a>` : ""}
    ${!google && del ? `<button class="x" data-del-event="${esc(e.id)}" title="삭제" aria-label="삭제">×</button>` : ""}</div>`;
}

function todoHtml(t) {
  const late = t.due && !t.done && t.due < today();
  return `<li class="${t.done ? "done" : ""}">
    <input type="checkbox" data-toggle-todo="${esc(t.id)}" ${t.done ? "checked" : ""} aria-label="완료">
    <span class="tt">${esc(t.title)}</span>
    ${t.due ? `<span class="due ${late ? "late" : ""}">${dayLabel(t.due)}</span>` : ""}
    <button class="x" data-del-todo="${esc(t.id)}" title="삭제" aria-label="삭제">×</button></li>`;
}

function sortedTodos() {
  return [...(state.priv?.todos || [])].sort((a, b) =>
    (a.done - b.done) || (a.due || "9999").localeCompare(b.due || "9999") || (a.created || "").localeCompare(b.created || ""));
}

function newsItems(tab, range = state.range, q = state.q) {
  const minDay = addDays(today(), -(range - 1));
  const kws = tab === "__all" ? state.keywords : [tab];
  const seen = new Set();
  const out = [];
  for (const kw of kws) {
    for (const it of state.news.keywords?.[kw] || []) {
      if (kstDay(it.publishedAt) < minDay || seen.has(it.link)) continue;
      seen.add(it.link);
      out.push({ ...it, kw });
    }
  }
  const s = q.trim().toLowerCase();
  return out.filter((it) => !s || `${it.title} ${it.source}`.toLowerCase().includes(s))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function newsLi(it, showKw) {
  const isNew = state.lastVisit && Date.parse(it.publishedAt) > state.lastVisit;
  return `<li><a href="${esc(it.link)}" target="_blank" rel="noopener">
    <div class="t">${isNew ? '<span class="badge">NEW</span>' : ""}${esc(it.title)}</div>
    <div class="meta">${showKw ? `<span class="kw">#${esc(it.kw)}</span>` : ""}<span>${esc(it.source || "")}</span><span>${rel(it.publishedAt)}</span></div>
  </a></li>`;
}

// ---------- 홈 ----------
function renderHome() {
  const connected = !!state.priv;
  const pf = connected ? portfolio() : null;
  const tEvents = connected ? eventsOn(today()) : [];
  const openTodos = connected ? sortedTodos().filter((t) => !t.done) : [];
  const newsToday = newsItems("__all", 1, "");

  $("#homeMetrics").innerHTML = connected
    ? metric("총 평가금액", `${won(pf.value)}<small>원</small>`) +
      metric("총 수익 (수익률)", `${pf.pnl > 0 ? "+" : ""}${won(pf.pnl)} <small>${pct(pf.rate)}</small>`, sign(pf.pnl)) +
      metric("연 배당 예상", `${won(pf.annualDiv)}<small>원</small>`) +
      metric("오늘 일정", `${tEvents.length}건 <small class="muted">· 할 일 ${openTodos.length}</small>`)
    : metric("오늘 뉴스", `${newsToday.length}건`) + metric("키워드", `${state.keywords.length}개`);

  $("#homeToday").hidden = $("#homeAlloc").hidden = $("#homeHoldings").hidden = !connected;
  if (connected) {
    $("#homeToday").innerHTML = `<div class="card-head"><h3>오늘 · ${+today().slice(5, 7)}월 ${+today().slice(8)}일 (${weekday(today())})</h3><a class="more" data-go="plan">일정 →</a></div>
      ${tEvents.map((e) => eventHtml(e, { del: false })).join("") || '<div class="empty" style="padding:10px 0">오늘 일정이 없습니다.</div>'}
      ${openTodos.length ? `<ul class="todos" style="border-top:1px solid var(--line);margin-top:6px;padding-top:4px">${openTodos.slice(0, 5).map(todoHtml).join("")}</ul>` : ""}`;
    $("#homeAlloc").innerHTML = `<div class="card-head"><h3>자산 배분</h3><span class="muted sm">평가금액 기준</span></div>${allocHtml(pf)}
      <h3 style="margin-top:14px">월별 배당 예상</h3>${divChartHtml(pf)}`;
    $("#homeHoldings").innerHTML = `<div class="card-head"><h3>투자 목록</h3><a class="more" data-go="invest">전체 →</a></div>
      ${pf.rows.length ? `<div class="table-wrap"><table class="tbl" style="min-width:420px">
        <tr><th>종목</th><th>평가금액</th><th>수익률</th><th>오늘</th></tr>
        ${[...pf.rows].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 6).map((r) => `<tr class="h" data-edit-holding="${esc(r.h.id)}">
          <td><span class="nm">${esc(r.name)}</span><span class="ty">${TYPE[r.h.type].label}</span></td>
          <td>${won(r.value)}</td><td class="${sign(r.rate)}">${pct(r.rate)}</td><td class="${sign(r.changePct)}">${pct(r.changePct)}</td></tr>`).join("")}
      </table></div>` : `<div class="empty">아직 종목이 없습니다. <a class="more" data-go="invest">종목 추가 →</a></div>`}`;
  }

  $("#homeNews").innerHTML = `<div class="card-head"><h3>오늘의 뉴스</h3><a class="more" data-go="news">전체 →</a></div>
    ${newsToday.length ? `<ul class="list">${newsToday.slice(0, 6).map((it) => newsLi(it, true)).join("")}</ul>` : '<div class="empty">오늘 올라온 기사가 없습니다.</div>'}`;
}

// ---------- 뉴스 ----------
function renderNews() {
  if (state.tab !== "__all" && !state.keywords.includes(state.tab)) state.tab = "__all";
  const tabs = [["__all", "전체"], ...state.keywords.map((k) => [k, k])];
  $("#tabs").innerHTML = tabs.map(([id, label]) =>
    `<button class="tab${id === state.tab ? " active" : ""}" data-tab="${esc(id)}">${esc(label)}<span class="cnt">${newsItems(id).length}</span></button>`
  ).join("") + `<button class="tab add" id="addTab">＋ 키워드</button>`;
  $$("[data-range]").forEach((b) => b.classList.toggle("on", +b.dataset.range === state.range));

  const items = newsItems(state.tab);
  if (!items.length) {
    const pending = state.tab !== "__all" && !state.news.keywords?.[state.tab];
    $("#list").innerHTML = `<div class="empty">${
      !state.keywords.length ? "＋ 키워드 버튼을 눌러 키워드를 추가하세요."
      : pending ? "아직 수집되지 않은 키워드입니다.<br>잠시 후 자동으로 표시됩니다."
      : state.range === 1 ? "오늘 올라온 기사가 없습니다.<br>3일·7일 필터를 눌러보세요." : "기사가 없습니다."}</div>`;
    return;
  }
  const groups = new Map();
  for (const it of items) {
    const d = kstDay(it.publishedAt);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(it);
  }
  $("#list").innerHTML = [...groups].map(([day, list]) =>
    `<div class="day">${dayLabel(day)} · ${list.length}건</div><ul class="list">${list.map((it) => newsLi(it, state.tab === "__all")).join("")}</ul>`).join("");
}

// ---------- 일정 ----------
function renderPlan() {
  const [y, m] = state.calMonth.split("-").map(Number);
  $("#calTitle").textContent = `${y}년 ${m}월`;
  const first = `${state.calMonth}-01`;
  const start = addDays(first, -new Date(first + "T12:00:00+09:00").getUTCDay());
  const catColor = { 업무: "var(--cat-work)", 개인: "var(--cat-life)", 재테크: "var(--cat-money)", 구글: "var(--cat-google)" };
  let html = [...WD].map((w) => `<div class="wd">${w}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const dow = i % 7;
    const cls = ["d", d.slice(0, 7) !== state.calMonth && "other", d === today() && "today", d === state.selDay && "sel", dow === 0 && "sun", dow === 6 && "sat"].filter(Boolean).join(" ");
    const dots = eventsOn(d).slice(0, 3).map((e) => `<i style="background:${catColor[e.cat] || "var(--accent)"}"></i>`).join("");
    html += `<button class="${cls}" data-day="${d}">${+d.slice(8)}<span class="dots">${dots}</span></button>`;
    if (i >= 34 && addDays(start, i + 1).slice(0, 7) !== state.calMonth && dow === 6) break;
  }
  $("#cal").innerHTML = html;
  const g = state.gcal;
  $("#gcalStatus").innerHTML = g?.updatedAt
    ? `<span class="sw" style="background:var(--cat-google)"></span>구글 캘린더 ${dayLabel(kstDay(g.updatedAt))} ${timeFmt.format(new Date(g.updatedAt))} 동기화 · ${g.events.length}건${g.errors ? ` · <span class="up">${esc(g.errors.join(", "))}</span>` : ""}`
    : `구글 캘린더 미연동 · <a href="https://github.com/${esc(cfg.repo)}#구글-캘린더-연동" target="_blank" rel="noopener">연동 방법</a>`;

  $("#dayTitle").textContent = `${dayLabel(state.selDay) === "오늘" ? "오늘 · " : ""}${+state.selDay.slice(5, 7)}월 ${+state.selDay.slice(8)}일 (${weekday(state.selDay)})`;
  const evs = eventsOn(state.selDay);
  $("#dayEvents").innerHTML = evs.map((e) => eventHtml(e)).join("") || '<div class="empty" style="padding:10px 0">일정이 없습니다.</div>';
  if (!$("#evDate").matches(":focus")) $("#evDate").value = state.selDay;

  $("#todos").innerHTML = sortedTodos().map(todoHtml).join("") || '<li class="muted" style="justify-content:center">할 일이 없습니다.</li>';

  const up = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(today(), i);
    const list = eventsOn(d);
    if (list.length) up.push(`<div class="upday">${dayLabel(d)}${i > 1 ? "" : ` · ${+d.slice(5, 7)}/${+d.slice(8)}`}</div>${list.map((e) => eventHtml(e, { del: false })).join("")}`);
  }
  $("#upcoming").innerHTML = up.join("") || '<div class="empty">2주 안에 예정된 일정이 없습니다.</div>';
}

// ---------- 투자 ----------
function renderInvest() {
  const pf = portfolio();
  $("#invMetrics").innerHTML =
    metric("매입금액", `${won(pf.cost)}<small>원</small>`) +
    metric("평가금액", `${won(pf.value)}<small>원</small>`) +
    metric("평가손익", `${pf.pnl > 0 ? "+" : ""}${won(pf.pnl)}<small>원</small>`, sign(pf.pnl)) +
    metric("수익률", pct(pf.rate), sign(pf.rate)) +
    metric("연 배당 예상", `${won(pf.annualDiv)}<small>원</small>`);

  const u = state.prices.updatedAt;
  $("#priceTime").textContent = u ? `시세 ${dayLabel(kstDay(u))} ${timeFmt.format(new Date(u))}` : "시세 수집 전";

  const rows = [...pf.rows].sort((a, b) => (b.value || 0) - (a.value || 0));
  $("#holdings").innerHTML = rows.length ? `
    <tr><th>종목</th><th>수량</th><th>평단가</th><th>현재가</th><th>매입금액</th><th>평가금액</th><th>손익</th><th>수익률</th><th>연 배당</th></tr>
    ${rows.map((r) => {
      const t = TYPE[r.h.type];
      const money = (v) => (r.h.type === "us" ? `$${fmtNum(v, 2)}` : won(v));
      const avgMoney = (v) => (r.h.type === "us" && r.h.avgCur === "KRW" ? `${won(v)}원` : money(v));
      return `<tr class="h" data-edit-holding="${esc(r.h.id)}" title="${esc(r.h.memo || "눌러서 수정")}">
        <td><span class="nm">${esc(r.name)}</span><span class="ty">${t.label}${r.h.symbol && r.h.type !== "gold" ? ` · ${esc(r.h.symbol)}` : ""}</span>
          ${r.h.lots?.length > 1 ? `<span class="lots">${r.h.lots.map((l) => `${esc(l.account)} ${fmtNum(l.qty)}${t.unit}${l.avg ? ` @${avgMoney(l.avg)}` : ""}`).join(" · ")}</span>` : ""}</td>
        <td>${fmtNum(r.h.qty)}${t.unit}</td><td>${+r.h.avg ? avgMoney(r.h.avg) : '<span class="up sm">미입력</span>'}</td>
        <td>${r.price != null ? money(r.price) : '<span class="muted">대기</span>'}${r.changePct != null ? ` <span class="${sign(r.changePct)} sm">${pct(r.changePct)}</span>` : ""}</td>
        <td>${won(r.cost)}</td><td>${won(r.value)}</td>
        <td class="${sign(r.pnl)}">${r.pnl != null ? (r.pnl > 0 ? "+" : "") + won(r.pnl) : "-"}</td>
        <td class="${sign(r.rate)}">${pct(r.rate)}</td><td>${r.annualDiv ? won(r.annualDiv) : "-"}</td></tr>`;
    }).join("")}
    <tfoot><tr><td>합계</td><td></td><td></td><td></td><td>${won(pf.cost)}</td><td>${won(pf.value)}</td>
      <td class="${sign(pf.pnl)}">${pf.pnl > 0 ? "+" : ""}${won(pf.pnl)}</td><td class="${sign(pf.rate)}">${pct(pf.rate)}</td><td>${won(pf.annualDiv)}</td></tr></tfoot>`
    : `<tr><td class="empty" style="text-align:center">＋ 종목 추가 버튼으로 주식, 금, 코인 등을 등록하세요.</td></tr>`;
  if (pf.missing) $("#priceTime").textContent += ` · ${pf.missing}개 종목 시세 대기 중`;
  if (pf.noAvg) $("#priceTime").textContent += ` · 평단가 미입력 ${pf.noAvg}개는 손익 계산에서 제외 (눌러서 입력)`;

  $("#invAlloc").innerHTML = `<div class="card-head"><h3>자산 배분</h3></div>${allocHtml(pf)}`;
  $("#invDiv").innerHTML = `<div class="card-head"><h3>월별 배당 예상</h3></div>${divChartHtml(pf)}`;
}

// ---------- 전체 렌더 ----------
function renderAll() {
  const v = ["home", "news", "plan", "invest"].includes(state.view) ? state.view : "home";
  $$("#views button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  const needsPriv = v === "plan" || v === "invest";
  const locked = needsPriv && !state.priv;
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === `view-${v}` && !locked));
  $("#needConnect").hidden = !locked;
  if (locked && state.privError && cfg.token) {
    $("#needConnect p").textContent = state.privError;
  }

  const u = state.news.updatedAt;
  $("#updated").textContent = u ? `뉴스 ${dayLabel(kstDay(u))} ${timeFmt.format(new Date(u))}` : "";

  renderNews();
  renderHome();
  if (state.priv) { renderPlan(); renderInvest(); }
}

function go(view) {
  state.view = view; store.set("view", view);
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  renderAll();
  window.scrollTo({ top: 0 });
}

// ---------- 키워드 ----------
async function saveKeywords(next, message) {
  const cur = await gh(cfg.repo, `/contents/keywords.json`);
  await ghPut(cfg.repo, "keywords.json", next, cur.sha, message);
  state.keywords = next;
  renderAll(); renderChips();
  toast("저장했습니다. 1~2분 뒤 기사가 수집됩니다.");
  pollFor(() => loadPublic("data/news.json"), (d) => d.updatedAt !== state.news.updatedAt, (d) => { state.news = d; });
}

async function addKeyword(kw) {
  kw = kw.trim();
  if (!kw) return;
  if (state.keywords.includes(kw)) return toast("이미 등록된 키워드입니다.");
  if (!cfg.token) {
    pendingAdd = kw;
    openSettings({ needConnect: true });
    return toast(`이 기기를 연결하면 "${kw}"가 바로 추가됩니다.`);
  }
  try {
    await saveKeywords([...state.keywords, kw], `키워드 추가: ${kw}`);
    $("#kwInput").value = "";
    state.tab = kw; store.set("tab", kw); renderAll();
  } catch (err) { toast(err.message, 6000); }
}

let pollTimers = {};
function pollFor(load, changed, apply, key = load.toString()) {
  clearInterval(pollTimers[key]);
  let n = 0;
  pollTimers[key] = setInterval(async () => {
    if (++n > 20) return clearInterval(pollTimers[key]);
    try {
      const d = await load();
      if (changed(d)) {
        clearInterval(pollTimers[key]);
        apply(d); renderAll(); toast("새 데이터를 불러왔습니다.");
      }
    } catch {}
  }, 15000);
}

// ---------- 설정 / 연결 ----------
function tokenUrl() {
  const p = new URLSearchParams({
    name: "내 대시보드", description: "news-feed 키워드, my-data 개인 데이터",
    target_name: cfg.repo.split("/")[0] || "", expires_in: "none", contents: "write", actions: "write",
  });
  return `https://github.com/settings/personal-access-tokens/new?${p}`;
}

function renderChips() {
  $("#kwChips").innerHTML = state.keywords.map((k) =>
    `<span class="chip">${esc(k)}<button data-del="${esc(k)}" title="삭제">×</button></span>`).join("") || '<span class="help">등록된 키워드가 없습니다.</span>';
  $("#kwHelp").textContent = cfg.token ? "추가·삭제하면 탭에 바로 반영되고, 1~2분 뒤 기사가 수집됩니다." : "처음 한 번은 아래에서 이 기기를 연결해야 추가·삭제할 수 있습니다.";
  $("#connStatus").textContent = !cfg.token ? "" : state.priv ? "✓ 뉴스·개인 데이터 연결됨" : "✓ 뉴스 연결됨 · 개인 데이터 미연결";
  if (cfg.token && !state.priv && state.privError) $("#connDetail").textContent = state.privError;
}

let pendingAdd = null;
async function connect() {
  const token = $("#tokenInput").value.trim();
  if (!token) return toast("토큰을 붙여넣어 주세요.");
  store.set("token", token);
  try {
    await gh(cfg.repo, "");
  } catch (err) {
    store.set("token", null); renderChips();
    return toast(`연결 실패: ${err.message}`, 6000);
  }
  $("#connect").classList.remove("attention");
  await loadPrivate();
  await loadLiveCoins();
  renderAll(); renderChips();
  toast(state.priv ? "연결되었습니다." : `뉴스는 연결됐지만 개인 데이터는 아직입니다: ${state.privError}`, 6000);
  if (pendingAdd) { const kw = pendingAdd; pendingAdd = null; addKeyword(kw); }
}

function openSettings({ needConnect = false } = {}) {
  $("#repoInput").value = cfg.repo;
  $("#dataRepoInput").value = cfg.dataRepo;
  $("#tokenInput").value = cfg.token;
  $("#tokenLink").href = tokenUrl();
  renderChips();
  if (!$("#settings").open) $("#settings").showModal();
  if (needConnect) {
    $("#connect").classList.add("attention");
    $("#connect").scrollIntoView({ block: "center" });
  }
}

// ---------- 종목 다이얼로그 ----------
const SYMBOL_HINT = {
  kr: ["종목 코드 (6자리)", "005930, 0104N0"],
  us: ["티커", "SCHD, AAPL, QQQ"],
  gold: ["", ""],
  coin: ["코인 심볼", "BTC, ETH, XRP"],
  etc: ["", ""],
};
function syncHoldingForm() {
  const t = $("#hType").value;
  const [label, ph] = SYMBOL_HINT[t];
  $("#hSymbolField").hidden = !label;
  $("#hSymbolLabel").textContent = label;
  $("#hSymbol").placeholder = ph;
  $("#hSymbol").required = !!label;
  const cur = t === "us" ? "달러" : "원";
  $("#hQtyLabel").textContent = t === "gold" ? "보유량 (g)" : t === "etc" ? "수량 (예금·현금은 1)" : "수량";
  $("#hAvgCur").hidden = t !== "us";
  const avgCur = t === "us" && $("#hAvgCur").value === "KRW" ? "원" : cur;
  $("#hAvgLabel").textContent = t === "gold" ? `평균 매입가 (원/g)` : t === "etc" ? "매입금액 (원)" : `평단가 (${avgCur})`;
  $$("#hLots .lot-avg").forEach((i) => { i.placeholder = `평단가 (${avgCur})`; });
  $("#hDpsLabel").textContent = t === "etc" ? "연 이자 (원)" : `연간 주당 배당금 (${cur})`;
  $("#hManualLabel").textContent = t === "etc" ? "현재 평가액 (원)" : `현재가 직접 입력 (${cur}, 선택)`;
  $("#hManual").required = t === "etc";
  $("#hLotsField").hidden = t === "etc";
}

let editingId = null;
function openHolding(id = null) {
  if (!state.priv) return openSettings({ needConnect: true });
  editingId = id;
  const h = (state.priv.holdings || []).find((x) => x.id === id) || { type: "kr", divMonths: [] };
  $("#holdingTitle").textContent = id ? "종목 수정" : "종목 추가";
  $("#hType").value = h.type;
  $("#hSymbol").value = h.symbol || "";
  $("#hName").value = h.name || "";
  $("#hQty").value = h.qty ?? "";
  // 기타 자산은 총액으로 입력받고 1단위 가격으로 저장하므로 다시 총액으로 보여준다
  const k = h.type === "etc" ? +h.qty || 1 : 1;
  $("#hAvg").value = h.avg != null ? +(h.avg * k).toFixed(4) : "";
  $("#hAvgCur").value = h.avgCur === "KRW" ? "KRW" : "USD";
  $("#hDps").value = h.dps ? +(h.dps * k).toFixed(4) : "";
  $("#hManual").value = h.manualPrice ? +(h.manualPrice * k).toFixed(4) : "";
  $("#hMemo").value = h.memo || "";
  $("#hMonths").innerHTML = Array.from({ length: 12 }, (_, i) =>
    `<label><input type="checkbox" value="${i + 1}" ${(h.divMonths || []).includes(i + 1) ? "checked" : ""}>${i + 1}월</label>`).join("");
  $("#hLots").innerHTML = (h.lots || []).map(lotRowHtml).join("");
  $("#holdingDelete").hidden = !id;
  syncHoldingForm();
  syncLots();
  $("#holdingDlg").showModal();
}

// ---------- 계좌별 보유 (연금저축·ISA 등) ----------
function lotRowHtml(l = {}) {
  return `<div class="row lot">
    <input class="lot-acc" list="accList" placeholder="계좌 (예: ISA)" value="${esc(l.account || "")}">
    <input class="lot-qty" type="number" step="any" min="0" placeholder="수량" value="${l.qty ?? ""}">
    <input class="lot-avg" type="number" step="any" min="0" placeholder="평단가" value="${l.avg ?? ""}">
    <button type="button" class="lot-del" title="계좌 삭제" aria-label="계좌 삭제">×</button></div>`;
}
function readLots() {
  return $$("#hLots .lot").map((r) => ({
    account: $(".lot-acc", r).value.trim() || "계좌",
    qty: +$(".lot-qty", r).value || 0,
    avg: +$(".lot-avg", r).value || null,
  })).filter((l) => l.qty > 0);
}
// 합계 수량, 전체 평단가(수량 가중평균). 평단가가 빠진 계좌가 있으면 전체 평단가는 비운다
function lotTotals(lots) {
  const qty = lots.reduce((s, l) => s + l.qty, 0);
  const avg = lots.length && lots.every((l) => l.avg) ? lots.reduce((s, l) => s + l.qty * l.avg, 0) / qty : null;
  return { qty, avg };
}
function syncLots() {
  const hasRows = $$("#hLots .lot").length > 0;
  $("#hQty").readOnly = $("#hAvg").readOnly = hasRows;
  if (!hasRows) return;
  const t = lotTotals(readLots());
  $("#hQty").value = t.qty ? +t.qty.toFixed(6) : "";
  $("#hAvg").value = t.avg ? +t.avg.toFixed(4) : "";
}
$("#addLot").addEventListener("click", () => {
  // 처음 나눌 때는 지금 입력된 수량·평단가를 첫 계좌로 옮겨 준다
  const first = !$$("#hLots .lot").length && $("#hQty").value
    ? { qty: $("#hQty").value, avg: $("#hAvg").value } : {};
  $("#hLots").insertAdjacentHTML("beforeend", lotRowHtml(first));
  syncHoldingForm();
  syncLots();
  $$("#hLots .lot-acc").at(-1).focus();
});
$("#hLots").addEventListener("input", syncLots);
$("#hLots").addEventListener("click", (e) => {
  if (!e.target.closest(".lot-del")) return;
  e.target.closest(".lot").remove();
  syncLots();
});

// ---------- 이벤트 연결 ----------
$("#views").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) go(b.dataset.view); });
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); go(g.dataset.go); return; }
  if (e.target.closest("[data-open-settings]")) return openSettings({ needConnect: true });
  const eh = e.target.closest("[data-edit-holding]");
  if (eh) return openHolding(eh.dataset.editHolding);
  const de = e.target.closest("[data-del-event]");
  if (de) {
    const id = de.dataset.delEvent;
    if (confirm("이 일정을 삭제할까요?")) mutate("일정 삭제", (d) => { d.events = d.events.filter((x) => x.id !== id); });
    return;
  }
  const dt = e.target.closest("[data-del-todo]");
  if (dt) {
    const id = dt.dataset.delTodo;
    mutate("할 일 삭제", (d) => { d.todos = d.todos.filter((x) => x.id !== id); });
  }
});
document.addEventListener("change", (e) => {
  const t = e.target.closest("[data-toggle-todo]");
  if (!t) return;
  const id = t.dataset.toggleTodo, done = t.checked;
  // 화면 먼저 반영
  const local = state.priv?.todos.find((x) => x.id === id);
  if (local) { local.done = done; renderAll(); }
  mutate(done ? "할 일 완료" : "할 일 되돌림", (d) => { const x = d.todos.find((y) => y.id === id); if (x) x.done = done; });
});

// 뉴스
$("#tabs").addEventListener("click", (e) => {
  if (e.target.closest("#addTab")) {
    const kw = prompt("추가할 키워드를 입력하세요 (예: 현대리바트)");
    if (kw) addKeyword(kw);
    return;
  }
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  state.tab = b.dataset.tab; store.set("tab", state.tab);
  renderNews(); window.scrollTo({ top: 0 });
});
$$("[data-range]").forEach((b) => b.addEventListener("click", () => { state.range = +b.dataset.range; store.set("range", state.range); renderNews(); }));
$("#search").addEventListener("input", (e) => { state.q = e.target.value; renderNews(); });

// 일정
$("#cal").addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  state.selDay = b.dataset.day;
  if (state.selDay.slice(0, 7) !== state.calMonth) state.calMonth = state.selDay.slice(0, 7);
  renderPlan();
});
const shiftMonth = (n) => {
  const [y, m] = state.calMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  state.calMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  renderPlan();
};
$("#calPrev").addEventListener("click", () => shiftMonth(-1));
$("#calNext").addEventListener("click", () => shiftMonth(1));
$("#calToday").addEventListener("click", () => { state.selDay = today(); state.calMonth = today().slice(0, 7); renderPlan(); });
$("#eventForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const ev = { id: uid(), date: $("#evDate").value, time: $("#evTime").value, title: $("#evTitle").value.trim(), cat: $("#evCat").value };
  if (!ev.date || !ev.title) return;
  state.selDay = ev.date; state.calMonth = ev.date.slice(0, 7);
  $("#evTitle").value = ""; $("#evTime").value = "";
  mutate(`일정 추가: ${ev.title}`, (d) => { d.events.push(ev); }).then(() => toast("일정을 추가했습니다."));
});
$("#todoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = { id: uid(), title: $("#todoTitle").value.trim(), due: $("#todoDue").value || "", done: false, created: new Date().toISOString() };
  if (!t.title) return;
  $("#todoTitle").value = ""; $("#todoDue").value = "";
  mutate(`할 일 추가: ${t.title}`, (d) => { d.todos.push(t); });
});

// 투자
$("#addHolding").addEventListener("click", () => openHolding());
$("#hType").addEventListener("change", syncHoldingForm);
$("#hAvgCur").addEventListener("change", syncHoldingForm);
$("#holdingCancel").addEventListener("click", () => $("#holdingDlg").close());
$("#holdingDelete").addEventListener("click", () => {
  const id = editingId;
  if (!id || !confirm("이 종목을 삭제할까요?")) return;
  $("#holdingDlg").close();
  mutate("종목 삭제", (d) => { d.holdings = d.holdings.filter((x) => x.id !== id); });
});
$("#holdingForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const type = $("#hType").value;
  let symbol = $("#hSymbol").value.trim();
  if (type === "kr") symbol = symbol.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (type === "us" || type === "coin") symbol = symbol.toUpperCase();
  if (type === "gold") symbol = "gold";
  if (type === "etc") symbol = "";
  if (type === "kr" && /^\d{1,5}$/.test(symbol)) symbol = symbol.padStart(6, "0");
  if (type === "kr" && !/^[0-9A-Z]{6}$/.test(symbol)) return toast("국내 종목 코드는 6자리입니다. (예: 005930, 0104N0)");
  const h = {
    id: editingId || uid(), type, symbol,
    name: $("#hName").value.trim(),
    qty: +$("#hQty").value, avg: +$("#hAvg").value || null,
    ...(type === "us" && { avgCur: $("#hAvgCur").value }),
    dps: +$("#hDps").value || 0,
    divMonths: $$("#hMonths input:checked").map((c) => +c.value),
    manualPrice: +$("#hManual").value || null,
    memo: $("#hMemo").value.trim(),
  };
  const lots = type === "etc" ? [] : readLots();
  if (lots.length) Object.assign(h, { lots }, lotTotals(lots));
  if (!(h.qty > 0)) return toast("수량을 입력해 주세요.");
  if (type === "etc" && h.qty) { h.avg /= h.qty; h.dps /= h.qty; if (h.manualPrice) h.manualPrice /= h.qty; }
  $("#holdingDlg").close();
  const isNew = !editingId;
  mutate(`${isNew ? "종목 추가" : "종목 수정"}: ${h.name || h.symbol || "기타"}`, (d) => {
    const i = d.holdings.findIndex((x) => x.id === h.id);
    if (i >= 0) d.holdings[i] = h; else d.holdings.push(h);
  }).then(() => {
    if (!isNew) return;
    toast("저장했습니다. 1~2분 뒤 시세가 반영됩니다.");
    loadLiveCoins().then(renderAll);
    watchPrices();
  });
});
function watchPrices() {
  const before = state.prices.updatedAt;
  pollFor(async () => (await ghFile(cfg.dataRepo, "prices.json")).json, (d) => d.updatedAt !== before, (d) => { state.prices = d; }, "prices");
}
$("#refreshPrices").addEventListener("click", async () => {
  try {
    await gh(cfg.dataRepo, "/actions/workflows/prices.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) });
    toast("시세 수집을 시작했습니다. 1~2분 뒤 자동으로 갱신됩니다.");
    await loadLiveCoins(); renderAll();
    watchPrices();
  } catch (err) { toast(err.message, 6000); }
});

// 설정
$("#openSettings").addEventListener("click", () => openSettings());
$("#closeSettings").addEventListener("click", () => { pendingAdd = null; $("#settings").close(); });
$("#repoInput").addEventListener("change", (e) => { store.set("repo", e.target.value.trim() || null); $("#tokenLink").href = tokenUrl(); });
$("#dataRepoInput").addEventListener("change", async (e) => { store.set("dataRepo", e.target.value.trim() || null); await loadPrivate(); renderAll(); renderChips(); });
$("#connectBtn").addEventListener("click", connect);
$("#tokenInput").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
$("#addForm").addEventListener("submit", (e) => { e.preventDefault(); addKeyword($("#kwInput").value); });
$("#kwChips").addEventListener("click", async (e) => {
  const kw = e.target.closest("[data-del]")?.dataset.del;
  if (!kw) return;
  if (!cfg.token) return openSettings({ needConnect: true });
  if (!confirm(`'${kw}' 키워드를 삭제할까요?`)) return;
  try { await saveKeywords(state.keywords.filter((k) => k !== kw), `키워드 삭제: ${kw}`); }
  catch (err) { toast(err.message, 6000); }
});
$("#runNow").addEventListener("click", async () => {
  try {
    await gh(cfg.repo, "/actions/workflows/fetch-news.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) });
    toast("뉴스 수집을 시작했습니다. 1~2분 뒤 자동으로 갱신됩니다.");
    pollFor(() => loadPublic("data/news.json"), (d) => d.updatedAt !== state.news.updatedAt, (d) => { state.news = d; });
  } catch (err) { toast(err.message, 6000); }
});

// ---------- 로드 ----------
async function load(manual = false) {
  try {
    const [kws, news] = await Promise.all([
      loadPublic("keywords.json"),
      loadPublic("data/news.json").catch(() => ({ keywords: {} })),
      loadPrivate(),
    ]);
    state.keywords = kws; state.news = news;
    await loadLiveCoins();
    renderAll();
    if (manual) toast("최신 데이터를 불러왔습니다.");
  } catch (err) {
    $("#list").innerHTML = $("#homeNews").innerHTML = `<div class="empty">불러오기 실패: ${esc(err.message)}</div>`;
  }
}

$("#reload").addEventListener("click", () => load(true));
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (v && v !== state.view) go(v); });
window.addEventListener("pagehide", () => store.set("lastVisit", Date.now()));
let lastLoad = Date.now();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastLoad > 60000) { lastLoad = Date.now(); load(); }
});

if (location.hash.length > 1) state.view = location.hash.slice(1);
renderAll();
load();
