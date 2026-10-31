import {
  DbConnection,
  type SubscriptionHandle,
} from "../module_bindings";
import type {
  Match,
  MatchMember,
  FactionState,
  Ship,
  Structure,
  DetectedEnemyContact,
} from "../module_bindings/types";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface SpacetimeClientState {
  status: ConnectionStatus;
  identity: string | null;
  error: string | null;
  matches: Match[];
  activeMatchId: bigint | null;
  activeMatch: Match | null;
  myMembership: MatchMember | null;
  myFaction: FactionState | null;
  myShips: Ship[];
  myStructures: Structure[];
  visibleEnemies: DetectedEnemyContact[];
}

export type StateListener = (state: SpacetimeClientState) => void;
export type EntityListener = () => void;

class SpacetimeClient {
  private conn: DbConnection | null = null;
  private subHandle: SubscriptionHandle | null = null;
  private status: ConnectionStatus = "disconnected";
  private identity: string | null = null;
  private error: string | null = null;
  private activeMatchId: bigint | null = null;
  private listeners = new Set<StateListener>();
  private entityListeners = new Set<EntityListener>();
  private refCount = 0;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedState: SpacetimeClientState;

  readonly host: string;
  readonly database: string;

  constructor() {
    this.host =
      import.meta.env.VITE_SPACETIME_HOST || "http://127.0.0.1:3000";
    this.database =
      import.meta.env.VITE_SPACETIME_DATABASE || "sea-siege-dev";
    this.cachedState = this.computeState();
  }

  private tokenStorageKey(): string {
    return `spacetimedb:auth_token:${this.host}/${this.database}`;
  }

  getStoredToken(): string | null {
    try {
      return localStorage.getItem(this.tokenStorageKey());
    } catch {
      return null;
    }
  }

  private setStoredToken(token: string): void {
    try {
      localStorage.setItem(this.tokenStorageKey(), token);
    } catch {
      // storage unavailable / quota exceeded
    }
  }

  clearStoredToken(): void {
    try {
      localStorage.removeItem(this.tokenStorageKey());
    } catch {
      // ignore
    }
  }

  getState(): SpacetimeClientState {
    return this.cachedState;
  }

  private computeState(): SpacetimeClientState {
    const conn = this.conn;
    let matches: Match[] = [];
    let myShips: Ship[] = [];
    let myStructures: Structure[] = [];
    let myMemberships: MatchMember[] = [];
    let myFactionStates: FactionState[] = [];
    let visibleEnemies: DetectedEnemyContact[] = [];

    if (conn && this.status === "connected") {
      try {
        matches = Array.from(conn.db.match.iter());
        myShips = Array.from(conn.db.myShips.iter());
        myStructures = Array.from(conn.db.myStructures.iter());
        myMemberships = Array.from(conn.db.myMemberships.iter());
        myFactionStates = Array.from(conn.db.myFactionStates.iter());
        visibleEnemies = Array.from(conn.db.myVisibleEnemies.iter());
      } catch {
        // Cache during transition
      }
    }

    // Determine active match ID
    let activeMatchId = this.activeMatchId;
    if (activeMatchId === null && myMemberships.length > 0) {
      activeMatchId = myMemberships[myMemberships.length - 1]!.matchId;
    }

    const activeMatch =
      activeMatchId !== null
        ? matches.find((m) => m.id === activeMatchId) || null
        : null;

    const myMembership =
      activeMatchId !== null
        ? myMemberships.find((m) => m.matchId === activeMatchId) || null
        : null;

    const myFaction =
      activeMatchId !== null && myMembership !== null
        ? myFactionStates.find(
            (f) =>
              f.matchId === activeMatchId && f.slot === myMembership.slot
          ) || null
        : null;

    const filteredShips =
      activeMatchId !== null
        ? myShips.filter((s) => s.matchId === activeMatchId)
        : [];

    const filteredStructures =
      activeMatchId !== null
        ? myStructures.filter((s) => s.matchId === activeMatchId)
        : [];

    const filteredEnemies =
      activeMatchId !== null
        ? visibleEnemies.filter((e) => e.matchId === activeMatchId)
        : [];

    return {
      status: this.status,
      identity: this.identity,
      error: this.error,
      matches,
      activeMatchId,
      activeMatch,
      myMembership,
      myFaction,
      myShips: filteredShips,
      myStructures: filteredStructures,
      visibleEnemies: filteredEnemies,
    };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeEntities(listener: EntityListener): () => void {
    this.entityListeners.add(listener);
    return () => {
      this.entityListeners.delete(listener);
    };
  }

  private notify(): void {
    this.cachedState = this.computeState();
    for (const listener of this.listeners) {
      try {
        listener(this.cachedState);
      } catch (err) {
        console.error("Error in state listener:", err);
      }
    }
    for (const el of this.entityListeners) {
      try {
        el();
      } catch (err) {
        console.error("Error in entity listener:", err);
      }
    }
  }

  setActiveMatchId(id: bigint | null): void {
    this.activeMatchId = id;
    this.notify();
  }

  connect(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    if (this.conn && (this.status === "connected" || this.status === "connecting")) {
      return;
    }

    this.status = "connecting";
    this.error = null;
    this.notify();

    const token = this.getStoredToken() || undefined;

    try {
      this.conn = DbConnection.builder()
        .withUri(this.host)
        .withDatabaseName(this.database)
        .withToken(token)
        .withAutomaticReconnect()
        .onConnect((connection, identity, authToken) => {
          this.status = "connected";
          this.identity = identity.toHexString();
          this.setStoredToken(authToken);
          this.error = null;
          this.attachTableCallbacks(connection);
          this.applySubscriptions(connection);
          this.notify();
        })
        .onAutomaticReconnect((_connection, identity, authToken) => {
          this.status = "connected";
          this.identity = identity.toHexString();
          this.setStoredToken(authToken);
          this.error = null;
          this.notify();
        })
        .onConnectError((_ctx, err, nextAttempt, _nextDelay) => {
          this.error = err.message || "Failed to connect to SpacetimeDB";
          this.status = nextAttempt !== undefined ? "reconnecting" : "error";
          this.notify();
        })
        .onDisconnect((_ctx, err, nextAttempt, _nextDelay) => {
          if (err) {
            this.error = err.message;
          }
          this.status = nextAttempt !== undefined ? "reconnecting" : "disconnected";
          this.notify();
        })
        .build();
    } catch (err: any) {
      this.status = "error";
      this.error = err?.message || "Failed to initialize SpacetimeDB connection";
      this.notify();
    }
  }

  private attachTableCallbacks(conn: DbConnection): void {
    const notifyChange = () => this.notify();

    // Table update listeners
    conn.db.match.onInsert(notifyChange);
    conn.db.match.onUpdate(notifyChange);
    conn.db.match.onDelete(notifyChange);

    conn.db.myMemberships.onInsert(notifyChange);
    conn.db.myMemberships.onUpdate(notifyChange);
    conn.db.myMemberships.onDelete(notifyChange);

    conn.db.myFactionStates.onInsert(notifyChange);
    conn.db.myFactionStates.onUpdate(notifyChange);
    conn.db.myFactionStates.onDelete(notifyChange);

    conn.db.myShips.onInsert(notifyChange);
    conn.db.myShips.onUpdate(notifyChange);
    conn.db.myShips.onDelete(notifyChange);

    conn.db.myStructures.onInsert(notifyChange);
    conn.db.myStructures.onUpdate(notifyChange);
    conn.db.myStructures.onDelete(notifyChange);

    conn.db.myVisibleEnemies.onInsert(notifyChange);
    conn.db.myVisibleEnemies.onUpdate(notifyChange);
    conn.db.myVisibleEnemies.onDelete(notifyChange);
  }

  private applySubscriptions(conn: DbConnection): void {
    if (this.subHandle) {
      try {
        this.subHandle.unsubscribe();
      } catch {
        // ignore
      }
    }

    this.subHandle = conn
      .subscriptionBuilder()
      .onApplied(() => {
        this.notify();
      })
      .onError((ctx) => {
        console.error("Subscription error:", ctx);
      })
      .subscribe([
        "SELECT * FROM match",
        "SELECT * FROM my_memberships",
        "SELECT * FROM my_ships",
        "SELECT * FROM my_structures",
        "SELECT * FROM my_faction_states",
        "SELECT * FROM my_visible_enemies",
      ]);
  }

  acquire(): () => void {
    this.refCount++;
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (!this.conn || this.status === "disconnected") {
      this.connect();
    }
    return () => {
      this.refCount--;
      if (this.refCount <= 0) {
        this.refCount = 0;
        // Delay disconnect slightly to handle React StrictMode unmount/mount cycle safely
        this.disconnectTimer = setTimeout(() => {
          if (this.refCount === 0) {
            this.disconnect();
          }
        }, 300);
      }
    };
  }

  disconnect(): void {
    if (this.subHandle) {
      try {
        this.subHandle.unsubscribe();
      } catch {
        // ignore
      }
      this.subHandle = null;
    }
    if (this.conn) {
      try {
        this.conn.disconnect();
      } catch {
        // ignore
      }
      this.conn = null;
    }
    this.status = "disconnected";
    this.notify();
  }

  resetIdentity(): void {
    this.disconnect();
    this.clearStoredToken();
    this.identity = null;
    this.activeMatchId = null;
    this.connect();
  }

  // Authoritative Reducer Actions
  async createMatch(maxSlots = 2): Promise<void> {
    if (!this.conn || this.status !== "connected") {
      throw new Error("Cannot create match: not connected to SpacetimeDB");
    }
    await this.conn.reducers.createMatch({ maxSlots });
  }

  async joinMatch(matchId: bigint): Promise<void> {
    if (!this.conn || this.status !== "connected") {
      throw new Error("Cannot join match: not connected to SpacetimeDB");
    }
    await this.conn.reducers.joinMatch({ matchId });
    this.activeMatchId = matchId;
    this.notify();
  }

  async startMatch(matchId: bigint): Promise<void> {
    if (!this.conn || this.status !== "connected") {
      throw new Error("Cannot start match: not connected to SpacetimeDB");
    }
    await this.conn.reducers.startMatch({ matchId });
  }

  async issueShipOrder(
    shipId: bigint,
    targetX: number,
    targetY: number
  ): Promise<void> {
    if (!this.conn || this.status !== "connected") {
      throw new Error("Cannot order ship: not connected to SpacetimeDB");
    }
    await this.conn.reducers.issueShipOrder({
      shipId,
      targetX,
      targetY,
    });
  }

  getConnection(): DbConnection | null {
    return this.conn;
  }
}

export const spacetimeClient = new SpacetimeClient();
if (typeof window !== "undefined") {
  (window as any).__spacetimeClient = spacetimeClient;
}
