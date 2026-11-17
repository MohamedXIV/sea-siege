import { describe, expect, it } from "vitest";
import { GameSettingsStore } from "../src/settings/settings-store";
import { rebindAction } from "../src/settings/keybindings";
import { GAME_SETTINGS_STORAGE_KEY } from "../src/settings/settings-storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); } };
}

describe("shared settings store", () => {
  it("publishes changed snapshots once and stops after unsubscribe", () => {
    const store = new GameSettingsStore(memoryStorage());
    let count = 0;
    const unsub = store.subscribe(() => count++);
    const original = store.getSnapshot();
    store.update({ ...original, accessibility: { ...original.accessibility, highContrast: true } });
    store.update(store.getSnapshot());
    expect(count).toBe(1);
    unsub(); store.reset();
    expect(count).toBe(1);
  });
  it("persists effective preferences and restores only its own key", () => {
    const storage = memoryStorage();
    storage.setItem("sea-siege:android-lan-config", "keep");
    const store = new GameSettingsStore(storage);
    const before = store.getSnapshot();
    store.update({ ...before, accessibility: { ...before.accessibility, uiScale: 1.5 } });
    expect(new GameSettingsStore(storage).getSnapshot().accessibility.uiScale).toBe(1.5);
    store.reset();
    expect(storage.values.has(GAME_SETTINGS_STORAGE_KEY)).toBe(false);
    expect(storage.getItem("sea-siege:android-lan-config")).toBe("keep");
  });
  it("keeps settings usable with no storage", () => {
    const store = new GameSettingsStore(null);
    const before = store.getSnapshot();
    store.update({ ...before, accessibility: { ...before.accessibility, highContrast: true } });
    expect(store.getSnapshot().accessibility.highContrast).toBe(true);
  });
  it("preserves reuse of a freed default key through update and refresh", () => {
    const storage = memoryStorage(); const store = new GameSettingsStore(storage);
    const first = rebindAction(store.getSnapshot(), "focusEnemy", { code: "KeyJ", shift: false });
    if (!first.ok) throw Error("setup should rebind Enemy");
    store.update(first.settings);
    const second = rebindAction(store.getSnapshot(), "focusHome", { code: "KeyE", shift: false });
    if (!second.ok) throw Error("setup should rebind Home");
    store.update(second.settings);
    expect(store.getSnapshot().controls.keybindings.focusHome.code).toBe("KeyE");
    expect(new GameSettingsStore(storage).getSnapshot().controls.keybindings.focusHome.code).toBe("KeyE");
  });
});
