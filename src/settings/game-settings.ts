import { DEFAULT_KEYBINDINGS, GAME_ACTION_IDS, keyBindingProblem, type GameActionId, type KeyBinding } from "./input-actions";

export type ReducedMotionPreference = "system" | "on" | "off";
export type UiScale = 1 | 1.25 | 1.5;
export interface GameSettingsV1 {
  version: 1;
  controls: { keybindings: Record<GameActionId, KeyBinding>; zoomSensitivity: number };
  accessibility: { uiScale: UiScale; highContrast: boolean; reducedMotion: ReducedMotionPreference };
}

export const GAME_ZOOM_SENSITIVITY_RANGE = { min: 0.5, max: 2 } as const;
export const DEFAULT_GAME_SETTINGS: Readonly<GameSettingsV1> = {
  version: 1,
  controls: { keybindings: { focusHome: DEFAULT_KEYBINDINGS.focusHome,
    focusEnemy: DEFAULT_KEYBINDINGS.focusEnemy,
    cancelWorldAction: DEFAULT_KEYBINDINGS.cancelWorldAction }, zoomSensitivity: 1 },
  accessibility: { uiScale: 1, highContrast: false, reducedMotion: "system" },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readKeyBinding(value: unknown, fallback: KeyBinding): KeyBinding {
  if (!isObject(value) || typeof value.code !== "string" ||
      !/^[A-Za-z][A-Za-z0-9]{1,31}$/.test(value.code) || typeof value.shift !== "boolean") {
    return { ...fallback };
  }
  return { code: value.code, shift: value.shift };
}

/** Every persisted field is untrusted. Recover valid fields without accepting duplicate keys. */
export function sanitizeGameSettings(raw: unknown): GameSettingsV1 {
  const source = isObject(raw) && raw.version === 1 ? raw : {};
  const controls = isObject(source.controls) ? source.controls : {};
  const rawBindings = isObject(controls.keybindings) ? controls.keybindings : {};
  const keybindings: Record<GameActionId, KeyBinding> = {
    focusHome: { ...DEFAULT_KEYBINDINGS.focusHome },
    focusEnemy: { ...DEFAULT_KEYBINDINGS.focusEnemy },
    cancelWorldAction: { ...DEFAULT_KEYBINDINGS.cancelWorldAction },
  };
  // Read the entire candidate layout before resolving conflicts. Otherwise a
  // valid reuse/swap of freed default keys is silently discarded.
  for (const action of GAME_ACTION_IDS) {
    const candidate = readKeyBinding(rawBindings[action], DEFAULT_KEYBINDINGS[action]);
    if (keyBindingProblem(action, candidate) === null) keybindings[action] = candidate;
  }
  for (let pass = 0; pass < GAME_ACTION_IDS.length; pass++) {
    const conflicting = new Set<GameActionId>();
    for (let i = 0; i < GAME_ACTION_IDS.length; i++) {
      for (let j = i + 1; j < GAME_ACTION_IDS.length; j++) {
        const left = GAME_ACTION_IDS[i], right = GAME_ACTION_IDS[j];
        if (keybindings[left].code === keybindings[right].code &&
            keybindings[left].shift === keybindings[right].shift) {
          conflicting.add(left); conflicting.add(right);
        }
      }
    }
    if (!conflicting.size) break;
    for (const action of conflicting) keybindings[action] = { ...DEFAULT_KEYBINDINGS[action] };
  }
  const zoom = typeof controls.zoomSensitivity === "number" && Number.isFinite(controls.zoomSensitivity)
    ? Math.max(GAME_ZOOM_SENSITIVITY_RANGE.min,
      Math.min(GAME_ZOOM_SENSITIVITY_RANGE.max, controls.zoomSensitivity))
    : DEFAULT_GAME_SETTINGS.controls.zoomSensitivity;
  const accessibility = isObject(source.accessibility) ? source.accessibility : {};
  const uiScale: UiScale = accessibility.uiScale === 1.25 || accessibility.uiScale === 1.5 ? accessibility.uiScale : 1;
  const reducedMotion: ReducedMotionPreference = accessibility.reducedMotion === "on" || accessibility.reducedMotion === "off"
    ? accessibility.reducedMotion : "system";
  return { version: 1, controls: { keybindings, zoomSensitivity: zoom }, accessibility: {
    uiScale, highContrast: accessibility.highContrast === true, reducedMotion } };
}
