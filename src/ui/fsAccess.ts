export interface FsAccessWindow {
  showDirectoryPicker?: unknown;
  navigator?: { brave?: unknown };
}

export function fsAccessSupport(w: FsAccessWindow): { supported: boolean; message: string | null } {
  if (typeof w.showDirectoryPicker === "function") return { supported: true, message: null };
  const first = "이 브라우저는 폴더 접근을 지원하지 않아 읽기 전용으로 열려요.";
  const second = w.navigator?.brave
    ? "기록 플러그인을 쓰려면 크롬·엣지를 쓰거나 Brave는 brave://flags/#file-system-access-api 를 켜 주세요."
    : "기록 플러그인을 쓰려면 크롬이나 엣지를 써 주세요.";
  return { supported: false, message: `${first} ${second}` };
}
