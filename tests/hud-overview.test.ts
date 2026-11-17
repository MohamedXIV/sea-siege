import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HudOverview } from "../src/components/hud/HudOverview";
import type { HudSummary } from "../src/components/hud/hud-view-model";

const summary: HudSummary = {
  connected: true,
  fleetCount: 12,
  structureCount: 9,
  enemyAssetCount: 4,
  materials: { iron: 2400, oil: 30, alloy: 0, isotope: 3 },
};

describe("HUD glanceable overview", () => {
  it("labels all server-derived numbers without relying only on color", () => {
    const html = renderToStaticMarkup(createElement(HudOverview, { summary }));
    expect(html).toContain("Iron Scrap");
    expect(html).toContain("2,400");
    expect(html).toContain("Alloy");
    expect(html).toContain("Fleet");
    expect(html).toContain("Structures");
    expect(html).toContain("Enemy assets");
    expect(html).toContain("12");
    expect(html).toContain("9");
    expect(html).toContain("4");
    expect(html).toContain('aria-label="Owned material balances"');
  });

  it("renders unknown data as unavailable rather than a false zero", () => {
    const html = renderToStaticMarkup(createElement(HudOverview, {
      summary: {
        connected: false,
        fleetCount: null,
        structureCount: null,
        enemyAssetCount: null,
        materials: { iron: null, oil: null, alloy: null, isotope: null },
      },
    }));
    expect(html).toContain("Waiting for match data");
    expect(html).not.toContain('data-resource-amount="0"');
    expect(html).toContain('data-resource-amount="unknown"');
    expect(html).not.toContain('data-hud-count="0"');
  });

  it("keeps the current selection visible outside the collapsible command dock", () => {
    const html = renderToStaticMarkup(createElement(HudOverview, {
      summary,
      selectionLabel: "2 ships selected",
    }));
    expect(html).toContain('data-hud-selection="true"');
    expect(html).toContain("2 ships selected");
  });
});
