import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { SeaScene } from "./SeaScene";

/** Phaser owns this canvas, React owns its container. Clean shutdown supports StrictMode and navigation. */
export function PhaserViewport() {
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
      className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-cyan-300"
      aria-label="Sea Siege battlefield. Use the mouse to select and command ships; H focuses home, E focuses the enemy and Escape cancels building."
    />
  );
}
