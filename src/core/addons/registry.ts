import { cleanNoticeHooks } from "./notices";

/**
 * 게임별 부가 기능(애드온) 목록. 게임마다 따로 켜고 끈다(기본은 모두 꺼짐).
 * 나중에 특정 플러그인 전용 어댑터도 같은 모양으로 더한다:
 * - controlFlags: 켜져 있을 때 control.json에 실을 값(게임 쪽 기록 플러그인이 읽는다)
 * - minPluginVersion: 게임 쪽 기록 플러그인이 이 버전 이상이어야 동작한다
 * 기록 변환·읽기 화면 그리기는 id로 찾아 쓴다(core/addons/screenPictures, ui/addons).
 */
export interface AddonDef {
  id: AddonId;
  label: string;
  description: string;
  /** 켤 때 보여 줄 안내 */
  note?: string;
  minPluginVersion?: string;
  controlFlags?: Record<string, unknown>;
  /** 이 게임에서 쓸 수 있을 때(예: 알림 문구 — plugins.js에 아는 플러그인이 켜져 있음) 붙이는 표시 */
  hint?: string;
}

export type AddonId = "screenPictures" | "notices";

export const ADDONS: readonly AddonDef[] = [
  {
    id: "screenPictures",
    label: "화면 그림 따라 그리기 (스탠딩 이미지)",
    description: "게임이 화면에 띄우는 그림(스탠딩 이미지 등)을 대사마다 기록해서 읽기에서 같이 보여줘요. 이 게임에서만 켜져요.",
    note: "게임이 기록 플러그인 1.6.0 이상으로 실행 중이어야 하고, 켠 뒤에 나오는 대사부터 그림이 붙어요. 1.7.0부터는 화면에 실제로 보이는 그림만 기록하고, 1.8.0부터는 전투 중 그림도 기록해요.",
    minPluginVersion: "1.6.0",
    controlFlags: { capturePictures: true },
  },
  {
    id: "notices",
    label: "알림 문구 기록",
    description: "게임이 화면 구석이나 위쪽에 잠깐 띄우는 문구(티커, 코멘트, 알림)를 기록해서 읽기와 전투 기록에 같이 보여줘요. 이 게임에서만 켜져요.",
    note: "게임이 기록 플러그인 1.9.0 이상으로 실행 중이어야 하고, 켠 뒤에 나오는 문구부터 기록돼요.",
    minPluginVersion: "1.9.0",
    controlFlags: { captureNotices: true },
    hint: "이 게임에서 쓸 수 있어요",
  },
];

/** 게임별 애드온 켜짐 상태 */
export type AddonState = Partial<Record<AddonId, boolean>>;

export const isAddonId = (v: unknown): v is AddonId => ADDONS.some(a => a.id === v);

/**
 * 켜진 애드온의 control.json 값을 합친다. noticeHooks: 알림 문구 기록이 켜졌을 때 함께 싣는 직접 추가한 함수 경로.
 * 예외를 던지지 않는다.
 */
export function addonControlFlags(state: AddonState | null | undefined, extra?: { noticeHooks?: readonly string[] | null }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of ADDONS) {
    if (state?.[a.id] === true && a.controlFlags) Object.assign(out, a.controlFlags);
  }
  const hooks = cleanNoticeHooks(extra?.noticeHooks);
  if (state?.notices === true && hooks.length > 0) out.noticeHooks = hooks;
  return out;
}
