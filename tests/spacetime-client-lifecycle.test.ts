import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SpacetimeClient } from "../src/network/spacetime-client";
import { validateMatchIdInput, U64_MAX } from "../src/network/match-id-validation";
import { DbConnection } from "../src/module_bindings";

function waitFor(predicate: () => boolean, timeoutMs = 10000, intervalMs = 50): Promise<void> {
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

describe("P0 Stabilization Verification Suite", () => {
  // 1. Validate Manual Match IDs
  describe("Priority 3: Manual Match ID Validation", () => {
    it("rejects empty, blank, and whitespace-only inputs", () => {
      expect(validateMatchIdInput("").valid).toBe(false);
      expect(validateMatchIdInput("   ").valid).toBe(false);
      expect(validateMatchIdInput("\t\n").valid).toBe(false);
    });

    it("rejects non-decimal, negative, fractional, and alphanumeric strings", () => {
      const invalid = ["abc", "-1", "-100", "3.14", "0x10", "12a", "1e5", "++2"];
      for (const input of invalid) {
        const res = validateMatchIdInput(input);
        expect(res.valid).toBe(false);
        if (!res.valid) {
          expect(res.error).toBe("Match ID must be a positive decimal number");
        }
      }
    });

    it("rejects zero Match ID", () => {
      const res = validateMatchIdInput("0");
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toBe("Match ID must be greater than zero");
      }
    });

    it("rejects values exceeding 64-bit unsigned integer maximum", () => {
      const overflow = "18446744073709551616"; // U64_MAX + 1
      const huge = "99999999999999999999999999999";
      for (const input of [overflow, huge]) {
        const res = validateMatchIdInput(input);
        expect(res.valid).toBe(false);
        if (!res.valid) {
          expect(res.error).toBe("Match ID exceeds maximum 64-bit integer value");
        }
      }
    });

    it("accepts valid positive decimal u64 values including boundary values", () => {
      const res1 = validateMatchIdInput("1");
      expect(res1.valid).toBe(true);
      if (res1.valid) expect(res1.value).toBe(1n);

      const res42 = validateMatchIdInput("  42  ");
      expect(res42.valid).toBe(true);
      if (res42.valid) expect(res42.value).toBe(42n);

      const maxStr = U64_MAX.toString();
      const resMax = validateMatchIdInput(maxStr);
      expect(resMax.valid).toBe(true);
      if (resMax.valid) expect(resMax.value).toBe(U64_MAX);
    });
  });

  // 2. Production build inspection
  describe("Priority 5: Restrict Development Globals", () => {
    it("ensures window.__spacetimeClient is absent from the production build bundle", () => {
      const distAssetsDir = join(process.cwd(), "dist", "assets");
      const files = readdirSync(distAssetsDir).filter((f) => f.endsWith(".js"));
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const content = readFileSync(join(distAssetsDir, file), "utf-8");
        expect(content).not.toContain("__spacetimeClient");
      }
    });
  });

  // 3. StrictMode Mount/Unmount & Debounced Cleanup
  describe("Priority 1: StrictMode Lifecycle and Cleanup", () => {
    it("debounces rapid unmount/mount cycle without tearing down socket", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      // First mount
      const release1 = client.acquire();
      expect(client.getState().status).toBe("connecting");

      // StrictMode immediate unmount
      release1();

      // Immediate remount before 300ms debounce
      const release2 = client.acquire();

      // Wait 350ms to ensure the timer was cancelled and did NOT disconnect
      await new Promise((r) => setTimeout(r, 350));
      await waitFor(() => client.getState().status === "connected");
      expect(client.getState().status).toBe("connected");

      // Now final unmount
      release2();
      // Wait for debounce timer to fire
      await new Promise((r) => setTimeout(r, 350));
      expect(client.getState().status).toBe("disconnected");
    });

    it("aborts safely when disconnect is called during a pending connection", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      expect(client.getState().status).toBe("connecting");

      // Disconnect immediately before WebSocket connection handshakes
      client.disconnect();
      expect(client.getState().status).toBe("disconnected");

      // Wait 400ms to verify no late connect callback flips status to connected
      await new Promise((r) => setTimeout(r, 400));
      expect(client.getState().status).toBe("disconnected");
    });

    it("guards against duplicate connections while connecting", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      const firstConn = client.getConnection();
      expect(client.getState().status).toBe("connecting");

      // Call connect again while already connecting
      client.connect();
      const secondConn = client.getConnection();
      // Must be the same instance; duplicate builder not invoked
      expect(secondConn).toBe(firstConn);

      client.disconnect();
    });

    it("enters reconnecting state on connection drop and ignores repeated connect() calls during reconnecting", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().status === "connected");
      expect(client.getState().status).toBe("connected");

      const activeConn = client.getConnection() as any;
      expect(activeConn).not.toBeNull();

      // Simulate connection loss by closing the underlying WebSocket
      activeConn.ws?.close(1006, "Simulated network drop");

      // SpacetimeDB withAutomaticReconnect triggers onDisconnect with nextAttempt defined
      await waitFor(() => client.getState().status === "reconnecting");
      expect(client.getState().status).toBe("reconnecting");
      const reconnectingConn = client.getConnection();
      expect(reconnectingConn).toBe(activeConn);

      // Calling connect() while in reconnecting state must be guarded and not replace the connection
      client.connect();
      client.connect();
      expect(client.getState().status).toBe("reconnecting");
      expect(client.getConnection()).toBe(reconnectingConn);

      // Verify connection recovers automatically to connected
      await waitFor(() => client.getState().status === "connected", 10000);
      expect(client.getState().status).toBe("connected");

      client.disconnect();
      expect(client.getState().status).toBe("disconnected");
    });
  });

  // 4. Reset Identity and Stale Callback Invalidation
  describe("Priority 1: Identity Reset & Stale Callback Invalidation", () => {
    it("invalidates stale callbacks when identity is reset while connected", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().status === "connected");
      const firstIdentity = client.getState().identity;
      expect(firstIdentity).toBeTruthy();

      // Reset identity triggers disconnect, token clearance, and new connect
      client.resetIdentity();
      await waitFor(() => client.getState().status === "connected" && client.getState().identity !== firstIdentity);

      const secondIdentity = client.getState().identity;
      expect(secondIdentity).toBeTruthy();
      expect(secondIdentity).not.toBe(firstIdentity);

      client.disconnect();
    });

    it("discards deliberately delayed stale callbacks after resetIdentity()", async () => {
      let capturedOnConnect: ((conn: any, id: any, token: string) => void) | null = null;
      let capturedOnReconnect: ((conn: any, id: any, token: string) => void) | null = null;
      let capturedOnDisconnect: ((ctx: any, err: any, nextAttempt: any, nextDelay: any) => void) | null = null;

      const originalBuilder = DbConnection.builder;
      DbConnection.builder = function () {
        const builder = originalBuilder.call(DbConnection);
        const origOnConnect = builder.onConnect.bind(builder);
        const origOnReconnect = builder.onAutomaticReconnect.bind(builder);
        const origOnDisconnect = builder.onDisconnect.bind(builder);

        builder.onConnect = function (cb: any) {
          if (!capturedOnConnect) capturedOnConnect = cb;
          return origOnConnect(cb);
        };
        builder.onAutomaticReconnect = function (cb: any) {
          if (!capturedOnReconnect) capturedOnReconnect = cb;
          return origOnReconnect(cb);
        };
        builder.onDisconnect = function (cb: any) {
          if (!capturedOnDisconnect) capturedOnDisconnect = cb;
          return origOnDisconnect(cb);
        };
        return builder;
      };

      try {
        const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
        client.clearStoredToken();

        client.connect();
        await waitFor(() => client.getState().status === "connected");
        const firstIdentity = client.getState().identity;
        expect(firstIdentity).toBeTruthy();
        expect(capturedOnConnect).not.toBeNull();

        const staleOnConnect = capturedOnConnect!;
        const staleOnReconnect = capturedOnReconnect!;
        const staleOnDisconnect = capturedOnDisconnect!;

        // Reset identity, creating a new connection generation
        client.resetIdentity();
        await waitFor(() => client.getState().status === "connected" && client.getState().identity !== firstIdentity);
        const freshIdentity = client.getState().identity;
        expect(freshIdentity).toBeTruthy();
        expect(freshIdentity).not.toBe(firstIdentity);

        // Inject stale onConnect callback from previous generation with forged identity
        const fakeOldId = { toHexString: () => "0000000000000000stale_identity" };
        staleOnConnect({}, fakeOldId, "stale_token");

        // Assert state was NOT poisoned by stale callback
        expect(client.getState().identity).toBe(freshIdentity);
        expect(client.getState().identity).not.toBe("0000000000000000stale_identity");

        // Inject stale onAutomaticReconnect callback
        staleOnReconnect({}, fakeOldId, "stale_token");
        expect(client.getState().identity).toBe(freshIdentity);

        // Inject stale onDisconnect callback
        staleOnDisconnect({}, new Error("stale error"), undefined, undefined);
        expect(client.getState().status).toBe("connected");
        expect(client.getState().error).toBeNull();

        client.disconnect();
      } finally {
        DbConnection.builder = originalBuilder;
      }
    });

    it("ensures old connection callbacks cannot poison state after disconnect", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().status === "connected");

      // Disconnect client
      client.disconnect();
      expect(client.getState().status).toBe("disconnected");

      // Calling methods on disconnected old connection must not alter client state
      expect(client.getState().status).toBe("disconnected");
      expect(client.getConnection()).toBeNull();
    });
  });

  // 5. Subscription Surface, Recovery & Listener Deduplication
  describe("Priority 4: Surface Subscription State and Recovery", () => {
    it("marks subscription as applied once authorized views are received", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().status === "connected");
      await waitFor(() => client.getState().subscriptionStatus === "applied");

      expect(client.getState().status).toBe("connected");
      expect(client.getState().subscriptionStatus).toBe("applied");
      expect(client.getState().error).toBeNull();

      client.disconnect();
    });

    it("allows resubscribe recovery without accumulating duplicate table subscriptions or listeners", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().subscriptionStatus === "applied");

      // Call resubscribe multiple times
      client.resubscribe();
      await waitFor(() => client.getState().subscriptionStatus === "applied");
      client.resubscribe();
      await waitFor(() => client.getState().subscriptionStatus === "applied");

      expect(client.getState().status).toBe("connected");
      expect(client.getState().subscriptionStatus).toBe("applied");

      // Verify that table callbacks were bound once and not duplicated
      const conn = client.getConnection();
      expect((client as any).tableCallbacksBoundConnection).toBe(conn);

      client.disconnect();
    });

    it("verifies server rejects unauthorized direct queries to private tables", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();
      client.connect();
      await waitFor(() => client.getState().subscriptionStatus === "applied");

      let errorFired = false;
      await new Promise<void>((resolve) => {
        client.getConnection()!.subscriptionBuilder()
          .onError(() => {
            errorFired = true;
            resolve();
          })
          .onApplied(() => {
            resolve();
          })
          .subscribe("SELECT * FROM ship");
        setTimeout(resolve, 2000);
      });

      expect(errorFired).toBe(true);
      client.disconnect();
    });
  });

  // 6. Deterministic Match Selection & Explicit Switch
  describe("Priority 2: Deterministic Match Selection and Switching", () => {
    let client: SpacetimeClient;

    beforeAll(async () => {
      client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();
      client.connect();
      await waitFor(() => client.getState().subscriptionStatus === "applied");
    });

    afterAll(() => {
      client.disconnect();
    });

    it("deterministically selects the newly created match when creating consecutive matches", async () => {
      // Create first match
      await client.createMatch(2);
      await waitFor(() => client.getState().activeMatchId !== null);
      const match1Id = client.getState().activeMatchId;
      expect(match1Id).not.toBeNull();
      expect(client.getState().activeMatch?.id).toBe(match1Id);

      // Create second match
      await client.createMatch(2);
      await waitFor(() => {
        const current = client.getState().activeMatchId;
        return current !== null && current !== match1Id;
      });

      const match2Id = client.getState().activeMatchId;
      expect(match2Id).not.toBeNull();
      expect(match2Id).not.toBe(match1Id);
      expect(client.getState().activeMatch?.id).toBe(match2Id);

      // Explicitly switch back to match 1
      client.setActiveMatchId(match1Id);
      expect(client.getState().activeMatchId).toBe(match1Id);
      expect(client.getState().activeMatch?.id).toBe(match1Id);

      // Explicitly switch back to match 2 using joinMatch (which safely acts as a switch for existing memberships)
      await client.joinMatch(match2Id!);
      expect(client.getState().activeMatchId).toBe(match2Id);
      expect(client.getState().activeMatch?.id).toBe(match2Id);
    });
  });

  // 7. Codespaces Browser Preview Same-Origin Proxy
  describe("Codespaces Browser Preview Same-Origin Proxy", () => {
    it("connects and applies subscriptions through the Vite dev proxy on port 5173", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:5173", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().status === "connected", 8000);
      await waitFor(() => client.getState().subscriptionStatus === "applied", 8000);

      expect(client.getState().status).toBe("connected");
      expect(client.getState().subscriptionStatus).toBe("applied");
      expect(client.getState().identity).toBeTruthy();

      client.disconnect();
    }, 10000);

    it("resolves same-origin host in browser environment when accessing remote Codespaces hostname", () => {
      const originalWindow = globalThis.window;
      try {
        (globalThis as any).window = {
          location: {
            origin: "https://my-codespace-5173.app.github.dev",
            hostname: "my-codespace-5173.app.github.dev",
          },
        };

        const client = new SpacetimeClient();
        expect(client.host).toBe("https://my-codespace-5173.app.github.dev");
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });
  });

  // 8. Single-Member Lobby Rejection Regression (Controlled SenderError)
  describe("Single-Member Lobby Rejection Regression", () => {
    it("rejects 1-member startMatch with SenderError rather than crashing the instance", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().status === "connected", 8000);
      await waitFor(() => client.getState().subscriptionStatus === "applied", 8000);

      // Create a new match (host only, 1 member)
      await client.createMatch(2);
      await waitFor(() => client.getState().activeMatchId !== null, 8000);
      const matchId = client.getState().activeMatchId!;

      let caughtError: any = null;
      try {
        await client.startMatch(matchId);
      } catch (err: any) {
        caughtError = err;
      }

      // Must be a graceful SenderError with exact reducer message, NOT InternalError fatal crash
      expect(caughtError).toBeTruthy();
      expect(caughtError.name).toBe("SenderError");
      expect(caughtError.message).toBe("Need at least two actual members");

      // Verify client connection and subscriptions remain healthy and applied
      expect(client.getState().status).toBe("connected");
      expect(client.getState().subscriptionStatus).toBe("applied");

      client.disconnect();
    });

    it("rejects startMatch from a non-host with SenderError", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().status === "connected", 8000);
      await waitFor(() => client.getState().subscriptionStatus === "applied", 8000);

      let caughtError: any = null;
      try {
        await client.startMatch(33n); // Match 33 is owned by another identity
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).toBeTruthy();
      expect(caughtError.name).toBe("SenderError");
      expect(caughtError.message).toBe("Only the host may start");

      expect(client.getState().status).toBe("connected");
      expect(client.getState().subscriptionStatus).toBe("applied");

      client.disconnect();
    });
  });
});
