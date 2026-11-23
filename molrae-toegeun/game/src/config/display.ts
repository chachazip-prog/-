/**
 * 화면(표시) 설정. 게임플레이 수치가 아니라 렌더링 기준값이므로 코드에 둔다.
 * 결정 근거: game/docs/display.md
 */
export const LOGICAL_WIDTH = 180;
export const LOGICAL_HEIGHT = 320;

/** 부모 영역(CSS px)에 들어가는 최대 정수 배율. 최소 1. */
export function integerZoomFor(parentWidth: number, parentHeight: number): number {
  const zoom = Math.floor(Math.min(parentWidth / LOGICAL_WIDTH, parentHeight / LOGICAL_HEIGHT));
  return Math.max(1, zoom);
}

/** 상단 HUD 높이(px): 시계·의심·업무 2줄 */
export const HUD_TOP_PX = 24;
/** 하단 HUD 높이(px): 미션 칩 */
export const HUD_BOTTOM_PX = 28;
/** 지도 타일 크기(px) — maps.json tileSizePx와 같음 */
export const TILE_PX = 16;

/** 화면 밖 판정(X10)용 화면 배치: 화면 높이 20타일 중 HUD가 가리는 행은 '화면 밖' */
export const CAMERA_VIEW = {
  viewHeightTiles: LOGICAL_HEIGHT / TILE_PX,
  insetTopTiles: HUD_TOP_PX / TILE_PX,
  insetBottomTiles: HUD_BOTTOM_PX / TILE_PX,
} as const;
