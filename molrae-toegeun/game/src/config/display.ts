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
