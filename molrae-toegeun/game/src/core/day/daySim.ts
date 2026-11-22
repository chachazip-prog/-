/**
 * 하루 한 판 시뮬레이션 (X9: 하루 시계·업무 게이지·미션, 방해 이벤트 런타임, 퇴근 시퀀스) — 렌더링 무관.
 * FloorSim(이동·시선·의심)을 감싸고 훅으로 상위 규칙을 넣는다. 씬과 QA 봇이 같은 API를 쓴다.
 *
 * 결정성: 고정 스텝(rules.fixedStepSec) + 시드 RNG(FloorSim.rng 하나를 공유) + 고정된 갱신 순서.
 *  매 스텝: (1) 하루 규칙 전처리(시계·방해 시작·미션 해금) → (2) FloorSim.step → (3) 후처리(미션 진행·퇴근·결과)
 *
 * 입력:
 *  - tapWorld(tx, ty): 화면(지도) 탭. 미션 행동 중이면 미션 입력, 퇴근 가방·게이트 단계면 그 입력, 아니면 이동/정지(FloorSim.tap)
 *  - tapMission(id): HUD 미션 칩. 화면 탭이 아니므로 이동 중에도 멈추지 않고 목적지만 바꾼다(rules.input.hudTapDoesNotStop)
 */
import { FloorSim, type SimEvent } from '../floorSim';
import { zoneAt, type Tile } from '../grid';
import { findPath } from '../pathfinding';
import type { NpcDef, PatrolNpc, WaypointDef } from '../patrol';
import { addSuspicion } from '../suspicion';
import { createActivity, emptyEffects, type Activity, type ActivityEffects, type ActivityView } from './missions';
import type { CameraView } from '../camera';
import type {
  DayContent, DayInterruptDef, DayOutcome, DayPhase, DayResult, LeaveStage, MissionDef, MissionState,
} from './types';

export type DayEvent =
  | { t: number; type: 'phase'; phase: DayPhase }
  | { t: number; type: 'hint'; key: string }
  | { t: number; type: 'toast'; key: string }
  | { t: number; type: 'missionUnlocked'; id: string }
  | { t: number; type: 'missionStart'; id: string }
  | { t: number; type: 'missionSuccess'; id: string }
  | { t: number; type: 'missionDone'; id: string; points: number }
  | { t: number; type: 'missionFail'; id: string; reason: 'fail' | 'timeout' }
  | { t: number; type: 'interrupt'; id: string; textKey?: string }
  | { t: number; type: 'leaveStage'; stage: LeaveStage }
  | { t: number; type: 'gate'; result: 'pass' | 'fail' }
  | { t: number; type: 'hrAbsent' }
  | { t: number; type: 'report'; result: 'start' | 'arrive' | 'doubt' | 'blocked' | 'giveUp' }
  | { t: number; type: 'closeCall'; points: number }
  | { t: number; type: 'result'; result: DayResult };

/** 미션 런타임 상태 */
export interface MissionRuntime {
  readonly def: MissionDef;
  state: MissionState;
  /** 시작(자리를 뜬 순간) 시각(floor.time). null = 아직 */
  startedAt: number | null;
  /** 잠김 사유(회의 중) */
  blocked: boolean;
}

export interface DaySimOptions {
  /** 화면 밖 판정용 화면 배치(HUD가 가리는 행). 표시 설정 — config/display.ts의 값을 넘긴다 */
  readonly view: CameraView;
}

/** 직업 표시용 단계: 지금 플레이어 상태(의심 상승률 선택에 씀) */
export type PlayerPosture = 'moving' | 'still' | 'seated' | 'activity' | 'paused' | 'safe' | 'talked' | 'lobby';

const TUTORIAL_ON: Readonly<Record<string, string>> = {
  // tutorialId → 트리거 이름 (트리거가 오면 tutorial.<id> 문구를 한 번 띄움)
  tut_tap_move: 'dayStart',
  tut_work: 'firstSeatedWork',
  tut_coffee: 'start:coffee',
  tut_restroom: 'start:restroom',
  tut_nap: 'start:nap',
  tut_shopping: 'start:shopping',
  tut_snack: 'start:snack',
  tut_leave: 'leaveStart',
  tut_gate: 'gateStart',
  tut_hr: 'int:INT-05',
  tut_gossip: 'int:INT-04',
  tut_meeting: 'int:INT-08',
  tut_badge: 'int:INT-06',
  tut_snitch: 'int:INT-03',
};

export class DaySim {
  readonly content: DayContent;
  readonly floor: FloorSim;
  phase: DayPhase = 'intro';
  /** 현재 단계 경과(초) */
  phaseTime = 0;
  /** 근무 구간 경과(초) */
  dayTime = 0;
  /** 퇴근 단계 경과(초) */
  leaveTime = 0;
  work = 0;
  points = 0;
  snackStock: number;
  readonly missions: MissionRuntime[];
  /** 진행 중인 미션 행동 */
  activity: Activity | null = null;
  activeMission: MissionRuntime | null = null;
  /** 칩으로 고른 미션(도착하면 시작) */
  pendingMission: MissionRuntime | null = null;
  leaveStage: LeaveStage = 'pack';
  packProgress = 0;
  packPaused = false;
  gateAttempts = 0;
  /** 게이트 막대 위치(0~1) */
  gateMarker = 0;
  gateOpen = false;
  elevatorLeft = 0;
  result: DayResult | null = null;
  /** 인사팀 근태 점검 카운트다운(초). null = 없음 */
  hrCountdown: number | null = null;
  /** 정의로운 동료 보고 달리기 진행 중 */
  reportActive = false;

  private events: DayEvent[] = [];
  private acc = 0;
  private leftSeatAt: number | null = null;
  private wasAtSeat = true;
  private gateTime = 0;
  private hintsShown = new Set<string>();
  private intState = new Map<string, { started: number; count: number; lastAt: number }>();
  private scriptDone = new Set<number>();
  private snitchDwell = 0;
  private reportWait = 0;
  private reportCancelled = false;
  private hrChecked = false;
  private caughtBy: string | null = null;
  private seatedWorkSeen = false;

  constructor(content: DayContent, opts: DaySimOptions, seed: string = content.seed) {
    this.content = content;
    this.floor = new FloorSim(content.floor, seed, {
      camera: { rules: content.camera, view: opts.view },
      autoEscape: false,
      hooks: {
        playerRate: (base) => this.playerRate(base),
        gazeAllowed: (npc) => this.gazeAllowed(npc),
        talkAllowed: (npc) => this.talkAllowed(npc),
        blockedForPlayer: (x, y) => this.gateBlocked(x, y),
        onNpcEnded: (npc) => this.onNpcEnded(npc),
      },
    });
    for (const b of content.background) this.floor.addNpc(b.npc);
    this.snackStock = content.scoring.snackStockStart;
    this.missions = content.missions.map((def) => ({ def, state: 'locked' as MissionState, startedAt: null, blocked: false }));
    this.push({ t: 0, type: 'phase', phase: 'intro' });
  }

  // ── 공개 상태 ─────────────────────────────────────────

  get time(): number { return this.floor.time; }
  get suspicion(): number { return this.floor.suspicion.value; }

  /** 게임 시계(분, 0시 기준) */
  get clockMin(): number {
    const c = this.content.clock;
    if (this.phase === 'intro') return c.startMin;
    if (this.phase === 'day') return c.startMin + (Math.min(this.dayTime, this.content.dayPhaseSec) / this.content.dayPhaseSec) * (c.dayEndMin - c.startMin);
    return c.leaveStartMin + this.leaveTime * c.leaveMinPerSec;
  }

  get playerAtSeat(): boolean {
    const t = this.floor.player.tile, s = this.content.playerSeat;
    return t.x === s.x && t.y === s.y;
  }

  /** 자리에서 일하는 중(업무 게이지가 차는 상태) */
  get seatedWorking(): boolean {
    return this.phase === 'day' && this.playerAtSeat && this.floor.playerStill && this.activity === null && this.floor.player.mode !== 'talked';
  }

  get posture(): PlayerPosture {
    const p = this.floor.player;
    if (this.gateOpen && this.content.leave.safeAfterGate) return 'lobby';
    if (p.mode === 'talked') return 'talked';
    if (this.activity) return this.activity.posture;
    if (this.phase === 'leave' && this.leaveStage === 'pack' && this.playerAtSeat && this.floor.playerStill) return this.packPaused ? 'paused' : 'activity';
    if (this.seatedWorking) return 'seated';
    return p.mode === 'moving' ? 'moving' : 'still';
  }

  /** 가방을 들고 있는가(퇴근 단계에서 가방을 챙긴 뒤) */
  get carryingBag(): boolean { return this.phase === 'leave' && this.leaveStage !== 'pack'; }

  activityView(): ActivityView | null { return this.activity ? this.activity.view() : null; }

  missionsDone(): number { return this.missions.filter((m) => m.state === 'done').length; }

  drainEvents(): DayEvent[] { const e = this.events; this.events = []; return e; }

  // ── 입력 ─────────────────────────────────────────────

  tapWorld(tx: number, ty: number): string {
    if (this.phase === 'intro' || this.phase === 'ended' || this.floor.outcome !== 'playing') return 'ignored';
    const p = this.floor.player;
    if (p.mode === 'talked') return this.floor.tap(tx, ty);
    if (this.activity && this.activeMission) {
      const fx = emptyEffects();
      const st = this.activity.tap(this.activityCtx(), fx);
      this.applyEffects(fx);
      this.resolveActivity(st);
      return 'mission';
    }
    if (this.phase === 'leave') {
      if (this.leaveStage === 'pack' && this.playerAtSeat && this.floor.playerStill && this.content.leave.packTapPauses) {
        const self = tx === p.tile.x && ty === p.tile.y;
        // 자리 근처 탭 = 가방 멈춤/재개, 다른 곳 탭 = 이동(가방은 자리에서만 챙김)
        if (self || Math.abs(tx - p.tile.x) + Math.abs(ty - p.tile.y) <= 1) { this.packPaused = !this.packPaused; return 'pack'; }
      }
      if (this.leaveStage === 'gate') { this.gateTap(); return 'gate'; }
      if (this.leaveStage === 'elevator' || this.leaveStage === 'done') return 'ignored';
    }
    return this.floor.tap(tx, ty);
  }

  /** HUD 미션 칩 */
  tapMission(id: string): boolean {
    if (this.phase !== 'day' || this.activity) return false;
    const m = this.missions.find((x) => x.def.id === id);
    if (!m) return false;
    if (m.state === 'carry') return this.floor.moveTo(this.content.playerSeat);
    if (m.state !== 'open' || m.blocked) return false;
    this.pendingMission = m;
    if (m.def.startsAt === 'chip_tap_at_seat') {
      if (this.playerAtSeat && this.floor.player.mode !== 'moving') { this.startActivity(m); return true; }
      return this.floor.moveTo(this.content.playerSeat);
    }
    if (!this.playerAtSeat && m.startedAt === null) m.startedAt = this.leftSeatAt ?? this.time;
    const t = m.def.spot;
    const here = this.floor.player.tile;
    if (here.x === t.x && here.y === t.y && this.floor.player.mode !== 'moving') { this.startActivity(m); return true; }
    return this.floor.moveTo(t);
  }

  // ── 진행 ─────────────────────────────────────────────

  advance(dtSec: number): void {
    const r = this.content.floor.rules;
    this.acc += Math.min(Math.max(0, dtSec), r.maxAdvanceSec);
    const h = r.fixedStepSec;
    while (this.acc >= h - 1e-9) {
      this.acc -= h;
      this.step();
    }
  }

  step(): void {
    if (this.phase === 'ended') return;
    const dt = this.content.floor.rules.fixedStepSec;
    this.phaseTime += dt;
    if (this.phase === 'intro') {
      if (this.phaseTime >= this.content.introSec) this.setPhase('day');
      return;
    }
    if (this.phase === 'day') {
      this.dayTime += dt;
      this.unlockMissions();
      this.runScheduledInterrupts();
      this.runScripted();
      if (this.dayTime >= this.content.dayPhaseSec) this.startLeave();
    } else this.leaveTime += dt;

    this.floor.step();
    this.collectFloorEvents();
    if (this.floor.outcome === 'caught') { this.end('caught'); return; }

    this.trackSeat();
    if (this.phase === 'day') this.dayAfterStep(dt);
    else if (this.phase === 'leave') this.leaveAfterStep(dt);
    this.afterInterrupts(dt);
    // 즉시 가산(미션 실패·보고·게이트 삐빅 등)으로 100%가 된 경우
    if ((this.phase as DayPhase) !== 'ended' && this.floor.suspicion.value >= this.content.floor.rules.suspicion.max) this.end('caught');
  }

  // ── FloorSim 훅 ──────────────────────────────────────

  private playerRate(base: number): number {
    const s = this.content.floor.rules.suspicion;
    switch (this.posture) {
      case 'lobby': return 0;
      case 'seated': return s.seatedWorkingPerSec ?? base;
      case 'activity': return (s.activityPerSec ?? s.movingPerSec) * (this.activity?.activityScale ?? 1);
      case 'paused': return s.activityPausedPerSec ?? base;
      case 'safe': return 0;
      default: return base;
    }
  }

  private gazeAllowed(npc: PatrolNpc): boolean {
    if (this.gateOpen && this.content.leave.safeAfterGate) return false;
    const actor = npc.def.actorId;
    if (actor && this.content.ambientActors.includes(actor)) return false;
    return true;
  }

  private talkAllowed(npc: PatrolNpc): boolean {
    const actor = npc.def.actorId ? this.content.actors[npc.def.actorId] : undefined;
    const intId = actor?.talkEnabledBy;
    if (!intId) return false;
    const phase = this.phase === 'leave' ? 'leave' : 'day';
    const int = this.content.interrupts.find((i) => i.id === intId && i.phase === phase);
    if (!int) return false;
    if (this.activity) return false;
    if (this.gateOpen) return false;
    if (actor.talkOnlyWhilePlayerAway && this.playerAtSeat) return false;
    const cond = actor.talkOnlyWhen ?? (typeof int.triggerDef['condition'] === 'string' ? int.triggerDef['condition'] as string : undefined);
    if (cond === 'leave_phase_before_1800' && !(this.phase === 'leave' && this.clockMin < this.content.clock.earlyLeaveBeforeMin)) return false;
    if (cond === 'clock_before_1800' && !(this.clockMin < this.content.clock.earlyLeaveBeforeMin)) return false;
    const st = this.intState.get(intId);
    if (st && st.count >= int.maxPerDay) return false;
    if (st && this.time - st.lastAt < int.cooldownSec) return false;
    return true;
  }

  private gateBlocked(x: number, y: number): boolean {
    if (this.gateOpen) return false;
    const m = this.floor.map;
    return x >= 0 && y >= 0 && x < m.width && y < m.height && m.gateOnly[y * m.width + x] === 1;
  }

  private onNpcEnded(npc: PatrolNpc): NpcDef | null {
    const next = npc.def.thenPatrol;
    if (next) {
      const def = this.content.patrols[next];
      if (def) return def;
    }
    return null;
  }

  // ── 단계 ─────────────────────────────────────────────

  private setPhase(p: DayPhase): void {
    this.phase = p;
    this.phaseTime = 0;
    this.push({ t: this.time, type: 'phase', phase: p });
    if (p === 'day') this.tutorial('dayStart');
  }

  private startLeave(): void {
    // 진행 중인 미션은 중단(벌점 없음, 미완료로 남음)
    if (this.activeMission) { this.activeMission.state = 'failed'; this.activeMission = null; this.activity = null; }
    for (const m of this.missions) if (m.state === 'carry' || m.state === 'active') m.state = 'failed';
    this.pendingMission = null;
    this.setPhase('leave');
    this.leaveStage = 'pack';
    this.push({ t: this.time, type: 'leaveStage', stage: 'pack' });
    this.push({ t: this.time, type: 'toast', key: 'hud.leave_start' });
    this.tutorial('leaveStart');
    if (!this.playerAtSeat) this.floor.moveTo(this.content.playerSeat); // ifAwayWalkToSeatFirst
    // 퇴근 방해: on_leave_start 트리거
    for (const int of this.content.interrupts) {
      if (int.phase !== 'leave') continue;
      const lt = int.triggerDef['leaveTrigger'];
      if (lt === 'on_leave_start') this.startInterrupt(int);
    }
  }

  private end(outcome: DayOutcome): void {
    if (this.phase === 'ended') return;
    const c = this.content;
    const peak = this.floor.suspicion.peak;
    const done = this.missionsDone();
    let stars = 0;
    let outc = outcome;
    let titleKey = 'result.title_caught';
    if (outcome === 'leave' || outcome === 'leave_short') {
      if (this.work < c.work.quota) { outc = 'overtime'; stars = 1; titleKey = 'result.title_overtime'; }
      else if (done < c.missionsRequired) { outc = 'leave_short'; stars = 1; titleKey = 'result.title_leave_short'; }
      else { stars = peak < c.scoring.star3PeakBelow ? 3 : 2; titleKey = 'result.title_leave'; }
    } else if (outcome === 'overtime') { stars = 1; titleKey = 'result.title_overtime'; }
    if (outcome === 'caught') this.floor.finish('caught');
    else this.floor.finish('escaped');
    const mul = c.scoring.starMultiplier[stars] ?? 0;
    const points = Math.floor(this.points);
    const salary = Math.round(c.scoring.salaryBase * mul) + Math.floor(points / c.scoring.slackPointsPerWon);
    const by = this.caughtBy;
    const reaction = outcome === 'caught' && by ? (c.actors[by]?.reactionKeys[0] ?? null)
      : outcome === 'overtime' ? 'react.leave.overtime' : null;
    this.result = {
      outcome: outc, stars, titleKey, peakSuspicion: peak, work: this.work, quota: c.work.quota,
      missionsDone: done, missionsTotal: this.missions.length, missionsRequired: c.missionsRequired,
      slackPoints: points, salary, timeSec: this.time, clockMin: this.clockMin, caughtBy: by, reactionKey: reaction,
    };
    this.phase = 'ended';
    this.push({ t: this.time, type: 'phase', phase: 'ended' });
    this.push({ t: this.time, type: 'result', result: this.result });
  }

  // ── 근무 구간 ─────────────────────────────────────────

  private unlockMissions(): void {
    for (const m of this.missions) {
      if (m.state === 'locked' && this.dayTime >= m.def.unlockAtSec) {
        m.state = 'open';
        this.push({ t: this.time, type: 'missionUnlocked', id: m.def.id });
      }
      // 회의 중 잠김(INT-08 blocksMissions)
      m.blocked = this.missionBlocked(m.def.id);
    }
  }

  private missionBlocked(id: string): boolean {
    for (const int of this.content.interrupts) {
      const bm = int.effect['blocksMissions'];
      if (!Array.isArray(bm) || !bm.includes(id)) continue;
      const pid = int.effect['patrolId'];
      if (typeof pid === 'string' && this.floor.npcs.some((n) => n.def.patrolId === pid)) return true;
    }
    return false;
  }

  private trackSeat(): void {
    const at = this.playerAtSeat;
    if (this.wasAtSeat && !at) {
      this.leftSeatAt = this.time;
      if (this.pendingMission && this.pendingMission.startedAt === null && this.pendingMission.def.awayFromDesk) this.pendingMission.startedAt = this.time;
    }
    this.wasAtSeat = at;
  }

  private dayAfterStep(dt: number): void {
    const c = this.content;
    // 업무 게이지
    if (this.seatedWorking) {
      this.work = Math.min(c.work.max, this.work + c.work.fillPerSec * dt);
      if (!this.seatedWorkSeen && this.dayTime > 1) { this.seatedWorkSeen = true; this.tutorial('firstSeatedWork'); }
    }
    const p = this.floor.player;
    // 미션 행동 진행
    if (this.activity && this.activeMission) {
      if (p.mode !== 'talked') {
        const fx = emptyEffects();
        const st = this.activity.tick(dt, this.activityCtx(), fx);
        this.applyEffects(fx);
        this.resolveActivity(st);
      }
    } else if (p.mode === 'idle') {
      // 도착 → 행동 시작 (칩으로 고른 미션, 또는 열린 미션 장소를 직접 탭해 도착)
      const here = p.tile;
      const cand = this.pendingMission && this.matchesSpot(this.pendingMission, here) ? this.pendingMission
        : this.missions.find((m) => m.state === 'open' && !m.blocked && m.def.startsAt === 'arrive_spot' && this.matchesSpot(m, here));
      if (cand && cand.state === 'open' && !cand.blocked) this.startActivity(cand);
    }
    // 들고 돌아오기 → 자리 도착하면 완료
    for (const m of this.missions) {
      if (m.state === 'carry' && this.playerAtSeat && this.floor.playerStill) this.completeMission(m);
    }
    // 제한 시간
    for (const m of this.missions) {
      if ((m.state === 'active' || m.state === 'carry' || (m.state === 'open' && m === this.pendingMission)) && m.startedAt !== null
        && this.time - m.startedAt > m.def.timeLimitSec) this.failMission(m, 'timeout');
    }
  }

  private matchesSpot(m: MissionRuntime, t: Tile): boolean {
    const s = m.def.startsAt === 'chip_tap_at_seat' ? this.content.playerSeat : m.def.spot;
    return s.x === t.x && s.y === t.y;
  }

  private activityCtx(): { seen: boolean; elapsed: number } {
    return { seen: this.floor.gazeNow > 0, elapsed: this.activeMission?.startedAt !== null && this.activeMission ? this.time - (this.activeMission.startedAt ?? this.time) : 0 };
  }

  private startActivity(m: MissionRuntime): void {
    this.floor.player.halt();
    m.state = 'active';
    if (m.startedAt === null) m.startedAt = this.time;
    this.activeMission = m;
    this.pendingMission = null;
    this.activity = createActivity(m.def.mechanic, m.def.params);
    this.push({ t: this.time, type: 'missionStart', id: m.def.id });
    this.tutorial(`start:${m.def.id}`);
    if (m.def.mechanic === 'trip_safe_zone') this.fireTrigger('restroom_inside_rest_start');
  }

  private applyEffects(fx: ActivityEffects): void {
    if (fx.suspicion !== 0) addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, fx.suspicion);
    if (fx.points !== 0) this.points += fx.points;
    if (fx.toastKey) this.push({ t: this.time, type: 'toast', key: fx.toastKey });
    if (fx.noise) {
      const p = this.floor.player.pos;
      for (const n of this.floor.npcs) {
        if (n.def.seated && Math.hypot(n.x - p.x, n.y - p.y) <= fx.noise.radius) n.shortenIdle(fx.noise.idleTo);
      }
    }
  }

  private resolveActivity(st: 'running' | 'success' | 'fail'): void {
    const m = this.activeMission;
    if (!m || st === 'running') return;
    this.activity = null;
    this.activeMission = null;
    if (st === 'fail') { this.failMission(m, 'fail'); return; }
    this.push({ t: this.time, type: 'missionSuccess', id: m.def.id });
    if (m.def.completeAt === 'return_to_seat') m.state = 'carry';
    else this.completeMission(m);
  }

  private completeMission(m: MissionRuntime): void {
    m.state = 'done';
    this.points += m.def.reward.slackPoints;
    if (m.def.reward.snackStock) this.snackStock = Math.min(this.content.scoring.snackStockMax, this.snackStock + m.def.reward.snackStock);
    this.push({ t: this.time, type: 'missionDone', id: m.def.id, points: m.def.reward.slackPoints });
  }

  private failMission(m: MissionRuntime, reason: 'fail' | 'timeout'): void {
    if (this.activeMission === m) { this.activity = null; this.activeMission = null; }
    if (this.pendingMission === m) this.pendingMission = null;
    m.state = 'failed';
    const pen = reason === 'fail' ? m.def.failPenalty : m.def.timeoutPenalty;
    if (pen > 0) addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, pen);
    this.push({ t: this.time, type: 'missionFail', id: m.def.id, reason });
  }

  // ── 퇴근 ─────────────────────────────────────────────

  private leaveAfterStep(dt: number): void {
    const c = this.content, L = c.leave;
    const p = this.floor.player;
    if (this.clockMin >= c.clock.overtimeAtMin && this.leaveStage !== 'elevator') { this.end('overtime'); return; }
    switch (this.leaveStage) {
      case 'pack':
        if (this.playerAtSeat && this.floor.playerStill && p.mode !== 'talked' && !this.packPaused) {
          this.packProgress += dt;
          if (this.packProgress >= L.packSec) this.setLeaveStage('walk');
        }
        break;
      case 'walk': {
        const t = p.tile, g = L.gate.spot;
        if (p.mode === 'idle' && t.x === g.x && t.y === g.y) { this.setLeaveStage('gate'); this.gateTime = 0; this.tutorial('gateStart'); }
        break;
      }
      case 'gate': {
        const t = p.tile, g = L.gate.spot;
        if (t.x !== g.x || t.y !== g.y) { this.setLeaveStage('walk'); break; }
        this.gateTime += dt;
        const ph = (this.gateTime / L.gate.markerCycleSec) % 1;
        this.gateMarker = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        break;
      }
      case 'lobby': {
        const t = p.tile;
        if (zoneAt(this.floor.map, t.x, t.y) === c.floor.level.exitZone && p.mode !== 'moving') {
          this.setLeaveStage('elevator');
          const [a, b] = L.elevatorWaitSecRange;
          this.elevatorLeft = a === b ? a : this.floor.rng.range(a, b);
        }
        break;
      }
      case 'elevator':
        this.elevatorLeft -= dt;
        if (this.elevatorLeft <= 0) {
          this.points += L.reward;
          if (this.clockMin < c.clock.earlyLeaveBeforeMin) { this.points += L.earlyLeaveBonusPoints; this.push({ t: this.time, type: 'toast', key: 'event.leave.early_bonus' }); }
          this.setLeaveStage('done');
          this.end('leave');
        }
        break;
      case 'done':
        break;
    }
  }

  private setLeaveStage(s: LeaveStage): void {
    this.leaveStage = s;
    this.push({ t: this.time, type: 'leaveStage', stage: s });
  }

  /** 게이트 막대 창(배율 반영) */
  get gateWindow(): number {
    const g = this.content.leave.gate;
    return Math.min(1, g.windowRatio * (this.gateAttempts < g.firstTryAttempts ? g.firstTryWindowScale : 1));
  }

  private gateTap(): void {
    const g = this.content.leave.gate;
    const hit = Math.abs(this.gateMarker - 0.5) <= this.gateWindow / 2;
    this.gateAttempts++;
    if (hit) {
      this.gateOpen = true;
      this.push({ t: this.time, type: 'gate', result: 'pass' });
      this.setLeaveStage('lobby');
      this.floor.moveTo(this.content.leave.exitSpot);
      return;
    }
    this.push({ t: this.time, type: 'gate', result: 'fail' });
    addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, g.beepSuspicion);
    if (g.beepAttractsGuardLook) {
      const guard = this.floor.findNpc((n) => n.def.actorId === g.guardActorId);
      if (guard) {
        const p = this.floor.player.pos;
        guard.forceLook(Math.atan2(p.y - guard.y, p.x - guard.x), this.floor.rng, { tellSec: guard.def.tellSec, lookSec: guard.def.lookSec });
      }
    }
    if (this.gateAttempts >= g.maxAttempts) this.end('overtime');
    this.gateTime = 0;
  }

  // ── 방해 이벤트 ───────────────────────────────────────

  private runScheduledInterrupts(): void {
    for (const int of this.content.interrupts) {
      if (int.phase !== 'day' || int.atSec <= 0) continue;
      if (this.intState.has(int.id)) continue;
      if (this.dayTime >= int.atSec) this.startInterrupt(int);
    }
  }

  /** 하루 계획의 trigger 이름(예: restroom_inside_rest_start)으로 시작하는 방해 */
  private fireTrigger(name: string): void {
    for (const int of this.content.interrupts) {
      if (int.phase === (this.phase === 'leave' ? 'leave' : 'day') && int.trigger === name && !this.intState.has(int.id)) this.startInterrupt(int);
    }
  }

  private noteInterrupt(id: string): void {
    const st = this.intState.get(id) ?? { started: this.time, count: 0, lastAt: -Infinity };
    st.count++;
    st.lastAt = this.time;
    this.intState.set(id, st);
  }

  private startInterrupt(int: DayInterruptDef): void {
    const pat = this.content.patrols;
    const e = int.effect;
    let started = true;
    switch (int.category) {
      case 'walker':
      case 'walker_talk': {
        const variants = Array.isArray(e['patrolVariants']) ? e['patrolVariants'] as string[] : [];
        const id = int.phase === 'leave' && typeof e['leaveVariant'] === 'string' ? e['leaveVariant'] as string
          : typeof e['patrolId'] === 'string' ? e['patrolId'] as string : this.floor.rng.pick(variants);
        const def = id ? pat[id] : undefined;
        if (def) this.floor.addNpc(def); else started = false;
        break;
      }
      case 'walker_opportunity': {
        const id = e['patrolId'];
        const def = typeof id === 'string' ? pat[id] : undefined;
        const actor = def?.actorId;
        const cur = actor ? this.floor.findNpc((n) => n.def.actorId === actor && !!n.def.seated) : undefined;
        if (def && cur) {
          let d = def;
          if (int.phase === 'leave' && typeof e['leaveStartsAt'] === 'string') d = sliceFromStop(def, e['leaveStartsAt'] as string, numOr(e['letoutTellSec'], 1));
          this.floor.replaceNpc(cur, d);
        } else started = false;
        break;
      }
      case 'countdown': {
        const id = e['patrolId'];
        const def = typeof id === 'string' ? pat[id] : undefined;
        if (!def) { started = false; break; }
        this.floor.addNpc(def);
        this.hrChecked = false;
        this.hrCountdown = Math.max(numOr(e['countdownMinSec'], 0), etaToStop(def, 'stop_inspect', this.floor));
        break;
      }
      case 'block': {
        const ids = Array.isArray(e['patrolIds']) ? e['patrolIds'] as string[] : [];
        let any = false;
        for (const id of ids) {
          let def = pat[id];
          if (!def) continue;
          if (int.phase === 'leave' && e['leavePrePositioned']) def = sliceFromStop(def, 'stop_gossip', numOr(e['leaveBlockSec'], def.waypoints[1]?.waitSec ?? 4), true);
          const cur = this.floor.findNpc((n) => n.def.actorId === def!.actorId && !!n.def.seated);
          if (cur) this.floor.replaceNpc(cur, def); else this.floor.addNpc(def);
          any = true;
        }
        started = any;
        break;
      }
      case 'report_run': {
        const id = e['patrolId'];
        const def = typeof id === 'string' ? pat[id] : undefined;
        const cur = this.floor.findNpc((n) => n.def.actorId === 'snitch' && !!n.def.seated);
        if (def && cur) { this.floor.replaceNpc(cur, def); this.reportActive = true; this.reportWait = 0; this.reportCancelled = false; this.push({ t: this.time, type: 'report', result: 'start' }); }
        else started = false;
        break;
      }
      case 'talk_stop':
        started = false; // 근접형: 말걸기 훅이 처리(talkAllowed)
        break;
      default:
        // freeze(INT-09)·qte(INT-11)·assist(INT-12)는 이번 1차 플레이어블 범위 밖 [미구현]
        started = false;
    }
    if (!this.intState.has(int.id)) this.intState.set(int.id, { started: this.time, count: 0, lastAt: -Infinity });
    if (started) {
      this.noteInterrupt(int.id);
      const ev: DayEvent = int.tell.textKey ? { t: this.time, type: 'interrupt', id: int.id, textKey: int.tell.textKey } : { t: this.time, type: 'interrupt', id: int.id };
      this.push(ev);
      this.tutorial(`int:${int.id}`);
      this.scriptHint('interrupt_hint', int.id);
    }
  }

  private afterInterrupts(dt: number): void {
    const p = this.floor.player;
    // 인사팀 근태 점검(INT-05): 점검 지점 도착 시 자리에 없으면 가산
    if (this.hrCountdown !== null) {
      this.hrCountdown = Math.max(0, this.hrCountdown - dt);
      const hr = this.floor.findNpc((n) => n.def.patrolId === 'p_hr_attendance');
      if (!hr) this.hrCountdown = null;
      else if (!this.hrChecked && hr.stopId === 'stop_inspect' && hr.mode !== 'walk' && hr.mode !== 'spawn') {
        this.hrChecked = true;
        this.hrCountdown = null;
        const int = this.content.interrupts.find((i) => i.category === 'countdown');
        if (!this.playerAtSeat && int) {
          addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, numOr(int.effect['absentSuspicion'], 0));
          this.push({ t: this.time, type: 'hrAbsent' });
          this.caughtBy = this.floor.suspicion.value >= 1 ? 'hr_inspector' : this.caughtBy;
        }
      }
    }
    // 정의로운 동료 발견 → 보고 달리기(INT-03)
    const rep = this.content.interrupts.find((i) => i.category === 'report_run' && i.phase === (this.phase === 'leave' ? 'leave' : 'day'));
    if (rep && !this.reportActive) {
      const st = this.intState.get(rep.id);
      const snitch = this.floor.findNpc((n) => n.def.actorId === 'snitch' && !!n.def.seated);
      const actor = this.content.actors['snitch'];
      const states = actor?.spot?.triggerStates ?? [];
      const posture = this.posture;
      const trig = (posture === 'activity' && states.includes('activity')) || (this.carryingBag && states.includes('leaving_with_bag'));
      const sees = snitch && snitch.coneActive && this.floor.isOnScreen(snitch) && seesPlayer(this.floor, snitch);
      if (sees && trig && (!st || st.count < rep.maxPerDay)) {
        this.snitchDwell += dt;
        if (this.snitchDwell >= (actor?.spot?.dwellSec ?? 0.4)) { this.snitchDwell = 0; this.startInterrupt(rep); }
      } else this.snitchDwell = 0;
    }
    if (this.reportActive && rep) {
      const run = this.floor.findNpc((n) => n.def.patrolId === numStr(rep.effect['patrolId']));
      if (!run) { this.reportActive = false; return; }
      // 몸으로 막기: 간식이 있으면 옆에 서서 나눠 주기
      if (!this.reportCancelled && run.mode === 'walk' && this.snackStock > 0 && Math.hypot(run.x - p.x, run.y - p.y) <= 1.1) {
        this.snackStock--;
        this.reportCancelled = true;
        this.push({ t: this.time, type: 'report', result: 'blocked' });
        this.push({ t: this.time, type: 'toast', key: 'npc.snitch.snack_thanks' });
      }
      if (run.mode === 'hold') {
        const tl = this.floor.findNpc((n) => n.def.actorId === 'team_lead');
        const busy = !tl || !tl.def.seated || tl.mode === 'phone' || tl.mode === 'talk' || tl.suppressed;
        if (this.reportCancelled) { run.release(); this.reportActive = false; return; }
        if (busy) {
          this.reportWait += dt;
          if (this.reportWait >= numOr(rep.effect['waitIfReceiverSuppressedMaxSec'], 8)) {
            this.push({ t: this.time, type: 'report', result: 'giveUp' });
            this.push({ t: this.time, type: 'toast', key: 'npc.snitch.give_up' });
            run.release(); this.reportActive = false;
          }
          return;
        }
        if (this.playerAtSeat && this.floor.playerStill && this.activity === null) {
          this.push({ t: this.time, type: 'report', result: 'doubt' });
          this.push({ t: this.time, type: 'toast', key: 'react.snitch.doubt' });
        } else {
          this.push({ t: this.time, type: 'report', result: 'arrive' });
          addSuspicion(this.floor.suspicion, this.content.floor.rules.suspicion, numOr(rep.effect['arrivalSuspicion'], 0));
          const fl = rep.effect['forcedLook'] as Record<string, unknown> | undefined;
          if (tl && fl) {
            const pp = this.floor.player.pos;
            const o: { tellSec: number; lookSec: number; coneRange?: number } = { tellSec: numOr(fl['tellSec'], 0.5), lookSec: numOr(fl['lookSec'], 2.5) };
            if (typeof fl['coneRange'] === 'number') o.coneRange = fl['coneRange'];
            tl.forceLook(Math.atan2(pp.y - tl.y, pp.x - tl.x), this.floor.rng, o);
          }
          if (this.floor.suspicion.value >= 1) this.caughtBy = 'snitch';
        }
        run.release();
        this.reportActive = false;
      }
    }
    // 퇴근: 구역 진입 트리거(INT-06, INT-10)
    if (this.phase === 'leave') {
      const t = p.tile;
      const z = zoneAt(this.floor.map, t.x, t.y);
      for (const int of this.content.interrupts) {
        if (int.phase !== 'leave' || this.intState.has(int.id)) continue;
        if (int.triggerDef['leaveTrigger'] === 'player_enters_zone' && inZone(this.content, int.triggerDef['leaveZone'], t, z)) this.startInterrupt(int);
      }
    }
  }

  // ── 스크립트(튜토리얼 연출) ─────────────────────────────

  private runScripted(): void {
    this.content.scripted.forEach((b, i) => {
      if (this.scriptDone.has(i)) return;
      const at = typeof b['atSec'] === 'number' ? b['atSec'] as number : null;
      if (at === null || this.dayTime < at) return;
      if (b.type === 'boss_look') {
        const npc = this.floor.findNpc((n) => n.def.actorId === b['actor']);
        if (!npc) { this.scriptDone.add(i); return; }
        const wp = npc.def.waypoints[0];
        const dir = wp?.lookDirs?.[0] ?? 'down';
        const ang = dir === 'down' ? Math.PI / 2 : dir === 'up' ? -Math.PI / 2 : dir === 'left' ? Math.PI : 0;
        const o: { tellSec: number; lookSec: number; gazeScale?: number } = { tellSec: numOr(b['tellSec'], npc.def.tellSec), lookSec: npc.def.lookSec };
        if (typeof b['gazeMultiplierScale'] === 'number') o.gazeScale = b['gazeMultiplierScale'] as number;
        if (npc.forceLook(ang, this.floor.rng, o)) {
          this.scriptDone.add(i);
          if (typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
        }
      } else if (b.type === 'boss_opportunity' && b['opportunity'] === 'phone_call') {
        const npc = this.floor.findNpc((n) => n.def.actorId === b['actor']);
        if (npc && npc.mode === 'wait') { npc.startPhone(numOr(b['durationSec'], 3)); this.scriptDone.add(i); }
      } else this.scriptDone.add(i);
    });
  }

  private scriptHint(type: string, interruptId: string): void {
    for (const b of this.content.scripted) {
      if (b.type === type && b['interruptId'] === interruptId && typeof b['hintKey'] === 'string') this.hint(b['hintKey'] as string);
    }
  }

  private tutorial(trigger: string): void {
    for (const id of this.content.tutorialIds) if (TUTORIAL_ON[id] === trigger) this.hint(`tutorial.${id}`);
  }

  private hint(key: string): void {
    if (this.hintsShown.has(key)) return;
    this.hintsShown.add(key);
    this.push({ t: this.time, type: 'hint', key });
  }

  // ── FloorSim 이벤트 후처리 ──────────────────────────────

  private floorEvents: SimEvent[] = [];

  /** FloorSim 이벤트(이번 스텝). 표시 쪽이 사운드·연출에 씀 */
  drainFloorEvents(): SimEvent[] { const e = this.floorEvents; this.floorEvents = []; return e; }

  private collectFloorEvents(): void {
    for (const e of this.floor.drainEvents()) {
      this.floorEvents.push(e);
      if (e.type === 'closeCall') {
        this.points += this.content.scoring.closeCallBonusPoints;
        this.push({ t: this.time, type: 'closeCall', points: this.content.scoring.closeCallBonusPoints });
      } else if (e.type === 'talkWarn') {
        const npc = this.floor.findNpc((n) => n.def.id === e.npc);
        const intId = npc?.def.actorId ? this.content.actors[npc.def.actorId]?.talkEnabledBy : undefined;
        if (intId) this.scriptHint('talk_hint', intId);
      } else if (e.type === 'talk') {
        const npc = this.floor.findNpc((n) => n.def.id === e.npc);
        const intId = npc?.def.actorId ? this.content.actors[npc.def.actorId]?.talkEnabledBy : undefined;
        if (intId) {
          this.noteInterrupt(intId);
          const int = this.content.interrupts.find((i) => i.id === intId);
          const pts = int ? numOr(int.effect['earlyLeavePoints'], 0) : 0;
          if (pts > 0) this.points += pts;
        }
      } else if (e.type === 'caught') {
        let best: PatrolNpc | null = null;
        this.floor.npcs.forEach((n, i) => { if (this.floor.seeing[i] && (!best || n.gazeMultiplier > best.gazeMultiplier)) best = n; });
        const b = best as PatrolNpc | null;
        if (b) this.caughtBy = b.def.actorId ?? null;
      }
    }
  }

  private push(e: DayEvent): void { this.events.push(e); }
}

// ── 보조 함수 ─────────────────────────────────────────────

function numOr(v: unknown, d: number): number { return typeof v === 'number' ? v : d; }
function numStr(v: unknown): string { return typeof v === 'string' ? v : ''; }

function seesPlayer(floor: FloorSim, npc: PatrolNpc): boolean {
  const i = floor.npcs.indexOf(npc);
  return i >= 0 && floor.seeing[i] === true;
}

function inZone(c: DayContent, zoneId: unknown, t: Tile, legendZone: string | null): boolean {
  if (typeof zoneId !== 'string') return false;
  if (legendZone === zoneId) return true;
  const z = c.zones.find((zz) => zz.id === zoneId);
  if (!z) return false;
  const [x, y, w, h] = z.rect;
  return t.x >= x && t.y >= y && t.x < x + w && t.y < y + h;
}

/** stopId 웨이포인트부터 시작하는 순찰(퇴근 '미리 서 있음'·'회의 끝'), 그 지점 대기 = waitSec */
function sliceFromStop(def: NpcDef, stopId: string, waitSec: number, dropSpawnTell = true): NpcDef {
  const i = def.waypoints.findIndex((w) => w.stopId === stopId);
  if (i < 0) return def;
  const wps: WaypointDef[] = def.waypoints.slice(i).map((w, k) => (k === 0 ? { ...w, waitSec } : w));
  const out: NpcDef = { ...def, waypoints: wps };
  if (dropSpawnTell) { const { spawnTellSec: _s, ...rest } = out; return rest; }
  return out;
}

/** 순찰이 stopId에 도착하기까지 예상 시간(등장 전조 + 경로 길이 ÷ 속도 + 앞 정지 대기) */
function etaToStop(def: NpcDef, stopId: string, floor: FloorSim): number {
  let sec = def.spawnTellSec ?? 0;
  const wps = def.waypoints;
  for (let i = 0; i < wps.length - 1; i++) {
    if (wps[i]!.stopId === stopId) break;
    if (i > 0) sec += wps[i]!.waitSec;
    const a = wps[i]!, b = wps[i + 1]!;
    sec += pathLen(floor, a, b) / def.speedTilesPerSec;
    if (b.stopId === stopId) break;
  }
  return sec;
}

function pathLen(floor: FloorSim, a: Tile, b: Tile): number {
  // NPC는 동적 차단 없이 지도만 본다
  const path = floorPath(floor, a, b);
  return path ?? Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function floorPath(floor: FloorSim, a: Tile, b: Tile): number | null {
  const p = findPath(floor.map, a, b);
  return p ? p.length : null;
}
