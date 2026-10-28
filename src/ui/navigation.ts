import { formatRoute } from "@/app/route";
import type { Location } from "@/core/types";

export function openPage(loc: Location): void {
  window.location.hash = formatRoute({ kind: "page", location: loc });
}
