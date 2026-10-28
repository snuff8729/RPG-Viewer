import { MemoryFolder } from "@/core/fs/folder";

// DEV 전용: Vite dev 서버가 /tests/fixtures/<name>/... 로 서빙하는 픽스처를 MemoryFolder로 만든다.
const FILES: Record<"sample-mz" | "sample-mv", string[]> = {
  "sample-mz": [
    "data/Actors.json", "data/Armors.json", "data/CommonEvents.json", "data/Items.json",
    "data/Map001.json", "data/Map002.json", "data/Map003.json", "data/MapInfos.json",
    "data/System.json", "data/Troops.json", "data/Weapons.json",
    "img/faces/actor1.png", "img/faces/People1.png_", "img/pictures/village_map.png_",
  ],
  "sample-mv": [
    "www/data/Actors.json", "www/data/Armors.json", "www/data/CommonEvents.json", "www/data/Items.json",
    "www/data/Map001.json", "www/data/MapInfos.json", "www/data/System.json", "www/data/Troops.json",
    "www/data/Weapons.json", "www/img/faces/Actor1.rpgmvp",
  ],
};

export async function loadFixtureOverHttp(name: "sample-mz" | "sample-mv"): Promise<MemoryFolder> {
  const files: Record<string, string | Uint8Array> = {};
  await Promise.all(FILES[name].map(async (rel) => {
    const res = await fetch(`/tests/fixtures/${name}/${rel}`);
    if (!res.ok) throw new Error(`fixture fetch failed: ${rel} (${res.status})`);
    files[rel] = rel.toLowerCase().endsWith(".json") ? await res.text() : new Uint8Array(await res.arrayBuffer());
  }));
  return new MemoryFolder(files);
}
