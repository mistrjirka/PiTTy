/** Sends a leading activity veto, then releases it after typing stops. */
export class InputActivityTracker<T extends { setInputActive(active: boolean): Promise<void> }> {
	private readonly active = new Map<T, ReturnType<typeof setTimeout>>();
	private readonly writes = new Map<T, Promise<void>>();
	constructor(private readonly idleMs = 1500) {}

	note(client: T, hasText: boolean): void {
		const pending = this.active.get(client);
		if (pending) clearTimeout(pending);
		if (!hasText) {
			if (pending) this.send(client, false);
			this.active.delete(client);
			return;
		}
		if (!pending) this.send(client, true);
		const timer = setTimeout(() => {
			this.active.delete(client);
			this.send(client, false);
		}, this.idleMs);
		timer.unref?.();
		this.active.set(client, timer);
	}
	dispose(): void {
		for (const [client, timer] of this.active) {
			clearTimeout(timer);
			this.send(client, false);
		}
		this.active.clear();
	}
	private send(client: T, active: boolean): void {
		// Preserve ordering if an older runtime takes time to reject the optional command.
		const write = (this.writes.get(client) ?? Promise.resolve())
			.then(() => client.setInputActive(active))
			.catch(() => {});
		this.writes.set(client, write);
		void write.then(() => {
			if (this.writes.get(client) === write) this.writes.delete(client);
		});
	}
}
