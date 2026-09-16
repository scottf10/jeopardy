export function createBuzzDeadline(remainingMs, now = Date.now()) {
  const safeRemaining = Math.max(0, Number(remainingMs) || 0);
  return now + safeRemaining;
}

export function buzzSecondsRemaining(deadline, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(deadline) - now) / 1000));
}

export function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}
