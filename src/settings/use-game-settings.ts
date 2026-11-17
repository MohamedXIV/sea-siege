import { useSyncExternalStore } from "react";
import { gameSettingsStore } from "./settings-store";

/** React consumes the same stable snapshot the Phaser key handler reads. */
export function useGameSettings() {
  return useSyncExternalStore(gameSettingsStore.subscribe, gameSettingsStore.getSnapshot,
    gameSettingsStore.getSnapshot);
}
