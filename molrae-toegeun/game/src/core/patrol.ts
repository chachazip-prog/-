/**
 * 순찰 NPC: 웨이포인트 순환 이동 + 전조(tell) → 돌아보기(look) 상태.
 *
 *   walk ──웨이포인트 도착──▶ (확률 lookChance) tell → look → wait → walk(다음 구간)
 *                          └ (아니면) wait → walk
 *   walk ──타일 도착(구간 중간)──▶ (확률 glanceBackChancePerTile) tell(뒤쪽) → look → walk
 *   walk|wait ──말걸기 반경 진입──▶ tell(말걸기 전조, D-043) ──플레이어가 catchRadius 안──▶ talk → (원래 상태 복귀)
 *                                                          └ (벗어남) ──▶ look(플레이어가 있던 쪽) → 원래 상태
 *
 * tell 동안 NPC는 멈추고, 시선 콘은 '현재' 방향을 유지한다. pendingFacing이 곧 돌아볼 방향(전조 표시용).
 * 모든 무작위 결정은 외부에서 주입한 시드 RNG로만 한다.
 *
 * ── 방향 전환 전조 규칙 (BUG-001, D-038 / D-044 조건부) ──
 * 모퉁이(경로 노드), 대기·돌아보기 후 재출발, 말걸기 종료 후 원래 방향 복귀처럼 '예정에 없던' 전환이 생기면
 * NPC는 그 순간 StepContext.shouldTellTurn(npc, 새 방향)을 묻는다.
 *  - true  → 그 자리에 멈춰 tell(tellSec, 새 방향 점선 표시) → 새 방향으로 회전(look, 유지 0초) → 원래 동작 재개
 *  - false → 즉시 회전(전조 없음)
 * FloorSim의 판정 기준: "새 방향의 '경고 콘'(rules.threat: 실제 콘 거리 + approachExtraRange,
 * 반각 + approachExtraAngleDeg, 가림 무시) 안에 플레이어가 있으면 true".
 * 경고 콘은 실제 콘을 완전히 포함하므로, 회전 직후 실제 콘에 플레이어가 들어오는 전환은 반드시 전조를 거친다.
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
  /** 플레이어와 이 거리(타일) 이내면 말걸기 전조를 시작한다 */
  readonly radius: number;
  readonly durationSec: number;
  readonly cooldownSec: number;
  /** 말걸기 전조(말풍선) 길이(초). D-043 기준 0.5. 실제 길이는 max(이 값, NpcDef.tellSec) */
  readonly warnSec?: number;
  /** 전조가 끝날 때 플레이어가 이 거리 이내면 말걸기 성립, 밖이면 취소(플레이어가 피할 여지). 없으면 radius × 2 */
  readonly catchRadius?: number;
  /** 말걸기 종료 후 이 시간 동안 이 NPC의 시선은 플레이어 의심에 반영하지 않는다(보내 준 직후 재적발 방지). 없으면 0 */
  readonly releaseSec?: number;
}

/** TalkDef 선택 필드 기본값 (기획 미확정 — 데이터에 값이 없을 때만 사용) */
export const TALK_DEFAULTS = { warnSec: 0.5, catchRadiusMul: 2, releaseSec: 0 } as const;

/** NPC 한 스텝 갱신 시 시뮬레이션이 주는 정보 (NPC는 플레이어를 직접 알지 못한다) */
export interface StepContext {
  /** 지금 방향을 newFacing으로 바꾸려 할 때 전조가 필요한가 (D-044). 모듈 주석의 판정 기준 참고 */
  shouldTellTurn(npc: PatrolNpc, newFacing: number): boolean;
  /** 플레이어 위치 */
  readonly player: Vec;
  /** 플레이어에게 지금 말을 걸 수 있는가 (다른 NPC와 말하는 중이 아님 등) */
  readonly playerTalkable: boolean;
}

/** 컨텍스트 없이 step을 부를 때: 모든 전환에 전조(보수적) */
const ALWAYS_TELL: StepContext = { shouldTellTurn: () => true, player: { x: Infinity, y: Infinity }, playerTalkable: false };

/** 이보다 작은 각 변화는 '방향 전환'으로 보지 않는다(라디안) */
const TURN_EPS = 1e-3;

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
  /** 현재 tell의 종류: look(돌아보기) / turn(경로 방향 전환, D-044) / talk(말걸기 전조, D-043) */
  tellKind: 'look' | 'turn' | 'talk' | null = null;
  talkCooldown = 0;
  /** 말걸기 종료 후 남은 '보내 줌' 시간(초) */
  releaseLeft = 0;

  private readonly segments: Vec[][];
  private wpIndex = 0;
  private nodeIndex = 0;
  private timer = 0;
  private waitLeft = 0;
  private resume: 'walk' | 'wait' = 'wait';
  private lookHold = 0;
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

  private startTell(facing: number, resume: 'walk' | 'wait', kind: 'look' | 'turn' = 'look'): void {
    this.pendingFacing = normAngle(facing);
    this.resume = resume;
    this.tellKind = kind;
    this.timer = this.def.tellSec;
    // turn: 전조 후 회전만 하고 바로 재개(유지 0초 → look 1스텝)
    this.lookHold = kind === 'turn' ? 0 : this.def.lookSec;
    this.setMode('tell');
  }

  /**
   * 예정된 방향 전환. D-044 규칙에 따라 전조가 필요하면 tell을 시작하고 true(이번 스텝 동작 중단),
   * 아니면 즉시 회전하고 false.
   */
  private turnTo(facing: number, resume: 'walk' | 'wait', ctx: StepContext): boolean {
    if (angleDiff(facing, this.facing) <= TURN_EPS) { this.facing = facing; return false; }
    if (ctx.shouldTellTurn(this, facing)) { this.startTell(facing, resume, 'turn'); return true; }
    this.facing = facing;
    return false;
  }

  /** 시선이 지금 플레이어 의심에 반영되지 않는가 (말걸기 중·보내 준 직후, D-043) */
  get ignoresPlayer(): boolean { return this.mode === 'talk' || this.releaseLeft > 0; }

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

  /**
   * 말걸기 전조 시작 (D-043). NPC는 멈추고 방향은 그대로, pendingFacing = 플레이어 쪽.
   * 전조가 끝나는 스텝에 플레이어가 catchRadius 안이면 talk(이때 FloorSim이 플레이어를 강제 정지), 아니면 취소하고 그쪽을 돌아본다.
   */
  startTalk(towardAngle: number): void {
    const t = this.def.talk;
    if (!t) return;
    this.talkResume = this.mode === 'walk' ? 'walk' : 'wait';
    this.talkPrevFacing = this.facing;
    this.pendingFacing = normAngle(towardAngle);
    this.resume = this.talkResume;
    this.tellKind = 'talk';
    this.timer = Math.max(t.warnSec ?? TALK_DEFAULTS.warnSec, this.def.tellSec);
    this.lookHold = this.def.lookSec;
    this.setMode('tell');
  }

  private finishTalkWarn(ctx: StepContext): void {
    const t = this.def.talk!;
    const dx = ctx.player.x - this.x, dy = ctx.player.y - this.y;
    const catchR = t.catchRadius ?? t.radius * TALK_DEFAULTS.catchRadiusMul;
    this.pendingFacing = null;
    this.tellKind = null;
    if (ctx.playerTalkable && Math.hypot(dx, dy) <= catchR) {
      this.facing = normAngle(Math.atan2(dy, dx));
      this.timer = t.durationSec;
      this.talkCooldown = t.cooldownSec + t.durationSec;
      this.setMode('talk');
    } else {
      // 취소: 전조로 예고한 방향을 돌아본다(전조 → look, 공정)
      this.facing = normAngle(Math.atan2(dy, dx));
      this.talkCooldown = t.cooldownSec;
      this.timer = this.lookHold;
      this.setMode('look');
    }
  }

  step(dt: number, rng: Rng, ctx: StepContext = ALWAYS_TELL): void {
    this.modeTime += dt;
    if (this.talkCooldown > 0) this.talkCooldown -= dt;
    if (this.releaseLeft > 0) this.releaseLeft = Math.max(0, this.releaseLeft - dt);
    switch (this.mode) {
      case 'tell':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.tellKind === 'talk') { this.finishTalkWarn(ctx); return; }
          this.facing = this.pendingFacing ?? this.facing;
          this.pendingFacing = null;
          this.tellKind = null;
          this.timer = this.lookHold;
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
          this.releaseLeft = this.def.talk?.releaseSec ?? TALK_DEFAULTS.releaseSec;
          // 원래 방향 복귀도 방향 전환 규칙(D-044)을 따른다
          if (!this.turnTo(this.talkPrevFacing, this.talkResume, ctx)) this.setMode(this.talkResume);
        }
        return;
      case 'wait':
        this.waitLeft -= dt;
        if (this.waitLeft <= 0) this.setMode('walk');
        return;
      case 'walk':
        this.walk(dt, rng, ctx);
        return;
    }
  }

  private walk(dt: number, rng: Rng, ctx: StepContext): void {
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
      // 모퉁이·재출발 방향 전환: D-044 규칙(전조가 필요하면 여기서 멈춘다)
      if (d > 1e-9 && this.turnTo(Math.atan2(dy, dx), 'walk', ctx)) return;
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
        this.startTell(this.facing + Math.PI, 'walk', 'look');
        return;
      }
    }
  }
}
