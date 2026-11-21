/** Bound an optional usage read without interrupting the session's model or tools. */
export async function readProviderUsage(options) {
    const unavailable = {
        provider: options.provider,
        status: "unavailable",
        observedAt: null,
        limits: [],
        source: "provider",
    };
    const controller = new AbortController();
    let timedOut = false;
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            resolve(undefined);
        }, options.timeoutMs ?? 15_000);
    });
    try {
        const snapshot = await Promise.race([
            options.read({
                provider: options.provider,
                modelId: options.modelId,
                signal: controller.signal,
            }),
            timeout,
        ]);
        if (!options.isCurrent())
            return unavailable;
        if (timedOut)
            return { ...unavailable, status: "error", error: "Usage request timed out" };
        if (!snapshot)
            return unavailable;
        if (snapshot.provider !== options.provider)
            return unavailable;
        return snapshot;
    }
    catch {
        // Provider failures can contain authentication details. Keep them off the RPC wire.
        return {
            ...unavailable,
            status: "error",
            error: timedOut ? "Usage request timed out" : "Usage request failed",
        };
    }
    finally {
        clearTimeout(timer);
    }
}
