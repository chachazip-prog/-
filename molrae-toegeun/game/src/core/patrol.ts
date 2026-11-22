/**
 * 순찰 NPC: 웨이포인트 순환 이동 + 전조(tell) → 돌아보기(look) 상태.
 *
 *   walk ──웨이포인트 도착──▶ (확률 lookChance) tell → look → wait → walk(다음 구간)
 *                          └ (아니면) wait → walk
 *   walk ──타일 도착(구간 중간)──▶ (확률 glanceBackChancePerTile) tell(뒤쪽) → look → walk
 *   walk|wait ──말걸기──▶ talk → (원래 상태 복귀)
 *
 * tell 동안 NPC는 멈추고, 시선 콘은 '현재' 방향을 유지한다. pendingFacing이 곧 돌아볼 방향(전조 표시용).
 * 모든 무작위 결정은 외부에서 주입한 시드 RNG로만 한다.
 */
import { tileCenter, type GridMap, type Vec } from './grid';
import { findPath } from './pathfinding';
import type { Rng } from './rng';
import { DIR_ANGLE, angleDiff, normAngle, type ConeDef, type Dir } from './vision';

export interface WaypointDef {
  readonly x: number;
  readonly y: number;
  readonly waitSec: number;
  /** 이 지점에서 돌아볼 확률. 없으면 NpcDef.lookChance */
  readonly lookChance?: number;
  /** 돌아볼 후보 방향. 없으면 현재 방향을 제외한 4방향 */
  readonly lookDirs?: readonly Dir[];
}

export interface TalkDef {
  /** 플레이어와 이 거리(타일) 이내면 말을 건다 */
  readonly radius: number;
  readonly durationSec: number;
  readonly cooldownSec: number;
}

export interface NpcDef {
  readonly id: string;
  readonly name: string;
  /** 렌더링 분류 (boss = 상사, 빨강 위험색 / guard / ...) */
  readonly role: string;
  readonly cone: ConeDef;
  readonly speedTilesPerSec: number;
  /** 의심 상승 배율 */
  readonly gazeMultiplier: number;
  /** 전조 길이(초). 기획 기준 ≥ 0.4 (rules.json tell.minSec) */
  readonly tellSec: number;
  readonly lookSec: number;
  readonly lookChance: number;
  readonly glanceBackChancePerTile: number;
  readonly waypoints: readonly WaypointDef[];
  readonly talk?: TalkDef;
}

export type NpcMode = 'walk' | 'wait' | 'tell' | 'look' | 'talk';

const ALL_DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];

export class PatrolNpc {
  readonly def: NpcDef;
  x: number;
  y: number;
  facing = 0;
  mode: NpcMode = 'wait';
  modeTime = 0;
  /** tell 중일 때 돌아볼 방향 */
  pendingFacing: number | null = null;
  talkCooldown = 0;

  private readonly segments: Vec[][];
  private wpIndex = 0;
  private nodeIndex = 0;
  private timer = 0;
  private waitLeft = 0;
  private resume: 'walk' | 'wait' = 'wait';
  private talkResume: 'walk' | 'wait' = 'wait';
  private talkPrevFacing = 0;

  constructor(def: NpcDef, map: GridMap, rng: Rng) {
    if (def.waypoints.length === 0) throw new Error(`npc ${def.id}: 웨이포인트 없음`);
    this.def = def;
    const wps = def.waypoints;
    this.segments = wps.map((wp, i) => {
      const next = wps[(i + 1) % wps.length]!;
      const p = findPath(map, { x: wp.x, y: wp.y }, { x: next.x, y: next.y });
      if (!p) throw new Error(`npc ${def.id}: 웨이포인트 ${i}→${(i + 1) % wps.length} 경로 없음`);
      return p.map(tileCenter);
    });
    const c = tileCenter(wps[0]!);
    this.x = c.x;
    this.y = c.y;
    const first = this.segments[0]![0];
    this.facing = first ? Math.atan2(first.y - c.y, first.x - c.x) : 0;
    this.arrive(0, rng);
  }

  get pos(): Vec { return { x: this.x, y: this.y }; }
  get waypointIndex(): number { return this.wpIndex; }

  private setMode(m: NpcMode): void { this.mode = m; this.modeTime = 0; }

  private startTell(facing: number, resume: 'walk' | 'wait'): void {
    this.pendingFacing = normAngle(facing);
    this.resume = resume;
    this.timer = this.def.tellSec;
    this.setMode('tell');
  }

  private arrive(i: number, rng: Rng): void {
    this.wpIndex = i;
    this.nodeIndex = 0;
    const wp = this.def.waypoints[i]!;
    this.waitLeft = wp.waitSec;
    const chance = wp.lookChance ?? this.def.lookChance;
    if (wp.waitSec > 0 && rng.chance(chance)) {
      const cands = wp.lookDirs && wp.lookDirs.length > 0
        ? wp.lookDirs
        : ALL_DIRS.filter((d) => angleDiff(DIR_ANGLE[d], this.facing) > 0.1);
      const dir = rng.pick(cands) ?? 'down';
      this.startTell(DIR_ANGLE[dir], 'wait');
    } else if (wp.waitSec > 0) {
      this.setMode('wait');
    } else {
      this.setMode('walk');
    }
  }

  /** 말걸기 가능 여부 */
  canTalk(): boolean {
    return !!this.def.talk && this.talkCooldown <= 0 && (this.mode === 'walk' || this.mode === 'wait');
  }

  startTalk(towardAngle: number): void {
    const t = this.def.talk;
    if (!t) return;
    this.talkResume = this.mode === 'walk' ? 'walk' : 'wait';
    this.talkPrevFacing = this.facing;
    this.facing = normAngle(towardAngle);
    this.timer = t.durationSec;
    this.talkCooldown = t.cooldownSec + t.durationSec;
    this.setMode('talk');
  }

  step(dt: number, rng: Rng): void {
    this.modeTime += dt;
    if (this.talkCooldown > 0) this.talkCooldown -= dt;
    switch (this.mode) {
      case 'tell':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.facing = this.pendingFacing ?? this.facing;
          this.pendingFacing = null;
          this.timer = this.def.lookSec;
          this.setMode('look');
        }
        return;
      case 'look':
        this.timer -= dt;
        if (this.timer <= 0) this.setMode(this.resume === 'wait' && this.waitLeft > 0 ? 'wait' : 'walk');
        return;
      case 'talk':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.facing = this.talkPrevFacing;
          this.setMode(this.talkResume);
        }
        return;
      case 'wait':
        this.waitLeft -= dt;
        if (this.waitLeft <= 0) this.setMode('walk');
        return;
      case 'walk':
        this.walk(dt, rng);
        return;
    }
  }

  private walk(dt: number, rng: Rng): void {
    let budget = this.def.speedTilesPerSec * dt;
    while (budget > 0) {
      const seg = this.segments[this.wpIndex]!;
      const target = seg[this.nodeIndex];
      if (!target) { // 길이 0 구간 (연속 같은 웨이포인트)
        this.arrive((this.wpIndex + 1) % this.segments.length, rng);
        return;
      }
      const dx = target.x - this.x, dy = target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) this.facing = Math.atan2(dy, dx);
      if (d > budget) {
        this.x += (dx / d) * budget;
        this.y += (dy / d) * budget;
        return;
      }
      this.x = target.x; this.y = target.y;
      budget -= d;
      this.nodeIndex++;
      if (this.nodeIndex >= seg.length) {
        this.arrive((this.wpIndex + 1) % this.segments.length, rng);
        if (this.mode !== 'walk') return;
      } else if (rng.chance(this.def.glanceBackChancePerTile)) {
        this.startTell(this.facing + Math.PI, 'walk');
        return;
      }
    }
  }
}
