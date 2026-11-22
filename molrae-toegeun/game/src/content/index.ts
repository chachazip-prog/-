/**
 * 콘텐츠 공급 지점 (교체 포인트).
 * 지금은 src/dev/ 임시 데이터를 돌려준다. game/data/ 스키마(T-121)가 확정되면
 * 이 함수만 data/loader.ts 기반 변환으로 바꾸면 씬·core는 그대로 둔다.
 */
import type { FloorContent } from '../core/floorSim';
import { PROTO_FLOOR, PROTO_RESULT_INPUT_GUARD_SEC, PROTO_ZONE_LABELS } from '../dev/protoFloor';

export interface FloorPresentation {
  readonly zoneLabels: Readonly<Record<string, string>>;
  /** 결과 화면이 뜬 뒤 탭(재시작)을 받지 않는 시간(초) */
  readonly resultInputGuardSec: number;
}

export function loadFloorContent(): FloorContent {
  return PROTO_FLOOR;
}

export function loadFloorPresentation(): FloorPresentation {
  return { zoneLabels: PROTO_ZONE_LABELS, resultInputGuardSec: PROTO_RESULT_INPUT_GUARD_SEC };
}
