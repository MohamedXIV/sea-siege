import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS, sanitizeGameSettings } from "../src/settings/game-settings";
import { rebindAction, formatKeyBinding, keyBindingFromEvent } from "../src/settings/keybindings";

describe("semantic keybindings", () => {
  const defaults = sanitizeGameSettings(DEFAULT_GAME_SETTINGS);
  it("remaps a world action without changing the original snapshot", () => {
    const result = rebindAction(defaults, "focusHome", { code: "KeyJ", shift: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.controls.keybindings.focusHome).toEqual({ code: "KeyJ", shift: true });
    expect(defaults.controls.keybindings.focusHome.code).toBe("KeyH");
  });
  it("rejects conflicts without replacing the previous action", () => {
    const result = rebindAction(defaults, "focusHome", { code: "KeyE", shift: false });
    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(defaults.controls.keybindings.focusHome.code).toBe("KeyH");
  });
  it("rejects reserved browser/system keys and Escape for navigation", () => {
    for (const code of ["Tab", "F5", "F11", "Enter", "Backspace", "Escape"]) {
      expect(rebindAction(defaults, "focusHome", { code, shift: false }).ok).toBe(false);
    }
  });
  it("rejects invalid or empty key codes", () => {
    expect(rebindAction(defaults, "focusHome", { code: "", shift: false })).toEqual({ ok: false, reason: "invalid" });
    expect(rebindAction(defaults, "focusHome", { code: "Ctrl+KeyJ", shift: false }).ok).toBe(false);
  });
  it("formats physical codes and optional shift for readable hints", () => {
    expect(formatKeyBinding({ code: "KeyJ", shift: true })).toBe("Shift+J");
    expect(formatKeyBinding({ code: "Digit3", shift: false })).toBe("3");
    expect(formatKeyBinding({ code: "Escape", shift: false })).toBe("Esc");
  });
  it("does not capture modifier chords or IME composition", () => {
    expect(keyBindingFromEvent({ code: "KeyQ", shiftKey: false, ctrlKey: true,
      altKey: false, metaKey: false, isComposing: false })).toBeNull();
    expect(keyBindingFromEvent({ code: "KeyQ", shiftKey: false, ctrlKey: false,
      altKey: false, metaKey: false, isComposing: true })).toBeNull();
  });
  it("accepts an ordinary physical key with Shift", () => {
    expect(keyBindingFromEvent({ code: "KeyQ", shiftKey: true, ctrlKey: false,
      altKey: false, metaKey: false, isComposing: false })).toEqual({ code: "KeyQ", shift: true });
  });
});
