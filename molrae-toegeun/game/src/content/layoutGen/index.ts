/**
 * 생성 + 검증 + 시드 파생 재시도 (D-076, T-144).
 * 시도 i(0부터)의 시드 = i === 0 ? seed : `${seed}#r${i}`. maxAttempts 안에 통과 못 하면 layout = null(호출 측이 수작업 맵으로 폴백).
 */
import { generateLayout } from './generate';
import { validateLayout } from './validate';
import type { GenFailure, GenInput, GeneratedLayout, LayoutMetrics, ValidateRules } from './types';

export * from './types';
export { generateLayout, seamCandidates } from './generate';
export { validateLayout, longestClearSight, weightedPath, type LayoutLike } from './validate';
export { DEV_LAYOUT_MODULES, DEV_LAYOUT_RULES, DEV_VALIDATE_RULES, DEV_LAYOUT_POLICY } from './devModules';

export interface AttemptLog {
  readonly seed: string;
  readonly failures: readonly GenFailure[];
  readonly metrics?: LayoutMetrics;
}

export interface ValidatedResult {
  readonly layout: GeneratedLayout | null;
  readonly attempts: number;
  readonly log: readonly AttemptLog[];
  readonly metrics?: LayoutMetrics;
}

export function attemptSeed(seed: string, i: number): string { return i === 0 ? seed : `${seed}#r${i}`; }

/** extraCheck: 호출 측 추가 검사(실패 사유를 돌려주면 그 시도는 실패) */
export function generateValidated(
  input: GenInput, vrules: ValidateRules, maxAttempts: number, extraCheck?: (layout: GeneratedLayout) => GenFailure[],
): ValidatedResult {
  const log: AttemptLog[] = [];
  const n = Math.max(1, Math.floor(maxAttempts));
  for (let i = 0; i < n; i++) {
    const seed = attemptSeed(input.seed, i);
    const g = generateLayout({ ...input, seed });
    if (!g.layout) { log.push({ seed, failures: g.failures }); continue; }
    const v = validateLayout(g.layout, vrules);
    const fatal = [...v.failures, ...(v.ok && extraCheck ? extraCheck(g.layout) : [])];
    log.push({ seed, failures: [...g.failures.filter((f) => f.code === 'duplicate_spot'), ...fatal], metrics: v.metrics });
    if (fatal.length === 0) return { layout: g.layout, attempts: i + 1, log, metrics: v.metrics };
  }
  return { layout: null, attempts: n, log };
}

/** 미리보기·로그용 문자 격자(행 번호 포함) */
export function layoutToText(l: Pick<GeneratedLayout, 'rows' | 'modules'>): string {
  const starts = new Map(l.modules.map((m) => [m.y, `${m.id}${m.mirrored ? ' (반전)' : ''}`]));
  return l.rows.map((r, y) => `${String(y).padStart(3, ' ')} ${r}${starts.has(y) ? `   ← ${starts.get(y)}` : ''}`).join('\n');
}
