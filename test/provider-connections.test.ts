import { describe, expect, test } from "bun:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ProviderConnectionService, browserLoginUrl, visibleMethods } from "../src/integrations/provider-connections.ts";

describe("provider connection service", () => {
  test("shows subscription and API methods separately without Anthropic subscription login", () => {
    expect(visibleMethods({ id: "openai-codex", auth: { oauth: true } })).toEqual(["oauth"]);
    expect(visibleMethods({ id: "opencode-go", auth: { apiKey: { login() {} } } })).toEqual(["api_key"]);
    expect(visibleMethods({ id: "anthropic", auth: { oauth: true, apiKey: { login() {} } } })).toEqual(["api_key"]);
    expect(visibleMethods({ id: "openai", auth: { apiKey: { login() {} } } })).toEqual(["api_key"]);
  });

  test("rejects non-HTTPS links, embedded credentials and malformed URLs", () => {
    expect(browserLoginUrl("https://auth.example.test/sign-in?a=1")).toBe("https://auth.example.test/sign-in?a=1");
    for (const url of ["http://auth.example.test", "javascript:alert(1)", "file:///tmp/secret",
      "https://user:password@auth.example.test", "not-a-url"]) {
      expect(() => browserLoginUrl(url)).toThrow();
    }
  });

  test("does not expose credential values, and refuses unsupported or non-stored removals", async () => {
    const calls: string[] = [];
    const runtime = {
      listCredentials: async () => [{ providerId: "openai-codex", type: "oauth" }],
      getProviders: () => [
        { id: "openai-codex", name: "OpenAI Codex", auth: { oauth: { login() {} } } },
        { id: "opencode-go", name: "OpenCode Go", auth: { apiKey: { login() {} } } },
        { id: "anthropic", name: "Anthropic", auth: { oauth: { login() {} }, apiKey: { login() {} } } },
      ],
      getProvider: (id: string) => runtime.getProviders().find((provider) => provider.id === id),
      getProviderAuthStatus: (id: string) => ({ configured: id === "openai-codex", label: "OAuth" }),
      login: async (id: string, type: string) => { calls.push("login:" + id + ":" + type); },
      logout: async (id: string) => { calls.push("logout:" + id); },
    };
    const service = new ProviderConnectionService(async () => runtime as unknown as ModelRuntime);
    const listed = await service.list();
    expect(listed[0]!.id).toBe("openai-codex");
    expect(listed.find((p) => p.id === "opencode-go")?.methods).toEqual(["api_key"]);
    expect(listed.find((p) => p.id === "claude-code")?.status).toBe("external");
    expect(JSON.stringify(listed)).not.toContain("password");
    await expect(service.login("anthropic", "oauth", { prompt: async () => "", notify() {} })).rejects.toThrow("Unsupported");
    await service.login("openai-codex", "oauth", { prompt: async () => "", notify() {} });
    await expect(service.logout("opencode-go")).rejects.toThrow("no stored credential");
    await service.logout("openai-codex");
    expect(calls).toEqual(["login:openai-codex:oauth", "logout:openai-codex"]);
  });
});
