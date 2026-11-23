/**
 * maps.json 격자 → 아트 타일·가구 배치(표시 전용). 판정은 core/grid가 legend로 하고, 여기서는 그림만 고른다.
 * 스타일 가이드 v2.1 §4: 바닥·벽 타일 레이어 → (그림자·콘) → 오브젝트(가구 + 캐릭터, 발밑 y 정렬, 원점 (0.5, 1)).
 *
 * 규칙(legend kind 기준):
 *  - 바닥: 구역(zones.rect, 더 작은 구역 우선)별 바닥 타일. exit 구역 = floor_exit
 *  - 벽(#): 남쪽이 열려 있으면 앞면(wall_face, 창·시계 변형), 좌우 끝은 cap_l/r, 세로 내벽은 cap_v, 나머지 cap
 *  - 엘리베이터(E): 북쪽 = 메인(elev_l/m/r, 벽 앞면 변형), 남쪽 = 화물(freight_l/m/r, 벽 윗면 변형)
 *  - 가구: desk/seat/partition/plant/copier/counter/meeting_table/exec_desk/guard_booth/gate/restroom_stall → 스프라이트
 *  - 유리벽(glass): 세로 유리 스프라이트가 없어 코드로 그림(아트 요청 목록)
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
};

export function buildTileLayout(c: DayContent): TileLayout {
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
  const glass: GlassPiece[] = [];
  const bottom = (y: number) => (y + 1) * TILE;
  const cx = (x: number) => x * TILE + TILE / 2;
  let faceCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = kind(x, y);
      const z = zoneOf(x, y);
      const floor = (z && FLOOR_BY_ZONE[z]) ?? ((x * 7 + y * 13) % 5 === 0 ? 'tile/floor_b' : 'tile/floor');
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
        default:
          g = floor;
      }
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
        case 'partition': {
          const up = kind(x, y - 1) === 'partition', down = kind(x, y + 1) === 'partition';
          const left = kind(x - 1, y) === 'partition', right = kind(x + 1, y) === 'partition';
          let frame = 'furn/partition_v';
          if (up || down) frame = !up ? 'furn/partition_v_top' : down ? 'furn/partition_v_mid' : 'furn/partition_v';
          else if (left || right) frame = !left ? 'furn/partition_l' : !right ? 'furn/partition_r' : 'furn/partition_h';
          objects.push({ frame, x: cx(x), y: bottom(y) });
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
          if (kind(x + 1, y) !== 'meeting_table' && kind(x, y + 1) !== 'meeting_table') objects.push({ frame: 'big/meet_table', x: x * TILE, y: bottom(y) });
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
        case 'glass':
          glass.push({ x, y, door: false });
          break;
        case 'door':
          if (kind(x, y - 1) === 'glass' || kind(x, y + 1) === 'glass') glass.push({ x, y, door: true });
          break;
        default:
          break;
      }
    }
  }
  return { ground, objects, glass };
}
