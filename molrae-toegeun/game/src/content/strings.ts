/**
 * 문자열 조회(strings.ko.json). 화면 문구는 반드시 키로 참조한다(T-132: 기획이 문구·키 수정 중).
 * - 값이 배열이면 변형 대사: variant 인덱스로 고름(표시용, 보상과 무관). 기본 0
 * - {name} {n} {total} {time} {rank} {weekday} 치환
 * - 없는 키는 키 자체를 돌려주고 개발 빌드에서 한 번 경고
 */
export interface StringsTable {
  readonly strings: Readonly<Record<string, string | readonly string[]>>;
  readonly uiIcons?: Readonly<Record<string, string>>;
}

export type Vars = Readonly<Record<string, string | number>>;

export class Strings {
  private readonly warned = new Set<string>();
  constructor(private readonly table: StringsTable | undefined, private readonly onMissing?: (key: string) => void) {}

  has(key: string): boolean { return !!this.table?.strings[key]; }

  /** 배열 변형 개수(없으면 1) */
  variants(key: string): number {
    const v = this.table?.strings[key];
    return Array.isArray(v) ? v.length : 1;
  }

  t(key: string, vars?: Vars, variant = 0): string {
    const raw = this.table?.strings[key];
    let s: string;
    if (raw === undefined) {
      if (!this.warned.has(key)) { this.warned.add(key); this.onMissing?.(key); }
      s = key;
    } else if (typeof raw === 'string') s = raw;
    else s = raw.length > 0 ? raw[((variant % raw.length) + raw.length) % raw.length]! : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m));
    return s;
  }

  icon(key: string): string | undefined { return this.table?.uiIcons?.[key]; }
}
