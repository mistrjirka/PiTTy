export const INITIAL_MESSAGE_WINDOW = 120;
export const MAX_LIVE_MESSAGE_WINDOW = 180;
export const MESSAGE_LOAD_BATCH = 100;

export function initialMessageWindowStart(totalItems: number, windowSize = INITIAL_MESSAGE_WINDOW): number {
  return Math.max(0, Math.floor(totalItems) - Math.max(1, Math.floor(windowSize)));
}

export function loadOlderMessageWindowStart(currentStart: number, batchSize = MESSAGE_LOAD_BATCH): number {
  return Math.max(0, Math.floor(currentStart) - Math.max(1, Math.floor(batchSize)));
}

export function trimMessageWindowStart(
  totalItems: number,
  currentStart: number,
  maxVisibleItems = MAX_LIVE_MESSAGE_WINDOW,
): number {
  const total = Math.max(0, Math.floor(totalItems));
  const current = Math.min(total, Math.max(0, Math.floor(currentStart)));
  const minimumStart = Math.max(0, total - Math.max(1, Math.floor(maxVisibleItems)));
  return Math.max(current, minimumStart);
}

export function clampMessageWindowStart(totalItems: number, currentStart: number): number {
  return Math.min(Math.max(0, Math.floor(totalItems)), Math.max(0, Math.floor(currentStart)));
}
