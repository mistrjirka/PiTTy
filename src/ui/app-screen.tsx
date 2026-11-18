/** Renders the active theme view and its owner-bound modal stack. */
import { createDynamic } from "@opentui/solid";
import { AppDialogs } from "./app-dialogs.tsx";
import { AppMainContents } from "./app-main-contents.tsx";
import type { AppScreenContext } from "./app-screen-context.ts";
import { createAppDialogProps } from "./app-screen-dialog-props.ts";
import { createAppMainProps } from "./app-screen-main-props.ts";
export function AppScreen(ports: AppScreenContext) {
	const MainContents = () => <AppMainContents {...createAppMainProps(ports)} />;
	const EvenTheme = () => <MainContents />;
	const OddTheme = () => <MainContents />;
	return (
		<>
			{createDynamic(
				() =>
					ports.signals.themeController.revision() % 2 === 0
						? EvenTheme
						: OddTheme,
				{},
			)}
			<AppDialogs {...createAppDialogProps(ports)} />
		</>
	);
}
