/**
 * [임시 dev 상수] 팀장 순회(D-075, T-144). T-142가 bosses.json(또는 layout.json)에 순회 스키마를 확정하면 그 값으로 교체한다.
 * 숫자는 개발 가정이며 밸런스 값이 아니다(오너 결정 '하루 2~4회'만 반영).
 */
import { createRng } from '../core/rng';
import type { Tile } from '../core/grid';
import type { Dir } from '../core/vision';
import type { BossTourDef, BossTourStop } from '../core/day/types';

export const DEV_TOUR = {
  actorId: 'team_lead',
  seatPatrolId: 'p_tl_seat',
  /** 하루 순회 횟수(D-075: 2~4회) */
  countRange: [2, 4] as const,
  /** 출발 시각 구간 = 근무 구간 길이 × [first, last] */
  firstAtFrac: 0.1,
  lastAtFrac: 0.8,
  /** 이 비율 이후로 밀린 회차는 취소 */
  latestStartFrac: 0.88,
  /** 일어나기 전조(초). rules.tell.minSec보다 짧으면 그 값으로 올림 */
  standTellSec: 0.8,
  stopsPerTour: [1, 2] as const,
  waitSecRange: [2, 4] as const,
  lookChance: 0.5,
  /** 목적지 후보(앞 스팟부터 이 층에 있는 것 사용). 프린터·회의실·탕비실·옆 팀(D-075) */
  destinations: [
    { id: 'printer', spots: ['tour_printer', 'tour_copier'] },
    { id: 'meeting', spots: ['tour_meeting', 'meeting_inside'] },
    { id: 'pantry', spots: ['tour_pantry', 'coffee_use'] },
    { id: 'next_team', spots: ['tour_next_team'] },
  ],
} as const;

/** 시드 스트림 day-{n}-tour로 순회 일정을 만든다(같은 날 = 모든 플레이어 같은 일정) */
export function buildDevTour(
  day: number, dayPhaseSec: number, tellMinSec: number,
  spots: Readonly<Record<string, { readonly tile: Tile; readonly facing?: Dir }>>,
): BossTourDef | null {
  const T = DEV_TOUR;
  const dests = T.destinations
    .map((d) => {
      const name = d.spots.find((s) => spots[s]);
      const sp = name ? spots[name] : undefined;
      return sp ? { id: d.id, tile: sp.tile, facing: sp.facing } : null;
    })
    .filter((d): d is { id: 'printer' | 'meeting' | 'pantry' | 'next_team'; tile: Tile; facing: Dir | undefined } => d !== null);
  if (dests.length === 0) return null;
  const rng = createRng(`day-${day}-tour`);
  const n = rng.int(T.countRange[0], T.countRange[1]);
  const a = dayPhaseSec * T.firstAtFrac, b = dayPhaseSec * T.lastAtFrac;
  const seg = (b - a) / n;
  const atSec: number[] = [];
  const routes: BossTourStop[][] = [];
  for (let i = 0; i < n; i++) {
    atSec.push(Math.round((a + seg * i + rng.range(0.1, 0.6) * seg) * 10) / 10);
    const k = Math.min(dests.length, rng.int(T.stopsPerTour[0], T.stopsPerTour[1]));
    const picks = rng.shuffle(dests).slice(0, k);
    routes.push(picks.map((d) => ({
      id: d.id, tile: d.tile, waitSec: Math.round(rng.range(T.waitSecRange[0], T.waitSecRange[1]) * 10) / 10, lookChance: T.lookChance,
      ...(d.facing ? { facing: d.facing } : {}),
    })));
  }
  return {
    actorId: T.actorId, seatPatrolId: T.seatPatrolId, atSec, routes,
    standTellSec: Math.max(tellMinSec, T.standTellSec), latestStartSec: dayPhaseSec * T.latestStartFrac,
  };
}
