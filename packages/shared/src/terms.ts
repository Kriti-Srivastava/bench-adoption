/** "1 month", "18 months", "1 year", "10 years". */
export function termLabel(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** "10 years", "1 year or 2 years", "1 month, 1 year or 2 years". */
export function termsLabel(options: number[]): string {
  const labels = options.map(termLabel);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
}
