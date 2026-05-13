export const TYPE_COLORS = {
  person:        '#f472b6', // pink
  organization:  '#60a5fa', // blue
  company:       '#60a5fa',
  product:       '#34d399', // green
  module:        '#34d399',
  event:         '#fbbf24', // amber
  concept:       '#a78bfa', // violet
  metric:        '#f87171', // red
  location:      '#22d3ee', // cyan
  default:       '#94a3b8', // slate
};

export function colorForType(t) {
  if (!t) return TYPE_COLORS.default;
  const key = String(t).toLowerCase();
  return TYPE_COLORS[key] || TYPE_COLORS.default;
}

export const LEGEND = [
  { type: 'person',       label: 'Person' },
  { type: 'organization', label: 'Organization' },
  { type: 'product',      label: 'Product / Module' },
  { type: 'event',        label: 'Event' },
  { type: 'concept',      label: 'Concept' },
  { type: 'metric',       label: 'Metric' },
];
