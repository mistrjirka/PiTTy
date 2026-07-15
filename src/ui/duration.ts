export function formatDuration(milliseconds: number | undefined, fallback = "—"): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return fallback;
  const value = Math.max(0, milliseconds);
  if (value < 1000) return `${Math.round(value)}ms`;

  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
