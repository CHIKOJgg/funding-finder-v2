import type { CapacitorConfig } from '@capacitor/core';

// Capacitor configuration (Block B4). Wraps the built PWA as a native
// iOS / Android app. After `npm run build` in the frontend:
//   1. npm install @capacitor/core @capacitor/cli
//   2. npx cap init FundingFinder com.fundingfinder.app --web-dir=dist
//   3. npx cap add ios      # requires Xcode on macOS
//   4. npx cap add android  # requires Android Studio
//   5. npx cap sync && npx cap open ios   (or android)
// Then build/archive from the native IDE and publish to the stores.
//
// `server.url` is commented out: for production builds point it at the live
// PWA so the app always serves the latest web bundle. Leave it unset for local
// development so the wrapper loads dist/ directly.
const config: CapacitorConfig = {
  appId: 'com.fundingfinder.app',
  appName: 'Funding Finder',
  webDir: 'dist',
  // server: { url: 'https://your-pwa-domain.com', cleartext: false },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
