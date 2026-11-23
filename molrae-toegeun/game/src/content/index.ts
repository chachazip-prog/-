/**
 * 콘텐츠 공급 지점: game/data/*.json v2(Vite 번들 포함) → DayContent.
 * 조립 로직은 buildDay.ts(순수 함수, QA 헤드리스 재사용). dev 상수(src/dev/protoFloor.ts)는 QA 테스트용으로만 남김.
 */
import { getDataTables } from '../data/loader';
import type { DayContent } from '../core/day/types';
import { authoredDayCount, buildDayContent, type BuildOptions } from './buildDay';
import { createLevelProvider, layoutEnabledInData } from './levelProvider';
import { Strings, type StringsTable } from './strings';

export { buildDayContent, generateDay, dayPlan, authoredDayCount, DEFAULTS, hhmm, type Tables, type BuildOptions } from './buildDay';
export { createLevelProvider, authoredMapBundle, rankComplexity, layoutEnabledInData, type LevelProvider, type MapBundle, type LevelRequest } from './levelProvider';
export { Strings, type StringsTable, type Vars } from './strings';

/**
 * 개발 파라미터(T-144): ?gen=1 생성 층 강제(0 = 끔) · ?genseed=문자열 생성 시드 덮어쓰기 · ?tour=1 팀장 순회 강제(0 = 끔).
 * ?day=N과 함께 쓴다. 앱인토스 실행 환경에서는 URL 파라미터가 없으므로 데이터 기본값으로 동작한다.
 */
function devBuildOptions(): { key: string; opts: BuildOptions } {
  let q: URLSearchParams;
  try { q = new URLSearchParams(typeof location !== 'undefined' ? location.search : ''); } catch { q = new URLSearchParams(''); }
  const gen = q.get('gen'), seed = q.get('genseed'), tour = q.get('tour');
  const generate = gen === '1' ? true : gen === '0' ? false : layoutEnabledInData(getDataTables());
  const opts: BuildOptions = {
    levelProvider: createLevelProvider({ generate, ...(seed ? { seedOverride: seed } : {}) }),
    ...(tour === '1' ? { tours: true } : tour === '0' ? { tours: false } : {}),
  };
  return { key: `${generate ? 1 : 0}|${seed ?? ''}|${tour ?? ''}`, opts };
}

const cache = new Map<string, DayContent>();

export function loadDayContent(day: number): DayContent {
  const dev = devBuildOptions();
  const key = `${day}|${dev.key}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const warnings: string[] = [];
  const c = buildDayContent(getDataTables(), day, warnings, dev.opts);
  for (const w of warnings) console.warn(`[content] ${w}`);
  if (import.meta.env.DEV && c.layout) console.info(`[content] ${day}일차 층: ${c.layout.source} ${c.layout.mapId}${c.layout.modules ? ` [${c.layout.modules.join(', ')}] 시도 ${c.layout.attempts}` : ''}${c.bossTours ? ` · 순회 ${c.bossTours[0]?.atSec.length ?? 0}회` : ''}`);
  cache.set(key, c);
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
