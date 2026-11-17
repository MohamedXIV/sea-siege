import type { GameSettingsV1 } from "../../settings/game-settings";
import { GAME_ACTION_IDS, type GameActionId } from "../../settings/input-actions";

/** World input is owned by Phaser only when React controls do not have focus. */
export function resolveWorldShortcut(event: KeyboardEvent, settings: GameSettingsV1,
  worldHotkeysAllowed: boolean): GameActionId | null {
  if (!worldHotkeysAllowed || event.defaultPrevented || event.repeat || event.isComposing ||
      event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.code === "Escape") return "cancelWorldAction";
  for (const action of GAME_ACTION_IDS) {
    const binding = settings.controls.keybindings[action];
    if (binding.code === event.code && binding.shift === event.shiftKey) return action;
  }
  return null;
}
