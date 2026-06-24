import Icon from '../ui/Icon';
import { fmtCurrency, fmtNumber } from '../../utils/formatters';
import { CHART_COLORS } from '../../utils/colors';

/**
 * Conversion funnel. Bar width is proportional to opportunity count; the
 * connector between stages shows stage-to-stage conversion and drop-off, with
 * the worst drop-off highlighted. An optional previous-period overlay compares
 * counts and overall win rate.
 */
export default function FunnelView({ funnel, comparing, previous, loadingCompare, onToggleCompare }) {
  const stages = funnel?.stages || [];
  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  const prevByStage = new Map((previous?.stages || []).map((s) => [s.stage, s]));

  return (
    <div className="funnel-view">
      <div className="funnel-header">
        <div className="funnel-winrate">
          <span className="funnel-winrate-label">Overall win rate</span>
          <span className="funnel-winrate-value">{funnel?.overallWinRate == null ? '–' : `${funnel.overallWinRate}%`}</span>
          {comparing && previous?.overallWinRate != null && (
            <span className={`delta ${funnel.overallWinRate >= previous.overallWinRate ? 'up' : 'down'}`}>
              {funnel.overallWinRate >= previous.overallWinRate ? '▲' : '▼'}{' '}
              {Math.abs(funnel.overallWinRate - previous.overallWinRate)} pts vs prev
            </span>
          )}
        </div>
        <button className={`btn btn-sm${comparing ? '' : ' btn-ghost'}`} onClick={onToggleCompare} disabled={loadingCompare}>
          <Icon name={loadingCompare ? 'refresh' : 'trending-up'} size={14} className={loadingCompare ? 'spinning' : undefined} />
          {comparing ? 'Comparing to previous period' : 'Compare to previous period'}
        </button>
      </div>

      <div className="funnel-stages">
        {stages.map((s, i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length];
          const width = 30 + (s.count / maxCount) * 70; // 30%..100%
          const prev = prevByStage.get(s.stage);
          return (
            <div className="funnel-stage" key={s.stage}>
              <div className="funnel-bar-wrap">
                <div
                  className={`funnel-bar${s.highDropOff ? ' funnel-bar-risk' : ''}`}
                  style={{ width: `${width}%`, background: color }}
                >
                  <span className="funnel-bar-stage">{s.stage}</span>
                  <span className="funnel-bar-figures">
                    {fmtNumber(s.count)} · {fmtCurrency(s.totalValue)}
                  </span>
                </div>
                {comparing && prev && (
                  <div className="funnel-prev" style={{ width: `${30 + (prev.count / maxCount) * 70}%` }} title={`Previous: ${fmtNumber(prev.count)}`}>
                    prev {fmtNumber(prev.count)}
                  </div>
                )}
              </div>
              {s.conversionToNext != null && (
                <div className={`funnel-connector${s.highDropOff ? ' risk' : ''}`}>
                  <Icon name="arrow-right" size={13} />
                  <span className="conv-rate">{s.conversionToNext}% advance</span>
                  <span className="drop-rate">
                    {s.highDropOff && <Icon name="alert-triangle" size={12} />}
                    {s.dropOff}% drop-off
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {stages.some((s) => s.highDropOff) && (
        <div className="funnel-note">
          <Icon name="alert-triangle" size={13} /> Highlighted stage has the steepest drop-off — the most likely
          bottleneck where deals stall or leak out of the pipeline.
        </div>
      )}
    </div>
  );
}
