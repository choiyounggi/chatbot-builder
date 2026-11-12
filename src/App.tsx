import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import { ApiError } from "./api/client";
import { TopBar } from "./components/TopBar";
import { Analytics } from "./pages/Analytics";
import { BotLayout } from "./pages/BotLayout";
import { BotList } from "./pages/BotList";
import { BotSettings } from "./pages/BotSettings";
import { WebChat } from "./pages/WebChat";
import { Deploy } from "./pages/Deploy";
import { Edits } from "./pages/Edits";
import { MachineLearning } from "./pages/MachineLearning";
import { Scenarios } from "./pages/Scenarios";
import { Knowledge } from "./pages/Knowledge";
import { Skills } from "./pages/Skills";
import { Training } from "./pages/Training";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // a 4xx (no token, not found, conflict) does not get better by asking again
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<BotList />} />
      <Route path="/bots/:botId" element={<BotLayout />}>
        <Route index element={<Navigate to="settings" replace />} />
        <Route path="scenarios" element={<Scenarios />} />
        <Route path="scenarios/:blockId" element={<Scenarios />} />
        <Route path="training" element={<Training />} />
        <Route path="ml" element={<MachineLearning />} />
        <Route path="deploy" element={<Deploy />} />
        <Route path="history" element={<Edits />} />
        <Route path="skills" element={<Skills />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="web" element={<WebChat />} />
        <Route path="settings" element={<BotSettings />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <>
      <TopBar />
      <main className="page">
        <header>
          <h1>없는 주소예요</h1>
          <p><Link to="/">봇 목록으로 돌아가기</Link></p>
        </header>
      </main>
    </>
  );
}

export function Providers({ children, client: given }: { children: ReactNode; client?: QueryClient }) {
  const [client] = useState(() => given ?? createQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A rendering bug shows a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("builder crashed", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <div className="notice" data-tone="error" role="alert">
          <h2>화면을 그리다가 문제가 생겼어요</h2>
          <p>빌더의 버그예요. 새로 고침하면 대부분 돌아와요. 계속되면 브라우저 콘솔의 오류를 알려 주세요.</p>
          <div className="actions"><a className="btn" href="/">처음으로</a></div>
        </div>
      </main>
    );
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <Providers>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </Providers>
    </ErrorBoundary>
  );
}
