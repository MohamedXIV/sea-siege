# Sea Siege

**Drowned-industrial top-down naval RTS** — expand connected floating platforms, salvage a flooded world, build ships, command fleets, and besiege rival Command Cores.

**Real stack:** Phaser 4 + TypeScript + Vite + React + Tailwind/shadcn UI; an authoritative SpacetimeDB 2.x TypeScript module, official client SDK and identity-scoped subscriptions.

> **Status (2 Nov 2026): real connected foundation verified, *not yet a complete playable RTS*.** [PR #21](https://github.com/MohamedXIV/sea-siege/pull/21) and [PR #22](https://github.com/MohamedXIV/sea-siege/pull/22) merged to `main`. An owner-run **GitHub Codespaces forwarded-browser** check confirmed a two-human match could start after the controlled `SenderError` fix; SDK/connection, auth, own ships/structures and ship movement are integrated. A whole solo-vs-bot match with map, building, production, combat and victory has **not** been accepted yet. The older [PR #20](https://github.com/MohamedXIV/sea-siege/pull/20) was only the source foundation.

## Active priority: Playable Gemini Parity

**We are rebuilding the fun, not the fake backend.** The next goal is one-click **Quick Play vs a real server-owned Bot**, an authentic known sea map, floating construction, Salvage/ship production, combat, victory/defeat and Rematch.

- [Active Playable Parity roadmap](./docs/PLAYABLE_PARITY_ROADMAP.md)
- [Playable Parity Epic #23](https://github.com/MohamedXIV/sea-siege/issues/23) and implementation issues [#24–#29](https://github.com/MohamedXIV/sea-siege/issues/24)
- [Long-term roadmap](./ROADMAP.md), [master Epic #1](https://github.com/MohamedXIV/sea-siege/issues/1), and [implementation snapshot](./docs/STATUS.md)

**Default design decision for this recovery phase:** full *static terrain map* visible from the start; **no new persistent exploration Fog of War**. Existing tactical enemy contact authorization and private server information must remain secure.

## Primary gameplay reference

The original Gemini prototype and its 18-file source archive are **preserved byte-for-byte** in [`references/gemini/`](./references/gemini/README.md). The HTML file is a playable, local **Canvas 2D prototype using simulated in-browser authority**, despite the architecture-themed filename. It is a reference for enjoyment, feel, visual language, loop and balance, **not** real Phaser or SpacetimeDB code to include in production.

## Development and verification

- [Codespaces and local SpacetimeDB development guide](./docs/DEVELOPMENT.md)
- [Server-authoritative motion ADR](./docs/adr/0001-multiplayer-motion-tickrate.md)
- Real database queries and subscriptions require the actual generated bindings and local SpacetimeDB instance. No credentials or generated bindings should be committed.
- Backend tests, client tests and a production build are important; each new feature also requires a **playable browser check** via private Codespaces port 5173 when possible.
- Keep feature branches/PRs small and reviewable; no unnecessary GitHub Actions. Cloud publication and release packaging remain future work.

**The next acceptance question:** Can one person click Quick Play, build, harvest, produce, fight a bot, finish and rematch — and want another round?
