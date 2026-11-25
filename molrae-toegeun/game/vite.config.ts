import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { V3_PROSE_KEYS, V3_PROSE_TABLES } from './src/content/layoutGen/proseKeys';

/**
 * T-140: ?url로 내보내는 JSON 에셋(아트 산출물 sheet.json·anims.json)은 들여쓰기된 원본 그대로 복사되어
 * 약 55KB가 공백이었다. 원본(game/assets, 아트 소유)은 건드리지 않고 빌드 산출물에서만 공백을 없앤다(내용 동일).
 */
/** 아틀라스 텍스처 키(src/render/sprites.ts ATLAS_KEY와 같아야 함) */
const ATLAS_KEY_BUILD = 'sprites';

function minifyJsonAssets(): Plugin {
  return {
    name: 'mt-minify-json-assets',
    apply: 'build',
    generateBundle(_opts, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'asset' || !out.fileName.endsWith('.json')) continue;
        const src = typeof out.source === 'string' ? out.source : new TextDecoder().decode(out.source);
        const json = JSON.parse(src) as { frames?: unknown; meta?: unknown };
        // T-145: 텍스처 아틀라스(JSON Hash)의 자르지 않은 프레임은 Phaser JSONHash 파서가 frame·anchor만 읽는다
        // (trimmed가 false면 sourceSize·spriteSourceSize 미사용, rotated false 기본) → 빌드 산출물에서만 뺌. 원본은 그대로
        if (json.meta && json.frames && typeof json.frames === 'object' && !Array.isArray(json.frames)) {
          for (const f of Object.values(json.frames as Record<string, Record<string, unknown>>)) {
            if (f['trimmed'] === false) { delete f['trimmed']; delete f['sourceSize']; delete f['spriteSourceSize']; }
            if (f['rotated'] === false) delete f['rotated'];
          }
        }
        // T-151(D-102 한도 유지): 애니메이션 JSON에서 Phaser 3.90 기본값과 같은 필드·아틀라스 키 반복을 뺀다(원본 그대로, 빌드 산출물만).
        // 빠진 아틀라스 키는 BootScene이 defaultTextureKey = ATLAS_KEY로 되돌린다. 프레임 순서·이름·frameRate·repeat는 그대로
        const an = (json as { anims?: unknown }).anims;
        if (Array.isArray(an)) {
          const DEF: Record<string, unknown> = { delay: 0, repeatDelay: 0, yoyo: false, showOnStart: false, hideOnComplete: false, skipMissedFrames: true, type: 'frame' };
          for (const a of an as Record<string, unknown>[]) {
            for (const [k, v] of Object.entries(DEF)) if (a[k] === v) delete a[k];
            if (a['defaultTextureKey'] === ATLAS_KEY_BUILD) delete a['defaultTextureKey'];
            if (Array.isArray(a['frames'])) for (const f of a['frames'] as Record<string, unknown>[]) {
              if (f['duration'] === 0) delete f['duration'];
              if (f['key'] === ATLAS_KEY_BUILD) delete f['key'];
            }
          }
        }
        out.source = JSON.stringify(json);
      }
    },
  };
}

// art/palette.json(아트 소유, 읽기 전용)을 import하므로 개발 서버가 game/ 밖 한 단계 위 폴더를 읽을 수 있게 함
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url)).replace(/\\/g, '/');

// 앱인토스 WebView는 번들을 상대 경로로 서빙하므로 base는 './'.
// (추측: 공식 문서 미확인. ait build는 webBundleDir(dist)를 그대로 패킹함 — CLI 3.10.0 소스로 확인)
/**
 * T-140: game/data/*.json의 사람용 메모 키(`_`로 시작: _designNote·_comment·_deprecated 등, data-schema §0 '런타임은 무시')를
 * 번들에서 뺀다(약 37KB). 원본 데이터(기획 소유)는 그대로이고, 런타임은 원래 이 키들을 읽지 않는다.
 * 개발 서버에도 같이 적용해 개발·빌드 동작을 같게 둔다.
 */
function stripDataMemos(): Plugin {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!k.startsWith('_')) o[k] = strip(x);
      return o;
    }
    return v;
  };
  /**
   * T-145(D-082): v3 테이블(missions·layout)의 stringsKo(strings.ko.json 병합 대기 문구)는 strings.ko.json으로 옮기고(같은 키는 strings.ko 우선)
   * 원래 테이블에서는 지운다. 기획 원본 파일은 그대로다.
   */
  const STRINGS_SOURCES = ['missions.json', 'layout.json'];
  /** v3 테이블의 설명 문장 키(런타임 미사용) 제거: 모든 깊이 */
  const stripKeys = (v: unknown, keys: readonly string[]): void => {
    if (Array.isArray(v)) { for (const x of v) stripKeys(x, keys); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (keys.includes(k)) delete (v as Record<string, unknown>)[k]; else stripKeys((v as Record<string, unknown>)[k], keys); }
  };
  const pendingStrings = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of STRINGS_SOURCES) {
      try {
        const sk = (JSON.parse(readFileSync(DATA_DIR + f, 'utf8')) as { stringsKo?: Record<string, unknown> }).stringsKo ?? {};
        for (const [k, v] of Object.entries(sk)) if (!k.startsWith('_')) out[k] = v;
      } catch { /* 파일 없음 */ }
    }
    return out;
  };
  return {
    name: 'mt-strip-data-memos',
    enforce: 'pre',
    transform(code, id) {
      const file = (id.split('?')[0] ?? '').replace(/\\/g, '/');
      if (!file.startsWith(DATA_DIR) || !file.endsWith('.json')) return null;
      const name = file.slice(DATA_DIR.length);
      const data = strip(JSON.parse(code)) as Record<string, unknown>;
      if (V3_PROSE_TABLES.includes(name)) stripKeys(data, V3_PROSE_KEYS);
      if (STRINGS_SOURCES.includes(name)) delete data['stringsKo'];
      if (name === 'strings.ko.json') {
        const base = (data['strings'] ?? {}) as Record<string, unknown>;
        data['strings'] = { ...pendingStrings(), ...base };
        for (const f of STRINGS_SOURCES) this.addWatchFile(DATA_DIR + f);
      }
      return { code: JSON.stringify(data), map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [stripDataMemos(), minifyJsonAssets()],
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Phaser를 별도 청크로 분리해 게임 코드 변경 시 캐시 재사용
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  server: { port: 5173, fs: { allow: [PROJECT_ROOT] } },
});
