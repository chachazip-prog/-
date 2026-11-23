/**
 * 위험 단계(BGM 2스템 + 화면 테두리 공용, audio-manifest bgm_office.stages / rules.visualCues.dangerBorder.followsBgmHysteresis).
 * 순수 TS(렌더링·사운드 무관). 올릴 때는 즉시, 내릴 때는 조건이 downgradeDelaySec 연속 해소된 뒤에만.
 */
export type DangerStage = 'stopped' | 'freeze' | 'danger' | 'finale' | 'alert' | 'calm';

export interface StageInputs {
  readonly stopped: boolean;
  readonly freeze: boolean;
  /** 전조 중 나를 덮을 수 있음(turning) 또는 보는 중(seeing) */
  readonly turningOrSeeing: boolean;
  readonly suspicion: number;
  readonly leavePhase: boolean;
  /** 화면 밖 approaching 화살표 개수 */
  readonly offscreenApproaching: number;
}

export interface StageThresholds {
  /** danger: 의심 ≥ 이 값 (= rules.visualCues.suspicionHigh.threshold) */
  readonly dangerSuspicion: number;
  /** alert: 의심 ≥ 이 값 (= rules.visualCues.dangerBorder.alertSuspicionMin, T-136. 매니페스트 stages.alert.when과 같은 값) */
  readonly alertSuspicion: number;
}

/**
 * rules.visualCues에서 임계값을 읽는다(T-136). 값이 없으면 null — 데이터 누락은 호출 측이 경고로 처리.
 * danger = suspicionHigh.threshold, alert = dangerBorder.alertSuspicionMin
 */
export function stageThresholdsFromCues(visualCues: Readonly<Record<string, unknown>>): StageThresholds | null {
  const o = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? v as Record<string, unknown> : {});
  const danger = o(visualCues['suspicionHigh'])['threshold'];
  const alert = o(visualCues['dangerBorder'])['alertSuspicionMin'];
  if (typeof danger !== 'number' || typeof alert !== 'number') return null;
  return { dangerSuspicion: danger, alertSuspicion: alert };
}

const DEFAULT_PRIORITY: readonly DangerStage[] = ['stopped', 'freeze', 'danger', 'finale', 'alert', 'calm'];

export class DangerStageTracker {
  stage: DangerStage = 'calm';
  private pendingLower: DangerStage | null = null;
  private lowerFor = 0;

  constructor(
    private readonly thresholds: StageThresholds,
    private readonly downgradeDelaySec: number,
    private readonly priority: readonly DangerStage[] = DEFAULT_PRIORITY,
  ) {}

  desired(i: StageInputs): DangerStage {
    if (i.stopped) return 'stopped';
    if (i.freeze) return 'freeze';
    if (i.turningOrSeeing || i.suspicion >= this.thresholds.dangerSuspicion) return 'danger';
    if (i.leavePhase) return 'finale';
    if (i.offscreenApproaching > 0 || i.suspicion >= this.thresholds.alertSuspicion) return 'alert';
    return 'calm';
  }

  private rank(s: DangerStage): number { const r = this.priority.indexOf(s); return r < 0 ? this.priority.length : r; }

  update(dt: number, i: StageInputs): DangerStage {
    const want = this.desired(i);
    // stopped·freeze 진입·해제는 즉시(대표님 '띵'과 같은 프레임, 적발 즉시 정지)
    const immediate = want === 'stopped' || want === 'freeze' || this.stage === 'stopped' || this.stage === 'freeze';
    if (this.rank(want) <= this.rank(this.stage) || immediate) {
      this.stage = want; this.pendingLower = null; this.lowerFor = 0;
      return this.stage;
    }
    if (this.pendingLower !== want) { this.pendingLower = want; this.lowerFor = 0; }
    this.lowerFor += dt;
    if (this.lowerFor >= this.downgradeDelaySec) { this.stage = want; this.pendingLower = null; this.lowerFor = 0; }
    return this.stage;
  }
}
