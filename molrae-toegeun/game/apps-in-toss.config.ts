import { defineConfig } from '@apps-in-toss/web-framework/config';

// SDK 3.x 설정 파일 (구 granite.config.ts). 스키마는 @apps-in-toss/web-framework@3.10.0 dist/config.d.ts 기준.
// appName은 앱인토스 콘솔에 등록할 앱 이름과 일치해야 함 — 콘솔 등록 전이므로 임시값(추측).
export default defineConfig({
  appName: 'molrae-toegeun',
  permissions: [],
  webView: {
    bounces: false,
    pullToRefreshEnabled: false,
    overScrollMode: 'never',
    allowsBackForwardNavigationGestures: false,
  },
  webBundleDir: 'dist',
});
