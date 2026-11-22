/**
 * game/data/*.json 타입 자리. 스키마는 기획(mt-game-designer) 소유 — 확정되면 여기에 타입을 맞춘다.
 * 스키마 변경 요청은 PM 경유.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 파일명(확장자 제외) → 파싱된 JSON */
export type DataTables = Readonly<Record<string, JsonValue>>;
