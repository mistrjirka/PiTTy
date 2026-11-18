/** Route settings and non-settings dialogs without owning UI state. */
import {
	CoreSettingsOverlays,
	type CoreSettingsOverlaysProps,
} from "./core-settings-overlays.tsx";
import {
	ExtensionSettingsOverlays,
	type ExtensionSettingsOverlaysProps,
} from "./extension-settings-overlays.tsx";
import {
	SessionOverlays,
	type SessionOverlaysProps,
} from "./session-overlays.tsx";
import {
	UtilityOverlays,
	type UtilityOverlaysProps,
} from "./utility-overlays.tsx";

export interface AppDialogsProps {
	core: CoreSettingsOverlaysProps;
	extension: ExtensionSettingsOverlaysProps;
	session: SessionOverlaysProps;
	utility: UtilityOverlaysProps;
}

export function AppDialogs(props: AppDialogsProps) {
	return (
		<>
			<CoreSettingsOverlays {...props.core} />
			<ExtensionSettingsOverlays {...props.extension} />
			<SessionOverlays {...props.session} />
			<UtilityOverlays {...props.utility} />
		</>
	);
}
