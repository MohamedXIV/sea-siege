# Sea Siege

**Drowned-industrial top-down naval RTS** — build connected floating platforms, salvage the flooded world, command fleets and besiege rival bases. Planned for 2–8 human/bot factions.

**Planned stack:** Phaser 4 + TypeScript + Vite + React + Tailwind + shadcn/ui, with real SpacetimeDB server-authoritative multiplayer.

> **Status: Planning / foundation pending.** The former Gemini local prototype and extracted source are reference material, not a verified connected game or the production server. No playable new-stack release is claimed yet.

## Project planning

- [Roadmap and delivery gates](./ROADMAP.md)
- [ADR-0001: Server-authoritative motion and smooth ship rendering](./docs/adr/0001-multiplayer-motion-tickrate.md)
- [Master implementation epic (#1)](https://github.com/MohamedXIV/sea-siege/issues/1)
- [All implementation issues](https://github.com/MohamedXIV/sea-siege/issues)

Initial ready work: [#2 — frontend toolchain](https://github.com/MohamedXIV/sea-siege/issues/2) and [#3 — real SpacetimeDB module](https://github.com/MohamedXIV/sea-siege/issues/3).

Each deliverable must be verified against its issue's acceptance criteria. We will not use a fake browser-local authority as a substitute for SpacetimeDB.

## Original Gemini reference artifacts

The original Gemini web-chat prototype and its 18-file source archive are preserved as **byte-identical reference artifacts** under [`references/gemini/`](./references/gemini/README.md). They are **not** the production runtime or evidence of genuine Phaser/SpacetimeDB integration. Use them to port tested gameplay rules selectively.
