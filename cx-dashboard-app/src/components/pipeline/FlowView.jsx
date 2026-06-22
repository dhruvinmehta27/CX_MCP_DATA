import { useMemo } from 'react';
import { ResponsiveContainer, Sankey, Tooltip, Layer, Rectangle } from 'recharts';
import ErrorBoundary from '../ui/ErrorBoundary';
import Icon from '../ui/Icon';
import { fmtCurrency, fmtNumber } from '../../utils/formatters';
import { CHART_COLORS, COLORS } from '../../utils/colors';

const KIND_COLOR = { won: COLORS.success, lost: COLORS.danger, progress: COLORS.primary };

function nodeColor(name, i) {
  if (name === 'Won') return COLORS.success;
  if (name === 'Lost') return COLORS.danger;
  return CHART_COLORS[i % CHART_COLORS.length];
}

function SankeyNode({ x, y, width, height, index, payload }) {
  const color = nodeColor(payload.name, index);
  const labelLeft = x < 120;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.95} radius={2} />
      <text
        x={labelLeft ? x + width + 6 : x - 6}
        y={y + height / 2}
        textAnchor={labelLeft ? 'start' : 'end'}
        dominantBaseline="middle"
        fontSize={12}
        fill={COLORS.text}
        fontWeight={600}
      >
        {payload.name}
      </text>
    </Layer>
  );
}

function SankeyLink(props) {
  const { sourceX, sourceY, sourceControlX, targetControlX, targetX, targetY, linkWidth, payload } = props;
  const color = KIND_COLOR[payload.kind] || COLORS.primary;
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(linkWidth, 1)}
      strokeOpacity={0.32}
    />
  );
}

export default function FlowView({ flow }) {
  // Recharts Sankey indexes links by node position, so drop unused nodes and
  // remap link indices to avoid layout errors on sparse pipelines.
  const data = useMemo(() => {
    if (!flow?.links?.length) return null;
    const used = new Set();
    flow.links.forEach((l) => {
      used.add(l.source);
      used.add(l.target);
    });
    const kept = flow.nodes.map((n, i) => ({ n, i })).filter(({ i }) => used.has(i));
    const remap = new Map(kept.map(({ i }, newIdx) => [i, newIdx]));
    return {
      nodes: kept.map(({ n }) => ({ name: n.name })),
      links: flow.links.map((l) => ({
        source: remap.get(l.source),
        target: remap.get(l.target),
        value: l.value,
        amount: l.amount,
        kind: l.kind,
      })),
    };
  }, [flow]);

  if (!data || data.nodes.length < 2) {
    return (
      <div className="flow-empty">
        <Icon name="funnel" size={26} />
        <p>Not enough stage movement to render a flow for the current filters.</p>
      </div>
    );
  }

  return (
    <div className="flow-view">
      <div className="flow-legend">
        <span><i style={{ background: COLORS.primary }} /> Progression</span>
        <span><i style={{ background: COLORS.success }} /> Won</span>
        <span><i style={{ background: COLORS.danger }} /> Lost</span>
      </div>
      <div className="flow-canvas">
        <ErrorBoundary key={JSON.stringify(data.links.length)}>
          <ResponsiveContainer width="100%" height={420}>
            <Sankey
              data={data}
              node={<SankeyNode />}
              link={<SankeyLink />}
              nodePadding={28}
              nodeWidth={14}
              margin={{ top: 16, bottom: 16, left: 90, right: 90 }}
            >
              <Tooltip
                contentStyle={{ borderRadius: 10, border: '1px solid #E5E9ED', fontSize: 12 }}
                formatter={(v, _n, item) => {
                  const p = item?.payload?.payload;
                  if (p && p.amount != null) return [`${fmtNumber(p.value)} deals · ${fmtCurrency(p.amount)}`, 'Flow'];
                  return [fmtNumber(v), 'Flow'];
                }}
              />
            </Sankey>
          </ResponsiveContainer>
        </ErrorBoundary>
      </div>
      <div className="flow-note">
        <Icon name="alert-triangle" size={13} />
        <span>
          <strong>Snapshot-derived flow.</strong> C4C OData exposes each opportunity's current stage only — not its
          stage-by-stage history. Progression links approximate movement from the live stage distribution; Won/Lost
          flows originate from each closed deal's final recorded phase. A faithful historical Sankey needs a
          stage-transition source (see hand-off notes).
        </span>
      </div>
    </div>
  );
}
