import { useState } from 'react';
import SkeletonCard from './SkeletonCard';
import EmptyState from './EmptyState';

export default function ChartCard({ title, subtitle, loading, error, onRefresh, children }) {
  const [expanded, setExpanded] = useState(false);

  const body = loading ? (
    <SkeletonCard />
  ) : error ? (
    <EmptyState icon="⚠️" title="Could not load data" message={error.message} error />
  ) : (
    children
  );

  return (
    <>
      <div className="card chart-card">
        <div className="chart-card-header">
          <div>
            <div className="chart-card-title">{title}</div>
            {subtitle && <div className="chart-card-subtitle">{subtitle}</div>}
          </div>
          <div className="chart-card-actions">
            {onRefresh && (
              <button className="btn-icon" title="Refresh" onClick={onRefresh}>⟳</button>
            )}
            <button className="btn-icon" title="Expand" onClick={() => setExpanded(true)}>⤢</button>
          </div>
        </div>
        <div className="chart-card-body">{body}</div>
      </div>

      {expanded && (
        <div className="modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="chart-card-header">
              <div>
                <div className="chart-card-title">{title}</div>
                {subtitle && <div className="chart-card-subtitle">{subtitle}</div>}
              </div>
              <button className="btn-icon" title="Close" onClick={() => setExpanded(false)}>✕</button>
            </div>
            <div className="modal-body">{body}</div>
          </div>
        </div>
      )}
    </>
  );
}
