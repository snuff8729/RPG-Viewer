/** 화면에서 함께 쓰는 이름. 설명 문장은 -요 말투로 써요. */
export const terms = {
  play: "플레이",
  browse: "찾아보기",
  manage: "관리",
  map: "맵",
  assist: "보조",
  cheat: "치트",
  read: "읽기",
  more: "더보기",
  events: "이벤트",
  missing: "못 본 것",
  thisMap: "이 맵",
  plugin: "기록 플러그인",
  backups: "세이브 백업",
  settings: "게임 맞춤 설정",
  connection: "연결·실행",
  share: "휴대폰으로 보기",
  diagnose: "진단",
  appearance: "화면",
  games: "게임 바꾸기",
  pinAssist: "빠른 막대에 고정",
  connected: "게임 켜짐",
  disconnected: "게임 꺼짐",
  checking: "연결 확인 중",
  notConnected: "게임과 연결되지 않았어요",
  pcOnly: "PC에서 해 주세요",
  todo: (n: number) => `해 볼 것 ${n}`,
  /** 어려운 말 풀이(Tooltip 한 줄) */
  branchHint: "회차는 새 게임을 시작한 차례, 갈래는 그 안에서 세이브를 불러와 다르게 이어 간 줄기예요",
  unknownSaveHint: "뷰어가 기록하지 않은 세이브(기록 플러그인을 넣기 전 세이브 등)를 불러와 시작했어요",
  evidenceHint: "진단이 이렇게 판단한 까닭(찾은 파일·설정)이에요",
  notLiveValue: "연결되면 보여요",
} as const;

/** 불러오기 오류처럼 core에서 온 "-습니다" 글을 화면 말투("-요")로 바꿔요 */
export function casual(message: string): string {
  return message
    .replace(/없습니다/g, "없어요")
    .replace(/않습니다/g, "않아요")
    .replace(/입니다/g, "이에요")
    .replace(/합니다/g, "해요")
    .replace(/됩니다/g, "돼요");
}
