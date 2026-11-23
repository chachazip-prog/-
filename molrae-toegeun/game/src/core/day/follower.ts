/**
 * 공범 동료 따라오기(INT-12, patrols.p_accomplice_follow kind 'follow') — 렌더링 무관.
 * 플레이어가 지나간 자리(트레일)를 그대로 밟아 followGapTiles 뒤에 선다(벽을 뚫지 않음).
 * 합류 순간에는 자기 자리에서 플레이어까지의 A* 경로를 트레일로 받아 걸어온다.
 */
import { tileCenter, type GridMap, type Tile, type Vec } from '../grid';
import { findPath } from '../pathfinding';

/** 트레일 점 간격(타일). 렌더링·판정 정밀도용 값 */
const TRAIL_STEP = 0.25;

export class Follower {
  x: number;
  y: number;
  facing = Math.PI / 2;
  moving = false;
  private trail: Vec[] = [];

  constructor(start: Tile, player: Tile, map: GridMap, private readonly gapTiles: number, private readonly speed: number) {
    const c = tileCenter(start);
    this.x = c.x; this.y = c.y;
    const p = findPath(map, start, player);
    if (p) this.trail = p.map(tileCenter);
  }

  get pos(): Vec { return { x: this.x, y: this.y }; }
  get tile(): Tile { return { x: Math.floor(this.x), y: Math.floor(this.y) }; }

  /** 매 스텝: 플레이어 위치를 기록하고 트레일을 따라 이동. frozen이면 움직이지 않음(대표님 얼음) */
  step(dt: number, player: Vec, frozen: boolean): void {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(player.x - last.x, player.y - last.y) >= TRAIL_STEP) this.trail.push({ x: player.x, y: player.y });
    this.moving = false;
    if (frozen) return;
    let budget = this.speed * dt;
    while (budget > 0 && this.trail.length > 0) {
      // 남은 트레일 길이가 간격 이하면 멈춤(1타일 뒤 유지)
      if (this.trailLength() <= this.gapTiles + 1e-6) break;
      const t = this.trail[0]!;
      const dx = t.x - this.x, dy = t.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d <= 1e-9) { this.trail.shift(); continue; }
      this.facing = Math.atan2(dy, dx);
      this.moving = true;
      if (d <= budget) { this.x = t.x; this.y = t.y; budget -= d; this.trail.shift(); }
      else { this.x += (dx / d) * budget; this.y += (dy / d) * budget; budget = 0; }
    }
  }

  private trailLength(): number {
    let len = 0, px = this.x, py = this.y;
    for (const t of this.trail) { len += Math.hypot(t.x - px, t.y - py); px = t.x; py = t.y; }
    return len;
  }
}
