/**
 * [임시 데이터] T-123 회색 박스 프로토타입용 층·NPC·규칙.
 * 기획(T-121)의 game/data/ 스키마가 확정되면 src/content/index.ts의 공급원을 데이터 로더로 바꾸고 이 파일은 삭제한다.
 * 모든 수치는 개발자가 임의로 정한 값(기획 미확정) — 밸런스 근거 없음.
 */
import type { FloorContent, FloorRules, LevelDef } from '../core/floorSim';

// 11 × 62 타일 (176 × 992 px ≈ 3.1화면). 위가 출구, 아래가 내 자리.
// # 벽  . 바닥  D 책상(통행 X, 시야 O)  P 파티션 / F 화분 / X 복사기 (통행 X, 시야 차단 = 엄폐물)
// S 내 자리  K 탕비실  E 출구
const ROWS: readonly string[] = [
  '###########', // 0
  '#EEEEEEEEE#',
  '#EEEEEEEEE#',
  '####...####',
  '#.........#',
  '#.F.....F.#', // 5
  '#.........#',
  '#..X...X..#',
  '#.........#',
  '#.........#',
  '##..###..##', // 10
  '#.........#',
  '#.DD.P.DD.#',
  '#.DD.P.DD.#',
  '#.........#',
  '#F.......F#', // 15
  '#.........#',
  '#.DD.P.DD.#',
  '#.DD.P.DD.#',
  '#.........#',
  '###.###.###', // 20
  '#KKKK#....#',
  '#KKKK#.DD.#',
  '#KKXK#.DD.#',
  '#KKKK.....#',
  '#KKKK#.DD.#', // 25
  '#KFKK#.DD.#',
  '#KKKK#....#',
  '###.###.###',
  '#.........#',
  '#.PPP.PPP.#', // 30
  '#.DD...DD.#',
  '#.DD.F.DD.#',
  '#.........#',
  '#.DD.F.DD.#',
  '#.DD...DD.#', // 35
  '#.PPP.PPP.#',
  '#.........#',
  '#.........#',
  '#.DD.P.DD.#',
  '#.DD.P.DD.#', // 40
  '#.........#',
  '#X.......F#',
  '#.........#',
  '#.DD.P.DD.#',
  '#.DD.P.DD.#', // 45
  '#.........#',
  '###.###.###',
  '#.........#',
  '#.DD...DD.#',
  '#.DDP.PDD.#', // 50
  '#.........#',
  '#.F.....F.#',
  '#.........#',
  '#.DD...DD.#',
  '#.DDP.PDD.#', // 55
  '#.........#',
  '#.SS......#',
  '#.DD......#',
  '#.........#',
  '#F.......F#', // 60
  '###########',
];

const LEVEL: LevelDef = {
  id: 'proto-floor-1',
  rows: ROWS,
  legend: {
    '#': { kind: 'wall', walkable: false, blocksSight: true },
    '.': { kind: 'floor', walkable: true, blocksSight: false },
    D: { kind: 'desk', walkable: false, blocksSight: false },
    P: { kind: 'partition', walkable: false, blocksSight: true },
    F: { kind: 'plant', walkable: false, blocksSight: true },
    X: { kind: 'copier', walkable: false, blocksSight: true },
    S: { kind: 'floor', walkable: true, blocksSight: false, zone: 'seat' },
    K: { kind: 'floor', walkable: true, blocksSight: false, zone: 'pantry' },
    E: { kind: 'floor', walkable: true, blocksSight: false, zone: 'exit' },
  },
  playerStart: { x: 2, y: 57 },
  exitZone: 'exit',
  npcs: [
    {
      id: 'teamlead',
      name: '팀장',
      role: 'boss',
      cone: { range: 5, halfAngleDeg: 30 },
      speedTilesPerSec: 1.6,
      gazeMultiplier: 1,
      tellSec: 0.6,
      lookSec: 1.4,
      lookChance: 0.6,
      glanceBackChancePerTile: 0.06,
      waypoints: [
        { x: 1, y: 29, waitSec: 1.5 },
        { x: 9, y: 29, waitSec: 1.0 },
        { x: 9, y: 46, waitSec: 2.0, lookDirs: ['left', 'up'] },
        { x: 4, y: 41, waitSec: 1.5 },
        { x: 1, y: 46, waitSec: 1.0 },
      ],
    },
    {
      id: 'guard',
      name: '경비',
      role: 'guard',
      cone: { range: 4, halfAngleDeg: 35 },
      speedTilesPerSec: 1.2,
      gazeMultiplier: 0.8,
      tellSec: 0.5,
      lookSec: 1.2,
      lookChance: 0.5,
      glanceBackChancePerTile: 0.04,
      waypoints: [
        { x: 2, y: 4, waitSec: 1.2 },
        { x: 8, y: 4, waitSec: 1.2 },
        { x: 8, y: 9, waitSec: 1.0, lookDirs: ['up', 'left'] },
        { x: 2, y: 9, waitSec: 1.0, lookDirs: ['up', 'right'] },
      ],
      talk: { radius: 1.1, durationSec: 1.5, cooldownSec: 6 },
    },
  ],
};

const RULES: FloorRules = {
  fixedStepSec: 1 / 60,
  maxAdvanceSec: 0.1,
  playerSpeedTilesPerSec: 3.5,
  tapSnapRadius: 2,
  suspicion: {
    max: 1,
    movingPerSec: 0.6,
    idlePerSec: 0.25,
    disguisedPerSec: 0.08,
    talkedPerSec: 0.08,
    disguiseSettleSec: 0.2,
    graceSec: 0.12, // rules.json input.inputGraceSec과 같은 값
    decayPerSec: 0.02, // rules.json suspicion.decayPerSec과 같은 값
  },
  threat: { approachExtraRange: 9, approachExtraAngleDeg: 25 },
};

export const PROTO_FLOOR: FloorContent = { level: LEVEL, rules: RULES };

/** 구역 이름표 (렌더링용, 임시 문자열 — strings.ko.json 확정 시 이동) */
export const PROTO_ZONE_LABELS: Readonly<Record<string, string>> = {
  seat: '내 자리',
  pantry: '탕비실',
  exit: '출구',
};
