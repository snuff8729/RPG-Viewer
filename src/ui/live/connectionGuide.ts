/** 연결 안내: 지금 상태에서 할 단계 하나(제목 · 한 문장 · 버튼 하나)를 정해요. 화면 없이 시험할 수 있게 순수 함수로 둬요. */

export type ConnectionState = "connected" | "checking" | "off" | "install" | "update" | "unsupported";

/** 안내의 버튼이 하는 일 */
export type GuideAction = "install" | "update" | "launch" | "manage";

export interface GuideStepMark {
  label: string;
  done: boolean;
  current: boolean;
}

export interface ConnectionGuide {
  title: string;
  /** 한 문장(없으면 null) */
  text: string | null;
  /** 버튼 하나(없으면 null) */
  action: GuideAction | null;
  /** 작은 단계 표시(1 기록 플러그인 → 2 게임 실행). 단계가 아닌 상태면 null */
  steps: GuideStepMark[] | null;
  spinner: boolean;
}

export interface GuideContext {
  /** 휴대폰 보기(설치·실행은 PC에서) */
  remote: boolean;
  /** 뷰어가 게임을 실행할 수 있는지 */
  canLaunch: boolean;
  /** 이 화면에서 방금 설치·업데이트했는지 */
  justInstalled?: "install" | "update" | null;
  /** 설치된 버전과 새 버전(업데이트 안내용) */
  installedVersion?: string | null;
  bundledVersion?: string | null;
}

export const PLUGIN_STEP = "기록 플러그인";
export const GAME_STEP = "게임 실행";

function steps(current: 1 | 2): GuideStepMark[] {
  return [
    { label: PLUGIN_STEP, done: current > 1, current: current === 1 },
    { label: GAME_STEP, done: false, current: current === 2 },
  ];
}

/** 버튼 글 */
export function actionLabel(action: GuideAction): string {
  switch (action) {
    case "install":
      return "플러그인 설치";
    case "update":
      return "업데이트";
    case "launch":
      return "게임 실행";
    case "manage":
      return "관리 › 연결·실행";
  }
}

/** 지금 상태의 안내. 연결됐으면 null(안내할 것이 없어요). */
export function connectionGuide(state: ConnectionState, ctx: GuideContext): ConnectionGuide | null {
  switch (state) {
    case "connected":
      return null;
    case "checking":
      return { title: "연결 확인 중이에요", text: null, action: null, steps: null, spinner: true };
    case "install":
      return {
        title: "기록 플러그인이 필요해요",
        text: ctx.remote ? "PC에서 설치해 주세요." : "버튼을 누르면 게임 폴더에 설치돼요.",
        action: ctx.remote ? null : "install",
        steps: steps(1),
        spinner: false,
      };
    case "update": {
      const versions = ctx.installedVersion && ctx.bundledVersion ? `지금 ${ctx.installedVersion} → 새 ${ctx.bundledVersion}` : null;
      return {
        title: "기록 플러그인을 업데이트해 주세요",
        text: ctx.remote ? "PC에서 업데이트해 주세요." : versions ?? "버튼을 누르면 바로 바뀌어요.",
        action: ctx.remote ? null : "update",
        steps: steps(1),
        spinner: false,
      };
    }
    case "off": {
      const canLaunch = ctx.canLaunch && !ctx.remote;
      const text = ctx.remote
        ? "PC에서 게임을 실행해 주세요."
        : ctx.justInstalled === "update"
          ? "업데이트했어요. 게임을 다시 실행해 주세요."
          : ctx.justInstalled === "install"
            ? "설치했어요. 이제 게임을 실행해 주세요. 켜져 있었다면 다시 실행해 주세요."
            : "게임을 켜면 자동으로 연결돼요.";
      return { title: "게임을 실행해 주세요", text, action: canLaunch ? "launch" : null, steps: steps(2), spinner: false };
    }
    case "unsupported":
      return {
        title: "이 게임은 기록할 수 없어요",
        text: "크롬이나 엣지에서 폴더 열기로 연 게임만 기록할 수 있어요.",
        action: "manage",
        steps: null,
        spinner: false,
      };
  }
}

/** 화면 위쪽 알림 줄을 보일 상태인지(설치·업데이트가 필요할 때만) */
export function needsPluginBanner(state: ConnectionState): boolean {
  return state === "install" || state === "update";
}

/** 알림 줄 한 문장 */
export function bannerText(state: ConnectionState, remote: boolean): string {
  if (state === "install") return remote ? "기록 플러그인이 필요해요. PC에서 설치해 주세요." : "기록 플러그인이 필요해요.";
  return remote ? "기록 플러그인을 업데이트해 주세요. PC에서 할 수 있어요." : "기록 플러그인을 업데이트해 주세요.";
}

/** 설치·업데이트 결과 알림 글 */
export function installResultText(kind: "install" | "update", ok: boolean, message?: string): string {
  if (!ok) return message ?? (kind === "update" ? "업데이트하지 못했어요." : "설치하지 못했어요.");
  return kind === "update" ? "업데이트했어요. 게임을 다시 실행해 주세요." : "설치했어요. 이제 게임을 실행해 주세요.";
}
