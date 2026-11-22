/**
 * 플레이어 이동 상태 머신 (D-033: 목적지 탭 → 자동 경로 이동, 이동 중 탭 → 정지·위장).
 *
 *   idle ──move──▶ moving ──도착──▶ idle
 *   disguised ──move──▶ moving ──stop(탭)──▶ disguised
 *   (talked 제외 모든 상태) ──forceTalk──▶ talked ──시간 종료──▶ idle   (경로는 취소됨)
 *
 * talked 동안에는 move/stop 입력을 무시한다.
 */
import { tileCenter, tileOf, type Tile, type Vec } from './grid';

export type PlayerMode = 'idle' | 'moving' | 'disguised' | 'talked';

export class PlayerMover {
  x: number;
  y: number;
  mode: PlayerMode = 'idle';
  /** 현재 모드에 머문 시간(초) */
  modeTime = 0;
  /** 마지막 이동 방향(라디안). 렌더링용 */
  facing = -Math.PI / 2;
  private path: Vec[] = [];
  private pathIndex = 0;
  private talkLeft = 0;

  constructor(start: Tile) {
    const c = tileCenter(start);
    this.x = c.x;
    this.y = c.y;
  }

  get pos(): Vec { return { x: this.x, y: this.y }; }
  get tile(): Tile { return tileOf(this); }

  /** 남은 경로 노드(타일 중심). 렌더링용 */
  remainingPath(): readonly Vec[] { return this.path.slice(this.pathIndex); }

  private setMode(m: PlayerMode): void {
    if (this.mode !== m) { this.mode = m; this.modeTime = 0; }
  }

  /** 경로(시작 타일 제외, 목적지 포함)를 따라 이동 시작. 성공 여부 반환 */
  move(path: readonly Tile[]): boolean {
    if (this.mode === 'talked') return false;
    const nodes = path.map(tileCenter);
    // 타일 중심이 아닌 곳(이동 중 정지)에서 출발하면 먼저 현재 타일 중심으로 정렬
    const here = tileCenter(this.tile);
    if (Math.abs(here.x - this.x) > 1e-6 || Math.abs(here.y - this.y) > 1e-6) nodes.unshift(here);
    if (nodes.length === 0) return false;
    this.path = nodes;
    this.pathIndex = 0;
    this.setMode('moving');
    return true;
  }

  /** 이동 중 정지 → 위장. 이동 중이 아니면 false */
  stop(): boolean {
    if (this.mode !== 'moving') return false;
    this.path = [];
    this.pathIndex = 0;
    this.setMode('disguised');
    return true;
  }

  /** 말걸기 등 강제 정지 */
  forceTalk(durationSec: number): boolean {
    if (this.mode === 'talked') return false;
    this.path = [];
    this.pathIndex = 0;
    this.talkLeft = durationSec;
    this.setMode('talked');
    return true;
  }

  step(dt: number, speedTilesPerSec: number): void {
    this.modeTime += dt;
    if (this.mode === 'talked') {
      this.talkLeft -= dt;
      if (this.talkLeft <= 0) this.setMode('idle');
      return;
    }
    if (this.mode !== 'moving') return;
    let budget = speedTilesPerSec * dt;
    while (budget > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex]!;
      const dx = target.x - this.x, dy = target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) this.facing = Math.atan2(dy, dx);
      if (d <= budget) {
        this.x = target.x; this.y = target.y;
        budget -= d;
        this.pathIndex++;
      } else {
        this.x += (dx / d) * budget;
        this.y += (dy / d) * budget;
        budget = 0;
      }
    }
    if (this.pathIndex >= this.path.length) {
      this.path = [];
      this.pathIndex = 0;
      this.setMode('idle');
    }
  }
}
