// 분석: 기간별 사용자·세션·블록 호출 집계와 신규 사용자 잔존율 (docs/builder-plan.md §6 B4, E12).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type AnalyticsBlockOut,
  type AnalyticsDayOut,
  type AnalyticsOut,
  type AnalyticsRetentionOut,
  type AnalyticsTotalsOut,
  getAnalytics,
} from "../api/analytics";
import { ApiError } from "../api/client";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import { formatPercent, PERIOD_PRESETS, type PresetId, presetRange, rangeProblem } from "../model/analytics";
import "../styles/analytics.css";

function PeriodPicker({ preset, onPreset, from, to, onFrom, onTo, problem }: {
  preset: PresetId | "custom"; onPreset: (p: PresetId | "custom") => void;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; problem: string | null;
}) {
  return (
    <section>
      <h2>기간</h2>
      <div className="tabs" role="group" aria-label="기간 선택">
        {PERIOD_PRESETS.map((p) => (
          <button key={p.id} type="button" className="btn" aria-pressed={preset === p.id} onClick={() => onPreset(p.id)}>
            {p.label}
          </button>
        ))}
        <button type="button" className="btn" aria-pressed={preset === "custom"} onClick={() => onPreset("custom")}>직접 고르기</button>
      </div>
      {preset === "custom" && (
        <div className="filters">
          <div className="field">
            <label htmlFor="analytics-from">시작일</label>
            <input id="analytics-from" type="date" className="input" value={from} onChange={(e) => onFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="analytics-to">종료일</label>
            <input id="analytics-to" type="date" className="input" value={to} onChange={(e) => onTo(e.target.value)} />
          </div>
        </div>
      )}
      {problem && <p className="help" data-tone="error" role="alert">{problem}</p>}
    </section>
  );
}

function Totals({ totals }: { totals: AnalyticsTotalsOut }) {
  const tiles: { key: string; label: string; value: string; help?: string }[] = [
    { key: "users", label: "사용자", value: String(totals.users) },
    { key: "new_users", label: "신규", value: String(totals.new_users) },
    { key: "returning_users", label: "재방문", value: String(totals.returning_users) },
    { key: "sessions", label: "세션", value: String(totals.sessions) },
    { key: "messages", label: "말", value: String(totals.messages) },
    { key: "block_calls", label: "블록 호출", value: String(totals.block_calls) },
    { key: "fallbacks", label: "폴백", value: String(totals.fallbacks) },
    {
      key: "knowledge_rate", label: "지식베이스 응답률", value: formatPercent(totals.knowledge_rate),
      help: "응답률 = 지식베이스 답 / (지식베이스 답 + 폴백)",
    },
  ];
  return (
    <section>
      <h2>요약</h2>
      <ul className="stat-tiles">
        {tiles.map((t) => (
          <li key={t.key} className="stat-tile">
            <p className="stat-tile-label">{t.label}</p>
            <p className="stat-tile-value">{t.value}</p>
            {t.help && <p className="stat-tile-help">{t.help}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 사용자(실선)와 세션(점선)의 일별 변화. 값은 색이 아니라 선 모양으로도 구분하고, 실제 수치는
 * 바로 아래 표가 접근성 있게 보여줘서 이 그래프는 보조 역할만 해요. */
function DailyChart({ days }: { days: AnalyticsDayOut[] }) {
  const width = 600;
  const height = 160;
  const padL = 8, padR = 8, padT = 10, padB = 10;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const maxVal = Math.max(1, ...days.map((d) => Math.max(d.users, d.sessions)));
  const x = (i: number) => (days.length <= 1 ? padL + innerW / 2 : padL + (i / (days.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / maxVal) * innerH;
  const pathOf = (key: "users" | "sessions") =>
    days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  return (
    <div className="analytics-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="analytics-chart" aria-hidden="true">
        <line x1={padL} y1={padT + innerH} x2={width - padR} y2={padT + innerH} className="analytics-axis" />
        <path d={pathOf("sessions")} className="analytics-line analytics-line--sessions" />
        <path d={pathOf("users")} className="analytics-line analytics-line--users" />
        {days.map((d, i) => <circle key={d.date} cx={x(i)} cy={y(d.users)} r={2.5} className="analytics-dot--users" />)}
        {days.length === 1 && days.map((d, i) => ( // one day: a line has nothing to join, so mark sessions too
          <circle key={`s-${d.date}`} cx={x(i)} cy={y(d.sessions)} r={2.5} className="analytics-dot--sessions" />
        ))}
      </svg>
      <ul className="analytics-legend">
        <li><span className="analytics-swatch analytics-swatch--users" />사용자</li>
        <li><span className="analytics-swatch analytics-swatch--sessions" />세션</li>
      </ul>
      <p className="analytics-chart-range">{days[0]?.date} ~ {days[days.length - 1]?.date}</p>
    </div>
  );
}

function DailySection({ days }: { days: AnalyticsDayOut[] }) {
  return (
    <section>
      <h2>일별</h2>
      <DailyChart days={days} />
      <table className="table stack-table">
        <thead>
          <tr>
            <th scope="col">날짜</th><th scope="col">사용자</th><th scope="col">신규</th><th scope="col">재방문</th>
            <th scope="col">세션</th><th scope="col">말</th><th scope="col">블록 호출</th><th scope="col">폴백</th>
            <th scope="col">지식베이스 응답</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td data-label="날짜" className="mono">{d.date}</td>
              <td data-label="사용자">{d.users}</td>
              <td data-label="신규">{d.new_users}</td>
              <td data-label="재방문">{d.returning_users}</td>
              <td data-label="세션">{d.sessions}</td>
              <td data-label="말">{d.messages}</td>
              <td data-label="블록 호출">{d.block_calls}</td>
              <td data-label="폴백">{d.fallbacks}</td>
              <td data-label="지식베이스 응답">{d.knowledge_answers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function BlocksSection({ blocks, totalCalls }: { blocks: AnalyticsBlockOut[]; totalCalls: number }) {
  return (
    <section>
      <h2>블록 순위</h2>
      {blocks.length === 0 ? (
        <div className="empty"><p>이 기간에 호출된 블록이 없어요.</p></div>
      ) : (
        <table className="table stack-table">
          <thead><tr><th scope="col">블록</th><th scope="col">호출</th><th scope="col">비중</th></tr></thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.block}>
                <td data-label="블록">{b.label} <span className="mono status">{b.block}</span></td>
                <td data-label="호출">{b.calls}</td>
                <td data-label="비중">{formatPercent(totalCalls > 0 ? b.calls / totalCalls : 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function RetentionSection({ retention }: { retention: AnalyticsRetentionOut[] }) {
  return (
    <section>
      <h2>잔존율</h2>
      <p className="help">그 날 처음 온 사용자 중 다음 날, 7일 뒤에도 다시 온 비율이에요.</p>
      {retention.length === 0 ? (
        <div className="empty"><p>이 기간에 새로 들어온 사용자가 없어요.</p></div>
      ) : (
        <table className="table stack-table">
          <thead><tr><th scope="col">가입일</th><th scope="col">신규 사용자</th><th scope="col">다음 날</th><th scope="col">7일 뒤</th></tr></thead>
          <tbody>
            {retention.map((r) => (
              <tr key={r.date}>
                <td data-label="가입일" className="mono">{r.date}</td>
                <td data-label="신규 사용자">{r.new_users}</td>
                <td data-label="다음 날">{formatPercent(r.d1)}</td>
                <td data-label="7일 뒤">{formatPercent(r.d7)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Report({ data }: { data: AnalyticsOut }) {
  const t = data.totals; // a welcome block opened with no message still counts as a block call
  if (t.messages + t.block_calls + t.fallbacks + t.knowledge_answers === 0) {
    return <div className="empty"><p>이 기간에는 사용자 대화가 없어요.</p></div>;
  }
  return (
    <>
      <Totals totals={data.totals} />
      <DailySection days={data.days} />
      <BlocksSection blocks={data.blocks} totalCalls={data.totals.block_calls} />
      <RetentionSection retention={data.retention} />
    </>
  );
}

export function Analytics() {
  const draft = useDraft();
  const botId = draft.botId;
  const [preset, setPreset] = useState<PresetId | "custom">("7");
  const defaultCustom = presetRange(7);
  const [customFrom, setCustomFrom] = useState(defaultCustom.from);
  const [customTo, setCustomTo] = useState(defaultCustom.to);

  const activePreset = PERIOD_PRESETS.find((p) => p.id === preset);
  const range = activePreset ? presetRange(activePreset.days) : { from: customFrom, to: customTo };
  const problem = preset === "custom" ? rangeProblem(customFrom, customTo) : null;

  const analytics = useQuery({
    queryKey: ["analytics", botId, range.from, range.to],
    queryFn: () => getAnalytics(botId, range.from, range.to),
    enabled: problem === null,
  });

  return (
    <>
      <header>
        <h1>분석</h1>
        <p>사용자 대화에서 블록 호출과 사용자 수를 하루(한국 시간) 단위로 셉니다. 봇테스트 대화는 세지 않아요.</p>
      </header>

      <PeriodPicker
        preset={preset} onPreset={setPreset}
        from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo}
        problem={problem}
      />

      {problem !== null ? null : analytics.isPending ? (
        <div className="skeletons" role="status">
          <span className="visually-hidden">분석 데이터를 불러오는 중</span>
          <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
        </div>
      ) : analytics.isError ? (
        analytics.error instanceof ApiError && analytics.error.status === 409
          ? <p className="notice" data-tone="error" role="alert">봇이 삭제 대기 중이에요. 봇 목록에서 되살릴 수 있어요.</p>
          : analytics.error instanceof ApiError && analytics.error.status === 422
            ? <p className="notice" data-tone="error" role="alert">{`엔진이 이 기간을 받지 않았어요: ${analytics.error.message}`}</p>
            : <ErrorNotice error={analytics.error} onRetry={() => void analytics.refetch()} />
      ) : analytics.isSuccess ? (
        <Report data={analytics.data} />
      ) : null}
    </>
  );
}
