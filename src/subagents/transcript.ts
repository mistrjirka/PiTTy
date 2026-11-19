/** Backward-compatible exports. Implementations are grouped by responsibility. */
export { readSubagentTranscript } from "./transcript-legacy.ts";
export { readSubagentConversation } from "./transcript-reader.ts";
export {
	subagentActivityAt,
	substantiveSubagentActivityAt,
} from "./transcript-reader-records.ts";
export {
	activeSubagentStep,
	MAX_SUBAGENT_SESSION_LINES,
	subagentTranscriptPath,
} from "./transcript-records.ts";
