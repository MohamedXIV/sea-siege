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
    return () => game.destroy(true);
  }, []);

  return <div ref={holder} className="absolute inset-0" aria-label="Phaser 4 ocean scene, without a connected game backend" />;
}
