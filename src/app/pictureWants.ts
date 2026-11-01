import { isWritableFolder, type GameFolder } from "@/core/fs/folder";
import { listPictureCopies, listPictures, parseLogText, pictureWants, pictureWantsText } from "@/core/diagnose";
import { livePaths } from "@/core/live/installer";
import type { GameData } from "@/core/types";

/** 기록 플러그인(1.31.0)에 복사를 부탁하는 그림 목록 파일 */
export const pictureWantsFile = (dataRoot: string): string => `${livePaths(dataRoot).logDir}/missing-pictures.json`;

/**
 * 게임 폴더에 파일이 없는 그림(게임 실행 파일 안에 묶인 그림 등) 목록을 rpg-viewer/missing-pictures.json에 쓴다.
 * 게임이 다음에 켜질 때 기록 플러그인이 그 그림을 읽어 rpg-viewer/pictures/<이름>.png로 복사해 둔다.
 * 쓸 수 없는 폴더·권한 없음·휴대폰 보기면 조용히 건너뛰고, 내용이 같으면 쓰지 않는다. 쓴 경우만 true. 예외를 던지지 않는다.
 */
export async function syncPictureWants(folder: GameFolder, data: GameData): Promise<boolean> {
  try {
    if (!isWritableFolder(folder) || !(await folder.canWrite())) return false;
    const files = await listPictures(folder, data.imgRoot);
    if (!files) return false;
    const p = livePaths(data.dataRoot);
    files.copies = await listPictureCopies(folder, p.logDir);
    const log = parseLogText(await folder.readText(p.logFile).catch(() => null));
    const names = pictureWants(data, files, log);
    const path = pictureWantsFile(data.dataRoot);
    const old = await folder.readText(path).catch(() => null);
    // 부탁할 것이 없고 파일도 없으면 만들지 않는다
    if (old === null && names.length === 0) return false;
    const text = pictureWantsText(names);
    if (old === text) return false;
    return await folder.writeText(path, text);
  } catch {
    return false;
  }
}
