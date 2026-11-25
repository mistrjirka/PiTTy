/**
 * PiTTy-only wire projection. Pi keeps its original session and resumable
 * code-tool state; these copies are made only for the UI transport.
 */
function object(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value
		: undefined;
}

function stripCodeResult(result, toolName) {
	if (typeof toolName !== "string" || toolName.toLowerCase() !== "code")
		return result;
	const record = object(result);
	const details = object(record?.details);
	if (!details || !Object.prototype.hasOwnProperty.call(details, "state"))
		return result;
	// Do not spread details: a deferred state getter would load a multi-MB
	// interpreter snapshot into memory, even though the UI discards it.
	const displayDetails = {};
	for (const key of Object.keys(details)) {
		if (key !== "state") displayDetails[key] = details[key];
	}
	const display = { ...record };
	if (Object.keys(displayDetails).length) display.details = displayDetails;
	else delete display.details;
	return display;
}

export function displayMessage(message) {
	const record = object(message);
	return record?.role === "toolResult"
		? stripCodeResult(message, record.toolName)
		: message;
}

export function displayMessages(messages) {
	return Array.isArray(messages) ? messages.map(displayMessage) : [];
}

/** Filter events before Pi serializes them to stdout, not after the UI parses them. */
export function displayEvent(event) {
	const record = object(event);
	if (!record) return event;
	const type = record.type;
	if (type === "entry_appended") {
		const entry = object(record.entry);
		if (entry?.type !== "tool_completion") return event;
		const result = stripCodeResult(entry.result, entry.toolName);
		return result === entry.result ? event : { ...record, entry: { ...entry, result } };
	}
	if (type === "message_start" || type === "message_end") {
		const message = displayMessage(record.message);
		return message === record.message ? event : { ...record, message };
	}
	if (type === "agent_end" || type === "turn_end") {
		const messages = Array.isArray(record.messages)
			? record.messages.map(displayMessage)
			: record.messages;
		const toolResults = Array.isArray(record.toolResults)
			? record.toolResults.map(displayMessage)
			: record.toolResults;
		const message = displayMessage(record.message);
		if (
			messages === record.messages &&
			toolResults === record.toolResults &&
			message === record.message
		)
			return event;
		return { ...record, messages, toolResults, message };
	}
	if (type === "tool_execution_update") {
		const partialResult = stripCodeResult(
			record.partialResult,
			record.toolName,
		);
		return partialResult === record.partialResult
			? event
			: { ...record, partialResult };
	}
	if (type === "tool_execution_end") {
		const result = stripCodeResult(record.result, record.toolName);
		return result === record.result ? event : { ...record, result };
	}
	return event;
}
