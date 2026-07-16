import { useTerminalDimensions } from "@opentui/solid";
import type { SessionChoice, SessionDiscoveryState } from "../sessions.ts";
import { colors } from "./theme.ts";
import { Logo } from "./logo.tsx";

export type EmptyDashboardProps = {
  sessionState: SessionDiscoveryState;
  onSelectSession: (choice: SessionChoice) => void;
  width?: number;
  height?: number;
};

const commonCommands = ["/help", "/resume", "/new", "/model"];

export function EmptyDashboard(props: EmptyDashboardProps) {
  const dimensions = useTerminalDimensions();
  const width = props.width ?? dimensions().width;
  const height = props.height ?? dimensions().height;
  const constrainedHeight = height <= 12;
  const compact = width < 60 || height < 20;
  const visibleSessionCount = constrainedHeight ? 2 : compact ? 4 : 5;

  return (
    <box
      width="100%"
      flexDirection="column"
      alignItems="center"
      paddingTop={constrainedHeight || compact ? 0 : 1}
      paddingBottom={1}
    >
      <Logo compact={compact} wordmarkOnly={constrainedHeight} />
      <text fg={colors.muted} wrapMode="none">{commonCommands.join("  ·  ")}</text>
      <box
        width="100%"
        maxWidth={72}
        minHeight={constrainedHeight ? 3 : compact ? 5 : 7}
        marginTop={constrainedHeight || compact ? 0 : 1}
        paddingLeft={1}
        paddingRight={1}
        border
        borderColor={colors.border}
      >
        {(() => {
          const state = props.sessionState;
          if (state.kind === "loading") {
            return (
              <text id="dashboard-sessions-loading" fg={colors.muted} wrapMode="none">
                Loading recent sessions{state.progress ? `… ${state.progress.loaded}/${state.progress.total}` : "…"}
              </text>
            );
          }
          if (state.kind === "error") {
            return (
              <text id="dashboard-sessions-error" fg={colors.red} wrapMode="word">
                Unable to load recent sessions: {state.error} · Use /sessions to retry.
              </text>
            );
          }
          if (state.kind === "empty") {
            return (
              <text id="dashboard-sessions-empty" fg={colors.muted} wrapMode="word">
                No recent sessions in this directory. Use /sessions to browse.
              </text>
            );
          }
          if (!state.choices.length) {
            return (
              <text id="dashboard-sessions-empty" fg={colors.muted}>
                No recent sessions in this directory. Use /sessions to browse.
              </text>
            );
          }
          return (
            <box flexDirection="column" width="100%">
              <text fg={colors.subtle}>Recent sessions</text>
              {state.choices.slice(0, visibleSessionCount).map((choice) => (
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
