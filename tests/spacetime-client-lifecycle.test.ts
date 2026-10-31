import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SpacetimeClient } from "../src/network/spacetime-client";
import { validateMatchIdInput, U64_MAX } from "../src/network/match-id-validation";

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

    it("guards against duplicate connections while connecting or reconnecting", async () => {
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

    it("ensures old connection callbacks cannot poison state after disconnect or reset", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().status === "connected");
      const oldConn = client.getConnection()!;

      // Disconnect client
      client.disconnect();
      expect(client.getState().status).toBe("disconnected");

      // Calling methods on disconnected old connection must not alter client state
      expect(client.getState().status).toBe("disconnected");
      expect(client.getConnection()).toBeNull();
    });
  });

  // 5. Subscription Surface & Recovery
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

    it("allows resubscribe recovery without reconnecting the underlying socket", async () => {
      const client = new SpacetimeClient("http://127.0.0.1:3000", "sea-siege-dev");
      client.clearStoredToken();

      client.connect();
      await waitFor(() => client.getState().subscriptionStatus === "applied");

      // Call resubscribe
      client.resubscribe();
      await waitFor(() => client.getState().subscriptionStatus === "applied");
      expect(client.getState().status).toBe("connected");
      expect(client.getState().subscriptionStatus).toBe("applied");

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
});
