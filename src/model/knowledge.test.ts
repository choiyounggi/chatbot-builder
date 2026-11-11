import { describe, expect, it } from "vitest";
import type { KnowledgeDoc } from "../api/knowledge";
import {
  addDocument, addFaq, duplicateFaqIds, emptyKb, faqWarning, firstLine, removeDocument, removeFaq, sameKb,
  documentWarning, kbProblem, uploadReason, writeDocument, writeFaq, writeSettings,
} from "./knowledge";

const base = (): KnowledgeDoc => ({
  faq: [{ id: "faq_1", question: "영업 시간이 어떻게 되나요?", answer: "평일 9시부터 6시까지예요." }],
  documents: [{ id: "doc_1", name: "안내문", text: "# 안내문\n\n문의는 이메일로 해 주세요." }],
  settings: { mode: "instant", suggest_text: "이런 답을 찾았어요. 골라 주세요." },
});

describe("emptyKb / sameKb", () => {
  it("빈 초안은 faq·documents가 비어 있고 기본 응답 방식을 쓴다", () => {
    const kb = emptyKb();
    expect(kb.faq).toEqual([]);
    expect(kb.documents).toEqual([]);
    expect(kb.settings?.mode).toBe("instant");
  });

  it("키 순서가 달라도 같은 내용이면 같다고 본다", () => {
    const a = base();
    const b = { settings: a.settings, documents: a.documents, faq: a.faq };
    expect(sameKb(a, b)).toBe(true);
  });

  it("내용이 다르면 다르다고 본다", () => {
    expect(sameKb(base(), emptyKb())).toBe(false);
  });

  it("둘 다 null이면 같다(초안이 없는 상태)", () => {
    expect(sameKb(null, null)).toBe(true);
  });
});

describe("FAQ 헬퍼", () => {
  it("새 FAQ는 가장 작은 미사용 번호를 쓴다", () => {
    const { kb, id } = addFaq(base());
    expect(id).toBe("faq_2");
    expect(kb.faq).toHaveLength(2);
    expect(kb.faq?.[1]).toEqual({ id: "faq_2", question: "", answer: "" });
  });

  it("중간 id를 지우면 그 번호를 다시 쓴다", () => {
    let kb = base();
    kb = addFaq(kb).kb; // faq_2
    kb = removeFaq(kb, "faq_1");
    const { id } = addFaq(kb);
    expect(id).toBe("faq_1");
  });

  it("writeFaq는 지정한 FAQ만 바꾼다", () => {
    const kb = writeFaq(base(), "faq_1", { answer: "주말은 쉬어요." });
    expect(kb.faq?.[0]?.answer).toBe("주말은 쉬어요.");
    expect(kb.faq?.[0]?.question).toBe("영업 시간이 어떻게 되나요?");
  });

  it("빈 질문/답은 경고하지만 저장은 막지 않는다(엔진이 판단)", () => {
    const empty = { id: "faq_1", question: "", answer: "" };
    expect(faqWarning(empty, new Set())).toBe("질문을 입력해 주세요");
    expect(faqWarning({ ...empty, question: "질문" }, new Set())).toBe("답을 입력해 주세요");
    expect(faqWarning({ ...empty, question: "질문", answer: "답" }, new Set())).toBeNull();
  });

  it("트림한 질문이 같으면 중복으로 표시한다", () => {
    const kb: KnowledgeDoc = {
      faq: [
        { id: "faq_1", question: "영업 시간은?", answer: "a" },
        { id: "faq_2", question: " 영업 시간은? ", answer: "b" },
        { id: "faq_3", question: "다른 질문", answer: "c" },
      ],
    };
    const dup = duplicateFaqIds(kb);
    expect(dup).toEqual(new Set(["faq_1", "faq_2"]));
    const second = kb.faq?.[1];
    expect(second && faqWarning(second, dup)).toBe("같은 질문이 이미 있어요");
  });

  it("빈 질문끼리는 중복으로 보지 않는다(경계값)", () => {
    const kb: KnowledgeDoc = { faq: [{ id: "faq_1", question: "", answer: "a" }, { id: "faq_2", question: "  ", answer: "b" }] };
    expect(duplicateFaqIds(kb)).toEqual(new Set());
  });
});

describe("문서 헬퍼", () => {
  it("새 문서는 가장 작은 미사용 번호를 쓴다", () => {
    const { kb, id } = addDocument(base(), "새 문서", "본문");
    expect(id).toBe("doc_2");
    expect(kb.documents?.[1]).toEqual({ id: "doc_2", name: "새 문서", text: "본문" });
  });

  it("writeDocument/removeDocument는 지정한 문서만 바꾸거나 지운다", () => {
    const written = writeDocument(base(), "doc_1", { name: "새 이름" });
    expect(written.documents?.[0]?.name).toBe("새 이름");
    const removed = removeDocument(base(), "doc_1");
    expect(removed.documents).toEqual([]);
  });

  it("firstLine은 빈 줄을 건너뛰고 80자가 넘으면 줄인다", () => {
    expect(firstLine("\n\n첫 줄\n둘째 줄")).toBe("첫 줄");
    expect(firstLine("")).toBe("");
    const long = "가".repeat(90);
    expect(firstLine(long)).toBe(`${"가".repeat(80)}…`);
  });
});

describe("응답 방식", () => {
  it("설정이 없던 초안에도 기본값 위에 patch를 적용한다", () => {
    const kb = writeSettings({}, { mode: "suggest" });
    expect(kb.settings).toEqual({ mode: "suggest", suggest_text: "이런 답을 찾았어요. 골라 주세요." });
  });

  it("안내 문구만 바꿀 수 있다", () => {
    const kb = writeSettings(base(), { suggest_text: "골라 주세요" });
    expect(kb.settings).toEqual({ mode: "instant", suggest_text: "골라 주세요" });
  });
});

describe("review fixes: messages and limits", () => {
  it("names save problems as on screen and keeps unknown ones", () => {
    expect(kbProblem("faq.0.question: String should have at most 300 characters")).toBe("FAQ 1 질문: String should have at most 300 characters");
    expect(kbProblem("documents.2.text: Field required")).toBe("문서 3 본문: Field required");
    expect(kbProblem("settings.suggest_text: too long")).toBe("안내 문구: too long");
    expect(kbProblem("settings.mode: bad")).toBe("응답 방식: bad");
    expect(kbProblem("(top): duplicate FAQ ids: ['a']")).toBe("(top): duplicate FAQ ids: ['a']");
  });

  it("says the engine's upload reasons in Korean and keeps unknown ones", () => {
    expect(uploadReason("the file is not UTF-8 text")).toMatch(/UTF-8 글이 아니에요/);
    expect(uploadReason("the PDF is encrypted")).toBe("암호가 걸린 PDF는 읽을 수 없어요.");
    expect(uploadReason("the file is over 10 MB")).toBe("10MB가 넘는 파일은 올릴 수 없어요.");
    expect(uploadReason("something new")).toBe("something new");
  });

  it("warns about an empty name before an empty text, and not for a usable document", () => {
    expect(documentWarning({ id: "d", name: " ", text: "" })).toMatch(/이름/);
    expect(documentWarning({ id: "d", name: "a", text: " " })).toMatch(/본문/);
    expect(documentWarning({ id: "d", name: "a", text: "b" })).toBeNull();
  });
});
