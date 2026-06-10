export const CHART_COLORS = ['#E4002B', '#FF6B6B', '#FFB347', '#4ECDC4', '#45B7D1', '#96CEB4'];

export const COLORS = {
  background: '#0F0F0F',
  card: '#1D1D1B',
  cardHover: '#252523',
  sidebar: '#161614',
  primary: '#E4002B',
  primaryHover: '#C0001F',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  border: '#2D2D2B',
  success: '#10B981',
  warning: '#F59E0B',
};

export function chartColor(index) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

const STATUS_COLOR_RULES = [
  { re: /won|complete|accept/i, color: COLORS.success },
  { re: /lost|cancel|reject|overdue/i, color: COLORS.primary },
  { re: /pending|process|progress|review/i, color: COLORS.warning },
];

export function statusColor(status) {
  for (const { re, color } of STATUS_COLOR_RULES) {
    if (re.test(status || '')) return color;
  }
  return '#45B7D1';
}
