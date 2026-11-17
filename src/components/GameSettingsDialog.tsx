import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { KeybindingEditor } from "@/components/KeybindingEditor";
import { Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_KEYBINDINGS, type GameActionId, type KeyBinding } from "@/settings/input-actions";
import { rebindAction, type RebindResult } from "@/settings/keybindings";
import { gameSettingsStore } from "@/settings/settings-store";
import { useGameSettings } from "@/settings/use-game-settings";

interface GameSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: HTMLElement | null;
}

/** Controlled dialogs without DialogTrigger need explicit keyboard-focus restoration. */
export function restoreSettingsOpenerFocus(opener: HTMLElement | null, fallback: HTMLElement | null): void {
  if (opener?.isConnected) opener.focus();
  else if (fallback?.isConnected) fallback.focus();
}

export function GameSettingsDialog({ open, onOpenChange, returnFocusTo }: GameSettingsDialogProps) {
  const settings = useGameSettings();
  const [notice, setNotice] = useState<string | null>(null);
  const onRebind = useCallback((action: GameActionId, requested: KeyBinding): RebindResult => {
    const result = rebindAction(gameSettingsStore.getSnapshot(), action, requested);
    if (result.ok) gameSettingsStore.update(result.settings);
    return result;
  }, []);
  const onResetAction = useCallback((action: GameActionId) => {
    const result = rebindAction(gameSettingsStore.getSnapshot(), action, DEFAULT_KEYBINDINGS[action]);
    if (result.ok) gameSettingsStore.update(result.settings);
    setNotice(result.ok ? null : "Another action uses this default. Restore all defaults to reset the layout.");
  }, []);

  return <Dialog open={open} onOpenChange={next => { if (!next) setNotice(null); onOpenChange(next); }}>
    <DialogContent data-game-ui="true" data-game-settings-dialog="true" aria-label="Game settings"
      onCloseAutoFocus={event => {
        event.preventDefault();
        restoreSettingsOpenerFocus(returnFocusTo,
          document.querySelector<HTMLElement>('[data-game-settings-trigger="true"]'));
      }}>
      <DialogHeader>
        <DialogTitle>Game Settings</DialogTitle>
        <DialogDescription>Saved on this device only. Changes take effect immediately.</DialogDescription>
      </DialogHeader>
      <section aria-label="Controls" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-200">Desktop controls</h2>
        <KeybindingEditor settings={settings} onRebind={onRebind} onResetAction={onResetAction} />
      </section>
      {notice && <p role="alert" className="text-sm text-amber-300">{notice}</p>}
      <DialogFooter>
        <Button variant="outline" type="button" onClick={() => {
          gameSettingsStore.reset(); setNotice(null);
        }}>Restore all defaults</Button>
        <Button type="button" onClick={() => { setNotice(null); onOpenChange(false); }}>Done</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
