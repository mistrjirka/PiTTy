/** Width-aware footer hints, independent of the main UI component. */
import { USAGE_FOOTER_SEPARATOR } from "./usage-footer.ts";

export function footerHintTiers(
	inspectorOpen: boolean,
	targetCount = 0,
): string[] {
	if (inspectorOpen) {
		const switchHint = targetCount > 1 ? "←/→ or ctrl+←/→ switch  " : "";
		return [`${switchHint}↑/ctrl+↑ main chat  esc/ctrl+i close`];
	}
	const targetHint = targetCount > 0 ? "  ctrl+down inspect" : "";
	const inspectHint = targetCount > 0 ? `  ctrl+i inspect${targetHint}` : "";
	return [
		`ctrl+x settings  ctrl+s sidebar  ctrl+p models${targetHint}`,
		`ctrl+x settings  ctrl+p models  ctrl+r requests  ctrl+t effort${inspectHint}`,
		`ctrl+x settings  ctrl+p models  ctrl+r requests  ctrl+t effort${inspectHint}  ctrl+o details`,
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
