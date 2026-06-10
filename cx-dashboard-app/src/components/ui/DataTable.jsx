import { useMemo, useState } from 'react';
import { statusColor } from '../../utils/colors';
import EmptyState from './EmptyState';

/**
 * Sortable, paginated table.
 * columns: [{ key, label, type: 'text'|'number'|'currency'|'date'|'status', render?, sortable? }]
 * rowClassName: optional (row) => string for highlighting (e.g. overdue RFQs)
 */
export default function DataTable({ columns, data, pageSize = 50, sortable = true, rowClassName }) {
  const [sort, setSort] = useState({ key: null, dir: 'desc' });
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort.key) return data || [];
    const col = columns.find((c) => c.key === sort.key);
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...(data || [])].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (col?.type === 'number' || col?.type === 'currency') return (Number(av) - Number(bv)) * mul;
      if (col?.type === 'date') return (new Date(av) - new Date(bv)) * mul;
      return String(av).localeCompare(String(bv)) * mul;
    });
  }, [data, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rows = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  if (!data || data.length === 0) {
    return <EmptyState title="No records" message="Try widening the filters." />;
  }

  const onSort = (col) => {
    if (!sortable || col.sortable === false) return;
    setPage(0);
    setSort((prev) =>
      prev.key === col.key
        ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: 'desc' }
    );
  };

  const renderCell = (col, row) => {
    const value = row[col.key];
    if (col.render) return col.render(value, row);
    if (col.type === 'status') {
      const color = statusColor(value);
      return (
        <span className="badge" style={{ color, borderColor: color, background: `${color}1a` }}>
          {value || '–'}
        </span>
      );
    }
    if (value == null || value === '') return '–';
    return String(value);
  };

  return (
    <div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${col.type === 'number' || col.type === 'currency' ? 'num ' : ''}${
                    !sortable || col.sortable === false ? 'no-sort' : ''
                  }`}
                  onClick={() => onSort(col)}
                >
                  {col.label}
                  {sort.key === col.key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id ?? i} className={rowClassName ? rowClassName(row) : undefined}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.type === 'number' || col.type === 'currency' ? 'num' : undefined}
                  >
                    {renderCell(col, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          {sorted.length.toLocaleString('en-US')} rows
          {pages > 1 && ` · page ${currentPage + 1} of ${pages}`}
        </span>
        {pages > 1 && (
          <div className="pager">
            <button className="btn-icon" disabled={currentPage === 0} onClick={() => setPage(0)}>«</button>
            <button className="btn-icon" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button>
            <button className="btn-icon" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>›</button>
            <button className="btn-icon" disabled={currentPage >= pages - 1} onClick={() => setPage(pages - 1)}>»</button>
          </div>
        )}
      </div>
    </div>
  );
}
