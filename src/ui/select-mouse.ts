/** Map a mouse row to an OpenTUI select option using its public API.
 * These selectors use the default one-line name, one-line description,
 * and zero item spacing. Match OpenTUI's centered selection scroll rule.
 */
import type { SelectRenderable } from "@opentui/core";

export interface SelectMouseLayout {
	screenY: number;
	height: number;
	selectedIndex: number;
	optionCount: number;
	linesPerItem: number;
}

export function selectIndexAtY(
	layout: SelectMouseLayout,
	mouseY: number,
): number | undefined {
	const { screenY, height, selectedIndex, optionCount, linesPerItem } = layout;
	if (
		linesPerItem <= 0 ||
		height <= 0 ||
		mouseY < screenY ||
		mouseY >= screenY + height
	)
		return undefined;
	const visibleCount = Math.max(1, Math.floor(height / linesPerItem));
	const scrollOffset = Math.max(
		0,
		Math.min(
			selectedIndex - Math.floor(visibleCount / 2),
			optionCount - visibleCount,
		),
	);
	const index = scrollOffset + Math.floor((mouseY - screenY) / linesPerItem);
	return index < optionCount && index >= 0 ? index : undefined;
}

export function selectOptionIndexAtMouse(
	select: SelectRenderable,
	mouseY: number,
): number | undefined {
	return selectIndexAtY(
		{
			screenY: select.screenY,
			height: select.height,
			selectedIndex: select.getSelectedIndex(),
			optionCount: select.options.length,
			linesPerItem: select.showDescription ? 2 : 1,
		},
		mouseY,
	);
}
