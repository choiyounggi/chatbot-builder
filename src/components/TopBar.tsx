import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { applyTheme, nextTheme, readTheme, THEME_LABEL } from "../theme";

/** children: what is open (left, after the wordmark); actions: buttons for it (right). */
export function TopBar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  const [theme, setTheme] = useState(readTheme);
  const cycle = () => {
    const next = nextTheme(theme);
    applyTheme(next);
    setTheme(next);
  };
  return (
    <header className="topbar">
      <Link to="/" className="wordmark">챗봇 빌더</Link>
      {children}
      <span className="spacer" />
      {actions}
      <button type="button" className="btn btn--quiet" onClick={cycle} title="눌러서 시스템 · 라이트 · 다크 순으로 바꿔요">
        테마 · {THEME_LABEL[theme]}
      </button>
    </header>
  );
}
