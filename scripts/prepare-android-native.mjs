import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = resolve("android/app/src/main/AndroidManifest.xml");
if (!existsSync(manifest)) {
  console.error("Android project not found. First run: npx cap add android");
  process.exit(1);
}
let xml = readFileSync(manifest, "utf8");
const activityMarker = 'android:name=".MainActivity"';
const start = xml.indexOf(activityMarker);
if (start === -1) {
  console.error("Could not find MainActivity in AndroidManifest.xml; inspect manually.");
  process.exit(1);
}
const end = xml.indexOf(">", start);
if (end === -1) {
  console.error("Malformed MainActivity tag; inspect AndroidManifest.xml manually.");
  process.exit(1);
}
if (!xml.slice(start, end).includes("android:screenOrientation")) {
  xml = xml.replace(activityMarker, activityMarker + '\n            android:screenOrientation="sensorLandscape"');
  writeFileSync(manifest, xml);
  console.log("Locked Android MainActivity to sensorLandscape for Sea Siege.");
} else {
  console.log("Android MainActivity orientation already configured.");
}
