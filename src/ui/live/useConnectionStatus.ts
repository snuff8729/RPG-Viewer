import { useLive } from "@/app/LiveProvider";
import { isRemoteView } from "@/app/share";
import { terms } from "@/ui/terms";

export function useConnectionStatus() {
  const { connection, supported, install, caughtUp } = useLive();
  const remote = isRemoteView();
  const state =
    !supported || install?.state === "unsupported"
      ? "unsupported"
      : install === null
        ? "checking"
        : install.state === "notInstalled"
          ? "install"
          : install.outdated
            ? "update"
            : connection === "connected"
              ? "connected"
              : !caughtUp && connection === "waiting"
                ? "checking"
                : "off";
  const labels = {
    connected: terms.connected,
    checking: terms.checking,
    off: terms.disconnected,
    install: "플러그인 필요",
    update: "업데이트 필요",
    unsupported: "기록 못 함",
  };
  const descriptions = {
    connected: "게임의 현재 상태와 기록을 받고 있어요.",
    checking: "기록 플러그인과 게임 상태를 확인하고 있어요.",
    off: "게임을 실행하면 현재 상태와 기록을 볼 수 있어요.",
    install: "기록 플러그인을 설치하면 게임과 연결할 수 있어요.",
    update: "기록 플러그인을 업데이트하고 게임을 다시 실행해 주세요.",
    unsupported: "이 환경에서는 게임 기록을 받을 수 없어요.",
  };
  return {
    state,
    text: labels[state],
    description: descriptions[state],
    remote,
    dot:
      state === "connected"
        ? "bg-success"
        : ["checking", "install", "update"].includes(state)
          ? "bg-warning"
          : "bg-muted-foreground",
    connected: state === "connected",
    variant: "outline" as const,
    muted: state === "checking",
  };
}
