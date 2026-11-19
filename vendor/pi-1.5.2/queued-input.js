// Tracks user inputs by identity while they remain in the agent's pending queues.
import { randomUUID } from "node:crypto";
/** Keeps queue edits atomic with core consumption, including duplicate message text. */
export class QueuedInputs {
    agent;
    onChange;
    unsubscribe;
    entries = new Map();
    revision = 0;
    imagesToNormalize = new WeakSet();
    constructor(agent, onChange) {
        this.agent = agent;
        this.onChange = onChange;
        this.unsubscribe = agent.subscribeQueueRemoval((messages) => {
            const removed = new Set(messages);
            let changed = false;
            for (const [id, input] of this.entries) {
                if (removed.has(input.agentMessage)) {
                    this.entries.delete(id);
                    changed = true;
                }
            }
            if (changed)
                this.changed();
        });
    }
    /** Return pending user inputs in delivery-priority order. */
    getState() {
        const messages = [...this.entries.values()].map((input) => input.info);
        return {
            revision: this.revision,
            messages: [
                ...messages.filter((message) => message.mode === "steer"),
                ...messages.filter((message) => message.mode === "followUp"),
            ],
        };
    }
    /** Add one prepared input without conflating repeated text. */
    add(message, images, mode, id = randomUUID()) {
        if (this.entries.has(id))
            throw new Error(`Queued message ID already exists: ${id}`);
        const input = this.create({ id, mode, message, images });
        this.entries.set(id, input);
        if (mode === "steer")
            this.agent.steer(input.agentMessage);
        else
            this.agent.followUp(input.agentMessage);
        this.changed();
        return input.info;
    }
    /** Replace prepared content; omitted images retain the existing attachments. */
    update(id, message, images, expectedRevision) {
        this.checkRevision(expectedRevision);
        const current = this.requirePending(id);
        const replacement = this.create({
            ...current.info,
            message,
            images: images ?? current.info.images,
        });
        if (!replacement.info.message.trim() && !replacement.info.images?.length) {
            throw new Error("A queued message must contain text or an image.");
        }
        this.replace([current], replacement);
        return this.getState();
    }
    /** Remove one input only while the core queue still owns it. */
    remove(id, expectedRevision) {
        this.checkRevision(expectedRevision);
        this.replace([this.requirePending(id)]);
        return this.getState();
    }
    /** Combine adjacent inputs from one delivery mode, preserving every attachment. */
    combine(ids, expectedRevision) {
        this.checkRevision(expectedRevision);
        if (ids.length < 2 || new Set(ids).size !== ids.length) {
            throw new Error("Choose at least two distinct queued messages to combine.");
        }
        const inputs = ids.map((id) => this.requirePending(id));
        if (inputs.some((input) => input.info.mode !== inputs[0].info.mode)) {
            throw new Error("Only consecutive messages with the same delivery mode can be combined.");
        }
        const replacement = this.create({
            ...inputs[0].info,
            message: inputs.map((input) => input.info.message).join("\n\n"),
            images: inputs.flatMap((input) => input.info.images ?? []),
        });
        this.replace(inputs, replacement);
        return this.getState();
    }
    /** Claim the next user input before starting a new run after compaction. */
    takeNext() {
        const next = this.getState().messages[0];
        if (!next)
            return undefined;
        const input = this.requirePending(next.id);
        this.replace([input]);
        return input;
    }
    /** Restore a claimed input when preparation failed before any run started. */
    restore(input) {
        this.entries = new Map([[input.info.id, input], ...this.entries]);
        this.agent.prependQueuedMessage(input.agentMessage, input.info.mode);
        this.changed();
    }
    /** Mark queued images for the same delivery-time normalization as ordinary prompts. */
    takeImagesToNormalize(message) {
        return this.imagesToNormalize.delete(message);
    }
    /** Clear user and extension queues using the same semantics as clear_queue. */
    clear() {
        const snapshot = this.getState();
        this.entries.clear();
        this.agent.clearAllQueues();
        this.changed();
        return {
            steering: snapshot.messages.filter((message) => message.mode === "steer").map((message) => message.message),
            followUp: snapshot.messages.filter((message) => message.mode === "followUp").map((message) => message.message),
        };
    }
    /** Detach queue observation when the owning session is disposed. */
    dispose() {
        this.unsubscribe();
    }
    create(info) {
        const agentMessage = {
            role: "user",
            content: [{ type: "text", text: info.message }, ...(info.images ?? [])],
            timestamp: Date.now(),
        };
        if (info.images?.length)
            this.imagesToNormalize.add(agentMessage);
        return { info, agentMessage };
    }
    checkRevision(expectedRevision) {
        if (expectedRevision !== undefined && expectedRevision !== this.revision) {
            throw new Error("Queue changed. Refresh the pending messages and try again.");
        }
    }
    requirePending(id) {
        const input = this.entries.get(id);
        if (!input || !this.agent.isMessageQueued(input.agentMessage)) {
            throw new Error("Queued message is no longer pending and cannot be changed.");
        }
        return input;
    }
    replace(inputs, replacement) {
        if (!this.agent.replaceQueuedMessages(inputs.map((input) => input.agentMessage), replacement?.agentMessage)) {
            throw new Error("Messages are no longer pending or are not consecutive in one queue.");
        }
        // Keep the first entry's insertion order when replacing or combining it.
        if (replacement)
            this.entries.set(replacement.info.id, replacement);
        for (const input of inputs) {
            if (input.info.id !== replacement?.info.id)
                this.entries.delete(input.info.id);
        }
        this.changed();
    }
    changed() {
        this.revision++;
        this.onChange();
    }
}
