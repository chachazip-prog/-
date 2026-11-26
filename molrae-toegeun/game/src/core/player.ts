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
 *
 * T-170 직접 조작 모드(D-127·D-131, design/control-dpad.md §1-3 M1~M10):
 *  - setHeldDir(dir | null): 방향 패드 입력. 경로(path)가 비어 있을 때만 쓰인다(경로 이동은 NPC·자동 연출·이어하기용).
 *  - 발은 언제나 칸 중심을 잇는 가로·세로 선 위. 정지(idle·disguised) 좌표는 칸 중심(붙는 중 제외).
 *  - M2 첫 칸 보장, M3 떼면 가장 가까운 칸 중심으로 붙음(max(속도, 거리 ÷ releaseSnapMaxSec)) + 즉시 위장,
 *    M4 반대 방향 즉시, M5 칸 중심에서만 꺾기(뒤 칸 0.5 안 / 앞 1칸 보정), M6 범프 = 정지(위장).
 *  - 말걸기 중 입력은 기억만 하고, 끝났을 때 누르고 있으면 heldResumeAfterTalkSec 뒤 출발(§3-1).
 */
import { tileCenter, tileOf, type Tile, type Vec } from './grid';
import { DIR_ANGLE, type Dir } from './vision';

export type PlayerMode = 'idle' | 'moving' | 'disguised' | 'talked';

/** 직접 조작 규칙(rules.input.dpad). FloorSim이 채운다 */
export interface ManualMoveRules {
  readonly speedTilesPerSec: number;
  /** M2: 멈춘 상태에서 누르면 떼도 다음 칸 중심까지 */
  readonly firstTileCommit: boolean;
  /** M3: 떼었을 때 칸 중심에 붙는 최대 시간(= rules.suspicion.disguiseSettleSec) */
  readonly releaseSnapMaxSec: number;
  /** M5 (b): 진행 방향 앞 칸 보정 범위(칸) */
  readonly turnAssistAheadTiles: number;
  /** §3-1: 말걸기가 끝났을 때 패드를 누르고 있었으면 이 시간 뒤 출발 */
  readonly heldResumeAfterTalkSec: number;
}

export const DIR_VEC: Readonly<Record<Dir, readonly [number, number]>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE: Readonly<Record<Dir, Dir>> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const isVertical = (d: Dir) => d === 'up' || d === 'down';

/** 직접 조작 이벤트(FloorSim이 꺼내 SimEvent로 바꿈) */
export type ManualEvent = { type: 'bump'; dir: Dir; tile: Tile } | { type: 'cornerAssist'; kind: 'back' | 'ahead' } | { type: 'stop'; reason: 'release' | 'arrive' | 'bump' };

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
  /**
   * 지금 모드가 '이미 멈춰 있던 상태'에서 이어졌는가(위장 안착 disguiseSettleSec 면제).
   * 말걸기(talked) 종료 → 대기·정지(BUG-009, D-043), 상위 규칙이 지정한 대기(게이트 앞, BUG-012). 모드가 바뀌면 해제
   */
  settled = false;

  // ── 직접 조작(T-170) ──
  /** 지금 누르고 있는 방향(DaySim이 잠금·얼음 규칙을 적용한 뒤의 값) */
  heldDir: Dir | null = null;
  /** 직접 조작 규칙. null이면 직접 조작 없음(T-123 프로토 호환) */
  manual: ManualMoveRules | null = null;
  /** 들어갈 수 있는 칸인가(지도 + 동적 차단). FloorSim이 채운다 */
  canEnter: (x: number, y: number) => boolean = () => true;
  /** 직접 조작 중 향하는 칸 중심(타일). null = 칸 중심에 서 있음 */
  private mTo: Tile | null = null;
  private mFrom: Tile | null = null;
  private mDir: Dir | null = null;
  /** M2: 첫 칸 보장 중 */
  private committed = false;
  /** M5: 이번 회전에 앞 칸 보정을 이미 씀(연쇄 보정 금지) */
  private assistUsed = false;
  /** M3: 칸 중심으로 붙는 중 */
  private snapTo: Vec | null = null;
  private snapSpeed = 0;
  /** §3-1: 말걸기 후 출발 대기 */
  private resumeDelay = 0;
  /** 같은 방향 범프를 한 번만 세기 위함 */
  private bumpDir: Dir | null = null;
  /** 마지막 움직임이 직접 조작이었나(말걸기·정지 때 칸 중심 붙기를 할지) */
  private lastManual = false;
  /** 세로 이동 방향(카메라 선행용): -1 위, 1 아래, 0 없음 */
  moveDy: -1 | 0 | 1 = 0;
  private manualEvents: ManualEvent[] = [];

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

  /** 칸 중심에 멈춰 서 있음(idle·disguised + 붙기 끝남). 자동 시작(자리·화장실 칸·게이트) 판정용 */
  get stoppedAtCenter(): boolean {
    return (this.mode === 'idle' || this.mode === 'disguised') && this.snapTo === null && this.mTo === null && this.path.length === 0 && this.centered;
  }

  /** 자동 경로(path) 이동 중인가(게이트 → 엘리베이터 연출, 사용 칸 1칸 보정 등). 이때 패드 입력은 쓰이지 않음 */
  get onPath(): boolean { return this.path.length > 0 && this.mode === 'moving'; }

  /** 첫 칸 보장 구간인가(QA 지표: 이 구간 콘 노출 0 기대) */
  get firstTileCommitted(): boolean { return this.committed && this.mode === 'moving'; }

  /** 직접 조작 이벤트 꺼내기 */
  drainManualEvents(): ManualEvent[] { const e = this.manualEvents; this.manualEvents = []; return e; }

  /** 가장 가까운 칸 중심 */
  private nearestCenter(): Vec { return tileCenter(this.tile); }

  private clearManual(): void {
    this.mTo = null; this.mFrom = null; this.mDir = null; this.committed = false; this.assistUsed = false;
  }

  /** 지금 칸 중심이 아니면 가장 가까운 칸 중심으로 붙기 시작(직접 조작에서 멈출 때) */
  private snapToNearest(): void {
    if (!this.lastManual || this.centered) { this.snapTo = null; return; }
    const c = this.nearestCenter();
    const d = Math.hypot(c.x - this.x, c.y - this.y);
    const m = this.manual;
    const speed = m?.speedTilesPerSec ?? 3;
    const maxSec = m?.releaseSnapMaxSec ?? 0.15;
    this.snapTo = c;
    this.snapSpeed = Math.max(speed, maxSec > 0 ? d / maxSec : speed);
  }

  /**
   * 패드 방향 입력. null = 손 뗌.
   * 떼는 순간 정지·위장(M3, 첫 칸 보장 중이면 그 칸 도착 때). 반환: 이 호출로 '정지'했는가(아슬아슬 판정 기준 시각)
   */
  setHeldDir(dir: Dir | null): boolean {
    if (dir === this.heldDir) return false;
    this.heldDir = dir;
    if (dir === null) this.resumeDelay = 0;
    if (this.mode === 'talked' || this.path.length > 0 || this.pauseLeft > 0) return false;
    if (dir === null && this.mode === 'moving' && this.mTo && !this.committed) {
      this.clearManual();
      this.snapToNearest();
      this.setMode('disguised');
      this.bumpDir = null;
      this.manualEvents.push({ type: 'stop', reason: 'release' });
      return true;
    }
    if (dir === null) this.bumpDir = null;
    return false;
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
    if (this.mode !== m) { this.mode = m; this.modeTime = 0; this.settled = false; }
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
    this.clearManual(); this.snapTo = null; this.resumeDelay = 0; this.lastManual = false;
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
    if (this.mTo) { this.clearManual(); this.snapToNearest(); }
    this.setMode('disguised');
    return true;
  }

  /**
   * 경로를 보관한 채 sec 동안 위장 상태로 멈춤. 이동 중이 아니면 false.
   * settled = true: 실제로는 멈춰 있던 상태에서 이어진 대기(말걸기 종료 직후 postTalkHoldSec)라 위장 안착 시간을 두지 않음(BUG-009)
   */
  pauseFor(sec: number, settled = false): boolean {
    if (this.mode !== 'moving' || sec <= 0) return false;
    this.savedPath = this.path; this.savedIndex = this.pathIndex;
    this.path = []; this.pathIndex = 0;
    this.pauseLeft = sec;
    this.setMode('disguised');
    if (settled) this.settled = true;
    return true;
  }

  /** 지금 정지 상태를 '안착 완료'로 표시(상위 규칙: 게이트 앞 대기 = 위장, BUG-012). 이동·말걸기 중이면 무시 */
  markSettled(): void {
    if (this.mode === 'idle' || this.mode === 'disguised') this.settled = true;
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

  /** 순간 이동(이어하기 체크포인트, D-050). 모든 경로를 버리고 idle */
  teleport(t: Tile): void {
    const c = tileCenter(t);
    this.x = c.x; this.y = c.y;
    this.path = []; this.pathIndex = 0; this.savedPath = []; this.savedIndex = 0; this.pauseLeft = 0; this.talkLeft = 0;
    this.clearManual(); this.snapTo = null; this.resumeDelay = 0; this.moveDy = 0;
    this.setMode('idle');
  }

  /** 강제 이동 정지(미션 시작·결과 등). 경로·보관 경로 모두 버리고 idle */
  halt(): void {
    this.path = []; this.pathIndex = 0; this.savedPath = []; this.savedIndex = 0; this.pauseLeft = 0;
    if (this.mTo) { this.clearManual(); this.snapToNearest(); }
    this.resumeDelay = 0;
    if (this.mode !== 'talked') this.setMode('idle');
  }

  /** 말걸기 등 강제 정지. 이동 중이었다면 남은 경로를 보관했다가 종료 시 재개한다(D-039) */
  forceTalk(durationSec: number): boolean {
    if (this.mode === 'talked') return false;
    // 직접 조작 중이면 가장 가까운 칸 중심에 붙어 선다(정지 좌표 = 칸 중심, §1-3 QA 불변식)
    if (this.mTo || this.snapTo) { this.clearManual(); this.snapToNearest(); }
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
      this.stepSnap(dt);
      this.talkLeft -= dt;
      this.talkElapsed += dt;
      if (this.talkLeft <= 0 && !this.restoreSaved()) {
        this.setMode('idle');
        this.settled = true; // BUG-009(D-043): 강제 정지에서 그대로 서 있음 → 안착 시간 없음
        // §3-1: 패드를 계속 누르고 있었으면 잠깐 뒤 그 방향으로 출발
        if (this.heldDir && this.manual) this.resumeDelay = this.manual.heldResumeAfterTalkSec;
      }
      return;
    }
    if (this.manual && this.path.length === 0 && this.pauseLeft <= 0) { this.stepManual(dt); return; }
    if (this.pauseLeft > 0 && this.mode === 'disguised') {
      this.pauseLeft -= dt;
      if (this.pauseLeft <= 0) { this.pauseLeft = 0; this.restoreSaved(); }
      return;
    }
    if (this.mode !== 'moving') { this.moveDy = 0; return; }
    let budget = speedTilesPerSec * dt;
    while (budget > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex]!;
      const dx = target.x - this.x, dy = target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) this.facing = Math.atan2(dy, dx);
      this.moveDy = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? -1 : 1) : 0;
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

  // ── 직접 조작 스텝(T-170) ──

  private stepSnap(dt: number): void {
    const t = this.snapTo;
    if (!t) return;
    const dx = t.x - this.x, dy = t.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.snapSpeed * dt;
    if (d <= step + 1e-12) { this.x = t.x; this.y = t.y; this.snapTo = null; return; }
    this.x += (dx / d) * step; this.y += (dy / d) * step;
  }

  private face(d: Dir): void { this.facing = DIR_ANGLE[d]; }

  private enterable(t: Tile, d: Dir): boolean {
    const [vx, vy] = DIR_VEC[d];
    return this.canEnter(t.x + vx, t.y + vy);
  }

  /** 칸 중심 t에 서서 방향 d로 출발(성공 여부) */
  private depart(t: Tile, d: Dir): boolean {
    if (!this.enterable(t, d)) return false;
    const [vx, vy] = DIR_VEC[d];
    this.mFrom = t; this.mTo = { x: t.x + vx, y: t.y + vy }; this.mDir = d;
    this.face(d);
    this.bumpDir = null;
    return true;
  }

  private bump(t: Tile, d: Dir, wasMoving: boolean): void {
    this.face(d);
    if (wasMoving) { this.setMode('disguised'); this.manualEvents.push({ type: 'stop', reason: 'bump' }); }
    if (this.bumpDir !== d) { this.bumpDir = d; this.manualEvents.push({ type: 'bump', dir: d, tile: t }); }
  }

  private stepManual(dt: number): void {
    const m = this.manual!;
    if (this.resumeDelay > 0) {
      this.resumeDelay -= dt;
      if (this.resumeDelay > 0) { this.moveDy = 0; return; }
      this.resumeDelay = 0;
    }
    const held = this.heldDir;
    // 붙는 중: 손을 뗀 상태면 붙기만, 다시 누르면 붙던 칸 중심을 목표로 이어서 판단
    if (this.snapTo) {
      if (!held) { this.stepSnap(dt); this.moveDy = 0; return; }
      const to = tileOf(this.snapTo);
      const dx = this.snapTo.x - this.x, dy = this.snapTo.y - this.y;
      const d: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
      const [vx, vy] = DIR_VEC[d];
      this.mTo = to; this.mFrom = { x: to.x - vx, y: to.y - vy }; this.mDir = d;
      this.snapTo = null; this.committed = false; this.assistUsed = false;
      this.setMode('moving');
    }
    let budget = m.speedTilesPerSec * dt;
    let guard = 0;
    while (budget > 1e-12 && guard++ < 8) {
      if (!this.mTo) {
        // 칸 중심에 서 있음
        if (!held) break;
        const here = this.tile;
        const wasStill = this.mode !== 'moving';
        if (this.depart(here, held)) {
          if (wasStill) { this.committed = m.firstTileCommit; this.assistUsed = false; this.lastManual = true; this.setMode('moving'); }
        } else { this.bump(here, held, !wasStill); break; }
        continue;
      }
      const dir = this.mDir!;
      // 입력 변화 처리(M4·M5)
      if (held && held !== dir) {
        if (held === OPPOSITE[dir]) {
          const f = this.mFrom!; this.mFrom = this.mTo; this.mTo = f; this.mDir = held; this.face(held);
        } else if (isVertical(held) !== isVertical(dir)) {
          const from = this.mFrom!;
          const progress = Math.abs(this.x - (from.x + 0.5)) + Math.abs(this.y - (from.y + 0.5));
          if (progress < 0.5 && this.enterable(from, held)) {
            // (a) 뒤쪽 가장 가까운 칸 중심에서 꺾을 수 있음 → 되돌아 붙고 꺾음
            const to = this.mTo; this.mTo = from; this.mFrom = to; this.mDir = OPPOSITE[dir];
            this.assistUsed = true;
            this.manualEvents.push({ type: 'cornerAssist', kind: 'back' });
          } else if (progress < 0.5) this.assistUsed = true; // (b)는 앞 칸 중심(mTo)까지만
        }
      }
      const tgt = tileCenter(this.mTo);
      const dx = tgt.x - this.x, dy = tgt.y - this.y;
      const d = Math.abs(dx) + Math.abs(dy);
      const cur = this.mDir!;
      this.moveDy = isVertical(cur) ? (cur === 'up' ? -1 : 1) : 0;
      if (d > budget) {
        const [vx, vy] = DIR_VEC[cur];
        this.x += vx * budget; this.y += vy * budget;
        budget = 0;
        break;
      }
      // 칸 중심 도착
      this.x = tgt.x; this.y = tgt.y;
      budget -= d;
      const here = this.mTo;
      const prevDir = cur;
      this.mFrom = here; this.mTo = null; this.mDir = null;
      this.committed = false;
      const h = this.heldDir;
      if (!h) { this.setMode('disguised'); this.manualEvents.push({ type: 'stop', reason: 'arrive' }); this.assistUsed = false; break; }
      if (this.depart(here, h)) { if (h !== prevDir) this.assistUsed = false; continue; }
      // (b) 앞 1칸 보정: 진행 방향으로 한 칸 더 가면 그 방향이 열려 있음
      if (isVertical(h) !== isVertical(prevDir) && !this.assistUsed && m.turnAssistAheadTiles >= 1) {
        const [vx, vy] = DIR_VEC[prevDir];
        const ahead = { x: here.x + vx, y: here.y + vy };
        if (this.canEnter(ahead.x, ahead.y) && this.enterable(ahead, h)) {
          this.mFrom = here; this.mTo = ahead; this.mDir = prevDir; this.assistUsed = true;
          this.manualEvents.push({ type: 'cornerAssist', kind: 'ahead' });
          continue;
        }
      }
      this.assistUsed = false;
      this.bump(here, h, true);
      break;
    }
    if (!this.mTo && this.mode !== 'moving') this.moveDy = 0;
  }
}
