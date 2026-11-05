/**
 * Forward `pi-mcp-adapter`'s status snapshot to PiTTy.
 *
 * The adapter publishes a structured snapshot on Pi's extension event bus
 * (`pi-mcp-adapter/status/v1`). PiTTy is the RPC host rather than an extension
 * consumer, so this bundled extension bridges the bus into the one channel the
 * host already reads: `ctx.ui.setStatus`. The snapshot is JSON under PiTTy's
 * own status key, not human text, so the sidebar can render counts and hover
 * details without parsing the adapter's footer string.
 */
const CHANNEL = "pi-mcp-adapter/status/v1";
const STATUS_KEY = "pitty.mcp.v1";

const isRecord = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export default function mcpObserver(pi) {
	let sessionCtx;
	let latest;

	const publish = () => {
		if (!sessionCtx || !latest) return;
		if (typeof sessionCtx.ui?.setStatus !== "function") return;
		try {
			sessionCtx.ui.setStatus(STATUS_KEY, JSON.stringify(latest));
		} catch {
			// Status reporting is optional and must never affect MCP operation.
		}
	};

	if (typeof pi.events?.on === "function") {
		pi.events.on(CHANNEL, (snapshot) => {
			if (!isRecord(snapshot)) return;
			latest = snapshot;
			publish();
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;
		publish();
	});
}
