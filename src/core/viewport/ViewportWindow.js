export function resolveBlockWindow({
  blockCount = 0,
  activeIndex = 0,
  before = 40,
  after = 40
} = {}) {
  const count = Number.isFinite(blockCount) ? Math.max(0, Math.trunc(blockCount)) : 0;
  if (count === 0) {
    return {
      fromIndex: 0,
      toIndexExclusive: 0
    };
  }

  const index = Number.isFinite(activeIndex) ? Math.max(0, Math.min(count - 1, Math.trunc(activeIndex))) : 0;
  const beforeCount = Number.isFinite(before) ? Math.max(0, Math.trunc(before)) : 40;
  const afterCount = Number.isFinite(after) ? Math.max(0, Math.trunc(after)) : 40;

  const fromIndex = Math.max(0, index - beforeCount);
  const toIndexExclusive = Math.min(count, index + afterCount + 1);

  return {
    fromIndex,
    toIndexExclusive
  };
}
