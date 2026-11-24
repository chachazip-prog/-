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

/**
 * 캐릭터 외형 = '액터 + 변형(variant)'(T-145, 성별 다양화 D-088 대비). 스프라이트 키를 액터 id와 1:1로 고정하지 않는다.
 *  - base: 데이터 spriteKey → 이 파일 표 → 'guard'
 *  - variant: 데이터(actor.spriteVariant 또는 배경 동료 variant)가 주면 `<base>_<variant>` 프레임이 아틀라스에 있을 때만 그 키, 없으면 base
 *  - 판정·데이터 id(actorId)는 외형과 무관(같은 팀장이 어떤 외형이든 규칙 같음)
 * [제안] 변형 키 규칙 `<base>_<variant>/<anim>`은 아트 확정 전 개발 가정. 바뀌면 variantKey()만 고친다.
 */
export interface CharacterSkin { readonly base: string; readonly variant?: string }

export function variantKey(base: string, variant: string): string { return `${base}_${variant}`; }

export function resolveSkin(skin: CharacterSkin, hasFrame: (frame: string) => boolean): string {
  if (skin.variant) {
    const k = variantKey(skin.base, skin.variant);
    if (hasFrame(`${k}/idle_down`)) return k;
  }
  return skin.base;
}

/** 배경 동료(actorId 'background:<id>')는 BackgroundDef.sprite를 따로 넘긴다 */
export function spriteKeyFor(actorId: string | undefined, dataKey?: string, variant?: string, hasFrame?: (frame: string) => boolean): string {
  const base = dataKey || (actorId && ACTOR_SPRITE[actorId]) || 'guard';
  return variant && hasFrame ? resolveSkin({ base, variant }, hasFrame) : base;
}

/**
 * 아트에 아직 없는 아이콘 → 지금 있는 키(T-146 작업 중, 표시 전용). 새 키가 아틀라스에 들어오면 자동으로 새 키를 씀
 */
const ICON_FALLBACK: Readonly<Record<string, string>> = {
  icon_parcel: 'icon_leave', icon_print: 'icon_shopping', icon_chat: 'icon_snack', icon_bank: 'icon_shopping',
  icon_cafe: 'icon_coffee', icon_window: 'icon_nap',
  icon_tour_printer: 'icon_shopping', icon_tour_cup: 'icon_coffee', icon_tour_meeting: 'icon_nap', icon_tour_talk: 'hud/talk_2', icon_tour_report: 'icon_done',
};
export function iconFallback(key: string): string { return ICON_FALLBACK[key] ?? key; }
export function iconFallbackTable(): Readonly<Record<string, string>> { return ICON_FALLBACK; }

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
