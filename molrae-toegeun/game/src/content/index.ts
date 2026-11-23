/**
 * 콘텐츠 공급 지점: game/data/*.json v2(Vite 번들 포함) → DayContent.
 * 조립 로직은 buildDay.ts(순수 함수, QA 헤드리스 재사용). dev 상수(src/dev/protoFloor.ts)는 QA 테스트용으로만 남김.
 */
import { getDataTables } from '../data/loader';
import type { DayContent } from '../core/day/types';
import { authoredDayCount, buildDayContent } from './buildDay';
import { Strings, type StringsTable } from './strings';

export { buildDayContent, generateDay, dayPlan, authoredDayCount, DEFAULTS, hhmm, type Tables } from './buildDay';
export { Strings, type StringsTable, type Vars } from './strings';

const cache = new Map<number, DayContent>();

export function loadDayContent(day: number): DayContent {
  const hit = cache.get(day);
  if (hit) return hit;
  const warnings: string[] = [];
  const c = buildDayContent(getDataTables(), day, warnings);
  for (const w of warnings) console.warn(`[content] ${w}`);
  cache.set(day, c);
  return c;
}

let strings: Strings | null = null;
export function getStrings(): Strings {
  if (!strings) {
    strings = new Strings(getDataTables()['strings.ko'] as unknown as StringsTable | undefined, (k) => {
      if (import.meta.env.DEV) console.warn(`[strings] 없는 키: ${k}`);
    });
  }
  return strings;
}

export function lastAuthoredDay(): number { return authoredDayCount(getDataTables()); }

/** ads.json 원본 */
export function getAdsTable(): Readonly<Record<string, unknown>> {
  return (getDataTables()['ads'] ?? {}) as Readonly<Record<string, unknown>>;
}
