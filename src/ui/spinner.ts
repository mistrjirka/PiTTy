/**
 * Single shared spinner implementation for working indicators.
 *
 * The main conversation owns the 250 ms tick (see `src/app.tsx`) and passes
 * the current glyph down to panels that need it (startup, compaction, and
 * the subagent inspector), so there is exactly one timer and one frame table.
 */
export const spinnerFrames = ["◐", "◓", "◑", "◒"] as const;

export type SpinnerFrame = (typeof spinnerFrames)[number];

/** Frame table lookup that tolerates any integer index. */
export function spinnerFrameAt(index: number): SpinnerFrame {
	const frame =
		spinnerFrames[
			((index % spinnerFrames.length) + spinnerFrames.length) % spinnerFrames.length
		];
	return frame ?? "◐";
}
