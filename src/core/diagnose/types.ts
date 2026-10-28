import type { AddonId, AddonState } from "../addons/registry";
import type { PictureRole, SpriteRoles } from "../addons/screenPictures";
import type { AdapterManifest } from "../adapters/manifest";

/** 진단 결과가 속한 곳(화면에 이 순서로 묶어 보인다) */
export type DiagnoseArea = "그림" | "스탠딩" | "컷인" | "전투" | "알림" | "세이브" | "이벤트" | "메뉴" | "화면" | "기타";
export const DIAGNOSE_AREAS: readonly DiagnoseArea[] = ["그림", "스탠딩", "컷인", "전투", "알림", "세이브", "이벤트", "메뉴", "화면", "기타"];

/**
 * ok: 문제 없음. auto-fixed: 뷰어가 알아서 처리함. needs-addon: 설정(부가 기능·어댑터·그림 구분)을 켜면 됨.
 * unsupported: 아직 뷰어가 못 함. unknown: 처음 보는 것 — 개발자가 살펴봐야 함.
 */
export type DiagnoseStatus = "ok" | "auto-fixed" | "needs-addon" | "unsupported" | "unknown";
export const DIAGNOSE_STATUSES: readonly DiagnoseStatus[] = ["ok", "auto-fixed", "needs-addon", "unsupported", "unknown"];

/** 한 번에 적용하는 추천 설정 */
export type DiagnoseAction =
  | { kind: "enable-addon"; addon: AddonId }
  | { kind: "enable-adapter"; adapter: string }
  | { kind: "set-role"; target: "sprite"; keys: string[]; role: PictureRole }
  | { kind: "set-role"; target: "picture"; ids: number[]; role: PictureRole }
  | { kind: "none" };

export interface DiagnoseFinding {
  /** 같은 게임에서 늘 같은 값(예: "picture-folders") */
  id: string;
  area: DiagnoseArea;
  status: DiagnoseStatus;
  title: string;
  /** 쉬운 한국어 설명 */
  detail: string;
  /** 근거(플러그인 이름, 이벤트 위치, 그림 이름 등) */
  evidence: string[];
  action?: DiagnoseAction;
}

/** 뷰어가 모르는 플러그인 중 그리기·알림·전투·화면·세이브를 건드리는 것 같은 것 */
export interface UnknownPlugin {
  name: string;
  /** 짐작한 곳 */
  areas: DiagnoseArea[];
  /** 찾은 열쇠말(`ImageManager.loadPicture`, `Scene_` 등) */
  keywords: string[];
  /** 플러그인이 정의·바꾸는 함수 이름(앞쪽 몇 개) */
  functions: string[];
}

export interface DiagnosisReport {
  v: 1;
  gameTitle: string;
  engine: string;
  findings: DiagnoseFinding[];
  unknownPlugins: UnknownPlugin[];
  /** 무엇을 보고 진단했는가 */
  used: { log: boolean; files: boolean; pluginSources: boolean; logRecords: number };
}

/** img/ 아래 파일 목록. pictures: img/pictures 아래 그림 이름(확장자 뺌, 하위 폴더는 `폴더/이름`) */
export interface ImageListing { pictures: string[] }

/** 지금 이 게임의 설정(이미 켠 것은 추천하지 않는다) */
export interface DiagnoseSettings {
  addons?: AddonState;
  /** 어댑터 id → 켜짐 */
  adapters?: Record<string, boolean>;
  spriteRoles?: SpriteRoles;
}

export interface DiagnoseExtra {
  /** 켜진 플러그인 이름 → js/plugins/<이름>.js 본문(글로만 읽는다, 실행하지 않는다) */
  pluginSources?: Record<string, string>;
  /** 뷰어에 든 게임 전용 어댑터(전부 — 맞는 것은 진단이 고른다) */
  adapters?: readonly AdapterManifest[];
  settings?: DiagnoseSettings;
}
