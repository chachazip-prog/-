/**
 * v3 테이블(layout·missions)에서 런타임이 읽지 않는 설명 문장 키(T-145). 빌드에서 '_' 키·stringsKo와 함께 제거(초기 로드 용량, D-082 취지).
 * 생성기 버전 태그(D-085) 해시도 이 키를 빼고 계산해 개발·빌드의 맵이 같게 둔다.
 */
export const V3_PROSE_KEYS: readonly string[] = [
  'rule', 'rules', 'selection', 'awayRule', 'conflicts', 'coneNote', 'complexityFormula', 'targets', 'modifierTemplates', 'conditions', 'difficultyNote', 'order',
];
export const V3_PROSE_TABLES: readonly string[] = ['layout.json', 'missions.json'];
