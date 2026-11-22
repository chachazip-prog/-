/**
 * 시선 콘 판정 (순수 TS). 거리·각도 + 그리드 레이캐스트(DDA, Amanatides–Woo)로 엄폐물 가림 처리.
 * 각도 규약: 라디안, 0 = +x(오른쪽), π/2 = +y(화면 아래). 좌표는 타일 단위 연속 좌표.
 * 렌더링(콘 다각형)과 판정이 같은 rayDistance를 써서 "보이는 콘 = 실제 판정"을 보장한다.
 */
import { blocksSight, type GridMap, type Vec } from './grid';

export interface ConeDef {
  /** 시야 거리(타일) */
  readonly range: number;
  /** 콘 반각(도). 전체 시야각 = 2 × halfAngleDeg */
  readonly halfAngleDeg: number;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIR_ANGLE: Readonly<Record<Dir, number>> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

/** 두 각의 차이 절댓값 [0, π] */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return Math.abs(d);
}

/** 각도를 (-π, π]로 정규화 */
export function normAngle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d <= -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
}

/**
 * (ox, oy)에서 단위벡터 (dx, dy) 방향으로 시야 차단 타일 경계까지의 거리. maxDist에서 자른다.
 * 출발 타일 자체는 검사하지 않는다. 정확히 모서리를 지날 때 양옆 두 타일이 모두 막혀 있으면 막힘(대각 틈 투시 방지).
 */
export function rayDistance(map: GridMap, ox: number, oy: number, dx: number, dy: number, maxDist: number): number {
  let tx = Math.floor(ox), ty = Math.floor(oy);
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = sx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaY = sy !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX = sx > 0 ? (tx + 1 - ox) * tDeltaX : sx < 0 ? (ox - tx) * tDeltaX : Infinity;
  let tMaxY = sy > 0 ? (ty + 1 - oy) * tDeltaY : sy < 0 ? (oy - ty) * tDeltaY : Infinity;
  const EPS = 1e-9;
  for (let guard = 0; guard < 4096; guard++) {
    if (Math.abs(tMaxX - tMaxY) < EPS) {
      const t = tMaxX;
      if (t > maxDist) return maxDist;
      if (blocksSight(map, tx + sx, ty) && blocksSight(map, tx, ty + sy)) return t;
      tx += sx; ty += sy;
      tMaxX += tDeltaX; tMaxY += tDeltaY;
      if (blocksSight(map, tx, ty)) return t;
    } else if (tMaxX < tMaxY) {
      const t = tMaxX;
      if (t > maxDist) return maxDist;
      tx += sx; tMaxX += tDeltaX;
      if (blocksSight(map, tx, ty)) return t;
    } else {
      const t = tMaxY;
      if (t > maxDist) return maxDist;
      ty += sy; tMaxY += tDeltaY;
      if (blocksSight(map, tx, ty)) return t;
    }
  }
  return maxDist;
}

/** from → to 사이에 시야 차단 타일이 없는가 */
export function hasLineOfSight(map: GridMap, from: Vec, to: Vec): boolean {
  const ddx = to.x - from.x, ddy = to.y - from.y;
  const dist = Math.hypot(ddx, ddy);
  if (dist < 1e-9) return true;
  return rayDistance(map, from.x, from.y, ddx / dist, ddy / dist, dist) >= dist - 1e-9;
}

/** 거리·각도만 본 콘 포함 여부 (가림 무시) */
export function inCone(origin: Vec, facing: number, cone: ConeDef, target: Vec): boolean {
  const ddx = target.x - origin.x, ddy = target.y - origin.y;
  const dist = Math.hypot(ddx, ddy);
  if (dist > cone.range) return false;
  if (dist < 1e-9) return true;
  return angleDiff(Math.atan2(ddy, ddx), facing) <= (cone.halfAngleDeg * Math.PI) / 180 + 1e-9;
}

/** 최종 시선 판정: 콘 안 + 가림 없음 */
export function canSee(map: GridMap, origin: Vec, facing: number, cone: ConeDef, target: Vec): boolean {
  return inCone(origin, facing, cone, target) && hasLineOfSight(map, origin, target);
}

/**
 * 렌더링용 콘 다각형: [origin, 광선 끝점들...]. 엄폐물에서 광선이 잘린다.
 * rays는 최소 2.
 */
export function conePolygon(map: GridMap, origin: Vec, facing: number, cone: ConeDef, rays: number): Vec[] {
  const half = (cone.halfAngleDeg * Math.PI) / 180;
  const n = Math.max(2, rays);
  const pts: Vec[] = [{ x: origin.x, y: origin.y }];
  for (let i = 0; i < n; i++) {
    const a = facing - half + (2 * half * i) / (n - 1);
    const dx = Math.cos(a), dy = Math.sin(a);
    const d = rayDistance(map, origin.x, origin.y, dx, dy, cone.range);
    pts.push({ x: origin.x + dx * d, y: origin.y + dy * d });
  }
  return pts;
}
