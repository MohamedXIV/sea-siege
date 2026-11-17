import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS, sanitizeGameSettings } from "../src/settings/game-settings";
import { GAME_SETTINGS_STORAGE_KEY, readGameSettings, saveGameSettings, removeGameSettings } from "../src/settings/settings-storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); } };
}

describe("device-local settings", () => {
  it("uses current live gameplay defaults without writing on first load", () => {
    const storage = memoryStorage();
    expect(readGameSettings(storage)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(storage.values.size).toBe(0);
    expect(DEFAULT_GAME_SETTINGS.controls.keybindings.focusHome.code).toBe("KeyH");
    expect(DEFAULT_GAME_SETTINGS.controls.keybindings.focusEnemy.code).toBe("KeyE");
    expect(DEFAULT_GAME_SETTINGS.controls.keybindings.cancelWorldAction.code).toBe("Escape");
  });
  it("round trips valid settings through only its own key", () => {
    const storage = memoryStorage();
    const value = sanitizeGameSettings({ version: 1, controls: { zoomSensitivity: 1.4,
      keybindings: { focusHome: { code: "KeyJ", shift: true } } },
      accessibility: { uiScale: 1.5, highContrast: true, reducedMotion: "on" } });
    expect(saveGameSettings(storage, value)).toBe(true);
    expect(storage.values.size).toBe(1);
    expect(readGameSettings(storage)).toEqual(value);
  });
  it("repairs malformed, unknown-version, primitive and partial settings", () => {
    const storage = memoryStorage();
    for (const bad of ["{bad", "null", "42", '{"version":99,"accessibility":{"highContrast":true}}']) {
      storage.setItem(GAME_SETTINGS_STORAGE_KEY, bad);
      expect(readGameSettings(storage)).toEqual(DEFAULT_GAME_SETTINGS);
    }
    expect(sanitizeGameSettings({ version: 1, accessibility: { highContrast: true } }).accessibility.highContrast).toBe(true);
  });
  it("repairs invalid nested values while clamping finite sensitivity", () => {
    const settings = sanitizeGameSettings({ version: 1, controls: { zoomSensitivity: 900,
      keybindings: { focusEnemy: { code: "", shift: "yes" } } },
      accessibility: { uiScale: 20, highContrast: "true", reducedMotion: "fast" } });
    expect(settings.controls.zoomSensitivity).toBe(2);
    expect(settings.controls.keybindings.focusEnemy.code).toBe("KeyE");
    expect(settings.accessibility).toEqual(DEFAULT_GAME_SETTINGS.accessibility);
  });
  it("survives denied localStorage reads, writes and reset", () => {
    const denied = { getItem(): string | null { throw Error("denied"); },
      setItem(): void { throw Error("quota"); }, removeItem(): void { throw Error("denied"); } };
    expect(readGameSettings(denied)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(saveGameSettings(denied, DEFAULT_GAME_SETTINGS)).toBe(false);
    expect(() => removeGameSettings(denied)).not.toThrow();
  });
  it("reset preserves unrelated Android LAN keys", () => {
    const storage = memoryStorage();
    storage.setItem("sea-siege:android-lan-config", "retain");
    saveGameSettings(storage, DEFAULT_GAME_SETTINGS);
    removeGameSettings(storage);
    expect(storage.getItem(GAME_SETTINGS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("sea-siege:android-lan-config")).toBe("retain");
  });
  it("preserves valid swaps and reuse of a formerly default key", () => {
    const layout = sanitizeGameSettings({ version: 1, controls: { keybindings: {
      focusHome: { code: "KeyE", shift: false }, focusEnemy: { code: "KeyJ", shift: false } } } });
    expect(layout.controls.keybindings.focusHome.code).toBe("KeyE");
    expect(layout.controls.keybindings.focusEnemy.code).toBe("KeyJ");
    const swapped = sanitizeGameSettings({ version: 1, controls: { keybindings: {
      focusHome: { code: "KeyE", shift: false }, focusEnemy: { code: "KeyH", shift: false } } } });
    expect(swapped.controls.keybindings.focusHome.code).toBe("KeyE");
    expect(swapped.controls.keybindings.focusEnemy.code).toBe("KeyH");
  });
  it("repairs duplicate persisted bindings to a conflict-free mapping", () => {
    const broken = sanitizeGameSettings({ version: 1, controls: { keybindings: {
      focusHome: { code: "KeyE", shift: false }, focusEnemy: { code: "KeyE", shift: false },
      cancelWorldAction: { code: "KeyH", shift: false } } } });
    const mappings = Object.values(broken.controls.keybindings).map(k => `${k.shift}:${k.code}`);
    expect(new Set(mappings).size).toBe(mappings.length);
  });
});
