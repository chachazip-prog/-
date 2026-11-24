/**
 * maps.json 격자 → 아트 타일·가구 배치(표시 전용). 판정은 core/grid가 legend로 하고, 여기서는 그림만 고른다.
 * 스타일 가이드 v2.1 §4: 바닥·벽 타일 레이어 → (그림자·콘) → 오브젝트(가구 + 캐릭터, 발밑 y 정렬, 원점 (0.5, 1)).
 *
 * 규칙(legend kind 기준):
 *  - 바닥: 구역(zones.rect, 더 작은 구역 우선)별 바닥 타일. exit 구역 = floor_exit
 *  - 벽(#): 남쪽이 열려 있으면 앞면(wall_face, 창·시계 변형), 좌우 끝은 cap_l/r, 세로 내벽은 cap_v, 나머지 cap
 *  - 엘리베이터(E): 북쪽 = 메인(elev_l/m/r, 벽 앞면 변형), 남쪽 = 화물(freight_l/m/r, 벽 윗면 변형)
 *  - 가구: desk/seat/partition/plant/copier/counter/meeting_table/exec_desk/guard_booth/gate/restroom_stall → 스프라이트
 *  - 세로 유리벽(glass·유리 문): 아트 T-135 tall/glass_v_top|mid|bot|door|one(16×24, 원점 (0.5,1), y = 칸 아래 변, depth = y).
 *    door 칸 → door, 위·아래 모두 유리 → mid, 아래만 → top, 위만 → bot, 둘 다 아님 → one (art/style-guide.md §12)
 *  - T-145(아트 T-143 §13, D-080): 칸막이 P(전높이) → pfull/<mask>, i(반높이) → phalf/<mask>. mask = 같은 종류 이웃 n·e·s·w(없으면 o),
 *    P와 i는 서로 이웃으로 치지 않음(벽도 아님). legend.art(T-142)가 있는 새 문자는 그 키로 그림: '|' 후보는 칸 좌표 해시로 하나(장식, 판정 무관),
 *    footprint [2,1]은 왼쪽 칸 기준 dx 8, U+h 2×2는 cube52 한 장. tile2/* 키는 바닥 레이어. 없는 키는 has()로 걸러 기존 키로 대체.
 *  - occlude: 그 칸들에 플레이어가 서면 그림이 플레이어를 덮으므로 알파 0.5(D-080 전높이 칸막이·전높이 큐비클)
 */
import type { DayContent } from '../core/day/types';

export const TILE = 16;

export interface Placement {
  readonly frame: string;
  /** 월드 px: 원점 (0.5, 1) 기준 x(가운데)·y(아래 변) */
  readonly x: number;
  readonly y: number;
  readonly flipX?: boolean;
  /** 깊이 보정(px). 러그처럼 바닥 취급할 때 음수 */
  readonly depthBias?: number;
  /** 화장실 칸 등 상태에 따라 프레임을 바꿀 타일 */
  readonly tile?: { x: number; y: number };
  /** 플레이어가 이 칸들(타일 사각형 x, y, w, h)에 서면 알파 0.5(전높이 뒤) */
  readonly occlude?: readonly [number, number, number, number];
  /** 회의실 문(사용 중 표시 교체용) */
  readonly meetingDoor?: boolean;
}

export interface GlassPiece { readonly x: number; readonly y: number; readonly door: boolean }

export interface TileLayout {
  /** 바닥·벽 타일 프레임(행 우선) */
  readonly ground: string[];
  readonly objects: Placement[];
  readonly glass: GlassPiece[];
}

const FLOOR_BY_ZONE: Readonly<Record<string, string>> = {
  lobby: 'tile/floor_lobby',
  gate_hall: 'tile/floor_lobby',
  exec_office: 'tile/floor_wood',
  meeting_room: 'tile/floor_meet',
  restroom: 'tile/floor_rest',
  restroom_stall: 'tile/floor_rest',
  pantry: 'tile/floor_pantry',
  exit: 'tile/floor_exit',
  // T-143 구역 바닥
  lounge: 'tile2/floor_lounge',
  window: 'tile2/floor_lounge',
  printer_room: 'tile2/floor_print',
  storage: 'tile2/floor_print',
  next_team: 'tile2/floor_team2',
};

/** 칸 좌표 해시(장식 후보 선택용, 결정적) */
const hash2 = (x: number, y: number): number => (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;

/** legend.art 문자열에서 아트 키 후보만 뽑음('tall2/cabinet|tall2/cabinet_open', 'cube52/cubicle_high(위 2칸)' 등) */
export function artCandidates(art: unknown): string[] {
  if (typeof art !== 'string') return [];
  return art.split('|').map((p) => /([a-z0-9_]+\/[a-z0-9_<>]+)/.exec(p.trim())?.[1]).filter((k): k is string => !!k);
}

/** 없는 아트 키를 대체한 목록(보고·디버그) */
export const missingArt = new Set<string>();

export function buildTileLayout(c: DayContent, has: (frame: string) => boolean = () => true): TileLayout {
  const pickArt = (cands: readonly string[], x: number, y: number, fallback: string): string => {
    const ok = cands.filter((k) => has(k));
    for (const k of cands) if (!has(k)) missingArt.add(k);
    return ok.length > 0 ? ok[hash2(x, y) % ok.length]! : fallback;
  };
  const orFallback = (k: string, fb: string): string => { if (has(k)) return k; missingArt.add(k); return fb; };
  const level = c.floor.level;
  const rows = level.rows;
  const H = rows.length, W = rows[0]!.length;
  const ch = (x: number, y: number): string => (x < 0 || y < 0 || x >= W || y >= H ? '#' : rows[y]![x]!);
  const kind = (x: number, y: number): string => level.legend[ch(x, y)]?.kind ?? 'wall';
  const legendZone = (x: number, y: number): string | undefined => level.legend[ch(x, y)]?.zone;
  const zoneOf = (x: number, y: number): string | undefined => {
    const lz = legendZone(x, y);
    if (lz && FLOOR_BY_ZONE[lz]) return lz;
    let best: { id: string; area: number } | null = null;
    for (const z of c.zones) {
      const [zx, zy, zw, zh] = z.rect;
      if (x >= zx && y >= zy && x < zx + zw && y < zy + zh && (!best || zw * zh < best.area)) best = { id: z.id, area: zw * zh };
    }
    return best?.id;
  };
  const wallish = (x: number, y: number) => { const k = kind(x, y); return k === 'wall' || k === 'elevator'; };
  const spotAt = (x: number, y: number): string | undefined =>
    Object.entries(c.spots).find(([, s]) => s.tile.x === x && s.tile.y === y)?.[0];

  const ground: string[] = [];
  const objects: Placement[] = [];
  /** 코드로 그리던 유리 조각(T-135 이후 항상 빈 배열, 호환용) */
  const glass: GlassPiece[] = [];
  const isGlassy = (x: number, y: number): boolean =>
    kind(x, y) === 'glass' || (kind(x, y) === 'door' && (kind(x, y - 1) === 'glass' || kind(x, y + 1) === 'glass'));
  const bottom = (y: number) => (y + 1) * TILE;
  const cx = (x: number) => x * TILE + TILE / 2;
  let faceCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = kind(x, y);
      const z = zoneOf(x, y);
      const zf = z ? FLOOR_BY_ZONE[z] : undefined;
      const floor = (zf && has(zf) ? zf : undefined) ?? ((x * 7 + y * 13) % 5 === 0 ? 'tile/floor_b' : 'tile/floor');
      let g = floor;
      switch (k) {
        case 'wall': {
          const southOpen = y + 1 < H && !wallish(x, y + 1);
          if (y === 0) g = 'tile/wall_cap';
          else if (southOpen) {
            faceCount++;
            const inOffice = !(zoneOf(x, y + 1) === 'lobby');
            g = inOffice && faceCount % 5 === 2 ? 'tile/wall_window' : faceCount % 11 === 7 ? 'tile/wall_clock' : 'tile/wall_face';
          } else if (x === 0) g = 'tile/wall_cap_l';
          else if (x === W - 1) g = 'tile/wall_cap_r';
          else if ((wallish(x, y - 1) || wallish(x, y + 1)) && !wallish(x - 1, y) && !wallish(x + 1, y)) g = 'tile/wall_cap_v';
          else g = 'tile/wall_cap';
          break;
        }
        case 'elevator': {
          let i = 0;
          while (kind(x - i - 1, y) === 'elevator') i++;
          let n = i + 1;
          while (kind(x - i + n, y) === 'elevator') n++;
          const part = i === 0 ? 'l' : i === n - 1 ? 'r' : 'm';
          g = y < H / 2 ? `tile/elev_${part}` : `tile/freight_${part}`;
          break;
        }
        case 'door_busy': g = orFallback('tile2/wall_door_busy', 'tile/wall_face'); break;
        case 'stairs_deco': g = pickArt([x < W / 2 ? 'tile2/floor_stairs_l' : 'tile2/floor_stairs_r'], x, y, floor); break;
        case 'door':
          // 이음 행의 문(좌우가 벽) = 열린 문 그림
          g = wallish(x - 1, y) && wallish(x + 1, y) && !isGlassy(x, y) ? orFallback('tile2/wall_door_free', floor) : floor;
          break;
        default: {
          g = floor;
          // 바닥형 새 문자(w 창가 등): legend.art의 tile2/* 첫 키
          const t2 = artCandidates((level.legend[ch(x, y)] as { art?: unknown } | undefined)?.art).find((k) => k.startsWith('tile2/'));
          if (t2 && level.legend[ch(x, y)]?.walkable) g = orFallback(t2, floor);
        }
      }
      // 바닥 대기 표시(스팟 floorMark, 프린터 앞 팀장 대기 칸)
      const sp = spotAt(x, y);
      if (sp && (c.spots[sp] as { floorMark?: boolean }).floorMark === true && k !== 'wall') g = orFallback('tile2/floor_print_mark', g);
      // 화물 엘리베이터 앞 발판
      if (k !== 'wall' && k !== 'elevator' && y + 1 < H && kind(x, y + 1) === 'elevator' && y > H / 2) g = 'tile/floor_freight';
      ground.push(g);

      // ── 오브젝트 ──
      switch (k) {
        case 'desk': {
          const south = spotAt(x, y + 1);
          const frame = south === 'tl_seat' || south === 'tl2_seat' ? 'furn/desk_boss' : (x + y) % 3 === 0 ? 'furn/desk_papers' : 'furn/desk_monitor';
          objects.push({ frame, x: cx(x), y: bottom(y) });
          break;
        }
        case 'seat': {
          const s = spotAt(x, y);
          const frame = s === 'tl_seat' || s === 'tl2_seat' ? 'furn/chair_high' : s === 'exec_seat' ? 'furn/chair_exec' : s === 'nap_chair' ? 'furn/chair_s' : 'furn/chair';
          objects.push({ frame, x: cx(x), y: bottom(y) });
          break;
        }
        case 'partition': case 'partition_full': case 'partition_half': {
          // D-080: P = 전높이(pfull, 시선 차단), i = 반높이(phalf). 같은 종류만 이웃
          const full = k !== 'partition_half';
          const same = (xx: number, yy: number) => { const kk = kind(xx, yy); return full ? kk === 'partition' || kk === 'partition_full' : kk === 'partition_half'; };
          const mask = `${same(x, y - 1) ? 'n' : ''}${same(x + 1, y) ? 'e' : ''}${same(x, y + 1) ? 's' : ''}${same(x - 1, y) ? 'w' : ''}` || 'o';
          const key = `${full ? 'pfull' : 'phalf'}/${mask}`;
          let frame = key;
          if (!has(key)) {
            missingArt.add(key);
            const up = same(x, y - 1), down = same(x, y + 1), left = same(x - 1, y), right = same(x + 1, y);
            frame = 'furn/partition_v';
            if (up || down) frame = !up ? 'furn/partition_v_top' : down ? 'furn/partition_v_mid' : 'furn/partition_v';
            else if (left || right) frame = !left ? 'furn/partition_l' : !right ? 'furn/partition_r' : 'furn/partition_h';
          }
          objects.push({ frame, x: cx(x), y: bottom(y), ...(full && frame.startsWith('pfull/') ? { occlude: [x, y - 1, 1, 1] as const } : {}) });
          break;
        }
        case 'cubicle_high': case 'cubicle_low': {
          // 위 2칸(UU/uu) + 아래 2칸 좌석 = 2×2 한 장. 왼쪽 위 칸에서 한 번
          let i = 0;
          while (kind(x - i - 1, y) === k) i++;
          if (i % 2 !== 0) break;
          const fr = k === 'cubicle_high' ? orFallback('cube52/cubicle_high', 'furn/partition_h') : orFallback('isle32/cubicle_low', 'furn/partition_h');
          objects.push({ frame: fr, x: x * TILE + TILE, y: bottom(y + 1), ...(k === 'cubicle_high' ? { occlude: [x, y - 2, 2, 2] as const } : {}) });
          break;
        }
        case 'plant': objects.push({ frame: 'tall/plant', x: cx(x), y: bottom(y) }); break;
        case 'copier': objects.push({ frame: 'tall/copier', x: cx(x), y: bottom(y) }); break;
        case 'counter': {
          const south = spotAt(x, y + 1);
          const frame = south === 'coffee_use' ? 'tall/coffee' : kind(x + 1, y) === 'counter' && kind(x - 1, y) !== 'counter' && y < H - 3 ? 'tall/water'
            : (x + y) % 2 === 0 ? 'furn/counter_snack' : 'furn/counter_micro';
          objects.push({ frame, x: cx(x), y: bottom(y) });
          break;
        }
        case 'meeting_table':
          // 2×2 블록의 오른쪽 아래 칸에서 한 번(48×32, 블록 가운데 정렬)
          if (kind(x + 1, y) !== 'meeting_table' && kind(x, y + 1) !== 'meeting_table') objects.push({ frame: 'big32/meet_table', x: x * TILE, y: bottom(y) });
          break;
        case 'exec_desk': objects.push({ frame: 'wide/exec_desk', x: cx(x), y: bottom(y) }); break;
        case 'guard_booth':
          if (kind(x - 1, y) !== 'guard_booth') objects.push({ frame: 'booth/guard', x: x * TILE + TILE, y: bottom(y) });
          break;
        case 'gate': {
          let i = 0;
          while (kind(x - i - 1, y) === 'gate') i++;
          objects.push({ frame: i % 2 === 0 ? 'furn/gate_l' : 'furn/gate_r', x: cx(x), y: bottom(y), tile: { x, y } });
          break;
        }
        case 'restroom_stall':
          objects.push({ frame: 'tall/stall', x: cx(x), y: bottom(y) + 1, tile: { x, y } });
          break;
        case 'glass': {
          const up = isGlassy(x, y - 1), down = isGlassy(x, y + 1);
          const frame = up && down ? 'tall/glass_v_mid' : down ? 'tall/glass_v_top' : up ? 'tall/glass_v_bot' : 'tall/glass_v_one';
          objects.push({ frame, x: cx(x), y: bottom(y) });
          break;
        }
        case 'door':
          if (kind(x, y - 1) === 'glass' || kind(x, y + 1) === 'glass') objects.push({ frame: 'tall/glass_v_door', x: cx(x), y: bottom(y), meetingDoor: (spotAt(x, y) ?? '').startsWith('meeting_door') });
          break;
        default: {
          // legend.art가 있는 새 구조물(T-142 legendAdd): 기둥·캐비닛·막힘·상자·복합기·택배함·자판기·카페·소파 등
          const e = level.legend[ch(x, y)] as (typeof level.legend)[string] & { art?: unknown; footprint?: unknown } | undefined;
          const cands = artCandidates(e?.art).filter((a) => !a.startsWith('tile2/'));
          if (!e || e.walkable || cands.length === 0) break;
          const fp = Array.isArray(e.footprint) ? Number(e.footprint[0]) : 1;
          if (fp >= 2) {
            let i = 0;
            while (ch(x - i - 1, y) === ch(x, y)) i++;
            if (i % fp !== 0) break;
            objects.push({ frame: pickArt(cands, x, y, 'tall/copier'), x: x * TILE + (fp * TILE) / 2, y: bottom(y) });
          } else objects.push({ frame: pickArt(cands, x, y, e.blocksSight ? 'tall/plant' : 'furn/counter_snack'), x: cx(x), y: bottom(y) });
          break;
        }
      }
    }
  }
  return { ground, objects, glass };
}
