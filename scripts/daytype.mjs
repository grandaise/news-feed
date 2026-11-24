// 한국 기준 오늘이 휴일(주말·공휴일)인지 판별한다.
//   node scripts/daytype.mjs        → "holiday" 또는 "workday" 출력
//   import { isHoliday } from "./daytype.mjs"
import { readFileSync } from "node:fs";

const list = JSON.parse(readFileSync(new URL("../holidays.json", import.meta.url), "utf8"));
const holidays = new Set(Object.entries(list).filter(([k]) => /^\d{4}$/.test(k)).flatMap(([, v]) => v));

export const kstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
export function isHoliday(day = kstToday()) {
  const wd = new Date(`${day}T12:00:00+09:00`).getUTCDay();
  return wd === 0 || wd === 6 || holidays.has(day);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const day = process.argv[2] || kstToday();
  console.log(isHoliday(day) ? "holiday" : "workday");
}
