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
/**
 * 하단 조작대 높이(px, T-170 control-dpad §2: 칩·행동 버튼·방향 패드). 28 → 72 = 4.5칸.
 * 조작대 뒤 = 화면 밖(hudCoveredRowsAreOffscreen). rules.input.layout.deckHeightPx와 같은 값(표시값이라 코드 상수)
 */
export const HUD_BOTTOM_PX = 72;
/** 지도 타일 크기(px) — maps.json tileSizePx와 같음 */
export const TILE_PX = 16;

/** 화면 밖 판정(X10)용 화면 배치: 화면 높이 20타일 중 HUD가 가리는 행은 '화면 밖' */
export const CAMERA_VIEW = {
  viewHeightTiles: LOGICAL_HEIGHT / TILE_PX,
  insetTopTiles: HUD_TOP_PX / TILE_PX,
  insetBottomTiles: HUD_BOTTOM_PX / TILE_PX,
} as const;

/**
 * 세이프 에어리어 때문에 조작대를 올린 높이(논리 px, T-170 control-dpad §8-4). 레터박스 여유가 있으면 0.
 * main.ts가 부팅 때 한 번 정한다(판 도중 바뀌지 않음). 0이 아니면 그만큼 지도 보이는 칸이 줄어든다(화면 밖 판정 포함)
 */
let deckLift = 0;
export function setDeckLiftPx(px: number): void { deckLift = Math.max(0, Math.min(32, Math.round(px))); }
export function deckLiftPx(): number { return deckLift; }
/** 화면 아래에서 조작대 윗변까지(px) = HUD_BOTTOM_PX + 올린 높이 */
export function deckBottomPx(): number { return HUD_BOTTOM_PX + deckLift; }
/** 지금 화면 배치(조작대 올림 반영). 씬은 이 값을 DaySim에 넘긴다 */
export function cameraViewNow(): { viewHeightTiles: number; insetTopTiles: number; insetBottomTiles: number } {
  return { ...CAMERA_VIEW, insetBottomTiles: deckBottomPx() / TILE_PX };
}
