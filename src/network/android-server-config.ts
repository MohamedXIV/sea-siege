import { Capacitor } from "@capacitor/core";

export const ANDROID_SERVER_KEY = "sea-siege:android-server";
export type AndroidServerConfig = { host: string; database: string };

export function parseAndroidServerConfig(host: string, database: string): AndroidServerConfig | null {
  try {
    const url = new URL(host.trim());
    const name = database.trim();
    if (!name || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /^(localhost|127\.|0\.0\.0\.0$|\[::1\]$)/i.test(url.hostname)) return null;
    return { host: url.origin, database: name };
  } catch { return null; }
}

export function readAndroidServerConfig(): AndroidServerConfig | null {
  if (Capacitor.getPlatform() !== "android") return null;
  try {
    const value = JSON.parse(localStorage.getItem(ANDROID_SERVER_KEY) || "null");
    return value && typeof value.host === "string" && typeof value.database === "string" ? parseAndroidServerConfig(value.host, value.database) : null;
  } catch { return null; }
}
