/**
 * Fiori Horizon (Morning) inspired palette.
 * Trelleborg red is reserved for brand marks; UI semantics use Horizon colors.
 */
export const CHART_COLORS = [
  '#0070F2', // indigo (sap brand blue)
  '#07838F', // teal
  '#36A41D', // positive green
  '#E76500', // mango
  '#7858FF', // purple
  '#FA4F96', // pink
  '#0CA6CA', // cyan
  '#925ACE', // violet
];

export const COLORS = {
  background: '#F5F6F7',
  card: '#FFFFFF',
  sidebar: '#FFFFFF',
  primary: '#0070F2',
  primaryHover: '#0064D9',
  brandRed: '#E4002B',
  text: '#1D2D3E',
  textSecondary: '#556B82',
  textMuted: '#8396A8',
  border: '#E5E9ED',
  success: '#36A41D',
  warning: '#E76500',
  danger: '#D20A0A',
};

export function chartColor(index) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

const STATUS_COLOR_RULES = [
  { re: /won|complete|accept|active/i, color: COLORS.success },
  { re: /lost|cancel|reject|overdue|expired/i, color: COLORS.danger },
  { re: /pending|process|progress|review|sent/i, color: COLORS.warning },
];

export function statusColor(status) {
  for (const { re, color } of STATUS_COLOR_RULES) {
    if (re.test(status || '')) return color;
  }
  return COLORS.primary;
}
