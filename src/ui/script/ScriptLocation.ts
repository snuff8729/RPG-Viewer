import { createContext } from "react";
import type { Location } from "@/core/types";

/** 지금 보고 있는 페이지의 Location(본 대사·고른 선택지 표시에 쓴다). */
export const ScriptLocation = createContext<Location | null>(null);
