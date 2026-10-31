import { createContext, useCallback, useContext, useState, type Dispatch, type SetStateAction } from "react";

/** Small UI values survive window eviction; never store assets or DOM nodes here.
 * The map belongs to one reader body (game/branch/log epoch).
 */
export const ReaderItemStateContext = createContext<Map<string, boolean | number> | null>(null);

export function useReaderItemState<T extends boolean | number>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(ReaderItemStateContext);
  const [value, setValue] = useState<T>(() => memory?.has(key) ? memory.get(key) as T : initial);
  const remember = useCallback<Dispatch<SetStateAction<T>>>(next => {
    setValue(prev => {
      const value = typeof next === "function" ? next(prev) : next;
      memory?.set(key, value);
      return value;
    });
  }, [memory, key]);
  return [value, remember];
}
