import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS, sanitizeGameSettings } from "../src/settings/game-settings";
import { rebindAction } from "../src/settings/keybindings";
import { resolveWorldShortcut, allowHudBuildCancel } from "../src/game/input/keyboard-shortcuts";

function key(code: string, changes: Record<string, unknown> = {}): KeyboardEvent {
  return { code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    repeat: false, defaultPrevented: false, isComposing: false, ...changes } as KeyboardEvent;
}

describe("live world keyboard routing", () => {
  const defaults = sanitizeGameSettings(DEFAULT_GAME_SETTINGS);
  it("dispatches semantic Home, Enemy and Escape actions", () => {
    expect(resolveWorldShortcut(key("KeyH"), defaults, true)).toBe("focusHome");
    expect(resolveWorldShortcut(key("KeyE"), defaults, true)).toBe("focusEnemy");
    expect(resolveWorldShortcut(key("Escape"), defaults, true)).toBe("cancelWorldAction");
  });
  it("resolves the new key immediately while ignoring the previous one", () => {
    const result = rebindAction(defaults, "focusHome", { code: "KeyJ", shift: true });
    if (!result.ok) throw Error("setup expected success");
    expect(resolveWorldShortcut(key("KeyJ", { shiftKey: true }), result.settings, true)).toBe("focusHome");
    expect(resolveWorldShortcut(key("KeyH"), result.settings, true)).toBeNull();
  });
  it("keeps Escape as a universal cancel after remapping Cancel", () => {
    const result = rebindAction(defaults, "cancelWorldAction", { code: "KeyQ", shift: false });
    if (!result.ok) throw Error("setup expected success");
    expect(resolveWorldShortcut(key("KeyQ"), result.settings, true)).toBe("cancelWorldAction");
    expect(resolveWorldShortcut(key("Escape"), result.settings, true)).toBe("cancelWorldAction");
  });
  it("never sends world keys while UI owns focus", () => {
    expect(resolveWorldShortcut(key("KeyH"), defaults, false)).toBeNull();
    expect(resolveWorldShortcut(key("Escape"), defaults, false)).toBeNull();
  });
  it("ignores browser modifiers, repeat, canceled events and composition", () => {
    for (const change of [{ ctrlKey: true }, { altKey: true }, { metaKey: true },
      { repeat: true }, { defaultPrevented: true }, { isComposing: true }]) {
      expect(resolveWorldShortcut(key("KeyH", change), defaults, true)).toBeNull();
    }
  });
  it("allows only the universal Escape fallback from a focused construction HUD button", () => {
    expect(allowHudBuildCancel({ code: "Escape" }, true, true)).toBe(true);
    expect(allowHudBuildCancel({ code: "Space" }, true, true)).toBe(false);
    expect(allowHudBuildCancel({ code: "KeyQ" }, true, true)).toBe(false);
    expect(allowHudBuildCancel({ code: "Escape" }, false, true)).toBe(false);
    expect(allowHudBuildCancel({ code: "Escape" }, true, false)).toBe(false);
  });
});
