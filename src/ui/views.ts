import type { Route } from "@/app/route";
import { terms } from "./terms";
export type ViewKind = "play" | "read" | "browse" | "manage" | "more";
export const VIEW_NAMES: Record<ViewKind, string> = { play: terms.play, read: terms.read, browse: terms.browse, manage: terms.manage, more: terms.more };
export function viewOf(route: Route): ViewKind { return route.kind === "page" ? "browse" : route.kind; }
