export type ThemeMode = "system" | "light" | "dark";
const KEY = "chatbot-builder.theme";
const MODES: readonly ThemeMode[] = ["system", "light", "dark"];

export function readTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(KEY);
    return MODES.includes(saved as ThemeMode) ? (saved as ThemeMode) : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // storage blocked: the choice lasts until reload
  }
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? "system";
}

export const THEME_LABEL: Record<ThemeMode, string> = { system: "시스템", light: "라이트", dark: "다크" };
