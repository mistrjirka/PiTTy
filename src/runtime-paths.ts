import * as path from "node:path";

function bundledPiExtensionsRoot(
	appRoot: string | undefined,
	importMetaDir: string,
): string {
	const sourceRoot = appRoot ? path.join(appRoot, "src") : importMetaDir;
	return path.join(sourceRoot, "pi-extensions");
}

export function resolveBundledPiExtensionPath(appRoot: string | undefined, importMetaDir: string): string {
	return path.join(bundledPiExtensionsRoot(appRoot, importMetaDir), "compaction-observer.mjs");
}

export function resolveBundledMcpObserverPath(appRoot: string | undefined, importMetaDir: string): string {
	return path.join(bundledPiExtensionsRoot(appRoot, importMetaDir), "mcp-observer.mjs");
}
