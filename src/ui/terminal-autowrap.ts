/**
 * Keep OpenTUI's cell-diff renderer from letting a right-edge write wrap onto
 * the next row. This affects the whole terminal, not just one message widget.
 *
 * OpenTUI 0.4.x uses absolute cursor positioning, but some terminals apply
 * DECAWM (?7) after a right-edge glyph. Once emitted cells land on a wrong
 * physical row, subsequent incremental diffs consider the intended cells
 * unchanged and never repair the screen. Disable terminal autowrap only for
 * PiTTy's active TTY session, then restore it on teardown.
 */
import { writeSync } from "node:fs";

export const DISABLE_AUTOWRAP = "\u001b[?7l";
export const RESTORE_AUTOWRAP = "\u001b[?7h";

export type TerminalWrapOutput = {
	isTTY?: boolean | undefined;
	fd?: number | undefined;
};

export type TerminalWrapOptions = {
	/** Windows Console and redirected output should retain their normal modes. */
	platform?: string | undefined;
	allowAutowrap?: boolean | undefined;
	/** Injection point for deterministic lifecycle testing. */
	write?: (sequence: string) => void;
};

/**
 * Returns an idempotent restore callback. This function does nothing for a
 * noninteractive stream or for terminals where autowrap must be preserved.
 *
 * This is a small compatibility workaround until OpenTUI exposes a proper
 * cursor/wrap mode setting or fixes terminal cursor desynchronization.
 */
export function disableTerminalAutowrap(
	output: TerminalWrapOutput,
	options: TerminalWrapOptions = {},
): () => void {
	const noop = () => {};
	if (output.isTTY !== true ||
			!Number.isSafeInteger(output.fd) || (output.fd ?? -1) < 0 ||
			options.allowAutowrap === true || (options.platform ?? process.platform) === "win32") {
		return noop;
	}

	const write = options.write ?? ((sequence: string) => writeSync(output.fd!, sequence));
	try {
		write(DISABLE_AUTOWRAP);
	} catch {
		// Failure to change terminal mode must not interrupt Pi or its agents.
		return noop;
	}

	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		try {
			write(RESTORE_AUTOWRAP);
		} catch {
			// Restoration is best effort, including shutdown after a closed pty.
		}
	};
}
