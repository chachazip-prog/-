/**
 * 콘텐츠 공급 지점: game/data/*.json v2(Vite 번들 포함) → DayContent.
 * 조립 로직은 buildDay.ts(순수 함수, QA 헤드리스 재사용). dev 상수(src/dev/protoFloor.ts)는 QA 테스트용으로만 남김.
 */
import { getDataTables } from '../data/loader';
import type { DayContent } from '../core/day/types';
import { authoredDayCount, buildDayContent, type BuildOptions } from './buildDay';
import { createLevelProvider, layoutEnabledInData } from './levelProvider';
import { missionsEnabledInData } from './missionsV3';
import { Strings, mergedStrings } from './strings';

export { buildDayContent, generateDay, dayPlan, authoredDayCount, DEFAULTS, hhmm, type Tables, type BuildOptions } from './buildDay';
export { createLevelProvider, authoredMapBundle, rankComplexity, layoutEnabledInData, type LevelProvider, type MapBundle, type LevelRequest } from './levelProvider';
export { Strings, mergedStrings, type StringsTable, type Vars } from './strings';

/**
 * 개발 파라미터(T-144·T-145): ?gen=1 생성 층 강제(0 = 끔) · ?missions=1 missions.json(v3) 강제(0 = 끔) · ?v3=1 둘 다
 * · ?genseed=문자열 생성 시드 덮어쓰기 · ?tour=1 팀장 순회 강제(0 = 끔). ?day=N과 함께 쓴다.
 * 앱인토스 실행 환경에서는 URL 파라미터가 없으므로 데이터 기본값(D-086: layout·missions enabled false)으로 동작한다.
 */
function devBuildOptions(): { key: string; opts: BuildOptions } {
  let q: URLSearchParams;
  try { q = new URLSearchParams(typeof location !== 'undefined' ? location.search : ''); } catch { q = new URLSearchParams(''); }
  const v3 = q.get('v3') === '1';
  const gen = v3 ? '1' : q.get('gen'), seed = q.get('genseed'), tour = q.get('tour'), mis = v3 ? '1' : q.get('missions');
  const tables = getDataTables();
  const generate = gen === '1' ? true : gen === '0' ? false : layoutEnabledInData(tables);
  const missionsV3 = mis === '1' ? true : mis === '0' ? false : missionsEnabledInData(tables);
  const opts: BuildOptions = {
    levelProvider: createLevelProvider({ generate, ...(seed ? { seedOverride: seed } : {}) }),
    missionsV3,
    ...(tour === '1' ? { tours: true } : tour === '0' ? { tours: false } : {}),
  };
  return { key: `${generate ? 1 : 0}|${missionsV3 ? 1 : 0}|${seed ?? ''}|${tour ?? ''}`, opts };
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
    strings = new Strings(mergedStrings(getDataTables()), (k) => {
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
