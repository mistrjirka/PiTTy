import type { BackgroundTask } from "../state/background-tasks.ts";
import { formatDuration } from "./duration.ts";

/**
 * Actual elapsed runtime. Running tasks use the live UI clock. Finished tasks
 * use their recorded end time so the duration stops increasing after exit.
 */
export function backgroundTaskDuration(task: BackgroundTask, now: number): string | undefined {
  const end = task.state === "running" ? now : task.endedAt;
  if (end === undefined || !Number.isFinite(end)) return undefined;
  return formatDuration(Math.max(0, end - task.startedAt));
}
