# Gemini original reference artifacts

These files are the **unaltered original outputs** of the Gemini web-chat prototype used to inform the Sea Siege rebuild. They are archived here strictly as source/reference material and should **not** be considered a working Phaser 4 or SpacetimeDB integration.

| File | SHA-256 | Bytes | Notes |
|---|---|---:|---|
| [`sea_siege_project.zip`](./sea_siege_project.zip) | `a674e76e9bb1e716e5745fd76bc9439b2c0ea80df87ff833d05383eec951ef3a` | 88,274 | Original 18-entry source archive, exactly preserved (ZIP) |
| [`sea_siege_drowned_industrial_naval_rts_spacetimedb_phaser_4_architecture.html`](./sea_siege_drowned_industrial_naval_rts_spacetimedb_phaser_4_architecture.html) | `3329db56570cfd575d71fa704fa720830906e76751f5f84ba6fbed153b6e753f` | 211,948 | Original single-page local-playable prototype, exactly preserved (HTML) |

## Use in the real-stack rebuild

- Prefer salvaging data-driven balance, procedural world generation, construction, fleet and combat rules, economy, bots and tests after reviewing their behavior.
- Never import the old `SpacetimeAuthorityServer` / in-memory fake `DbConnection` into the real backend or treat the Canvas 2D renderer as Phaser 4.
- The new implementation lives outside this folder. Check [the roadmap](../../ROADMAP.md), [the epic](https://github.com/MohamedXIV/sea-siege/issues/1), and [the real-stack foundation draft](https://github.com/MohamedXIV/sea-siege/pull/20).
- These files should be treated as **frozen archives**. If a change is needed, create a new, separately named derived file, preserving the originals and their checksums.

To verify locally:

```sh
sha256sum references/gemini/sea_siege_project.zip references/gemini/*.html
```
