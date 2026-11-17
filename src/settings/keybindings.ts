import { sanitizeGameSettings, type GameSettingsV1 } from "./game-settings";
import { GAME_ACTION_IDS, keyBindingProblem, type GameActionId, type KeyBinding } from "./input-actions";

export type RebindResult = { ok: true; settings: GameSettingsV1 } |
  { ok: false; reason: "invalid" | "reserved" | "conflict" };

export function formatKeyBinding(binding: KeyBinding): string {
  let label = binding.code;
  if (/^Key[A-Z]$/.test(label)) label = label.slice(3);
  else if (/^Digit[0-9]$/.test(label)) label = label.slice(5);
  else if (label === "Escape") label = "Esc";
  else if (label.startsWith("Arrow")) label = label.slice(5);
  return binding.shift ? `Shift+${label}` : label;
}
export function keyBindingFromEvent(event: Pick<KeyboardEvent,
  "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "isComposing">): KeyBinding | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return null;
  return { code: event.code, shift: event.shiftKey };
}
/** Conflicts are refused, never silently swapped. */
export function rebindAction(current: GameSettingsV1, action: GameActionId, requested: KeyBinding): RebindResult {
  if (!GAME_ACTION_IDS.includes(action)) return { ok: false, reason: "invalid" };
  const problem = keyBindingProblem(action, requested);
  if (problem) return { ok: false, reason: problem };
  const settings = sanitizeGameSettings(current);
  for (const other of GAME_ACTION_IDS) {
    if (other === action) continue;
    const key = settings.controls.keybindings[other];
    if (key.code === requested.code && key.shift === requested.shift) return { ok: false, reason: "conflict" };
  }
  settings.controls.keybindings[action] = { ...requested };
  return { ok: true, settings };
}
