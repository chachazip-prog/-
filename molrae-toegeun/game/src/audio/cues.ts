/**
 * 사운드 연결 표(데이터 → 효과음 키). 순수 함수 — 테이블은 data/loader 또는 QA가 넘긴다.
 * - 앉은 상사 전조: bosses[].tell.sfx (선배 '음…', 팀장 의자 삐걱)
 * - 걷는 사람 전조: sim.walkTellSfx{lookAround·glanceBack·cornerTurn·stopLook}, 없으면 rules.tell.defaultWalkTellSfx (화면 안일 때만, onScreenOnly)
 * - 페이크(헛기침)·대표님 재확인: sim.fake.sfx
 * - 방해 등장·말걸기 전조: interrupts[].tell.sfx
 */
type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export interface SoundCues {
  seatedTell: Readonly<Record<string, string>>;
  walkTell: Readonly<Record<string, Readonly<Record<string, string>>>>;
  walkTellOnScreenOnly: Readonly<Record<string, boolean>>;
  fake: Readonly<Record<string, string>>;
  interrupt: Readonly<Record<string, string>>;
  defaultWalkTell: string | undefined;
  cornerTurnTell: string | undefined;
}

export function buildSoundCues(tables: Readonly<Record<string, unknown>>): SoundCues {
  const seatedTell: Record<string, string> = {}, fake: Record<string, string> = {}, interrupt: Record<string, string> = {};
  const walkTell: Record<string, Record<string, string>> = {}, onlyOn: Record<string, boolean> = {};
  const actors = [...arr(obj(tables['bosses'])['bosses']), ...arr(obj(tables['npcs'])['npcs'])].map(obj);
  for (const a of actors) {
    const id = str(a['id']); if (!id) continue;
    const sim = obj(a['sim']);
    const t = str(obj(a['tell'])['sfx']); if (t) seatedTell[id] = t;
    const f = str(obj(sim['fake'])['sfx']); if (f) fake[id] = f;
    const w = obj(sim['walkTellSfx']);
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(w)) if (typeof v === 'string') m[k] = v;
    if (Object.keys(m).length > 0) walkTell[id] = m;
    onlyOn[id] = w['onScreenOnly'] !== false;
  }
  for (const i of arr(obj(tables['interrupts'])['interrupts']).map(obj)) {
    const id = str(i['id']), s = str(obj(i['tell'])['sfx']);
    if (id && s) interrupt[id] = s;
  }
  const rules = obj(tables['rules']);
  return {
    seatedTell, walkTell, walkTellOnScreenOnly: onlyOn, fake, interrupt,
    defaultWalkTell: str(obj(rules['tell'])['defaultWalkTellSfx']), cornerTurnTell: str(obj(rules['sight'])['cornerTurnTellSfx']),
  };
}

/** 전조 시작 효과음. kind: 'turn'(모퉁이) | 'look'(둘러보기·뒤돌아보기) */
export function tellSfxFor(c: SoundCues, actorId: string, seated: boolean, kind: 'turn' | 'look', isRecheck: boolean): string | undefined {
  if (isRecheck && c.fake[actorId]) return c.fake[actorId];
  if (seated) return c.seatedTell[actorId];
  const w = c.walkTell[actorId];
  if (kind === 'turn') return w?.['cornerTurn'] ?? c.cornerTurnTell ?? c.defaultWalkTell;
  return w?.['stopLook'] ?? w?.['lookAround'] ?? c.defaultWalkTell;
}
