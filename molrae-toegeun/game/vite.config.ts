import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// art/palette.json(아트 소유, 읽기 전용)을 import하므로 개발 서버가 game/ 밖 한 단계 위 폴더를 읽을 수 있게 함
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

// 앱인토스 WebView는 번들을 상대 경로로 서빙하므로 base는 './'.
// (추측: 공식 문서 미확인. ait build는 webBundleDir(dist)를 그대로 패킹함 — CLI 3.10.0 소스로 확인)
export default defineConfig({
  base: './',
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
