export { clearApiKeyCache } from "./provider-composer.js";
/**
 * Synchronous compatibility facade exposed to extensions.
 * Coding-agent internals use ModelRuntime directly.
 */
export class ModelRegistry {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    /** Reload models.json asynchronously. Await before making synchronous registry reads. */
    refresh(options) {
        return this.runtime.refresh(options);
    }
    getError() {
        return this.runtime.getError();
    }
    getAll() {
        return [...this.runtime.getModels()];
    }
    getAvailable() {
        return [...this.runtime.getAvailableSnapshot()];
    }
    find(provider, modelId) {
        return this.runtime.getModel(provider, modelId);
    }
    /** Find a model of a non-chat type, e.g. `findOfType("classifier", "typesafe", "jev-latest")`. */
    findOfType(type, provider, modelId) {
        return this.runtime.getModelOfType(type, provider, modelId);
    }
    hasConfiguredAuth(model) {
        return this.runtime.hasConfiguredAuth(model.provider);
    }
    async getApiKeyAndHeaders(model) {
        try {
            const resolution = await this.runtime.getAuth(model);
            if (!resolution) {
                const compatibility = this.runtime.getCompatibilityRequestConfig(model);
                if (compatibility.authHeader) {
                    return { ok: false, error: `No API key found for "${model.provider}"` };
                }
                return { ok: true, headers: compatibility.headers };
            }
            return {
                ok: true,
                apiKey: resolution.auth.apiKey,
                headers: resolution.auth.headers,
                ...(resolution.auth.baseUrl ? { baseUrl: resolution.auth.baseUrl } : {}),
                env: resolution.env,
            };
        }
        catch (error) {
            const cause = error instanceof Error ? error.cause : undefined;
            const message = cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                error: message === "authHeader requires a resolved API key"
                    ? `No API key found for "${model.provider}"`
                    : message,
            };
        }
    }
    getProviderAuthStatus(provider) {
        return this.runtime.getProviderAuthStatus(provider);
    }
    getProvider(provider) {
        return this.runtime.getProvider(provider);
    }
    /** Stream through the configured provider with request-time authentication. */
    stream(model, context, options) {
        return this.runtime.stream(model, context, options);
    }
    /** Stream with provider-neutral options and request-time authentication. */
    streamSimple(model, context, options) {
        return this.runtime.streamSimple(model, context, options);
    }
    /** Answer without tools or main-session mutation, using an explicitly supported provider. */
    streamSideQuestion(model, context, options) {
        return this.runtime.streamSideQuestion(model, context, options);
    }
    complete(model, context, options) {
        return this.runtime.complete(model, context, options);
    }
    /** Every known model of a type (chat, image, classifier), optionally for one provider. */
    getModelsOfType(type, provider) {
        return this.runtime.getModelsOfType(type, provider);
    }
    /** Models of a type whose provider has working credentials. */
    getAvailableOfType(type, provider, options) {
        return this.runtime.getAvailableOfType(type, provider, options);
    }
    getModelOfType(type, provider, modelId) {
        return this.runtime.getModelOfType(type, provider, modelId);
    }
    /** Classify structured state with request-time authentication. Never rejects. */
    classify(model, context, options) {
        return this.runtime.classify(model, context, options);
    }
    /** Generate images with request-time authentication. Never rejects. */
    generateImages(model, context, options) {
        return this.runtime.generateImages(model, context, options);
    }
    getProviderDisplayName(provider) {
        return this.runtime.getProvider(provider)?.name ?? provider;
    }
    getProviderAuth(provider) {
        return this.runtime.getAuth(provider);
    }
    async getApiKeyForProvider(provider) {
        try {
            return (await this.runtime.getAuth(provider))?.auth.apiKey;
        }
        catch {
            return undefined;
        }
    }
    isUsingOAuth(model) {
        return this.runtime.isUsingOAuth(model.provider);
    }
    registerProvider(providerOrName, config) {
        if (typeof providerOrName === "string") {
            if (!config)
                throw new Error("Provider config is required when registering by name");
            this.runtime.registerProvider(providerOrName, config);
            return;
        }
        this.runtime.registerNativeProvider(providerOrName);
    }
    unregisterProvider(providerName) {
        this.runtime.unregisterProvider(providerName);
    }
    registerVirtualModel(definition) {
        this.runtime.registerVirtualModel(definition);
    }
    unregisterVirtualModel(providerName, id) {
        this.runtime.unregisterVirtualModel(providerName, id);
    }
    getRegisteredProviderConfig(providerName) {
        return this.runtime.getRegisteredProviderConfig(providerName);
    }
    getRegisteredNativeProvider(providerName) {
        return this.runtime.getRegisteredNativeProvider(providerName);
    }
    getRegisteredProviderIds() {
        return this.runtime.getRegisteredProviderIds();
    }
}
