import { defineConfig } from 'vite';

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
  server: { port: 5173 },
});
