import { memo, useMemo } from 'react';
import { cx } from './cx';
import s from './StopGraph.module.css';

export interface GraphStop {
  id: string;
  name: string;
  area: 'campus' | 'city';
  lat: number;
  lng: number;
}
export interface GraphEdge {
  nodeAId: string;
  nodeBId: string;
}

const W = 560;
const H = 320;
const PAD = { left: 24, right: 96, top: 26, bottom: 26 };
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairs = (route: readonly string[]) => {
  const set = new Set<string>();
  for (let i = 0; i < route.length - 1; i++) set.add(key(route[i]!, route[i + 1]!));
  return set;
};

/** Projects lat/lng into the fixed 560×320 viewBox, keeping the aspect ratio (equirectangular). */
function layout(stops: readonly GraphStop[]) {
  const lat0 = (stops.reduce((a, n) => a + n.lat, 0) / Math.max(1, stops.length)) * (Math.PI / 180);
  const xs = stops.map((n) => n.lng * Math.cos(lat0));
  const ys = stops.map((n) => -n.lat);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const w = W - PAD.left - PAD.right;
  const h = H - PAD.top - PAD.bottom;
  const scale = Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1));
  const ox = PAD.left + (w - (maxX - minX) * scale) / 2;
  const oy = PAD.top + (h - (maxY - minY) * scale) / 2;
  return new Map(
    stops.map((n, i) => [
      n.id,
      { x: ox + (xs[i]! - minX) * scale, y: oy + (ys[i]! - minY) * scale },
    ]),
  );
}

/**
 * The Matches stop graph in SVG: your route 3px solid ink, the selected match's route 3px
 * dashed in the rides fill, shared segments 5px fill, other edges 1.5px line. Positions are
 * laid out once per graph (memoised); changing the routes only restyles. The drawing is
 * hidden from screen readers; `summary` (the routes as text) is read instead.
 */
export const StopGraph = memo(function StopGraph({
  stops,
  edges,
  mine,
  theirs,
  summary,
}: {
  stops: readonly GraphStop[];
  edges: readonly GraphEdge[];
  /** Stop ids along your route, in order. */
  mine: readonly string[];
  /** Stop ids along the selected match's route. */
  theirs: readonly string[];
  summary: string[];
}) {
  const at = useMemo(() => layout(stops), [stops]);
  const mineEdges = useMemo(() => pairs(mine), [mine]);
  const theirEdges = useMemo(() => pairs(theirs), [theirs]);
  const ends = new Set([mine[0], mine[mine.length - 1]]);
  return (
    <figure className={s.figure}>
      <svg className={s.svg} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
        {edges.map((e) => {
          const a = at.get(e.nodeAId);
          const b = at.get(e.nodeBId);
          if (!a || !b) return null;
          const k = key(e.nodeAId, e.nodeBId);
          const m = mineEdges.has(k);
          const t = theirEdges.has(k);
          return (
            <line
              key={k}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={cx(s.edge, m && t ? s.shared : t ? s.theirs : m ? s.mine : s.other)}
            />
          );
        })}
        {stops.map((n) => {
          const p = at.get(n.id)!;
          const onMine = mine.includes(n.id);
          const onTheirs = theirs.includes(n.id);
          const r = ends.has(n.id) ? 7 : 5;
          const on = onMine || onTheirs;
          return (
            <g key={n.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={r - 1}
                className={onMine ? s.nodeMine : onTheirs ? s.nodeTheirs : s.node}
              />
              {(on || n.area === 'city') && (
                <text x={p.x + r + 4} y={p.y - r - 2} className={cx(s.label, on && s.labelOn)}>
                  {n.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="uv-visually-hidden">
        <ul>
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
});
