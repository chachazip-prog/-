/** 아주 작은 테스트 하네스 (외부 의존성 없음). */
export interface CheckResult { name: string; ok: boolean; detail: string; group: string }
export const results: CheckResult[] = [];
let group = '';
export function section(name: string): void { group = name; console.log(`\n── ${name}`); }
export function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail, group });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
}
export function info(msg: string): void { console.log(`  · ${msg}`); }
export function summary(): number {
  const fail = results.filter((r) => !r.ok);
  console.log(`\n합계: ${results.length - fail.length}/${results.length} 통과`);
  for (const f of fail) console.log(`  FAIL [${f.group}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  return fail.length;
}
