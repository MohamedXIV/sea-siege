/** Stable gameplay intent IDs, independent of keyboard layout. */
export const GAME_ACTION_IDS = ["focusHome", "focusEnemy", "cancelWorldAction"] as const;
export type GameActionId = (typeof GAME_ACTION_IDS)[number];
export type KeyBinding = Readonly<{ code: string; shift: boolean }>;

export const DEFAULT_KEYBINDINGS: Readonly<Record<GameActionId, KeyBinding>> = {
  focusHome: { code: "KeyH", shift: false },
  focusEnemy: { code: "KeyE", shift: false },
  cancelWorldAction: { code: "Escape", shift: false },
};

export const GAME_ACTION_LABELS: Readonly<Record<GameActionId, string>> = {
  focusHome: "Focus home base",
  focusEnemy: "Focus enemy",
  cancelWorldAction: "Cancel build or selection",
};

const ASSIGNABLE = /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|Backquote|Escape)$/;

/** Reserved browser/menu keys cannot become world shortcuts. */
export function keyBindingProblem(action: GameActionId, binding: KeyBinding): "invalid" | "reserved" | null {
  if (!binding || typeof binding.code !== "string" || typeof binding.shift !== "boolean") return "invalid";
  if (/^(Tab|Enter|F\d{1,2}|Backspace|Delete|PrintScreen|MetaLeft|MetaRight|ControlLeft|ControlRight|AltLeft|AltRight)$/.test(binding.code)) return "reserved";
  if (!ASSIGNABLE.test(binding.code)) return "invalid";
  if (binding.code === "Escape" && (action !== "cancelWorldAction" || binding.shift)) return "reserved";
  return null;
}
