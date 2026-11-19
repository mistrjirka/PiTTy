/** Terminal startup settings, independent of the Solid UI entrypoint. */
import type { ThemeConfigDocument } from "../config/theme-config.ts";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { OptionalIntegrationStatus } from "../integrations/detect.ts";
import type { ThemeController } from "../ui/theme.ts";

export type AppOptions = {
	cwd: string;
	piExecutable?: string | undefined;
	piArgs: string[];
	sidebar: boolean;
	logger: DiagnosticLogger;
	integrations: OptionalIntegrationStatus;
	openSessionSelector?: boolean;
	themeWarning?: string;
	themeConfig?: ThemeConfigDocument;
	themeController?: ThemeController;
};
