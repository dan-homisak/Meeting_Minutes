export function normalizeLogString(value, maxLength = 120) {
  if (typeof value !== 'string') {
    return '';
  }

  const compact = value.trim().replace(/\s+/g, ' ');
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength)}...`;
}
