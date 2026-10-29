# Sea Siege

**Drowned-industrial top-down naval RTS** — build connected floating platforms, salvage the flooded world, command fleets and besiege rival bases. Planned for 2–8 human/bot factions.

**Stack:** Phaser 4 + TypeScript + Vite + React + Tailwind + shadcn/ui (frontend scaffold); SpacetimeDB TypeScript authoritative module (backend source, not yet published).

> **Status: Experimental foundation merged on 30 Oct 2026 — NOT playable multiplayer.** [PR #20](https://github.com/MohamedXIV/sea-siege/pull/20) consolidated the source implementation. The Phaser scene still says **Backend not connected**. No generated SpacetimeDB client bindings, published/verified server module, authenticated two-browser match, Bot E2E or Fog security audit exists yet. The original Gemini prototype remains reference-only.

## Project planning

- [Current issue status and unverified gates](./docs/STATUS.md)
- [Roadmap and delivery gates](./ROADMAP.md)
- [ADR-0001: Server-authoritative motion and smooth ship rendering](./docs/adr/0001-multiplayer-motion-tickrate.md)
- [Master implementation epic (#1)](https://github.com/MohamedXIV/sea-siege/issues/1)
- [All implementation issues](https://github.com/MohamedXIV/sea-siege/issues)

**Next P0 acceptance work:** install/typecheck/build and real SpacetimeDB SDK module verification ([#2](https://github.com/MohamedXIV/sea-siege/issues/2), [#3](https://github.com/MohamedXIV/sea-siege/issues/3), [#6](https://github.com/MohamedXIV/sea-siege/issues/6)), then generated client bindings, authenticated Phaser subscriptions and two-browser reconnect ([#4](https://github.com/MohamedXIV/sea-siege/issues/4), [#5](https://github.com/MohamedXIV/sea-siege/issues/5)).

Each deliverable must be verified against its issue's acceptance criteria. We will not use a fake browser-local authority as a substitute for SpacetimeDB.

## Original Gemini reference artifacts

The original Gemini web-chat prototype and its 18-file source archive are preserved as **byte-identical reference artifacts** under [`references/gemini/`](./references/gemini/README.md). They are **not** the production runtime or evidence of genuine Phaser/SpacetimeDB integration. Use them to port tested gameplay rules selectively.
