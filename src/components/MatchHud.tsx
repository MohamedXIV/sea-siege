import { useEffect, useState } from "react";
import { Anchor, Compass, Menu, LocateFixed, SlidersHorizontal, Crosshair, Plus, Minus, Settings2 } from "lucide-react";
import {
  FOCUS_ENEMY_EVENT, FOCUS_HOME_EVENT,
  GEMINI_SELECTION_EVENT,
  GEMINI_BUILD_MODE_EVENT, HUD_RESET_INTERACTION_EVENT,
  MOBILE_ORDER_MODE_EVENT, MOBILE_ORDER_MODE_CHANGED_EVENT, MOBILE_ZOOM_EVENT,
} from "@/game/SeaScene";
import { Button } from "@/components/ui/button";
import { TacticalOverview } from "@/components/TacticalOverview";
import { GeminiCommandDock } from "@/components/GeminiCommandDock";
import { HudOverview } from "@/components/hud/HudOverview";
import { getHudSummary } from "@/components/hud/hud-view-model";
import { getHudSelectionLabel, type HudSelection } from "@/components/hud/hud-selection";
import { canArmMobileOrder } from "@/game/input/mobile-order-eligibility";
import { MatchClock } from "@/components/MatchClock";
import { CommandFeedback } from "@/components/CommandFeedback";
import type { SpacetimeClientState } from "@/network/spacetime-client";
import { useGameSettings } from "@/settings/use-game-settings";
import { formatKeyBinding } from "@/settings/keybindings";

interface MatchHudProps {
  state: SpacetimeClientState;
  onMenu: () => void;
  onSettings: (opener: HTMLElement) => void;
}

/** Match overlays render real server state; Phaser remains the battlefield owner. */
export function MatchHud({ state, onMenu, onSettings }: MatchHudProps) {
  const settings = useGameSettings();
  // Keep the full desktop command dock; give small screens their battlefield back.
  const [mobileCommandsOpen, setMobileCommandsOpen] = useState(false);
  const [mobileOrderArmed, setMobileOrderArmed] = useState(false);
  const [buildKindActive, setBuildKindActive] = useState(false);
  const [selected, setSelected] = useState<HudSelection>(null);
  useEffect(() => {
    const onSelection = (event: Event) => {
      setSelected((event as CustomEvent<HudSelection>).detail ?? null);
    };
    window.addEventListener(GEMINI_SELECTION_EVENT, onSelection);
    return () => window.removeEventListener(GEMINI_SELECTION_EVENT, onSelection);
  }, []);
  useEffect(() => { setSelected(null); }, [state.activeMatchId]);
  useEffect(() => {
    const onBuild = (event: Event) => {
      setBuildKindActive((event as CustomEvent<{ kind?: string | null }>).detail?.kind != null);
    };
    window.addEventListener(GEMINI_BUILD_MODE_EVENT, onBuild);
    return () => window.removeEventListener(GEMINI_BUILD_MODE_EVENT, onBuild);
  }, []);
  useEffect(() => {
    const onChanged = (event: Event) => {
      setMobileOrderArmed(
        (event as CustomEvent<{ armed?: boolean }>).detail?.armed === true
      );
    };
    window.addEventListener(MOBILE_ORDER_MODE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MOBILE_ORDER_MODE_CHANGED_EVENT, onChanged);
  }, []);
  const match = state.activeMatch;
  if (!match) return null;

  const summary = getHudSummary(state);
  const selectedShipIds = selected?.type === "ship" ? selected.shipIds ?? [selected.id] : [];
  const canOrder = canArmMobileOrder(selectedShipIds, state, buildKindActive);
  const connected = summary.connected;
  const connectionLabel = connected ? "Live match" :
    state.status === "error" || state.subscriptionStatus === "error" ? "Connection error" :
    state.status === "disconnected" ? "Offline" : "Reconnecting";

  return (
    <div data-game-ui="true" data-game-hud="true" className="sea-hud-root pointer-events-none absolute inset-0 z-10 flex flex-col text-slate-100">
      <header className="sea-safe-top sea-hud-header flex flex-wrap items-center justify-between gap-2 p-2 lg:gap-3 lg:p-3">
        <div className="sea-hud-panel pointer-events-auto flex items-center gap-2 px-3 py-1.5">
          <Anchor className="size-4 text-cyan-300" aria-hidden="true" />
          <div>
            <div className="font-mono text-xs font-black tracking-widest">SEA SIEGE</div>
            <div className="hidden text-[10px] text-slate-300 sm:block">
              Match #{match.id.toString()} · Slot {state.myMembership?.slot ?? "—"}
            </div>
          </div>
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5 lg:gap-2">
          <MatchClock match={match} />
          <Button size="sm" variant="outline" type="button"
            aria-pressed={mobileOrderArmed}
            aria-label={mobileOrderArmed ? "Cancel target order" : "Order selected ships: then tap a destination or enemy"}
            disabled={!canOrder && !mobileOrderArmed}
            className={`sea-hud-touch-button lg:hidden ${mobileOrderArmed
              ? "border-amber-500 bg-amber-950/95 text-amber-200"
              : "border-sky-700 bg-slate-950/90 text-sky-200"}`}
            onClick={() => window.dispatchEvent(new CustomEvent(MOBILE_ORDER_MODE_EVENT, {
              detail: { armed: !mobileOrderArmed && canOrder },
            }))}>
            <Crosshair className="size-4" aria-hidden="true" />
            {mobileOrderArmed ? "Tap target" : "Order"}
          </Button>
          <Button size="sm" variant="outline" type="button"
            aria-label="Zoom out"
            className="sea-hud-touch-button lg:hidden border-sky-700 bg-slate-950/90 text-sky-200"
            onClick={() => window.dispatchEvent(new CustomEvent(MOBILE_ZOOM_EVENT, {
              detail: { direction: "out" },
            }))}>
            <Minus className="size-4" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="outline" type="button"
            aria-label="Zoom in"
            className="sea-hud-touch-button lg:hidden border-sky-700 bg-slate-950/90 text-sky-200"
            onClick={() => window.dispatchEvent(new CustomEvent(MOBILE_ZOOM_EVENT, {
              detail: { direction: "in" },
            }))}>
            <Plus className="size-4" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="outline" type="button"
            className="sea-hud-touch-button border-sky-700 bg-slate-950/90 text-sky-200 lg:hidden"
            aria-controls="sea-command-dock"
            aria-expanded={mobileCommandsOpen}
            onClick={() => setMobileCommandsOpen(open => !open)}>
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            {mobileCommandsOpen ? "Hide commands" : "Commands"}
          </Button>
          <div
            role="status"
            className={`sea-hud-panel flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold ${
              connected
                ? "border-emerald-700/60 bg-slate-950/85 text-emerald-300"
                : "border-amber-700/60 bg-slate-950/85 text-amber-200"
            }`}
          >
            <span className={`size-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
            {connectionLabel}
          </div>
          <Button size="sm" variant="outline" type="button" data-game-settings-trigger="true"
            aria-label="Game settings"
            className="sea-hud-touch-button border-slate-700 bg-slate-950/90"
            onClick={event => onSettings(event.currentTarget)}>
            <Settings2 className="size-4" aria-hidden="true" /> <span className="hidden lg:inline">Settings</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.dispatchEvent(new Event(HUD_RESET_INTERACTION_EVENT));
              onMenu();
            }}
            aria-label="Game menu"
            className="sea-hud-touch-button border-slate-700 bg-slate-950/90"
          >
            <Menu className="size-4" aria-hidden="true" /> <span className="hidden lg:inline">Menu</span>
          </Button>
        </div>
      </header>

      <div className="sea-hud-glance sea-safe-side px-2 pb-2 lg:px-3">
        <HudOverview summary={summary} selectionLabel={getHudSelectionLabel(selected, state)} />
      </div>

      <div className="sea-hud-field relative flex min-h-0 flex-1 flex-col">
        <CommandFeedback />
        <TacticalOverview state={state} />

        <div className="sea-hud-bottom mt-auto flex flex-col items-start justify-end gap-2 px-2 pb-2 lg:px-3 lg:pb-3">
          {state.error && (
            <p role="alert" className="pointer-events-auto max-w-sm rounded-md border border-rose-700/60 bg-slate-950/90 px-3 py-2 text-xs text-rose-200">
              {state.error}
            </p>
          )}

          <div className="sea-hud-panel sea-hud-command-panel pointer-events-auto w-full max-w-2xl overflow-y-auto p-2.5 lg:p-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-700/70 pb-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-200">
              <span>Command Deck</span>
              <span className="text-slate-400 lg:hidden">{mobileCommandsOpen ? "Expanded" : "Commands hidden"}</span>
            </div>
            <div id="sea-command-dock" role="region" aria-label="Fleet and construction commands"
              className={mobileCommandsOpen ? "block" : "hidden lg:block"}>
              <GeminiCommandDock state={state} selected={selected} />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/60 pt-2 text-[11px] text-slate-300">
                <div className="space-y-1">
                  <span className="flex items-center gap-1">
                    <Compass className="size-3 text-cyan-300" />
                    <span className="hidden lg:inline">LMB select / drag to box-select · RMB move · RMB enemy attack</span>
                    <span className="lg:hidden">Tap ship to select · Order then tap target · Drag sea to pan</span>
                  </span>
                  <div>Drag empty sea to deselect · {formatKeyBinding(settings.controls.keybindings.cancelWorldAction)}{settings.controls.keybindings.cancelWorldAction.code === "Escape" ? "" : "/Esc"}/RMB cancel build · {formatKeyBinding(settings.controls.keybindings.focusEnemy)} enemy · {formatKeyBinding(settings.controls.keybindings.focusHome)} home</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="min-h-9 border-slate-700 text-xs"
                    onClick={() => window.dispatchEvent(new Event(FOCUS_HOME_EVENT))}>
                    <LocateFixed className="size-3" /> Home
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-9 border-rose-800 text-xs text-rose-300"
                    disabled={!state.visibleEnemies.length}
                    onClick={() => window.dispatchEvent(new Event(FOCUS_ENEMY_EVENT))}>
                    <LocateFixed className="size-3" /> Find Enemy
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
