/// <reference types="node" />
/**
 * T-141 공통: 미리보기 빌드(?v3=1&gender=1, 순회 auto)와 같은 조립 옵션으로 DayContent를 만든다.
 * 데이터 기본값(layout.enabled·missions.enabled·genderFacilities.enabled = false)이 아니라
 * '생성 맵 + 미션 v3 + 성별 시설 + 팀장 순회' 활성 상태를 측정 대상으로 한다(PM 지시 T-141).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDayContent, type Tables } from '../../src/content/buildDay';
import { createLevelProvider } from '../../src/content/levelProvider';
import type { DayContent } from '../../src/core/day/types';

export type Pv = 'm' | 'f';

export function loadTables(dir: string): Tables {
  const t: Record<string, unknown> = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) t[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return t;
}

/** 미리보기 빌드 설정(생성 맵·미션 v3·성별 시설·순회 auto) */
export function contentV3(tables: Tables, day: number, pv: Pv = 'm', warn: string[] = []): DayContent {
  return buildDayContent(tables, day, warn, {
    levelProvider: createLevelProvider({ generate: true }), missionsV3: true, genderFacilities: true, playerVariant: pv, tours: 'auto',
  });
}

/** FNV-1a 32비트(개발 gen-survey와 같은 해시) */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const isCeoDay = (c: DayContent): boolean => !!(c as unknown as { ceoVisit?: unknown }).ceoVisit;
