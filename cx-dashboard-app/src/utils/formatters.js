export function fmtNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '–';
  return Number(value).toLocaleString('en-US');
}

/** Compact currency: €1.2M, €450K, €980 */
export function fmtCurrency(value, currency = 'EUR') {
  if (value == null || Number.isNaN(Number(value))) return '–';
  const n = Number(value);
  const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${symbol}${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${(n / 1_000).toFixed(0)}K`;
  return `${symbol}${n.toFixed(0)}`;
}

export function fmtCurrencyFull(value, currency = 'EUR') {
  if (value == null || Number.isNaN(Number(value))) return '–';
  return Number(value).toLocaleString('en-US', {
    style: 'currency',
    currency: currency || 'EUR',
    maximumFractionDigits: 0,
  });
}

export function fmtDate(value) {
  if (!value) return '–';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtMonth(yyyymm) {
  if (!yyyymm) return '–';
  const [y, m] = yyyymm.split('-');
  const d = new Date(Date.UTC(+y, +m - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function fmtPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '–';
  return `${Number(value).toFixed(1)}%`;
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
