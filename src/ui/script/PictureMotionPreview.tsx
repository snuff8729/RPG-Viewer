import { useContext, useMemo } from "react";
import { useGame } from "@/app/GameProvider";
import { useAddons } from "@/app/AddonsProvider";
import { motionNames, motionRuns, type MotionRun, type PictureMotion } from "@/core/addons/pictureMotion";
import { hiddenImageMatcher } from "@/core/addons/hiddenImages";
import { DEFAULT_SCREEN, type ScreenSize } from "@/core/addons/screenPictures";
import { pageList } from "@/core/live/mismatch";
import type { EventCommand } from "@/core/types";
import { MotionCanvas } from "../addons/MotionCanvas";
import { usePictureMotionOn } from "../addons/motionDisplay";
import { usePictureImages } from "../addons/pictureImages";
import { PictureViewport } from "../addons/PictureViewport";
import { ScriptLocation } from "./ScriptLocation";

/** 명령 목록 → 그림 움직임들(같은 목록·같은 화면 크기는 한 번만) */
const runsCache = new WeakMap<EventCommand[], { screen: ScreenSize; runs: MotionRun[] }>();
function runsOf(list: EventCommand[], screen: ScreenSize): MotionRun[] {
  const hit = runsCache.get(list);
  if (hit && hit.screen.width === screen.width && hit.screen.height === screen.height) return hit.runs;
  const runs = motionRuns(list, screen);
  runsCache.set(list, { screen, runs });
  return runs;
}

/** 지금 페이지에서 cmd 번째 명령(첫 그림 표시)에서 시작하는 그림 움직임. 없으면 null. */
function useMotionAt(cmd: number): PictureMotion | null {
  const { data } = useGame();
  const loc = useContext(ScriptLocation);
  const screen = data?.screenSize ?? DEFAULT_SCREEN;
  return useMemo(() => {
    if (!data || !loc) return null;
    const list = pageList(data, loc);
    return list ? runsOf(list, screen).find((r) => r.first === cmd)?.motion ?? null : null;
  }, [data, loc, screen, cmd]);
}

/**
 * 대본(아직 안 본 이벤트 포함)의 그림 움직임 미리 보기: 그림 바꾸기·이동이 이어진 곳의 첫 그림 표시 아래에 그 움직임을 게임 화면 그대로
 * 움직여 보인다(보기 설정 `그림 움직임`). 읽기에서 숨긴 그림(직접 고른 숨김·화면 장식, 숨길 그림 이름)은 빼고 그린다.
 */
export function PictureMotionPreview({ cmd }: { cmd: number }) {
  const [on] = usePictureMotionOn();
  const motion = useMotionAt(cmd);
  if (!on || !motion) return null;
  return <PictureViewport placeholderHeight={120}><PreviewBody motion={motion} /></PictureViewport>;
}

function PreviewBody({ motion: raw }: { motion: PictureMotion }) {
  const { data } = useGame();
  const { pictureRoles, hiddenImages } = useAddons();
  const motion = useMemo<PictureMotion>(() => {
    const hidden = hiddenImageMatcher(hiddenImages);
    const keep = (p: { id: number; name: string }) => {
      const role = pictureRoles?.[p.id];
      return role !== "hidden" && role !== "hud" && !hidden?.(p.name);
    };
    return { end: raw.end, frames: raw.frames.map((f) => ({ t: f.t, pictures: f.pictures.filter(keep) })) };
  }, [raw, pictureRoles, hiddenImages]);
  const names = motionNames(motion);
  const { images, status } = usePictureImages(names);
  const size = data?.screenSize ?? DEFAULT_SCREEN;
  if (names.length === 0) return null;
  return (
    <div className="mt-2 max-w-md">
      <MotionCanvas
        motion={motion} images={images} stand={false} label="그림 움직임 미리 보기"
        ready={names.every((n) => status(n) !== "loading")}
        view={{ left: 0, top: 0, width: size.width, height: size.height }}
      />
    </div>
  );
}
