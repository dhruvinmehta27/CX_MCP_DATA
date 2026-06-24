import { useState } from 'react';
import SkeletonCard from './SkeletonCard';
import EmptyState from './EmptyState';
import Icon from './Icon';

export default function ChartCard({ title, subtitle, loading, error, onRefresh, children }) {
  const [expanded, setExpanded] = useState(false);

  const body = loading ? (
    <SkeletonCard />
  ) : error ? (
    <EmptyState title="Could not load data" message={error.message} error />
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
              <button className="btn-icon" title="Refresh" onClick={onRefresh}>
                <Icon name="refresh" size={15} className={loading ? 'spinning' : undefined} />
              </button>
            )}
            <button className="btn-icon" title="Expand" onClick={() => setExpanded(true)}>
              <Icon name="expand" size={15} />
            </button>
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
              <button className="btn-icon" title="Close" onClick={() => setExpanded(false)}>
                <Icon name="close" size={17} />
              </button>
            </div>
            <div className="modal-body">{body}</div>
          </div>
        </div>
      )}
    </>
  );
}
