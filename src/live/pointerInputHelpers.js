export function createPointerInputHelpers({
  elementConstructor = typeof Element === 'function' ? Element : null,
  nodeConstructor = typeof Node === 'function' ? Node : null
} = {}) {
  function normalizePointerTarget(target) {
    if (elementConstructor && target instanceof elementConstructor) {
      return target;
    }

    if (nodeConstructor && target instanceof nodeConstructor) {
      return target.parentElement;
    }

    return null;
  }

  function readPointerCoordinates(event) {
    if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
      return {
        x: event.clientX,
        y: event.clientY
      };
    }

    const touchPoint = event?.touches?.[0] ?? event?.changedTouches?.[0] ?? null;
    if (!touchPoint || !Number.isFinite(touchPoint.clientX) || !Number.isFinite(touchPoint.clientY)) {
      return null;
    }

    return {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    };
  }

  return {
    normalizePointerTarget,
    readPointerCoordinates
  };
}
