export const MAX_TABS = 8;

export type TabBadge = "activity" | "extension" | "error";

export type TabTitleInput = {
	sessionName?: string;
	firstPrompt?: string;
	sessionFile?: string;
};

export type ConversationTab = {
	id: string;
	sessionFile?: string;
	sessionName?: string;
	firstPrompt?: string;
	badges: number;
	badgeKind?: TabBadge;
};

export type TabManagerState = {
	tabs: ConversationTab[];
	activeId: string;
};

export function resolveTabTitle(tab: TabTitleInput): string {
	const explicit = tab.sessionName?.trim();
	if (explicit) return explicit;
	const prompt = tab.firstPrompt?.replace(/\s+/g, " ").trim();
	if (prompt) return prompt.slice(0, 32);
	if (tab.sessionFile) {
		const parts = tab.sessionFile.replaceAll("\\", "/").split("/");
		return parts.at(-1) || "Conversation";
	}
	return "New conversation";
}

export function createTabState(tab: ConversationTab): TabManagerState {
	return { tabs: [tab], activeId: tab.id };
}

export class TabManager {
	private state: TabManagerState;

	constructor(initial: ConversationTab, private readonly maxTabs = MAX_TABS) {
		if (maxTabs < 1) throw new Error("Tab cap must be at least one.");
		this.state = createTabState(initial);
	}

	get snapshot(): TabManagerState {
		return { tabs: this.state.tabs.map((tab) => ({ ...tab })), activeId: this.state.activeId };
	}

	get active(): ConversationTab {
		const tab = this.state.tabs.find((candidate) => candidate.id === this.state.activeId);
		if (!tab) throw new Error("Active tab is missing.");
		return tab;
	}

	create(tab: ConversationTab): boolean {
		if (this.state.tabs.length >= this.maxTabs || this.state.tabs.some((candidate) => candidate.id === tab.id)) return false;
		this.state = { tabs: [...this.state.tabs, { ...tab }], activeId: tab.id };
		return true;
	}

	activate(id: string): boolean {
		if (!this.state.tabs.some((tab) => tab.id === id)) return false;
		this.state = { ...this.state, activeId: id };
		return true;
	}

	close(id: string): boolean {
		if (this.state.tabs.length <= 1) return false;
		const index = this.state.tabs.findIndex((tab) => tab.id === id);
		if (index < 0) return false;
		const tabs = this.state.tabs.filter((tab) => tab.id !== id);
		const activeId = id === this.state.activeId
			? (tabs[index]?.id ?? tabs.at(-1)?.id ?? this.state.activeId)
			: this.state.activeId;
		this.state = { tabs, activeId };
		return true;
	}

	cycle(direction: 1 | -1): string {
		const index = this.state.tabs.findIndex((tab) => tab.id === this.state.activeId);
		const next = (index + direction + this.state.tabs.length) % this.state.tabs.length;
		this.state = { ...this.state, activeId: this.state.tabs[next]?.id ?? this.state.activeId };
		return this.state.activeId;
	}

	incrementBadge(id: string, kind: TabBadge = "activity"): void {
		this.state = { ...this.state, tabs: this.state.tabs.map((tab) => tab.id === id ? { ...tab, badges: tab.badges + 1, badgeKind: kind } : tab) };
	}

	clearBadges(id: string): void {
		this.state = {
			...this.state,
			tabs: this.state.tabs.map((tab) => {
				if (tab.id !== id) return tab;
				const { badgeKind: _badgeKind, ...withoutBadgeKind } = tab;
				return { ...withoutBadgeKind, badges: 0 };
			}),
		};
	}
}
