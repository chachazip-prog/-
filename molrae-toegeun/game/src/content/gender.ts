/**
 * 성별 다양화(T-151, D-087·D-088·D-093·D-095·D-103) 순수 모듈. Phaser·Vite 무관(QA 헤드리스 재사용).
 *
 * 대칭 원칙(design/gender-design.md §0): 판정은 '플레이어 기준 관계'(same/other, mine/other)만 쓴다.
 *  - castRelation(): 회전 인물·시설 슬롯의 같은/다른 성별을 일차 시드(relation_block2)로 정한다. 플레이어 성별을 입력으로 받지 않는다
 *  - playerVariant는 그림(스킨·문 표지)에만 쓴다(renderSkins). DayContent의 판정 필드는 variant와 무관
 *
 * 'cast-{block}-{slot}' 시드의 해시 = FNV-1a 32비트(fnv1a32, T-157 확정). 기준: rules.characters.casting.rotation.hash
 * (offsetBasis 0x811c9dc5, prime 0x01000193, ASCII 바이트, 블록 첫날 same = hash % 2 == 0). testVectors는 smoke-core에서 대조한다.
 */

import type { RenderSkins } from '../core/day/types';
export type { RenderSkins };

type O = Record<string, unknown>;
const obj = (v: unknown): O => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as O : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
export type Tables = Readonly<Record<string, unknown>>;

export type PlayerVariant = 'm' | 'f';
export type Relation = 'same' | 'other';
export type Side = 'a' | 'b';

export const isPlayerVariant = (v: unknown): v is PlayerVariant => v === 'm' || v === 'f';
export const oppositeVariant = (v: PlayerVariant): PlayerVariant => (v === 'm' ? 'f' : 'm');

/** FNV-1a 32비트(정수 연산만, 기기 간 동일) */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

interface RotationRule { readonly blockDays: number; readonly seedFormat: string }

function rotationRule(tables: Tables): RotationRule {
  const r = obj(obj(obj(obj(tables['rules'])['characters'])['casting'])['rotation']);
  return { blockDays: Math.max(1, Math.floor(num(r['blockDays'], 2))), seedFormat: str(r['seedFormat'], 'cast-{block}-{slot}') };
}

/**
 * relation_block2: 블록 = floor((day − 1) / blockDays), 시드 cast-{block}-{slot}의 해시 % 2 == 0이면 블록 첫날이 same.
 * 2일 블록 안에서 하루 same, 하루 other(blockDays가 2가 아니면 첫날만 해시, 나머지는 번갈아)
 */
export function castRelation(tables: Tables, day: number, slot: string): Relation {
  const R = rotationRule(tables);
  const d = Math.max(1, Math.floor(day));
  const block = Math.floor((d - 1) / R.blockDays);
  const offset = (d - 1) % R.blockDays;
  const seed = R.seedFormat.replace('{block}', String(block)).replace('{slot}', slot);
  const firstSame = fnv1a32(seed) % 2 === 0;
  const same = offset % 2 === 0 ? firstSame : !firstSame;
  return same ? 'same' : 'other';
}

export function variantFor(rel: Relation, pv: PlayerVariant): PlayerVariant { return rel === 'same' ? pv : oppositeVariant(pv); }

// ── 성별 시설 설정(layout.genderFacilities) ─────────────────

export interface GenderFacilityConfig {
  readonly enabled: boolean;
  readonly fromDay: number;
  readonly groupReplace: Readonly<Record<string, string>>;
  readonly fitness: { readonly group: string; readonly minRank: string; readonly above: boolean; readonly below: boolean } | null;
  readonly mineSlot: string;
  readonly mineMap: Readonly<Record<Relation, Side>>;
  readonly authoredOrderSide: Side | null;
  readonly lockerSlot: string;
  readonly otherDoorHintKey: string;
  readonly talkCancelAtMineDoor: boolean;
  readonly talkCancelLineKey: string;
  /** access.talkCancelNpcHold.minSec(T-157) */
  readonly talkCancelNpcHoldMinSec: number;
  readonly hintKeys: Readonly<Record<Side, string>>;
  readonly v15MaxDiff: number;
  readonly raw: O;
}

const sideOf = (v: unknown, d: Side): Side => (v === 'a' || v === 'b' ? v : d);

export function genderFacilityConfig(tables: Tables, enabledOverride?: boolean): GenderFacilityConfig {
  const g = obj(obj(tables['layout'])['genderFacilities']);
  const ms = obj(g['mineSide']);
  const map = obj(ms['map']);
  const fm = obj(g['fitnessModule']);
  const acc = obj(g['access']);
  const lf = str(ms['lockerFollows']);
  const c1 = arr(g['cases']).map(obj).find((c) => c['id'] === 'C1_route_mine');
  const hk = obj(c1?.['hintKeys']);
  const v15 = arr(g['validators']).map(obj).find((v) => v['id'] === 'V15_facility_symmetry');
  const place = arr(fm['allowedPlacement']).map((x) => str(x));
  const ord = obj(ms['orderPolicyOverride'])['authored_order'];
  return {
    enabled: enabledOverride ?? g['enabled'] === true,
    fromDay: num(g['fromDay'], 3),
    groupReplace: Object.fromEntries(Object.entries(obj(g['groupReplace'])).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    fitness: fm['group'] ? { group: str(fm['group']), minRank: str(fm['minRank'], 'manager'), above: place.includes('above_team'), below: place.includes('below_team') } : null,
    mineSlot: str(ms['slot'], 'restroom_side'),
    mineMap: { same: sideOf(map['same'], 'a'), other: sideOf(map['other'], 'b') },
    authoredOrderSide: ord === 'a' || ord === 'b' ? ord : null,
    lockerSlot: lf.startsWith('independent_slot:') ? lf.slice('independent_slot:'.length) : 'locker_side',
    otherDoorHintKey: str(acc['otherDoorTapHintKey'], 'hint.restroom.not_mine'),
    talkCancelAtMineDoor: acc['talkCancelAtMineDoor'] === true,
    talkCancelLineKey: str(acc['talkCancelLineKey'], 'int.talk.cancel_at_door'),
    talkCancelNpcHoldMinSec: typeof obj(acc['talkCancelNpcHold'])['minSec'] === 'number' ? obj(acc['talkCancelNpcHold'])['minSec'] as number : 0,
    hintKeys: { a: str(hk['a'], 'hint.restroom.mine_a'), b: str(hk['b'], 'hint.restroom.mine_b') },
    v15MaxDiff: num(v15?.['maxOneWayDiffTiles'], 4),
    raw: g,
  };
}

/** 그날 생성기·시설 판정에 넘기는 값(플레이어 성별 없음) */
export interface GenderDayCtx {
  readonly groupReplace: Readonly<Record<string, string>>;
  /** 과장~: fitness 그룹을 선택 모듈 풀에 */
  readonly fitnessGroup: string | null;
  readonly fitnessBelow: boolean;
  readonly mine: Side;
  readonly lockerMine: Side;
  readonly v15MaxDiff: number;
  /** 생성 시드 버전 태그 접미사(D-085: 성별 시설 규칙이 바뀌면 시드에 드러남) */
  readonly tag: string;
}

const RANK_ORDER = ['intern', 'staff', 'assistant_manager', 'manager', 'deputy_general_manager', 'general_manager', 'executive'];
function rankOrder(tables: Tables, id: string): number {
  const r = arr(obj(tables['ranks'])['ranks']).map(obj).find((x) => x['id'] === id);
  return r ? num(r['order'], RANK_ORDER.indexOf(id) + 1) : RANK_ORDER.indexOf(id) + 1;
}

/** 그날 성별 시설이 켜지는가 + 내 쪽 결정. authoredOrder = 그날 직급이 수작업 순서(인턴 3~5일차) */
export function genderDayCtx(tables: Tables, cfg: GenderFacilityConfig, day: number, rankId: string, authoredOrder: boolean): GenderDayCtx | null {
  if (!cfg.enabled || day < cfg.fromDay) return null;
  const mine = authoredOrder && cfg.authoredOrderSide ? cfg.authoredOrderSide : cfg.mineMap[castRelation(tables, day, cfg.mineSlot)];
  const lockerMine = cfg.mineMap[castRelation(tables, day, cfg.lockerSlot)];
  const fit = cfg.fitness && rankOrder(tables, rankId) >= rankOrder(tables, cfg.fitness.minRank) ? cfg.fitness : null;
  return {
    groupReplace: cfg.groupReplace, fitnessGroup: fit?.group ?? null, fitnessBelow: fit?.below === true, mine, lockerMine,
    v15MaxDiff: cfg.v15MaxDiff, tag: `gf${fnv1a32(JSON.stringify({ r: cfg.groupReplace, f: cfg.fitness, m: cfg.mineMap })).toString(16).padStart(8, '0')}`,
  };
}

// ── 캐스팅(그림) ───────────────────────────────────────

/** 인물 슬롯별 캐스팅: 고정 = 변형 id(그림용), 회전 = relation(판정·그림) */
export type CastEntry = { readonly mode: 'fixed'; readonly variant: PlayerVariant | null } | { readonly mode: 'rotate'; readonly relation: Relation };

interface SkinSource { readonly base: string; readonly variants: Readonly<Partial<Record<PlayerVariant, string>>>; readonly casting: O }

function skinSource(a: O, baseKey: string): SkinSource {
  const vs: Partial<Record<PlayerVariant, string>> = {};
  for (const v of arr(a['variants']).map(obj)) if (isPlayerVariant(v['id']) && typeof v['spriteKey'] === 'string') vs[v['id']] = v['spriteKey'] as string;
  return { base: baseKey, variants: vs, casting: obj(a['casting']) };
}

function castOf(tables: Tables, day: number, slot: string, c: O, instance: number): CastEntry {
  if (c['mode'] === 'rotate') return { mode: 'rotate', relation: castRelation(tables, day, slot) };
  const bi = obj(c['byInstance'])[String(instance)];
  const v = isPlayerVariant(bi) ? bi : isPlayerVariant(c['variant']) ? c['variant'] : null;
  return { mode: 'fixed', variant: v };
}

/** 그날 인물 슬롯 캐스팅(판정에 쓰는 것은 rotate의 relation뿐). 키: actorId, actorId#instance, background:<id>, buddy */
export function dayCasting(tables: Tables, day: number): Record<string, CastEntry> {
  const out: Record<string, CastEntry> = {};
  for (const a of [...arr(obj(tables['bosses'])['bosses']), ...arr(obj(tables['npcs'])['npcs'])].map(obj)) {
    const id = str(a['id']);
    const c = obj(a['casting']);
    out[id] = castOf(tables, day, id, c, 1);
    if (obj(c['byInstance'])['2'] !== undefined) out[`${id}#2`] = castOf(tables, day, id, c, 2);
  }
  for (const b of arr(obj(tables['npcs'])['background']).map(obj)) out[`background:${str(b['id'])}`] = castOf(tables, day, str(b['id']), obj(b['casting']), 1);
  const buddy = obj(obj(tables['npcs'])['buddy']);
  if (buddy['id']) out['buddy'] = castOf(tables, day, str(buddy['id'], 'buddy'), obj(buddy['casting']), 1);
  return out;
}

/** 그림 해석(D-103): 데이터 variants[].spriteKey 우선, 없으면 `<역할>_<m|f>` */
function skinKey(src: SkinSource, v: PlayerVariant | null): string {
  if (!v) return src.base;
  return src.variants[v] ?? `${src.base}_${v}`;
}


/**
 * 그림만 정하는 함수(판정 무관). 플레이어 성별은 여기에서만 쓴다.
 * actorBase: actorId → 기본 스프라이트 키(데이터 spriteKey)
 */
export function renderSkins(tables: Tables, day: number, pv: PlayerVariant | null): RenderSkins {
  const rules = obj(obj(tables['rules'])['characters']);
  const sel = obj(rules['playerSelection']);
  const fb = str(sel['fallbackSprite'], str(rules['playerSpriteKey'], 'player'));
  const pvs = arr(rules['playerVariants']).map(obj);
  const player = pv ? str(pvs.find((x) => x['id'] === pv)?.['spriteKey'], `player_${pv}`) : fb;
  const cast = dayCasting(tables, day);
  const resolve = (src: SkinSource, e: CastEntry | undefined): string => {
    if (!e) return src.base;
    if (e.mode === 'fixed') return skinKey(src, e.variant);
    return pv ? skinKey(src, variantFor(e.relation, pv)) : src.base;
  };
  const byActor: Record<string, string> = {}, byPatrol: Record<string, string> = {}, background: Record<string, string> = {};
  const actors = [...arr(obj(tables['bosses'])['bosses']), ...arr(obj(tables['npcs'])['npcs'])].map(obj);
  for (const a of actors) {
    const id = str(a['id']);
    const src = skinSource(a, str(a['spriteKey'], id));
    byActor[id] = resolve(src, cast[id]);
    if (cast[`${id}#2`]) {
      const k2 = resolve(src, cast[`${id}#2`]);
      for (const p of arr(obj(tables['patrols'])['patrols']).map(obj)) if (p['actorId'] === id && num(p['instance'], 1) === 2) byPatrol[str(p['id'])] = k2;
    }
  }
  for (const b of arr(obj(tables['npcs'])['background']).map(obj)) {
    const id = str(b['id']);
    background[id] = resolve(skinSource(b, str(b['sprite'], 'bg_a')), cast[`background:${id}`]);
  }
  const bd = obj(obj(tables['npcs'])['buddy']);
  const buddy = bd['id'] ? resolve(skinSource(bd, str(bd['sprite'], 'bg_buddy')), cast['buddy']) : undefined;
  const g = pv ?? 'm';
  return {
    player, playerFallback: fb, byActor, byPatrol, background, ...(buddy ? { buddy } : {}),
    // [추측] 선택 전(pv 없음, 헤드리스·폴백)은 m 표지. 실제 게임은 선택 화면을 거쳐야 판이 시작됨
    doorSign: { mine: `tile2/wall_door_restroom_${g}_mine`, other: `tile2/wall_door_restroom_${oppositeVariant(g)}_other` },
    mark: { same: 'mark/gender_same', other: 'mark/gender_other' },
  };
}

// ── 공유 카드 가드(T-152 §5-1, D-091·D-095) ─────────────────

/**
 * 공유 카드 트리거 후보에서 뺄 이벤트(events[].shareCard.trigger false + copyRules.shareCard.excludeEventIds).
 * 공유 카드 생성기는 아직 없음 — 생성기가 생기면 이 함수와 sanitizeShareText를 반드시 거치게 한다
 */
export function shareExcludedEventIds(tables: Tables): Set<string> {
  const out = new Set<string>();
  for (const e of arr(obj(tables['events'])['events']).map(obj)) if (obj(e['shareCard'])['trigger'] === false) out.add(str(e['id']));
  for (const id of arr(obj(obj(obj(tables['strings.ko'])['copyRules'])['shareCard'])['excludeEventIds'])) out.add(str(id));
  return out;
}

/** 공유 텍스트 검사: 성별 변수·성별 라벨·시설 대사 인용이 있으면 null(보내지 않음) */
export function sanitizeShareText(tables: Tables, text: string, quotedKeys: readonly string[] = []): string | null {
  const sc = obj(obj(obj(tables['strings.ko'])['copyRules'])['shareCard']);
  const strings = obj(obj(tables['strings.ko'])['strings']);
  for (const v of arr(sc['forbiddenVars'])) if (text.includes(str(v))) return null;
  for (const k of arr(sc['forbiddenLabelKeys'])) { const s = strings[str(k)]; if (typeof s === 'string' && s && text.includes(s)) return null; }
  const pre = arr(sc['excludeReactionKeyPrefixes']).map((x) => str(x));
  if (quotedKeys.some((k) => pre.some((p) => k.startsWith(p)))) return null;
  return text;
}
