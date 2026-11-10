// 머신러닝: how strictly unknown questions are refused (5 levels, computed per bot at deploy
// training), blocks matched only by their exact sentences, keyword match, and confusable blocks.
import { useDraft } from "../draft/DraftContext";
import { listBlocks } from "../model/blocks";
import type { BotDoc } from "../model/doc";
import { classifierIntents, LEVELS, levelOf, setExactOnly, setKeywordMatch, setLevel } from "../model/ml";
import { ErrorNotice } from "../components/ErrorNotice";

const OOS = "out_of_scope";

export function MachineLearning() {
  const draft = useDraft();
  const doc = draft.doc;
  return (
    <>
      <header>
        <h1>머신러닝</h1>
        <p>봇이 사용자의 말을 블록에 맞추는 방식을 정해요. 바꾼 내용은 저장한 뒤 배포용 학습과 배포를 해야 사용자에게 반영돼요.</p>
      </header>
      {!doc ? (draft.query.isError ? <ErrorNotice error={draft.query.error} onRetry={() => void draft.query.refetch()} />
        : <p className="status" role="status">불러오는 중…</p>) : <Settings doc={doc} />}
    </>
  );
}

function Settings({ doc }: { doc: BotDoc }) {
  const draft = useDraft();
  const level = levelOf(doc);
  const hasOos = (doc.intents?.[OOS]?.examples.length ?? 0) > 0;
  const blocks = listBlocks(doc).filter((b) => b.intent && b.intent !== OOS);
  const trainable = classifierIntents(doc).length;
  const numbers = doc.settings as { intent_threshold?: number; similarity_threshold?: number } | undefined;
  return (
    <>
      <fieldset className="group">
        <legend>유사도</legend>
        <p className="status">높일수록 블록과 거리가 먼 말을 더 많이 "모르는 질문"으로 돌려보내요. 단계마다 모르는 질문을 거절하는 목표가 있고, 배포용 학습이 그 목표에 맞는 기준을 이 봇의 예문으로 계산해요.</p>
        <label className="check">
          <input type="radio" name="level" checked={level === null} onChange={() => draft.update((d) => setLevel(d, null))} />
          직접 정한 값 <span className="mono status">의도 {numbers?.intent_threshold ?? 0.3} · 유사도 {numbers?.similarity_threshold ?? 0.39}</span>
        </label>
        {LEVELS.map((l) => (
          <label className="check" key={l.id}>
            <input type="radio" name="level" checked={level === l.id} onChange={() => draft.update((d) => setLevel(d, l.id))} />
            {l.label} <span className="status">모르는 질문 {Math.round(l.target * 100)}% 거절</span>
          </label>
        ))}
        {level !== null && !hasOos && (
          <p className="help" data-tone="warn">"모르는 질문" 예시가 없어 계산할 수 없어요. 그대로 배포하면 직접 정한 값을 써요. 폴백 화면에서 예시를 넣어 주세요.</p>
        )}
        {level !== null && <p className="help">봇테스트(테스트 빌드)는 계산 없이 직접 정한 값으로 동작해요. 단계의 효과는 배포한 봇에서 보여요.</p>}
      </fieldset>

      <fieldset className="group">
        <legend>블록별 정확 일치만</legend>
        <p className="status">켠 블록은 예문과 똑같은 말(띄어쓰기·문장부호 무시)에만 반응해요. 비슷한 말로 잘못 시작되면 안 되는 블록에 써요.</p>
        <ul className="plain">
          {blocks.map((b) => {
            const on = !!doc.intents?.[b.intent as string]?.exact_only;
            const last = !on && trainable <= 2; // the classifier needs at least two intents
            return (
              <li key={b.id}>
                <label className="check">
                  <input type="checkbox" checked={on} disabled={last}
                         onChange={(e) => draft.update((d) => setExactOnly(d, b.intent as string, e.target.checked))} />
                  {b.label || b.id}
                </label>
              </li>
            );
          })}
        </ul>
        {trainable <= 2 && <p className="help">학습할 블록이 둘은 남아야 해서 더 켤 수 없어요.</p>}
      </fieldset>

      <fieldset className="group">
        <legend>핵심어 일치</legend>
        <label className="check">
          <input type="checkbox" checked={!!doc.settings?.keyword_match}
                 onChange={(e) => draft.update((d) => setKeywordMatch(d, e.target.checked))} />
          조사·어미만 다른 말도 예문과 같은 것으로 보기
        </label>
        <p className="help">"날씨 알려줘"와 "날씨 알려주세요"를 같은 말로 봐요. 서로 다른 블록의 예문이 같은 핵심어로 줄면 그 말은 어느 쪽에도 바로 맞추지 않고 학습할 때 알려 줘요.</p>
      </fieldset>

      <Confusable doc={doc} />
    </>
  );
}

function Confusable({ doc }: { doc: BotDoc }) {
  const { build } = useDraft();
  const label = (intent: string) => listBlocks(doc).find((b) => b.intent === intent)?.label || intent;
  return (
    <section className="group" aria-label="헷갈리는 블록">
      <h2>헷갈리는 블록</h2>
      {build.status !== "ready" ? <p className="status">저장해서 테스트 빌드가 만들어지면 여기에 보여요.</p>
        : build.confusable.length === 0 ? <p className="status">예문이 서로 많이 닮은 블록이 없어요.</p>
          : (
            <ul className="plain">
              {build.confusable.map((p) => (
                <li key={`${p.a}-${p.b}`}>
                  <strong>{label(p.a)}</strong> ↔ <strong>{label(p.b)}</strong> <span className="mono status">{p.similarity.toFixed(2)}</span>
                  <p className="help">“{p.example_a}” / “{p.example_b}” — 두 블록을 가르는 예문을 더 넣어 보세요.</p>
                </li>
              ))}
            </ul>
          )}
    </section>
  );
}
