/** Pure bounded observation assembly helpers, independent of SpacetimeDB. */
export type Cell = Readonly<{ x: number; y: number }>;
export type OwnSurface = Readonly<{
  kind: string; channel: string; complete: boolean;
  gridX: number; gridY: number; width: number; height: number;
}>;
export type KnownResource = Readonly<{ id: bigint; gridX: number; gridY: number; remaining: number }>;
export type SensorArea = Readonly<{ position: Cell; radius: number }>;

/** Never provide the decision policy with undetected deposit positions. */
export function visibleResources(
  nodes: readonly KnownResource[],
  sensors: readonly SensorArea[],
  lineOfSight: (from: Cell, to: Cell) => boolean,
): readonly Readonly<{ id: bigint; position: Cell; remaining: number }>[] {
  return nodes.filter(node => node.remaining > 0 && sensors.some(sensor => {
    const target = { x: node.gridX + 0.5, y: node.gridY + 0.5 };
    return Number.isFinite(sensor.radius) && sensor.radius >= 0 &&
      Math.hypot(sensor.position.x - target.x, sensor.position.y - target.y) <= sensor.radius &&
      lineOfSight(sensor.position, target);
  })).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(node => ({
      id: node.id, position: { x: node.gridX + 0.5, y: node.gridY + 0.5 },
      remaining: node.remaining,
    }));
}

/** Surface extension searches the frontier; mounted builds try existing pads first. */
export function orderedBuildOrigins(
  structures: readonly OwnSurface[], mapCells: number, mounted: boolean,
): readonly Cell[] {
  if (!Number.isInteger(mapCells) || mapCells < 2) throw new RangeError('Invalid map cells');
  const cells = new Map<string, Cell>(), pads = new Map<string, Cell>();
  const include = (map: Map<string, Cell>, x: number, y: number) => {
    if (x > 0 && y > 0 && x < mapCells - 1 && y < mapCells - 1)
      map.set(x + ':' + y, { x, y });
  };
  for (const st of structures) {
    if (st.channel !== 'surface' || !st.complete) continue;
    for (let dy=-1;dy<=st.height;dy++)for(let dx=-1;dx<=st.width;dx++)
      include(cells,st.gridX+dx,st.gridY+dy);
    if (st.kind === 'platform')for(let dy=0;dy<st.height;dy++)
      for(let dx=0;dx<st.width;dx++)include(pads,st.gridX+dx,st.gridY+dy);
  }
  const order = (a: Cell,b:Cell) => a.y-b.y || a.x-b.x;
  const all=[...cells.values()].sort(order);
  if (!mounted) return all;
  return [...pads.values()].sort(order).concat(all.filter(c=>!pads.has(c.x+':'+c.y)));
}
