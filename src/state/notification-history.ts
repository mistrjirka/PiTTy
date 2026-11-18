/** Keep the most recent one hundred notifications. */
import type { NotificationRecord } from "../types.ts";

const NOTIFICATION_HISTORY_CAP = 100;
export function appendNotificationHistory(
	current: NotificationRecord[],
	record: NotificationRecord,
): NotificationRecord[] {
	return [...current.slice(-(NOTIFICATION_HISTORY_CAP - 1)), record];
}
