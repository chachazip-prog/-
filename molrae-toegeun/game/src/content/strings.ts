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

/**
 * strings.ko 테이블 + v3 테이블(missions·layout)의 stringsKo(병합 대기 문구, D-082). 같은 키는 strings.ko.json이 우선.
 * 빌드에서는 vite 플러그인이 stringsKo를 strings.ko.json으로 옮기고 원래 자리에서 지우므로(용량) 이 함수는 개발·헤드리스용 보조이자 안전망이다.
 */
const mergedCache = new WeakMap<object, StringsTable>();
export function mergedStrings(tables: Readonly<Record<string, unknown>>): StringsTable {
  const base = (tables['strings.ko'] ?? { strings: {} }) as StringsTable;
  const hit = mergedCache.get(base);
  if (hit) return hit;
  const extra: Record<string, string | readonly string[]> = {};
  for (const t of ['missions', 'layout']) {
    const sk = (tables[t] as { stringsKo?: Record<string, unknown> } | undefined)?.stringsKo;
    if (sk) for (const [k, v] of Object.entries(sk)) if (!k.startsWith('_') && (typeof v === 'string' || Array.isArray(v))) extra[k] = v as string | readonly string[];
  }
  const out: StringsTable = { ...base, strings: { ...extra, ...base.strings } };
  mergedCache.set(base, out);
  return out;
}
