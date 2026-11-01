/** 화면에서 함께 쓰는 이름. 설명 문장은 -요 말투로 써요. */
export const terms = {
  play: "플레이", browse: "찾아보기", manage: "관리",
  map: "맵", assist: "보조", cheat: "치트", read: "읽기", more: "더보기",
  events: "이벤트", missing: "못 본 것", thisMap: "이 맵",
  plugin: "기록 플러그인", backups: "세이브 백업", settings: "게임 맞춤 설정",
  connection: "연결·실행", share: "휴대폰으로 보기", diagnose: "진단", appearance: "화면", games: "게임 바꾸기",
  pinAssist: "위쪽 막대에 고정", connected: "게임 켜짐", disconnected: "게임 꺼짐", checking: "연결 확인 중",
  notConnected: "게임과 연결되지 않았어요", pcOnly: "PC에서 해 주세요",
  todo: (n: number) => `해 볼 것 ${n}`,
} as const;
