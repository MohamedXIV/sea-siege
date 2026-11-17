import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KeybindingEditor } from "../src/components/KeybindingEditor";
import { restoreSettingsOpenerFocus } from "../src/components/GameSettingsDialog";
import { DEFAULT_GAME_SETTINGS } from "../src/settings/game-settings";

describe("player-facing controls settings", () => {
  it("shows each actual world action and current default key", () => {
    const html = renderToStaticMarkup(createElement(KeybindingEditor, { settings: DEFAULT_GAME_SETTINGS,
      onRebind: () => ({ ok: false, reason: "invalid" as const }) }));
    for (const text of ["Focus home base", "Focus enemy", "Cancel build or selection", "Esc"]) {
      expect(html).toContain(text);
    }
  });
  it("exposes accessible rebinding buttons without imaginary audio/graphics options", () => {
    const html = renderToStaticMarkup(createElement(KeybindingEditor, { settings: DEFAULT_GAME_SETTINGS,
      onRebind: () => ({ ok: false, reason: "invalid" as const }) }));
    expect(html).toContain('aria-label="Rebind Focus home base"');
    expect(html).toContain('aria-label="Rebind Focus enemy"');
    expect(html).not.toContain("Graphics quality");
    expect(html).not.toContain("Music volume");
  });
  it("returns focus to the actual Settings opener on close", () => {
    const focus = vi.fn(), fallbackFocus = vi.fn();
    const opener = { isConnected: true, focus } as unknown as HTMLElement;
    const fallback = { isConnected: true, focus: fallbackFocus } as unknown as HTMLElement;
    restoreSettingsOpenerFocus(opener, fallback);
    expect(focus).toHaveBeenCalledOnce();
    expect(fallbackFocus).not.toHaveBeenCalled();
  });
  it("falls back if the original HUD Settings button has unmounted", () => {
    const focus = vi.fn(), fallbackFocus = vi.fn();
    const gone = { isConnected: false, focus } as unknown as HTMLElement;
    const fallback = { isConnected: true, focus: fallbackFocus } as unknown as HTMLElement;
    restoreSettingsOpenerFocus(gone, fallback);
    expect(focus).not.toHaveBeenCalled();
    expect(fallbackFocus).toHaveBeenCalledOnce();
  });
  it("returns focus to match results when a match ends under Settings", () => {
    const resultFocus = vi.fn();
    const gone = { isConnected: false, focus: vi.fn() } as unknown as HTMLElement;
    const results = { isConnected: true, focus: resultFocus } as unknown as HTMLElement;
    restoreSettingsOpenerFocus(gone, null, results);
    expect(resultFocus).toHaveBeenCalledOnce();
  });
});
