// 렌더링 무관 순수 판정 모듈 진입점. Phaser/DOM/platform import 금지 (QA 헤드리스 시뮬레이션용).
export * from './rng';
/** @deprecated D-001(측면 홀드/떼기) 폐기(D-033). 탑다운 전환 후 미사용 — 기획 확정 시 제거 예정 */
export * from './stance';
export * from './grid';
export * from './pathfinding';
export * from './vision';
export * from './player';
export * from './suspicion';
export * from './patrol';
export {
  FloorSim,
  type FloorContent, type FloorRules, type LevelDef, type Outcome, type SimEvent, type TapResult, type Threat,
} from './floorSim';
