import { useEffect, useSyncExternalStore } from "react";
import {
  spacetimeClient,
  type SpacetimeClientState,
} from "./spacetime-client";

export function useSpacetime(): SpacetimeClientState & {
  createMatch: (maxSlots?: number) => Promise<void>;
  joinMatch: (matchId: bigint) => Promise<void>;
  startMatch: (matchId: bigint) => Promise<void>;
  issueShipOrder: (shipId: bigint, targetX: number, targetY: number) => Promise<void>;
  setActiveMatchId: (id: bigint | null) => void;
  resetIdentity: () => void;
  client: typeof spacetimeClient;
} {
  useEffect(() => {
    const release = spacetimeClient.acquire();
    return () => {
      release();
    };
  }, []);

  const state = useSyncExternalStore(
    (callback) => spacetimeClient.subscribe(callback),
    () => spacetimeClient.getState(),
    () => spacetimeClient.getState()
  );

  return {
    ...state,
    createMatch: (maxSlots = 2) => spacetimeClient.createMatch(maxSlots),
    joinMatch: (matchId: bigint) => spacetimeClient.joinMatch(matchId),
    startMatch: (matchId: bigint) => spacetimeClient.startMatch(matchId),
    issueShipOrder: (shipId: bigint, targetX: number, targetY: number) =>
      spacetimeClient.issueShipOrder(shipId, targetX, targetY),
    setActiveMatchId: (id: bigint | null) => spacetimeClient.setActiveMatchId(id),
    resetIdentity: () => spacetimeClient.resetIdentity(),
    client: spacetimeClient,
  };
}
