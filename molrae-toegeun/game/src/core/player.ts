/**
 * 플레이어 이동 상태 머신 (D-033: 목적지 탭 → 자동 경로 이동, 이동 중 탭 → 정지·위장).
 *
 *   idle ──move──▶ moving ──도착──▶ idle
 *   disguised ──move──▶ moving ──stop(탭)──▶ disguised
 *   (talked 제외 모든 상태) ──forceTalk──▶ talked ──시간 종료──▶ moving(이동 중이었으면 남은 경로 재개, D-039) | idle
 *
 * talked 동안에는 move/stop 입력을 무시한다.
 *
 * v2 확장(X5):
 *  - pauseFor(sec): 경로를 보관한 채 위장 상태로 멈췄다가 sec 뒤 자동 재개(말걸기 후 postTalkHoldSec, 길막 대기).
 *    sec = Infinity면 resumePaused()를 부를 때까지 대기.
 *  - shortenTalk: 말걸기 중 맞장구 탭(nodShortenSec, 최소 minDurationSec)
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
  /** 말걸기로 멈춘 경로 (D-039 자동 재개용) */
  private savedPath: Vec[] = [];
  private savedIndex = 0;
  private talkElapsed = 0;
  /** pauseFor 남은 시간(초). 0이면 일시정지 아님 */
  private pauseLeft = 0;

  constructor(start: Tile) {
    const c = tileCenter(start);
    this.x = c.x;
    this.y = c.y;
  }

  get pos(): Vec { return { x: this.x, y: this.y }; }
  get tile(): Tile { return tileOf(this); }

  /** 타일 중심에 정확히 서 있는가 */
  get centered(): boolean {
    const c = tileCenter(this.tile);
    return Math.abs(c.x - this.x) <= 1e-6 && Math.abs(c.y - this.y) <= 1e-6;
  }

  /** 남은 경로 노드(타일 중심). 렌더링용 */
  remainingPath(): readonly Vec[] {
    if (this.paused) return this.savedPath.slice(this.savedIndex);
    return this.path.slice(this.pathIndex);
  }

  /** 다음에 들어갈 경로 노드(이동 중일 때). 길막 판정용 */
  nextNode(): Vec | null { return this.mode === 'moving' ? (this.path[this.pathIndex] ?? null) : null; }

  /** pauseFor로 멈춰 있는가(경로 보관 중) */
  get paused(): boolean { return this.pauseLeft > 0 && this.mode === 'disguised'; }

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
    this.pauseLeft = 0; this.savedPath = []; this.savedIndex = 0;
    this.path = nodes;
    this.pathIndex = 0;
    this.setMode('moving');
    return true;
  }

  /** 이동 중 정지 → 위장. 이동 중이 아니면 false. 일시정지(길막 대기·말걸기 후 대기) 중이면 보관 경로를 버리고 위장 유지 */
  stop(): boolean {
    if (this.paused) {
      this.pauseLeft = 0; this.savedPath = []; this.savedIndex = 0;
      return true;
    }
    if (this.mode !== 'moving') return false;
    this.path = [];
    this.pathIndex = 0;
    this.setMode('disguised');
    return true;
  }

  /** 경로를 보관한 채 sec 동안 위장 상태로 멈춤. 이동 중이 아니면 false */
  pauseFor(sec: number): boolean {
    if (this.mode !== 'moving' || sec <= 0) return false;
    this.savedPath = this.path; this.savedIndex = this.pathIndex;
    this.path = []; this.pathIndex = 0;
    this.pauseLeft = sec;
    this.setMode('disguised');
    return true;
  }

  /** 일시정지 해제 → 보관 경로 재개 */
  resumePaused(): boolean {
    if (!this.paused) return false;
    this.pauseLeft = 0;
    return this.restoreSaved();
  }

  /** 보관 중인 경로를 새 경로로 교체(길막 우회) */
  replacePausedPath(path: readonly Tile[]): void {
    if (!this.paused) return;
    this.savedPath = path.map(tileCenter);
    this.savedIndex = 0;
  }

  /** 맞장구: 남은 말걸기 시간을 줄인다. 전체 길이는 minDurationSec 아래로 내려가지 않음. 새 남은 시간 반환 */
  shortenTalk(sec: number, minDurationSec: number): number {
    if (this.mode !== 'talked') return 0;
    this.talkLeft = Math.max(this.talkLeft - sec, minDurationSec - this.talkElapsed, 0);
    return this.talkLeft;
  }

  get talkRemaining(): number { return this.mode === 'talked' ? this.talkLeft : 0; }

  private restoreSaved(): boolean {
    const ok = this.savedIndex < this.savedPath.length;
    if (ok) {
      this.path = this.savedPath;
      this.pathIndex = this.savedIndex;
      this.setMode('moving');
    }
    this.savedPath = [];
    this.savedIndex = 0;
    return ok;
  }

  /** 강제 이동 정지(미션 시작·결과 등). 경로·보관 경로 모두 버리고 idle */
  halt(): void {
    this.path = []; this.pathIndex = 0; this.savedPath = []; this.savedIndex = 0; this.pauseLeft = 0;
    if (this.mode !== 'talked') this.setMode('idle');
  }

  /** 말걸기 등 강제 정지. 이동 중이었다면 남은 경로를 보관했다가 종료 시 재개한다(D-039) */
  forceTalk(durationSec: number): boolean {
    if (this.mode === 'talked') return false;
    if (this.mode === 'moving') { this.savedPath = this.path; this.savedIndex = this.pathIndex; }
    else if (!this.paused) { this.savedPath = []; this.savedIndex = 0; }
    this.pauseLeft = 0;
    this.path = [];
    this.pathIndex = 0;
    this.talkLeft = durationSec;
    this.talkElapsed = 0;
    this.setMode('talked');
    return true;
  }

  step(dt: number, speedTilesPerSec: number): void {
    this.modeTime += dt;
    if (this.mode === 'talked') {
      this.talkLeft -= dt;
      this.talkElapsed += dt;
      if (this.talkLeft <= 0 && !this.restoreSaved()) this.setMode('idle');
      return;
    }
    if (this.pauseLeft > 0 && this.mode === 'disguised') {
      this.pauseLeft -= dt;
      if (this.pauseLeft <= 0) { this.pauseLeft = 0; this.restoreSaved(); }
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
