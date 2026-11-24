import { CACHE_WARMING_MAX_AGE_MS, CACHE_WARMING_MAX_IDLE_AGE_MS, CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS, evaluateCacheWarming, getCacheWarmingDelayMs, getCacheWarmingRequestOptions, getPromptCacheTtlMs, isCacheWarmingReplayable, } from "@earendil-works/pi-ai";
/** Prompt size of the most recent real request on the branch, as reported by the provider. */
function lastPromptTokens(entries) {
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (entry.type === "message" && entry.message.role === "assistant") {
            const usage = entry.message.usage;
            return usage.input + usage.cacheRead + usage.cacheWrite;
        }
    }
    return 0;
}
/**
 * Keeps one prompt cache entry alive by re-sending its request with a
 * one-token output cap before the entry expires. `start` replaces any
 * previous run; warm requests never extend the fixed safety windows.
 */
export class CacheWarmer {
    run;
    captured;
    maintenance;
    inactive;
    models;
    sessionManager;
    getMode;
    /** Lets extensions override `event.action`; failures fall back to pi's decision. */
    decide;
    /** Called with the persisted usage entry after each successful refresh. */
    onWarmed;
    constructor(models, sessionManager, getMode, decide = async (event) => event.action, maintenance) {
        this.models = models;
        this.sessionManager = sessionManager;
        this.getMode = getMode;
        this.decide = decide;
        this.maintenance = maintenance;
        this.inactive = { state: "inactive", reason: "waiting for first request" };
    }
    get status() {
        if (this.maintenance?.getMode() === "off" || (!this.maintenance && this.getMode() === "off")) {
            return { state: "inactive", reason: "cache maintenance disabled" };
        }
        const run = this.run;
        if (!run)
            return this.inactive;
        if (!run.isCurrent())
            return { state: "inactive", reason: "conversation context changed" };
        const refreshing = run.timer === undefined;
        if (run.action === "compact") {
            return { state: refreshing ? "refreshing" : "scheduled", action: "compact", nextWarmAt: run.nextWarmAt };
        }
        const decision = this.evaluate(run);
        if (!decision.economicsAvailable && !refreshing) {
            return { state: "inactive", reason: "cache economics unavailable" };
        }
        return {
            state: refreshing ? "refreshing" : "scheduled",
            nextWarmAt: run.nextWarmAt,
            decision,
            extensionOverride: run.extensionOverride,
        };
    }
    /** Capture a real request and start its single cache-maintenance timer. */
    start(request, isCurrent) {
        this.captured = {
            request,
            isCurrent,
            startedAt: Date.now(),
            ttlMs: getPromptCacheTtlMs(request.model, request.options),
        };
        this.arm(this.captured);
    }
    /** Replace estimated lifetime only when evidence belongs to the current main request. */
    observeTiming(request, ttlMs) {
        if (this.captured?.request !== request)
            return;
        this.captured.ttlMs = ttlMs;
        // Do not cancel a summary or refresh already using this cache entry.
        if (this.run && this.run.timer === undefined)
            return;
        this.arm(this.captured);
    }
    arm(captured) {
        this.clearRun();
        const { request, isCurrent, startedAt, ttlMs } = captured;
        const maintenanceMode = this.maintenance?.getMode() ?? "keep-warm";
        const mode = this.getMode();
        if (maintenanceMode === "off" || (maintenanceMode === "keep-warm" && mode === "off")) {
            this.stop("cache maintenance disabled");
            return;
        }
        const action = maintenanceMode === "compact" ? "compact" : "warm";
        if (action === "warm" &&
            (!isCacheWarmingReplayable(request.model, request.options) || this.maintenance?.canWarm?.(request) === false)) {
            this.stop("request cannot be replayed safely");
            return;
        }
        if (ttlMs === undefined) {
            this.stop(request.options.cacheRetention === "none"
                ? "request disabled prompt caching"
                : "cache lifetime unavailable");
            return;
        }
        const delayMs = getCacheWarmingDelayMs(ttlMs);
        if (delayMs === undefined) {
            this.stop("cache lifetime unavailable");
            return;
        }
        this.run = {
            ...request,
            action,
            isCurrent,
            ttlMs,
            delayMs,
            startedAt,
            refreshDeadlineAt: 0,
            controller: new AbortController(),
            phase: "streaming",
            nextWarmAt: 0,
            extensionOverride: false,
        };
        this.schedule(this.run, startedAt);
    }
    onAgentSettled() {
        const run = this.run;
        if (!run)
            return;
        if (run.action === "warm" && this.getMode() === "streaming") {
            this.stop("agent run settled");
            return;
        }
        run.phase = "idle";
        if (run.action === "compact")
            return;
        const deadline = run.startedAt + CACHE_WARMING_MAX_IDLE_AGE_MS;
        if (run.nextWarmAt > deadline || Date.now() >= deadline) {
            this.stop("30-minute idle safety limit reached");
        }
    }
    /** Reconcile an active run after the persisted warming mode changes. */
    onModeChanged() {
        if (this.captured)
            this.arm(this.captured);
    }
    cancel() {
        this.captured = undefined;
        this.stop("inactive");
    }
    clearRun() {
        const run = this.run;
        if (!run)
            return;
        this.run = undefined;
        if (run.timer)
            clearTimeout(run.timer);
        run.controller.abort();
    }
    stop(reason, stopped) {
        this.clearRun();
        this.inactive = { state: "inactive", reason, ...stopped };
    }
    schedule(run, lastRequestStartedAt) {
        run.extensionOverride = false;
        run.nextWarmAt = lastRequestStartedAt + run.delayMs;
        // A timer can run late after sleep or event-loop blockage. Keep half of
        // the planned pre-expiry margin for that delay and request dispatch; a
        // late refresh is likely a full-price cache write, not a cache warm.
        run.refreshDeadlineAt = run.nextWarmAt + Math.floor((run.ttlMs - run.delayMs) / 2);
        const deadline = run.startedAt + (run.phase === "idle" ? CACHE_WARMING_MAX_IDLE_AGE_MS : CACHE_WARMING_MAX_AGE_MS);
        if (run.action === "warm" && (run.nextWarmAt > deadline || Date.now() >= deadline)) {
            this.stop(run.phase === "idle" ? "30-minute idle safety limit reached" : "one-hour safety limit reached");
            return;
        }
        run.timer = setTimeout(() => void this.refresh(run), Math.max(0, run.nextWarmAt - Date.now()));
        run.timer.unref?.();
    }
    async refresh(run) {
        run.timer = undefined;
        if (!this.validateRun(run))
            return;
        if (this.refreshDeadlineMissed(run))
            return;
        if (run.action === "compact") {
            if (!this.maintenance?.canCompact()) {
                run.nextWarmAt = Math.min(Date.now() + 1000, run.refreshDeadlineAt + 1);
                run.timer = setTimeout(() => void this.refresh(run), Math.max(1, run.nextWarmAt - Date.now()));
                run.timer.unref?.();
                return;
            }
            try {
                const prepared = await this.maintenance.prepare(run.controller.signal);
                if (this.run === run) {
                    this.run = undefined;
                    this.inactive = {
                        state: "inactive",
                        action: "compact",
                        reason: prepared ? "compaction prepared" : "nothing to compact",
                    };
                }
            }
            catch {
                if (this.run === run)
                    this.stop("cache compaction unavailable or cancelled");
            }
            return;
        }
        const decision = this.evaluate(run);
        const { warmCost, missCost, continuationProbability } = decision;
        let action = decision.action;
        try {
            action = await this.decide({
                type: "cache_warming_decision",
                warmCost,
                missCost,
                continuationProbability,
                action,
            });
        }
        catch {
            // Extension failures fall back to pi's own decision.
        }
        if (!this.validateRun(run) || this.refreshDeadlineMissed(run))
            return;
        const extensionOverride = action !== decision.action;
        if (action === "stop") {
            const reason = extensionOverride
                ? "stopped by extension"
                : decision.economicsAvailable
                    ? "expected savings below threshold"
                    : "cache economics unavailable";
            this.stop(reason, { decision, extensionOverride });
            return;
        }
        run.extensionOverride = extensionOverride;
        const refreshStartedAt = Date.now();
        try {
            const message = await this.models
                .streamSimple(run.model, run.context, getCacheWarmingRequestOptions(run.options, run.controller.signal))
                .result();
            if (!this.validateRun(run))
                return;
            if (message.stopReason !== "error" && message.stopReason !== "aborted") {
                const entry = this.sessionManager.appendUsage("cache_warm", message.provider, message.responseModel ?? message.model, message.usage, extensionOverride ? "extension override" : undefined);
                this.onWarmed?.(entry);
            }
        }
        catch {
            // Cache warming is best-effort and must not affect the active agent run.
        }
        if (this.run === run)
            this.schedule(run, refreshStartedAt);
    }
    refreshDeadlineMissed(run) {
        if (Date.now() <= run.refreshDeadlineAt)
            return false;
        this.stop("cache refresh deadline missed");
        return true;
    }
    validateRun(run) {
        if (this.run !== run)
            return false;
        const reason = this.getModeStopReason(run) ?? (!run.isCurrent() ? "conversation context changed" : undefined);
        if (!reason)
            return true;
        this.stop(reason);
        return false;
    }
    getModeStopReason(run) {
        const mode = this.getMode();
        const maintenanceMode = this.maintenance?.getMode() ?? "keep-warm";
        if (maintenanceMode === "off" || (maintenanceMode === "keep-warm" && mode === "off"))
            return "cache maintenance disabled";
        if ((maintenanceMode === "compact") !== (run.action === "compact"))
            return "cache maintenance changed";
        if (run.action === "warm" && mode === "streaming" && run.phase === "idle")
            return "agent run settled";
        return undefined;
    }
    evaluate(run) {
        return evaluateCacheWarming(run.model, lastPromptTokens(this.sessionManager.getBranch()), run.phase);
    }
}
function formatDollars(value) {
    return value < 0 ? `-$${Math.abs(value).toFixed(3)}` : `$${value.toFixed(3)}`;
}
function formatCacheWarmingEconomics(decision) {
    if (!decision.economicsAvailable)
        return "cache economics unavailable";
    const probability = Math.round(decision.continuationProbability * 100);
    const probabilityText = decision.phase === "streaming"
        ? `${probability}% continuation probability while agent is running`
        : `${probability}% continuation probability`;
    const comparison = decision.action === "warm" ? ">=" : "<";
    return `${probabilityText}, expected savings ${formatDollars(decision.expectedSavings)} ${comparison} $${CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS.toFixed(3)}`;
}
function formatCacheWarmingDecisionTime(nextWarmAt, now) {
    if (nextWarmAt === undefined || nextWarmAt <= now)
        return "Decision now";
    let remainingSeconds = Math.ceil((nextWarmAt - now) / 1000);
    const hours = Math.floor(remainingSeconds / 3600);
    remainingSeconds %= 3600;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const parts = [];
    if (hours > 0)
        parts.push(`${hours}h`);
    if (minutes > 0)
        parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0)
        parts.push(`${seconds}s`);
    return `Decision in ${parts.join(" ")}`;
}
/** One-line status for `/session`. */
export function formatCacheWarmingStatus(status, now = Date.now()) {
    const decision = status.decision;
    // A decision is attached once pi (or an extension) acted on it; "inactive"
    // without one never got that far.
    if (status.action === "compact" && status.state !== "inactive") {
        return status.state === "refreshing"
            ? "Preparing compaction before cache expiry"
            : `${formatCacheWarmingDecisionTime(status.nextWarmAt, now)} (compact before estimated cache expiry)`;
    }
    if (!decision || (status.state === "inactive" && !decision.economicsAvailable && !status.extensionOverride)) {
        return `Inactive (${status.reason ?? "unknown reason"})`;
    }
    const details = status.extensionOverride
        ? `extension override, ${formatCacheWarmingEconomics(decision)}`
        : `${formatCacheWarmingEconomics(decision)} -> ${decision.action}`;
    if (status.state === "inactive")
        return `Stopped (${details})`;
    if (status.state === "refreshing")
        return `Warming cache (${details})`;
    return `${formatCacheWarmingDecisionTime(status.nextWarmAt, now)} (${details})`;
}
/** One-line transcript text for the total cost of one or more consecutive cache warms. */
export function formatCacheWarmingUsage(totalCost, note) {
    const noteText = note ? ` (${note})` : "";
    const cost = totalCost.toFixed(6).replace(/(\.\d{3}\d*?)0+$/, "$1");
    return `Cache warmed${noteText}: $${cost}`;
}
