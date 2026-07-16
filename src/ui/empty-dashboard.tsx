import type { SessionChoice, SessionDiscoveryState } from "../sessions.ts";
import { colors } from "./theme.ts";
import { Logo } from "./logo.tsx";

export type EmptyDashboardProps = {
  sessionState: SessionDiscoveryState;
  onSelectSession: (choice: SessionChoice) => void;
  width?: number;
  height?: number;
};

const commonCommands = ["/help", "/sessions", "/new", "/model"];

export function EmptyDashboard(props: EmptyDashboardProps) {
  const compact = props.width !== undefined && props.width < 60;
  const constrainedHeight = props.height !== undefined && props.height <= 12;
  return (
    <box width="100%" flexDirection="column" alignItems="center" paddingTop={constrainedHeight ? 0 : 1} paddingBottom={1}>
      <Logo compact={compact} wordmarkOnly={constrainedHeight} />
      <text fg={colors.muted} wrapMode="none">{commonCommands.join("  ·  ")}</text>
      <box width="100%" maxWidth={72} minHeight={constrainedHeight ? 3 : 7} marginTop={constrainedHeight ? 0 : 1} paddingLeft={1} paddingRight={1} border borderColor={colors.border}>
        {(() => {
          const state = props.sessionState;
          if (state.kind === "loading") {
            return <text id="dashboard-sessions-loading" fg={colors.muted} wrapMode="none">Loading recent sessions{state.progress ? `… ${state.progress.loaded}/${state.progress.total}` : "…"}</text>;
          }
          if (state.kind === "error") {
            return <text id="dashboard-sessions-error" fg={colors.red} wrapMode="word">Unable to load recent sessions: {state.error} · Use /sessions to retry.</text>;
          }
          if (state.kind === "empty") {
            return <text id="dashboard-sessions-empty" fg={colors.muted} wrapMode="word">No recent sessions in this directory. Use /sessions to browse.</text>;
          }
          if (!state.choices.length) {
            return <text id="dashboard-sessions-empty" fg={colors.muted}>No recent sessions in this directory. Use /sessions to browse.</text>;
          }
          return (
            <box flexDirection="column" width="100%">
              <text fg={colors.subtle}>Recent sessions</text>
              {state.choices.slice(0, constrainedHeight ? 2 : 5).map((choice) => (
                <box
                  id={`dashboard-session-${choice.id}`}
                  width="100%"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onSelectSession(choice);
                  }}
                >
                  <text fg={colors.text} wrapMode="none">› {choice.name}</text>
                </box>
              ))}
            </box>
          );
        })()}
      </box>
    </box>
  );
}
