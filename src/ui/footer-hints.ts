/** Width-aware footer hints, independent of the main UI component. */
import { USAGE_FOOTER_SEPARATOR } from "./usage-footer.ts";
import { appVersion } from "../version.ts";

/** Always describe the executable currently running, not a pending upgrade. */
export const footerVersionLabel = `PiTTy v${appVersion}`;
/** Include the gap separating the version from other footer content. */
export const footerVersionReservedWidth = footerVersionLabel.length + 1;

/** Readable current-session level, not merely a Ctrl+T shortcut hint. */
export function thinkingFooterText(level: string | undefined): string {
	if (!level) return "";
	return /^(?:off|minimal|low|medium|high|xhigh|max)$/.test(level)
		? `THINK ${level.toUpperCase()}` : "";
}


export function footerHintTiers(
	inspectorOpen: boolean,
	targetCount = 0,
): string[] {
	if (inspectorOpen) {
		const switchHint = targetCount > 1 ? "  ←/→ agent" : "";
		return [`esc main chat${switchHint}`];
	}
	// One hint per action: ctrl+i and ctrl+down both open agents, so only the
	// arrow form is advertised. Rare actions (requests, details) live in /help.
	const agentsHint = targetCount > 0 ? "  ctrl+↓ agents" : "";
	return [
		`ctrl+s sidebar  ctrl+p model${agentsHint}`,
		`ctrl+p model  ctrl+t effort  ctrl+x settings${agentsHint}`,
		`ctrl+p model  ctrl+t effort  ctrl+x settings${agentsHint}  /help`,
	];
}

export function globalFooterHint(
	width: number,
	inspectorOpen: boolean,
	targetCount = 0,
): string {
	const tiers = footerHintTiers(inspectorOpen, targetCount);
	if (tiers.length === 1) return tiers[0]!;
	// Usage lives in this row now, so the hint ladder has three tiers: keep the
	// model/request/effort affordances at 120+, and only reach for the full list
	// when there is room for three provider summaries as well.
	if (width < 120) return tiers[0]!;
	if (width < 145) return tiers[1]!;
	return tiers[2]!;
}

/**
 * Longest hint tier that fits alongside the status text and the already-chosen
 * usage segments. Usage summaries win over hint verbosity: the full hint list
 * only appears when every usage segment still fits next to it.
 */
export function selectFooterHint(
	totalWidth: number,
	statusLength: number,
	usedUsageWidth: number,
	inspectorOpen: boolean,
	targetCount = 0,
): string {
	const tiers = footerHintTiers(inspectorOpen, targetCount);
	for (let index = tiers.length - 1; index >= 0; index--) {
		const hint = tiers[index]!;
		const row =
			2 +
			statusLength +
			(usedUsageWidth ? USAGE_FOOTER_SEPARATOR.length + usedUsageWidth : 0) +
			2 +
			hint.length;
		if (row <= totalWidth) return hint;
	}
	return tiers[0]!;
}
