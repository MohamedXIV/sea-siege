import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { SeaScene } from "./SeaScene";
import { useGameSettings } from "@/settings/use-game-settings";
import { formatKeyBinding } from "@/settings/keybindings";

/** Phaser owns this canvas, React owns its container. Clean shutdown supports StrictMode and navigation. */
export function PhaserViewport() {
  const settings = useGameSettings();
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: "#07121b",
      render: { pixelArt: true, antialias: false },
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: parent.clientWidth || 960,
        height: parent.clientHeight || 600,
      },
      scene: [SeaScene],
    });

    return () => {
      game.destroy(true);
    };
  }, []);

  return (
    <div
      ref={holder}
      tabIndex={0}
      role="region"
      onPointerDown={() => holder.current?.focus({ preventScroll: true })}
      className="absolute inset-0 touch-none focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-cyan-300"
      aria-label={`Sea Siege battlefield. On touch screens tap to select, drag to pan, or press Order and tap a target. With a mouse, left-click selects and right-click commands. ${formatKeyBinding(settings.controls.keybindings.focusHome)} focuses home and ${formatKeyBinding(settings.controls.keybindings.focusEnemy)} focuses the enemy.`}
    />
  );
}
