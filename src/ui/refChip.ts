import { cn } from "@/lib/utils";

/** 긴 조건(스크립트 등)은 한 줄로 늘이지 않고 줄바꿈한다 */
export const REF_WRAP = "h-auto min-w-0 max-w-full shrink whitespace-normal wrap-anywhere";

/** 눌리는 참조 칩: 칩 전체가 단추(테두리 배지 + 오른쪽 ↗, 손가락 커서, hover 밑줄). 눌리지 않는 표시는 ↗를 쓰지 않아요. */
export const REF_CHIP = cn(REF_WRAP, "cursor-pointer hover:bg-muted hover:underline");
