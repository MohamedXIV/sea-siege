import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(".env.mobile.local");
const source = existsSync(file) ? readFileSync(file, "utf8") : "";
const values = Object.fromEntries(
  source.split(/\r?\n/).filter(line => /^VITE_[A-Z_]+=/.test(line))
    .map(line => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const host = process.env.VITE_SPACETIME_HOST || values.VITE_SPACETIME_HOST;
const db = process.env.VITE_SPACETIME_DATABASE || values.VITE_SPACETIME_DATABASE;

let url;
try {
  url = new URL(host);
} catch {
  // Failed validation below gives an actionable error.
}
const localOnly = /^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$)/i;
if (!url || !["http:", "https:"].includes(url.protocol) ||
    localOnly.test(url.hostname) || !db) {
  console.error(
    "Android LAN build needs VITE_SPACETIME_HOST=http://<YOUR_PC_WIFI_IP>:3000 " +
    "and VITE_SPACETIME_DATABASE in .env.mobile.local. " +
    "Android cannot reach your PC through 127.0.0.1 or localhost."
  );
  process.exitCode = 1;
} else {
  console.log(`Android LAN target: ${url.origin} / ${db}`);
}
