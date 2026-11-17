import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GameSettingsV1 } from "@/settings/game-settings";
import { GAME_ACTION_IDS, GAME_ACTION_LABELS, type GameActionId, type KeyBinding } from "@/settings/input-actions";
import { formatKeyBinding, keyBindingFromEvent, type RebindResult } from "@/settings/keybindings";

interface KeybindingEditorProps {
  settings: Readonly<GameSettingsV1>;
  onRebind: (action: GameActionId, binding: KeyBinding) => RebindResult;
  onResetAction?: (action: GameActionId) => void;
}
const ERRORS = {
  conflict: "This key is already assigned to another action.",
  reserved: "That key is reserved for your browser, menus, or cancellation.",
  invalid: "Choose a regular key, optionally with Shift.",
};

export function KeybindingEditor({ settings, onRebind, onResetAction }: KeybindingEditorProps) {
  const [capturing, setCapturing] = useState<GameActionId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onCapture = (event: KeyboardEvent) => {
      if (event.code === "Tab") { setCapturing(null); return; }
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") { setCapturing(null); setError(null); return; }
      const binding = keyBindingFromEvent(event);
      if (!binding) { setError(ERRORS.reserved); return; }
      const result = onRebind(capturing, binding);
      if (!result.ok) { setError(ERRORS[result.reason]); return; }
      setCapturing(null); setError(null);
    };
    window.addEventListener("keydown", onCapture, { capture: true });
    return () => window.removeEventListener("keydown", onCapture, { capture: true });
  }, [capturing, onRebind]);

  return <div className="space-y-3" role="group" aria-label="Keyboard controls">
    <p className="text-sm text-muted-foreground">
      Choose a key for each world action. Ctrl, Alt and browser shortcuts are reserved. Escape always cancels.
    </p>
    {GAME_ACTION_IDS.map(action => <div key={action}
      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-card/70 p-2.5">
      <span className="min-w-[10rem] flex-1 text-sm">{GAME_ACTION_LABELS[action]}</span>
      <div className="flex items-center gap-2">
        <kbd className="min-w-12 rounded border border-border bg-background px-2 py-1 text-center font-mono text-sm">
          {formatKeyBinding(settings.controls.keybindings[action])}
        </kbd>
        <Button type="button" size="sm" variant="outline"
          aria-label={`Rebind ${GAME_ACTION_LABELS[action]}`}
          aria-pressed={capturing === action}
          onClick={() => { setCapturing(action); setError(null); }}>
          {capturing === action ? "Press a key…" : "Change"}
        </Button>
        {onResetAction && <Button type="button" size="sm" variant="ghost"
          aria-label={`Reset ${GAME_ACTION_LABELS[action]}`}
          onClick={() => { onResetAction(action); setError(null); }}>Reset</Button>}
      </div>
    </div>)}
    {capturing && <p role="status" className="text-sm text-cyan-200">
      Press a key for {GAME_ACTION_LABELS[capturing]}. Escape cancels capture; Tab moves focus.
    </p>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
  </div>;
}
