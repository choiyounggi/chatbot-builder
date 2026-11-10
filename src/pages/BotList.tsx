import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { listBots } from "../api/client";
import type { BotSummary } from "../api/types";
import { ErrorNotice } from "../components/ErrorNotice";
import { TopBar } from "../components/TopBar";

export function DeployState({ bot }: { bot: BotSummary }) {
  if (bot.live === null) return <span className="chip" data-tone="pending">배포 전 · 초안만 있음</span>;
  return (
    <span className="chips">
      <span className="chip" data-tone="live">배포됨 · v{bot.live_number}</span>
      {bot.undeployed_changes && <span className="chip" data-tone="pending">배포 안 된 변경</span>}
    </span>
  );
}

export function BotList() {
  const bots = useQuery({ queryKey: ["bots"], queryFn: listBots });
  return (
    <>
      <TopBar />
      <main className="page">
        <header>
          <h1>봇</h1>
          <p>봇을 골라 블록·엔티티·학습을 편집해요. 배포하기 전까지 사용자 대화에는 영향이 없어요.</p>
        </header>
        {bots.isPending && (
          <div className="skeletons" role="status">
            <span className="visually-hidden">봇 목록을 불러오는 중</span>
            <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
          </div>
        )}
        {bots.isError && <ErrorNotice error={bots.error} onRetry={() => void bots.refetch()} />}
        {bots.isSuccess && bots.data.length === 0 && (
          <div className="empty">
            <p>아직 봇이 없어요.</p>
            <p>엔진을 봇 폴더와 함께 켜면 여기에 나타나요: <code>uv run python -m chatcore.api --bot bots/sample</code></p>
          </div>
        )}
        {bots.isSuccess && bots.data.length > 0 && (
          <table className="table">
            <thead>
              <tr><th scope="col">이름</th><th scope="col">ID</th><th scope="col">상태</th></tr>
            </thead>
            <tbody>
              {bots.data.map((bot) => (
                <tr key={bot.id}>
                  <td><Link to={`/bots/${encodeURIComponent(bot.id)}/settings`}>{bot.label || bot.id}</Link></td>
                  <td className="mono">{bot.id}</td>
                  <td><DeployState bot={bot} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
