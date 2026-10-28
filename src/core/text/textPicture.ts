import type { EventCommand } from "../types";

/**
 * 파일 이름 없는 그림 표시(231)는 플러그인이 그린 그림이다. MV DTextPicture는 그 앞에
 * 플러그인 명령 `D_TEXT 글 [크기]`를 둔다(여러 줄이면 여러 번). 그 글을 그림 설명으로 쓴다.
 */

/** 플러그인 명령 글 하나가 `D_TEXT`면 그 글(끝의 크기 숫자는 뺀다), 아니면 null. */
export function dTextOf(command: unknown): string | null {
  if (typeof command !== "string") return null;
  const tokens = command.trim().split(/\s+/);
  if (tokens[0]?.toUpperCase() !== "D_TEXT") return null;
  const args = tokens.slice(1);
  if (args.length >= 2 && /^\d+$/.test(args[args.length - 1])) args.pop();
  return args.join(" ");
}

/** 바로 앞 플러그인 명령 글들(순서대로)에서 그림 설명을 만든다. D_TEXT가 없으면 "". */
export function dTextCaption(commands: unknown[]): string {
  return commands.map(dTextOf).filter((t): t is string => !!t).join(" / ");
}

/** D_TEXT 계열(D_TEXT, D_TEXT_SETTING 등) 명령인지 */
const isDTextFamily = (command: unknown): boolean =>
  typeof command === "string" && /^D_TEXT/i.test(command.trim());

/** list[index](231) 바로 앞에 이어진 356 `D_TEXT…` 명령들의 글로 만든 설명. 없으면 "". */
export function dTextCaptionBefore(list: EventCommand[], index: number): string {
  const texts: unknown[] = [];
  for (let i = index - 1; i >= 0; i--) {
    const c = list[i];
    if (!c || typeof c !== "object" || c.code !== 356) break;
    const text = Array.isArray(c.parameters) ? c.parameters[0] : undefined;
    if (!isDTextFamily(text)) break;
    texts.unshift(text);
  }
  return dTextCaption(texts);
}

/** 파일 없는 그림의 설명 문구 */
export function textPictureLabel(caption: string | undefined): string {
  return caption ? `글자 그림: 「${caption}」` : "글자·플러그인 그림 (파일 없음)";
}
