import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * T-140: ?url로 내보내는 JSON 에셋(아트 산출물 sheet.json·anims.json)은 들여쓰기된 원본 그대로 복사되어
 * 약 55KB가 공백이었다. 원본(game/assets, 아트 소유)은 건드리지 않고 빌드 산출물에서만 공백을 없앤다(내용 동일).
 */
function minifyJsonAssets(): Plugin {
  return {
    name: 'mt-minify-json-assets',
    apply: 'build',
    generateBundle(_opts, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'asset' || !out.fileName.endsWith('.json')) continue;
        const src = typeof out.source === 'string' ? out.source : new TextDecoder().decode(out.source);
        out.source = JSON.stringify(JSON.parse(src));
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
