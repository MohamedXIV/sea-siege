import { DEFAULT_GAME_SETTINGS, sanitizeGameSettings, type GameSettingsV1 } from "./game-settings";
import { readGameSettings, removeGameSettings, saveGameSettings } from "./settings-storage";

type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export class GameSettingsStore {
  private snapshot: GameSettingsV1;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage: SettingsStorage | null) {
    this.snapshot = readGameSettings(storage);
  }
  getSnapshot = (): GameSettingsV1 => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  update = (next: GameSettingsV1): void => {
    const validated = sanitizeGameSettings(next);
    if (JSON.stringify(validated) === JSON.stringify(this.snapshot)) return;
    this.snapshot = validated;
    saveGameSettings(this.storage, validated);
    this.notify();
  };
  reset = (): void => {
    const defaults = sanitizeGameSettings(DEFAULT_GAME_SETTINGS);
    removeGameSettings(this.storage);
    if (JSON.stringify(defaults) === JSON.stringify(this.snapshot)) return;
    this.snapshot = defaults;
    this.notify();
  };
  private notify(): void { for (const listener of this.listeners) listener(); }
}
function browserStorage(): SettingsStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}
export const gameSettingsStore = new GameSettingsStore(browserStorage());
