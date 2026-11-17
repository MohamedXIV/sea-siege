import { DEFAULT_GAME_SETTINGS, sanitizeGameSettings, type GameSettingsV1 } from "./game-settings";

export const GAME_SETTINGS_STORAGE_KEY = "sea-siege:game-settings:v1";
export function readGameSettings(storage: Pick<Storage, "getItem"> | null): GameSettingsV1 {
  try {
    const raw = storage?.getItem(GAME_SETTINGS_STORAGE_KEY);
    return raw === null || raw === undefined ? sanitizeGameSettings(DEFAULT_GAME_SETTINGS)
      : sanitizeGameSettings(JSON.parse(raw) as unknown);
  } catch { return sanitizeGameSettings(DEFAULT_GAME_SETTINGS); }
}
export function saveGameSettings(storage: Pick<Storage, "setItem"> | null, settings: GameSettingsV1): boolean {
  try {
    if (!storage) return false;
    storage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeGameSettings(settings)));
    return true;
  } catch { return false; }
}
export function removeGameSettings(storage: Pick<Storage, "removeItem"> | null): void {
  try { storage?.removeItem(GAME_SETTINGS_STORAGE_KEY); }
  catch { /* Denied storage must never prevent gameplay. */ }
}
