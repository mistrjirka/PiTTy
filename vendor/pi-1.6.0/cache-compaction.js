// Prepare a checkpoint with the captured main request prefix, without changing its conversation.
import { contentText, normalizeContext, } from "@earendil-works/pi-ai";
import { computeFileLists, formatFileOperations } from "./compaction/utils.js";
/** Keep every entry the captured request has not seen, including its pending tool-call assistant. */
export function retainUnseenCompactionEntries(preparation, entries, request) {
    const sourceIndex = request.sourceEntryId === null ? -1 : entries.findIndex((entry) => entry.id === request.sourceEntryId);
    if (request.sourceEntryId !== null && sourceIndex < 0)
        throw new Error("The cached request is no longer on this branch");
    const firstUnseen = entries[sourceIndex + 1];
    const keptIndex = entries.findIndex((entry) => entry.id === preparation.firstKeptEntryId);
    if (keptIndex < 0)
        throw new Error("The retained compaction boundary is no longer on this branch");
    return firstUnseen && keptIndex > sourceIndex + 1
        ? { ...preparation, firstKeptEntryId: firstUnseen.id }
        : preparation;
}
/** Summarize an unchanged request prefix through the provider's explicit isolated capability. */
export async function compactCachedRequest(models, request, preparation, signal, customInstructions) {
    const instruction = `Prepare a complete context checkpoint of the conversation above so work can continue after compaction.
Include the user's goal, explicit constraints and approvals, completed work, current state, unresolved problems, decisions, and concrete next steps.
Preserve exact identifiers, paths, commands, and important facts. Treat newer user corrections as authoritative.
Summarize only the conversation shown. Later assistant messages, pending tool calls, tool results, and new input are retained separately.
Do not continue the task, execute tools, or invent missing results. Return only the checkpoint.${customInstructions ? `\n\nAdditional focus: ${customInstructions}` : ""}`;
    const context = normalizeContext({
        messages: [
            ...request.context.messages,
            { role: "user", content: [{ type: "text", text: instruction }], timestamp: Date.now() },
        ],
    });
    const response = await models
        .streamSideQuestion(request.model, context, {
        ...request.options,
        signal,
        disableContinuation: true,
        maxTokens: request.model.maxTokens,
        maxRetries: 0,
    })
        .result();
    signal.throwIfAborted();
    if (response.stopReason !== "stop") {
        throw new Error(response.stopReason === "length"
            ? "Cache-aware compaction hit the output limit; the incomplete checkpoint was discarded"
            : response.errorMessage || "Cache-aware compaction did not finish");
    }
    if (response.content.some((block) => block.type === "toolCall")) {
        throw new Error("Cache-aware compaction attempted to call a tool");
    }
    const summary = contentText(response.content).trim();
    if (!summary)
        throw new Error("Cache-aware compaction returned an empty checkpoint");
    const files = computeFileLists(preparation.fileOps);
    return {
        summary: summary + formatFileOperations(files.readFiles, files.modifiedFiles),
        firstKeptEntryId: preparation.firstKeptEntryId,
        tokensBefore: preparation.tokensBefore,
        usage: response.usage,
        details: {
            ...files,
            method: "cache-aware",
            sourceEntryId: request.sourceEntryId,
            cacheReadTokens: response.usage.cacheRead,
            cacheWriteTokens: response.usage.cacheWrite,
            complete: true,
        },
    };
}
