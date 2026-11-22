/**
 * 직급 스케일링 (design/data-schema.md §0-2). 순수 함수.
 * - 보간(bosses·npcs·interrupts): rankScaling[rank] = {start:{path:v}, end:{path:v}} → t로 선형 보간.
 *   숫자·Range는 원소별, 정수 필드(perDayRange, maxPerDay)는 반올림, 그 외(문자열 등)는 t < 0.5면 start.
 * - 덮어쓰기(events): rankScaling[rank] = {field: v} → params의 같은 필드 교체. 'pack.sec' = params.phases[id=pack].sec
 * 경로 규칙: 점 경로. 배열 중간 단계는 원소의 type 또는 id로 찾는다(예: 'opportunities.phone_call.probPerCycle').
 */
type J = unknown;

const INT_FIELDS = new Set(['perDayRange', 'maxPerDay']);

export function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

function lerpValue(a: J, b: J, t: number, field: string): J {
  if (typeof a === 'number' && typeof b === 'number') {
    const v = a + (b - a) * t;
    return INT_FIELDS.has(field) ? Math.round(v) : v;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((x, i) => lerpValue(x, b[i], t, field));
  return t < 0.5 ? a : b;
}

/** 점 경로에 값 쓰기. 배열 단계는 type/id 일치 원소를 찾는다. 경로가 없으면 false */
export function setPath(root: Record<string, J>, path: string, value: J): boolean {
  const parts = path.split('.');
  let cur: J = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (Array.isArray(cur)) cur = cur.find((e) => typeof e === 'object' && e !== null && ((e as Record<string, J>)['type'] === k || (e as Record<string, J>)['id'] === k));
    else if (typeof cur === 'object' && cur !== null) {
      const o = cur as Record<string, J>;
      if (o[k] === undefined) o[k] = {};
      cur = o[k];
    } else return false;
    if (cur === undefined) return false;
  }
  if (typeof cur !== 'object' || cur === null) return false;
  (cur as Record<string, J>)[parts[parts.length - 1]!] = value;
  return true;
}

/** 보간 방식 직급 스케일링을 적용한 사본 */
export function applyInterpScaling<T extends Record<string, J>>(actor: T, rankId: string, t: number): T {
  const out = deepClone(actor);
  const rs = (actor['rankScaling'] as Record<string, { start?: Record<string, J>; end?: Record<string, J> }> | undefined)?.[rankId];
  if (!rs) return out;
  const start = rs.start ?? {}, end = rs.end ?? {};
  for (const path of new Set([...Object.keys(start), ...Object.keys(end)])) {
    const a = start[path] ?? end[path], b = end[path] ?? start[path];
    const field = path.split('.').pop()!;
    setPath(out as Record<string, J>, path, lerpValue(a, b, t, field));
  }
  return out;
}

/** 덮어쓰기 방식(events) */
export function applyOverrideScaling(params: Record<string, J>, scaling: Record<string, Record<string, J>> | undefined, rankId: string): Record<string, J> {
  const out = deepClone(params);
  const rs = scaling?.[rankId];
  if (!rs) return out;
  for (const [k, v] of Object.entries(rs)) {
    if (k.startsWith('_')) continue;
    if (k.includes('.')) {
      const [phaseId, field] = k.split('.') as [string, string];
      const phases = out['phases'];
      if (Array.isArray(phases)) {
        const ph = phases.find((p) => typeof p === 'object' && p !== null && (p as Record<string, J>)['id'] === phaseId) as Record<string, J> | undefined;
        if (ph) ph[field] = v;
      }
    } else out[k] = v;
  }
  return out;
}

/** 직급 내 진행도 t (data-schema §7) */
export function rankProgress(day: number, dayRange: readonly [number, number | null]): number {
  const [a, b] = dayRange;
  if (b === null || b <= a) return 0;
  return Math.min(1, Math.max(0, (day - a) / (b - a)));
}
