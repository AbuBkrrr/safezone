import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.collapse.safelinks",
  appName: "The Collapse",
  webDir: "out", // the static export from `npm run build`
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
};

export default config;
