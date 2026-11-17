# Sea Siege Android — Capacitor LAN prototype

> **Development-only prototype.** The Android project and Capacitor dependencies are tracked. The APK is for local testing, not a release. Physical-device and LAN validation remain required.

## Why this arrangement?

- The APK bundles the Vite `dist/` assets; **no Vite dev server or URL-based web wrapper** is needed on the phone.
- The Android WebView connects directly to the existing **authoritative** SpacetimeDB on the Windows PC, over the same trusted Wi-Fi network.
- No server reducers, schema changes, database recreation, cloud hosting, login shortcuts or new credentials are needed.
- LAN HTTP is deliberately enabled in `capacitor.config.json` **only for this local prototype**. Before publishing an app, use HTTPS/WSS, change `server.androidScheme` back to `https`, remove `server.cleartext`, and review Android network security configuration.

## Prerequisites

- Windows PC and Android phone on the **same trusted Wi-Fi** (no guest/client isolation).
- Node.js 22+ and project dependencies, with the existing SpacetimeDB CLI.
- Android Studio **2025.2.1 or newer**, Android SDK and platform-tools (Capacitor 8). Use a physical phone with USB debugging to avoid downloading an emulator image.
- Android 7+ (API 24+) with an up-to-date System WebView.

## 1. Start the actual database on your PC

Open PowerShell in the project root. If you already have the right local module published, **do not republish**.

In one terminal, launch SpacetimeDB accessible on your LAN:

```powershell
spacetime start --listen-addr 0.0.0.0:3000
```

If an existing server is bound only to `127.0.0.1:3000`, stop that process cleanly and restart with the LAN listen address. **Never pass `--delete-data`.**

If the module has not been published to this local instance, in another terminal:

```powershell
spacetime publish sea-siege-dev --server local --module-path ./spacetimedb
```

Allow **TCP port 3000 inbound on Windows' Private network profile only** if Windows Defender Firewall blocks the phone. Don't enable Public profiles or router port forwarding.

Find your PC's real **Wi-Fi adapter IPv4**:

```powershell
ipconfig
```

Example: `192.168.1.50` (placeholder only). Do not use `localhost`, `127.0.0.1`, a WSL/Docker private IP, or your public IP.

## 2. Prepare the Android frontend

Use the feature branch, and keep work confined to this branch:

```powershell
git fetch origin
git switch --track origin/feat/capacitor-android-lan-prototype
npm install
npm run db:generate
npm run mobile:build
```

On Android, enter your PC’s actual Wi-Fi URL and database name in the server settings screen. The settings are saved on the device; changing them reloads the app. No LAN IP is embedded in the build. `npm run mobile:build` builds the bundled assets without a server address.

## 3. Generate the real native project and run on your phone

```powershell
npm run mobile:android:prepare
npx cap sync android
npx cap open android
```

`mobile:android:prepare` changes only the generated `MainActivity` manifest to `sensorLandscape`; it can be run more than once.

In Android Studio:

1. Wait for the Gradle sync. Connect your unlocked Android phone over USB with **Developer options → USB debugging** enabled, and accept the phone's debugging prompt.
2. Choose your physical phone as the run target.
3. Press **Run ▶**. Sea Siege should install and launch landscape.
4. To produce a shareable debug APK instead, use **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The conventional output is `android/app/build/outputs/apk/debug/app-debug.apk`. It is a **debug APK**, not a signed distribution release.

If you changed the web code, rebuild and re-sync before hitting Run again. A new Wi-Fi IP can be entered in the app without rebuilding:

```powershell
npm run mobile:android:sync
```

## 4. Hands-on acceptance test

1. On the phone, open the app. It should say **Online** after connecting, and its identity should be stable after relaunch.
2. Choose **Quick Play**. Check there is a genuine server-owned bot, world data, ships, buildings and live motion.
3. Touch a friendly ship to select it. Press **Order**, then tap free water: a movement request should be submitted. Press **Order**, then tap an enemy: an attack request should be submitted (subject to server rules). The server remains authoritative.
4. Drag a finger across the sea to pan. Use **+ / −** to zoom. Tap a building to inspect it; try creating a structure.
5. Ensure tapping React HUD controls doesn't unintentionally issue world commands. Test Escape/cancel alternatives via the dock.
6. Close the app and reopen; verify connection reestablishes and the active match data appears.
7. Rotate the phone: the game remains landscape. Check HUD items aren't under the notch, gesture bar or cutouts.
8. Run `npm run typecheck`, `npm run test:client`, `npm run test:unit` on the PC. Debug build tests are still manual.

**Scope limit:** This first pass uses single-finger pan plus explicit zoom buttons and one-shot Order mode. It does **not** claim full touch parity: pinch zoom, two-finger gestures, mobile box selection, hit-area sizing, visual redesign, offline multiplayer or native notifications are future iterations.

## Troubleshooting

| Symptom | Check |
|---|---|
| App shows only Connecting | Wrong LAN IPv4/port, database name, Windows Private firewall, server bound to loopback, or Wi-Fi client isolation |
| It connects on Windows but not phone | Remember `localhost` on the phone is the phone itself. Open Server settings in the app and enter the actual PC address |
| Black or blank screen | Inspect Android Studio Logcat / WebView console; ensure `npm run mobile:build` produced `dist/index.html` before sync |
| Build cannot find Android SDK | Configure Android Studio SDK Manager and Gradle JDK; allow its initial SDK downloads |
| HTML works, but realtime fails | Confirm WebSocket access to port 3000 and that the database name matches the app’s server settings |
| On WSL2/Docker | Expose the service to the Windows host/LAN; `0.0.0.0` inside a container alone may not be enough |
| Android reports cleartext blocked | Re-run `npx cap sync android` after checking the **development-only** `server.cleartext` and scheme in `capacitor.config.json` |

### Do not publish this network configuration

The local server has no TLS and the bundle uses HTTP. It's for a trusted home network and testing only, not use over public Wi-Fi or the Internet. Don't forward the SpacetimeDB port on your router. Revisit auth, HTTPS/WSS, Android network policy and logging before any real release.

### Source and build outputs

The native project and Gradle wrapper are tracked. Local SDK paths, build outputs, APKs and signing keys must remain untracked. Run `npm run mobile:android:sync` before `cd android && ./gradlew assembleDebug`. Retrieve the debug APK from `android/app/build/outputs/apk/debug/app-debug.apk`.
