import { describe, it, expect } from "vitest";
import { DbConnection } from "../src/module_bindings";

interface ConnectedSession {
  conn: DbConnection;
  identity: string;
  token: string;
  applied: Promise<void>;
}

function connectClient(name: string, token?: string): Promise<ConnectedSession> {
  return new Promise((resolve, reject) => {
    let appliedResolve: () => void;
    let appliedReject: (err: any) => void;
    const applied = new Promise<void>((res, rej) => {
      appliedResolve = res;
      appliedReject = rej;
    });

    const conn = DbConnection.builder()
      .withUri("http://127.0.0.1:3000")
      .withDatabaseName("sea-siege-dev")
      .withToken(token)
      .onConnect((c, id, tok) => {
        const hex = id.toHexString();
        c.subscriptionBuilder()
          .onApplied(() => {
            appliedResolve();
          })
          .onError((ctx) => {
            appliedReject(new Error(`[${name}] Subscription failed: ${JSON.stringify(ctx)}`));
          })
          .subscribe([
            "SELECT * FROM match",
            "SELECT * FROM my_memberships",
            "SELECT * FROM my_ships",
            "SELECT * FROM my_structures",
            "SELECT * FROM my_faction_states",
            "SELECT * FROM my_visible_enemies",
          ]);

        resolve({ conn: c, identity: hex, token: tok, applied });
      })
      .onConnectError((_ctx, err) => {
        reject(err);
      })
      .build();
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 8000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Timeout waiting for condition"));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

describe("P0 Two-Client Connected Multiplayer Slice", () => {
  it("executes the full two-human match lifecycle on real local SpacetimeDB", async () => {
    // 1. Client A connects and creates a match
    const clientA = await connectClient("ClientA");
    await clientA.applied;
    expect(clientA.identity).toBeTruthy();
    expect(clientA.token).toBeTruthy();

    await clientA.conn.reducers.createMatch({ maxSlots: 2 });
    await waitFor(() => Array.from(clientA.conn.db.myMemberships.iter()).length > 0);
    const membershipsA = Array.from(clientA.conn.db.myMemberships.iter());
    const memA = membershipsA[membershipsA.length - 1]!;
    const matchId = memA.matchId;
    expect(memA.slot).toBe(0);

    // 2. Client B connects with genuinely different Identity
    const clientB = await connectClient("ClientB");
    await clientB.applied;
    expect(clientB.identity).not.toBe(clientA.identity);

    // 3. Client B joins the same match
    await clientB.conn.reducers.joinMatch({ matchId });
    await waitFor(() =>
      Array.from(clientB.conn.db.myMemberships.iter()).some((m) => m.matchId === matchId)
    );
    const memB = Array.from(clientB.conn.db.myMemberships.iter()).find((m) => m.matchId === matchId)!;
    expect(memB.slot).toBe(1);

    // 4. Both clients receive correct lobby state
    await waitFor(() => {
      const mA = Array.from(clientA.conn.db.match.iter()).find((m) => m.id === matchId);
      const mB = Array.from(clientB.conn.db.match.iter()).find((m) => m.id === matchId);
      return mA?.phase === "lobby" && mB?.phase === "lobby";
    });

    // 5. Client A starts the match
    await clientA.conn.reducers.startMatch({ matchId });
    await waitFor(() => {
      const mA = Array.from(clientA.conn.db.match.iter()).find((m) => m.id === matchId);
      const mB = Array.from(clientB.conn.db.match.iter()).find((m) => m.id === matchId);
      return mA?.phase === "active" && mB?.phase === "active";
    });

    // 6. Each client sees its own authorized ships and structures
    await waitFor(() =>
      Array.from(clientA.conn.db.myShips.iter()).some((s) => s.matchId === matchId) &&
      Array.from(clientB.conn.db.myShips.iter()).some((s) => s.matchId === matchId)
    );
    const shipsA = Array.from(clientA.conn.db.myShips.iter()).filter((s) => s.matchId === matchId);
    const shipsB = Array.from(clientB.conn.db.myShips.iter()).filter((s) => s.matchId === matchId);
    expect(shipsA.length).toBeGreaterThan(0);
    expect(shipsB.length).toBeGreaterThan(0);
    expect(shipsA[0]!.ownerSlot).toBe(0);
    expect(shipsB[0]!.ownerSlot).toBe(1);

    const structA = Array.from(clientA.conn.db.myStructures.iter()).filter((s) => s.matchId === matchId);
    const structB = Array.from(clientB.conn.db.myStructures.iter()).filter((s) => s.matchId === matchId);
    expect(structA.some((s) => s.kind === "command_core" && s.ownerSlot === 0)).toBe(true);
    expect(structB.some((s) => s.kind === "command_core" && s.ownerSlot === 1)).toBe(true);

    // 7. Client A orders its ship to move to valid open water
    const shipA = shipsA[0]!;
    const initialRev = shipA.revision;
    const initialX = shipA.x;
    const targetX = initialX - 3.0; // West into open water away from citadel
    const targetY = shipA.y;

    await clientA.conn.reducers.issueShipOrder({
      shipId: shipA.id,
      targetX,
      targetY,
    });

    // 8. Client A receives authoritative position / velocity updates
    await waitFor(() => {
      const updated = Array.from(clientA.conn.db.myShips.iter()).find((s) => s.id === shipA.id);
      return updated !== undefined && (updated.revision > initialRev || updated.velocityX !== 0 || updated.x !== initialX);
    }, 10000);

    // 9. Visibility check: Client B does NOT receive raw ship data for Client A
    const bShipsSeen = Array.from(clientB.conn.db.myShips.iter()).filter((s) => s.matchId === matchId);
    expect(bShipsSeen.every((s) => s.ownerSlot === 1)).toBe(true);

    // 10. Unauthorized command attempt: Client B attempts to command Client A's ship
    let unauthorizedBlocked = false;
    try {
      await clientB.conn.reducers.issueShipOrder({
        shipId: shipA.id,
        targetX: 10,
        targetY: 10,
      });
    } catch {
      unauthorizedBlocked = true;
    }
    expect(unauthorizedBlocked).toBe(true);

    // 11. Attempted access to private tables is rejected
    let privateSubscriptionRejected = false;
    await new Promise<void>((resolve) => {
      clientA.conn.subscriptionBuilder()
        .onError(() => {
          privateSubscriptionRejected = true;
          resolve();
        })
        .onApplied(() => {
          resolve();
        })
        .subscribe("SELECT * FROM ship");
      setTimeout(resolve, 1500);
    });
    expect(privateSubscriptionRejected).toBe(true);

    // 12. Disconnect and reconnect Client A with original token
    const tokenA = clientA.token;
    clientA.conn.disconnect();

    const clientAReconnected = await connectClient("ClientA_Reconnected", tokenA);
    await clientAReconnected.applied;
    expect(clientAReconnected.identity).toBe(clientA.identity);

    await waitFor(() =>
      Array.from(clientAReconnected.conn.db.myMemberships.iter()).some((m) => m.matchId === matchId)
    );
    const restoredMem = Array.from(clientAReconnected.conn.db.myMemberships.iter()).find(
      (m) => m.matchId === matchId
    )!;
    expect(restoredMem.slot).toBe(0);

    // Cleanup
    clientAReconnected.conn.disconnect();
    clientB.conn.disconnect();
  }, 35000);
});
