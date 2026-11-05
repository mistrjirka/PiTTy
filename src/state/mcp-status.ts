/**
 * PiTTy's view of `pi-mcp-adapter`'s published status snapshot.
 *
 * The adapter emits `pi-mcp-adapter/status/v1` on Pi's extension event bus.
 * PiTTy's bundled `mcp-observer` extension forwards that snapshot through
 * `ctx.ui.setStatus` so the RPC host can render it. Everything here is
 * defensive: the payload crosses an extension boundary and older or newer
 * adapter versions may add fields.
 */
export const MCP_STATUS_KEY = "pitty.mcp.v1";
export const MCP_ADAPTER_STATUS_KEY = "mcp";

export type McpServerConnectionState =
	| "connected"
	| "not-connected"
	| "needs-auth"
	| "failed"
	| "disabled"
	| "blocked"
	| "cached";

export type McpServerStatus = {
	name: string;
	status: McpServerConnectionState;
	toolCount?: number;
	disabled: boolean;
	blockedReason?: string;
};

export type McpStatusSnapshot = {
	version: 1;
	servers: McpServerStatus[];
	totalTools: number;
	connectedCount: number;
	disabledCount: number;
};

const STATES: ReadonlySet<string> = new Set([
	"connected",
	"not-connected",
	"needs-auth",
	"failed",
	"disabled",
	"blocked",
	"cached",
]);
const MAX_SERVERS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: undefined;
}

export function parseMcpStatusSnapshot(
	text: unknown,
): McpStatusSnapshot | undefined {
	if (typeof text !== "string" || !text.trim()) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(value) || value.version !== 1) return undefined;
	if (!Array.isArray(value.servers) || value.servers.length > MAX_SERVERS)
		return undefined;
	const seen = new Set<string>();
	const servers: McpServerStatus[] = [];
	for (const entry of value.servers) {
		if (!isRecord(entry)) return undefined;
		const name = typeof entry.name === "string" ? entry.name.trim() : "";
		const status = entry.status;
		if (!name || seen.has(name)) continue;
		if (typeof status !== "string" || !STATES.has(status)) return undefined;
		seen.add(name);
		const toolCount = count(entry.toolCount);
		const blockedReason =
			typeof entry.blockedReason === "string" && entry.blockedReason.trim()
				? entry.blockedReason.trim()
				: undefined;
		servers.push({
			name,
			status: status as McpServerConnectionState,
			disabled: entry.disabled === true || status === "disabled",
			...(toolCount !== undefined ? { toolCount } : {}),
			...(blockedReason ? { blockedReason } : {}),
		});
	}
	const connectedCount =
		count(value.connectedCount) ??
		servers.filter((server) => server.status === "connected").length;
	const disabledCount =
		count(value.disabledCount) ??
		servers.filter((server) => server.disabled).length;
	const totalTools =
		count(value.totalTools) ??
		servers.reduce((sum, server) => sum + (server.toolCount ?? 0), 0);
	return {
		version: 1,
		servers,
		totalTools,
		connectedCount,
		disabledCount,
	};
}

/**
 * The adapter's footer status is the only signal in its deferred (cached-metadata)
 * startup path, where it reports configured counts but publishes no structured
 * snapshot until a server actually connects. Parse the counts so the sidebar can
 * still show how many servers exist and that none are connected yet.
 */
export type McpStatusCounts = {
	enabled: number;
	connected: number;
	disabled: number;
};

export function parseMcpAdapterStatusText(
	text: unknown,
): McpStatusCounts | undefined {
	if (typeof text !== "string") return undefined;
	const plain = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").trim();
	if (!plain) return undefined;
	const compact = /MCP\s+(\d+)\/(\d+)/.exec(plain);
	if (compact) {
		const connected = Number(compact[1]);
		const enabled = Number(compact[2]);
		if (!Number.isFinite(connected) || !Number.isFinite(enabled))
			return undefined;
		return { enabled, connected, disabled: 0 };
	}
	const enabledMatch = /(\d+)\s+servers?\s+enabled/.exec(plain);
	if (!enabledMatch) return undefined;
	const connectedMatch = /(\d+)\s+connected/.exec(plain);
	const disabledMatch = /(\d+)\s+disabled/.exec(plain);
	return {
		enabled: Number(enabledMatch[1]),
		connected: connectedMatch ? Number(connectedMatch[1]) : 0,
		disabled: disabledMatch ? Number(disabledMatch[1]) : 0,
	};
}

export function mcpEnabledCount(snapshot: McpStatusSnapshot): number {
	return Math.max(0, snapshot.servers.length - snapshot.disabledCount);
}

export function connectedMcpServerNames(
	snapshot: McpStatusSnapshot,
): string[] {
	return snapshot.servers
		.filter((server) => server.status === "connected")
		.map((server) => server.name);
}

/** The adapter's shutdown snapshot is empty; PiTTy treats it as "no status". */
export function isEmptyMcpStatus(snapshot: McpStatusSnapshot): boolean {
	return snapshot.servers.length === 0;
}
