import type { RpcExtensionUIRequest } from "../types.ts";

export type ExtensionRequestEnvelope = {
	runtimeId: string;
	request: RpcExtensionUIRequest;
};

/** Keeps extension requests attached to their originating Pi process. */
export class ExtensionRequestRouter {
	private readonly queues = new Map<string, RpcExtensionUIRequest[]>();
	private activeId: string | undefined;

	setActive(runtimeId: string): ExtensionRequestEnvelope | undefined {
		this.activeId = runtimeId;
		return this.next(runtimeId);
	}

	enqueue(runtimeId: string, request: RpcExtensionUIRequest): ExtensionRequestEnvelope | undefined {
		const queue = this.queues.get(runtimeId) ?? [];
		const wasEmpty = queue.length === 0;
		queue.push(request);
		this.queues.set(runtimeId, queue);
		return runtimeId === this.activeId && wasEmpty ? this.next(runtimeId) : undefined;
	}

	next(runtimeId = this.activeId): ExtensionRequestEnvelope | undefined {
		if (!runtimeId) return undefined;
		const request = this.queues.get(runtimeId)?.[0];
		return request ? { runtimeId, request } : undefined;
	}

	complete(runtimeId: string, requestId: string): ExtensionRequestEnvelope | undefined {
		const queue = this.queues.get(runtimeId);
		if (!queue) return undefined;
		const index = queue.findIndex((request) => request.id === requestId);
		if (index >= 0) queue.splice(index, 1);
		if (queue.length === 0) this.queues.delete(runtimeId);
		return runtimeId === this.activeId ? this.next(runtimeId) : undefined;
	}

	remove(runtimeId: string): void {
		this.queues.delete(runtimeId);
		if (this.activeId === runtimeId) this.activeId = undefined;
	}

	pending(runtimeId: string): number {
		return this.queues.get(runtimeId)?.length ?? 0;
	}
}
