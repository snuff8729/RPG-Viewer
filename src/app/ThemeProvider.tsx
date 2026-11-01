import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "rpgv.theme";
const Context = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* 기기 저장소를 쓸 수 없어요 */
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return <Context.Provider value={{ theme, setTheme }}>{children}</Context.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const value = useContext(Context);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}
