import type { GameData } from "../types";

function fallback(name: string | undefined | null, id: number): string {
  return name ? name : `#${id}`;
}

function pick(list: ReadonlyArray<{ name: string } | null> | undefined, id: number): string {
  return fallback(list?.[id]?.name, id);
}

export function switchName(data: GameData, id: number): string {
  return fallback(data.system?.switches?.[id], id);
}

export function variableName(data: GameData, id: number): string {
  return fallback(data.system?.variables?.[id], id);
}

export function itemName(data: GameData, id: number): string {
  return pick(data.items, id);
}

export function weaponName(data: GameData, id: number): string {
  return pick(data.weapons, id);
}

export function armorName(data: GameData, id: number): string {
  return pick(data.armors, id);
}

export function actorName(data: GameData, id: number): string {
  return pick(data.actors, id);
}
