import type { DataTables, JsonValue } from './types';

/**
 * game/data/*.json을 빌드 시점에 번들에 포함 (eager). 파일이 하나도 없어도 빈 객체로 빌드된다.
 * 상대 경로: src/data/ → ../../data/
 */
const modules = import.meta.glob<JsonValue>('../../data/*.json', { eager: true, import: 'default' });

function toTables(mods: Record<string, JsonValue>): DataTables {
  const out: Record<string, JsonValue> = {};
  for (const [path, value] of Object.entries(mods)) {
    const name = path.split('/').pop()?.replace(/\.json$/, '');
    if (name) out[name] = value;
  }
  return Object.freeze(out);
}

const tables = toTables(modules);

export function getDataTables(): DataTables {
  return tables;
}

/** 테이블 조회. 없으면 undefined — 호출 측에서 기본 동작 처리 */
export function getTable<T = JsonValue>(name: string): T | undefined {
  return tables[name] as T | undefined;
}

export function listTables(): string[] {
  return Object.keys(tables);
}
