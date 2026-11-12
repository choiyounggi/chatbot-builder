import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useParams } from "react-router";
import { listBots } from "../api/client";
import { EntityPanel } from "../components/EntityPanel";
import { TestPanel } from "../components/TestPanel";
import { TopBar } from "../components/TopBar";
import { DraftProvider } from "../draft/DraftContext";
import { SaveBar } from "../draft/SaveBar";

/** The bot's sections, in the order a builder works through them. */
export const SECTIONS = [
  { path: "scenarios", label: "시나리오" },
  { path: "skills", label: "스킬" },
  { path: "knowledge", label: "지식베이스" },
  { path: "training", label: "학습" },
  { path: "analytics", label: "분석" },
  { path: "deploy", label: "배포" },
  { path: "history", label: "작업이력" },
  { path: "ml", label: "머신러닝" },
  { path: "web", label: "웹 채팅" },
  { path: "settings", label: "설정" },
] as const;

type PanelKind = "entities" | "tester";
const PANELS: Record<PanelKind, { title: string }> = {
  entities: { title: "엔티티" },
  tester: { title: "봇테스트" },
};

export function BotLayout() {
  const { botId = "" } = useParams();
  const bots = useQuery({ queryKey: ["bots"], queryFn: listBots });
  const bot = bots.data?.find((b) => b.id === botId);
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const toggles = useRef<Partial<Record<PanelKind, HTMLButtonElement | null>>>({});
  const toggle = (kind: PanelKind) => setPanel((open) => (open === kind ? null : kind));
  const close = () => {
    const opener = panel ? toggles.current[panel] : null;
    setPanel(null);
    opener?.focus(); // the close button is about to disappear: give focus back to what opened the panel
  };
  const onPanelKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  // on narrow screens the rail scrolls sideways: keep the current section in view
  const rail = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    rail.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <DraftProvider key={botId} botId={botId}>
      <TopBar actions={
        <span className="tools">
          {(Object.keys(PANELS) as PanelKind[]).map((kind) => (
            <button key={kind} type="button" className="btn" aria-pressed={panel === kind} onClick={() => toggle(kind)}
                    ref={(el) => { toggles.current[kind] = el; }}>
              {PANELS[kind].title}
            </button>
          ))}
        </span>
      }>
        <span className="crumb">
          <strong>{bot?.label || botId}</strong>
          <span className="mono">{botId}</span>
        </span>
      </TopBar>
      <a className="skip-link" href="#content">본문으로 건너뛰기</a>
      <div className="shell" data-panel={panel ? "open" : "closed"}>
        <nav className="rail" aria-label="봇 메뉴" ref={rail}>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.path}><NavLink to={s.path}>{s.label}</NavLink></li>
            ))}
          </ul>
        </nav>
        <main className="content" id="content" tabIndex={-1}>
          <SaveBar />
          <Outlet />
        </main>
        {panel && (
          <aside className="panel" aria-label={PANELS[panel].title} onKeyDown={onPanelKey}>
            <header>
              <h2>{PANELS[panel].title}</h2>
              <button type="button" className="btn btn--quiet" onClick={close} aria-label={`${PANELS[panel].title} 닫기`}>닫기</button>
            </header>
            {panel === "entities" ? <EntityPanel /> : <TestPanel />}
          </aside>
        )}
      </div>
    </DraftProvider>
  );
}
