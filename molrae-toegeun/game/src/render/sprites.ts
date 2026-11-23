/**
 * 액터 → 스프라이트 키 매핑(표시 전용). 아트 출력(game/assets/sprites/anims.json)의 캐릭터 키와 데이터 액터 id를 잇는다.
 * 데이터 bosses/npcs.json spriteKey(T-134)를 먼저 쓰고, 없을 때만 이 표로 대체한다
 */
export const ATLAS_KEY = 'sprites';

const ACTOR_SPRITE: Readonly<Record<string, string>> = {
  senior: 'senior',
  team_lead: 'teamlead',
  director: 'exec',
  ceo: 'ceo',
  security_guard: 'guard',
  snitch: 'snitch',
  accomplice: 'accomplice',
  hr_inspector: 'hr',
};

/** 배경 동료(actorId 'background:<id>')는 BackgroundDef.sprite를 따로 넘긴다 */
export function spriteKeyFor(actorId: string | undefined, dataKey?: string): string {
  return dataKey || (actorId && ACTOR_SPRITE[actorId]) || 'guard';
}

export type Facing4 = 'down' | 'up' | 'left' | 'right';

export function facing4(angle: number): Facing4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  if (Math.abs(c) >= Math.abs(s) - 1e-6) return c >= 0 ? 'right' : 'left';
  return s >= 0 ? 'down' : 'up';
}

/** 화면 밖 화살표 스프라이트 접두(사원증 줄 색, D-037). 없으면 화살표 없음 */
export function edgeArrowKey(lanyard: string): string | null {
  switch (lanyard) {
    case 'boss': return 'edge_boss';
    case 'guard': return 'edge_guard';
    case 'snitch': return 'edge_snitch';
    case 'hr': return 'edge_hr';
    default: return null;
  }
}

/** 시선 콘 오버레이 키(평상시, 전조) */
export function coneOverlayKeys(lanyard: string): { normal: string; tell: string } {
  if (lanyard === 'boss') return { normal: 'cone_boss', tell: 'cone_tell' };
  if (lanyard === 'guard') return { normal: 'cone_guard', tell: 'cone_tell_guard' };
  return { normal: 'cone_npc', tell: 'cone_tell_npc' };
}
