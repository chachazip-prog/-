/**
 * [임시 dev 데이터] 생성기 동작 확인용 모듈·규칙 (T-144). T-142(game/data/layout.json)·T-143(모듈 에셋)이 나오면 데이터가 대신한다.
 * 숫자·모듈 모양은 개발 가정이며 밸런스 값이 아니다. 문자 의미는 maps.json office_floor_1 legend를 그대로 쓴다.
 *  ? = 선택 엄폐물(바닥/화분/칸막이), ! = 선택 막힘(바닥/벽). 복잡도가 오를수록 엄폐·막힘 확률 증가.
 * 스팟 이름은 수작업 맵(office_floor_1)과 같게 맞춰 기존 순찰·미션이 그대로 재매핑되게 했다. tour_* = 팀장 순회 목적지(D-075).
 */
import type { LayoutRules, ModuleTemplate, ValidateRules } from './types';

export const DEV_LAYOUT_MODULES: readonly ModuleTemplate[] = [
  {
    id: 'dev_lobby', tags: ['top'],
    rows: [
      '###########',
      '#T..EEE..T#',
      '#...eee...#',
      '#.........#',
      '####GGG####',
      '#BB.......#',
      '#T.......T#',
    ],
    spots: { elevator_main_use: { x: 5, y: 2, facing: 'up' }, gate_use: { x: 5, y: 5, facing: 'up' }, guard_post: { x: 3, y: 5, facing: 'right' } },
    zones: [
      { id: 'lobby', nameKey: 'zone.lobby', rect: [1, 1, 9, 3], outsideOffice: true },
      { id: 'gate_hall', nameKey: 'zone.gate_hall', rect: [1, 5, 9, 2] },
    ],
    routeNodes: { n_lobby: [5, 6] },
  },
  {
    id: 'dev_exec_wing', tags: ['exec'], mirrorable: true,
    rows: [
      '#...#T....#',
      '#.X.#..C..#',
      '#.h.=.....#',
      '#...#..T..#',
    ],
    spots: { exec_seat: { x: 2, y: 2, facing: 'up' }, exec_door: { x: 4, y: 2 }, tour_printer: { x: 6, y: 1, facing: 'right' } },
    zones: [
      { id: 'exec_wing', nameKey: 'zone.exec_wing', rect: [1, 0, 9, 4] },
      { id: 'exec_office', nameKey: 'zone.exec_office', rect: [1, 0, 3, 4] },
    ],
    routeNodes: { n_b_hall: [5, 2] },
  },
  {
    id: 'dev_next_team', tags: ['middle'], mirrorable: true,
    rows: [
      '#....D....#',
      '#....h....#',
      '#.DD...DD.#',
      '#.hh.T.hh.#',
      '#!.......!#',
      '#.DD.?.DD.#',
      '#.hh...hh.#',
      '#.........#',
      '#.T..T..T.#',
      '#.........#',
    ],
    spots: { tl2_seat: { x: 5, y: 1, facing: 'up' }, tour_next_team: { x: 4, y: 7, facing: 'up' } },
    zones: [{ id: 'next_team', nameKey: 'zone.next_team', rect: [1, 0, 9, 10] }],
    routeNodes: { n_c_top: [6, 2], n_c_mid: [5, 4], n_c_bot: [5, 9], n_c_left: [1, 7], n_c_right: [9, 7] },
  },
  {
    id: 'dev_open_office', tags: ['middle'], mirrorable: true, minComplexity: 0.25, weightByComplexity: [0.5, 1.5],
    rows: [
      '#.........#',
      '#.DD.?.DD.#',
      '#.hh...hh.#',
      '#!..PTP..!#',
      '#.........#',
      '#..?...?..#',
    ],
    zones: [{ id: 'open_office', nameKey: 'zone.next_team', rect: [1, 0, 9, 6] }],
    routeNodes: { n_c_mid: [5, 4], n_c_bot: [5, 5] },
  },
  {
    id: 'dev_amenity', tags: ['amenity'],
    rows: [
      '#####.##=##',
      '#SSr#.g...#',
      '#rrr=.gMM.#',
      '#SSr#.=MM.#',
      '#rrr#.gh..#',
      '#####.##=##',
    ],
    spots: {
      restroom_door: { x: 4, y: 2 }, restroom_stall: { x: 1, y: 1, facing: 'up' }, nap_chair: { x: 7, y: 4, facing: 'up' },
      meeting_door_w: { x: 6, y: 3 }, meeting_door_n: { x: 8, y: 0 }, meeting_door_s: { x: 8, y: 5 },
      meeting_inside: { x: 9, y: 1, facing: 'left' }, gossip_a: { x: 5, y: 1, facing: 'down' }, gossip_b: { x: 5, y: 2, facing: 'up' },
      tour_meeting: { x: 9, y: 2, facing: 'left' },
    },
    zones: [
      { id: 'corridor_mid', nameKey: 'zone.corridor_mid', rect: [5, 0, 1, 6] },
      { id: 'restroom', nameKey: 'zone.restroom', rect: [1, 1, 3, 4] },
      { id: 'meeting_room', nameKey: 'zone.meeting_room', rect: [7, 1, 3, 4] },
    ],
    routeNodes: { n_d_top: [5, 0], n_d_mid: [5, 3], n_d_bot: [5, 5] },
  },
  {
    id: 'dev_team', tags: ['team'], mirrorable: true,
    rows: [
      '#.........#',
      '#....D....#',
      '#....h....#',
      '#.?..T..?.#',
      '#.PDD.DDP.#',
      '#.Ph@.hhP.#',
      '#.........#',
      '#.PDD.DDP.#',
      '#.Phh.hhP.#',
      '#.........#',
      '#T..CTC..T#',
      '#!.......!#',
    ],
    spots: {
      player_seat: { x: 4, y: 5, facing: 'up' }, tl_seat: { x: 5, y: 2, facing: 'up' }, tl_greet_spot: { x: 4, y: 3, facing: 'down' },
      snitch_seat: { x: 6, y: 5, facing: 'up' }, accomplice_seat: { x: 7, y: 8, facing: 'up' },
      hr_inspect_spot: { x: 5, y: 6, facing: 'left' }, ceo_greet_spot: { x: 5, y: 6, facing: 'left' }, ceo_talk_spot: { x: 6, y: 3, facing: 'up' },
      snitch_report_spot: { x: 6, y: 2, facing: 'left' }, tour_copier: { x: 4, y: 11, facing: 'up' },
    },
    zones: [{ id: 'team', nameKey: 'zone.team', rect: [1, 0, 9, 12] }],
    routeNodes: {
      n_e_head: [5, 0], n_e_aisle1: [5, 4], n_e_aisle2: [5, 6], n_e_aisle3: [5, 9],
      n_e_left_top: [1, 0], n_e_left_bot: [1, 9], n_e_win_top: [9, 0], n_e_win_bot: [9, 9],
    },
  },
  {
    id: 'dev_pantry', tags: ['bottom'],
    rows: [
      '#.........#',
      '#KK.....T.#',
      '#.........#',
      '#.KK...KK.#',
      '#.........#',
      '####EEE####',
    ],
    spots: { coffee_use: { x: 2, y: 2, facing: 'up' }, elevator_service_spawn: { x: 5, y: 4, facing: 'up' }, tour_pantry: { x: 4, y: 2, facing: 'left' } },
    zones: [{ id: 'pantry', nameKey: 'zone.pantry', rect: [1, 0, 9, 5] }],
    routeNodes: { n_pantry: [5, 0] },
  },
];

export const DEV_LAYOUT_RULES: LayoutRules = {
  width: 11,
  maxHeight: 72,
  playerSeatSpot: 'player_seat',
  exitZone: 'exit',
  slots: [
    { tag: 'top' },
    { tag: 'exec' },
    { tag: 'middle', count: [1, 1], countAtMax: [1, 2] },
    { tag: 'amenity' },
    { tag: 'middle', count: [0, 0], countAtMax: [0, 1] },
    { tag: 'team' },
    { tag: 'bottom' },
  ],
  seam: {
    wallChar: '#',
    openChars: [{ ch: '.', weight: [1, 0.6] }, { ch: '=', weight: [0, 0.4] }],
    openings: [2, 3],
    openingsAtMax: [1, 2],
  },
  wildcards: {
    '?': [{ ch: '.', weight: [0.7, 0.3] }, { ch: 'T', weight: [0.2, 0.4] }, { ch: 'P', weight: [0.1, 0.3] }],
    '!': [{ ch: '.', weight: [0.9, 0.55] }, { ch: '#', weight: [0.1, 0.45] }],
  },
};

export const DEV_VALIDATE_RULES: ValidateRules = {
  requiredSpots: [
    'player_seat', 'gate_use', 'elevator_main_use', 'guard_post', 'tl_seat', 'snitch_seat', 'accomplice_seat',
    'coffee_use', 'restroom_stall', 'nap_chair', 'meeting_inside', 'hr_inspect_spot', 'elevator_service_spawn',
  ],
  routeGoalSpot: 'gate_use',
  maxSharedRatio: 0.75,
  maxDetourRatio: 1.6,
  sharePenalty: 4,
  maxClearSightTiles: 18,
  maxHeight: 72,
  width: 11,
};

/** 공급자 정책(임시). T-142 데이터의 같은 의미 키가 생기면 그쪽이 우선 */
export const DEV_LAYOUT_POLICY = {
  /** 이 일차까지는 수작업 맵(D-074: 1~2일차 튜토리얼 맵) */
  authoredMapDays: 2,
  /** 검증 실패 시 시드 파생 재시도 횟수 */
  maxAttempts: 8,
  /** 생성 층이 legend·카메라·순찰(재매핑)을 빌려 오는 수작업 맵 */
  sourceMapId: 'office_floor_1',
} as const;
