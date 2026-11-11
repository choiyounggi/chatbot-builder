// B5: the skills screen (목록·에디터·삭제·테스트 실행·오류 내역·비밀값).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, Providers } from "../App";
import { DraftProvider, useDraft } from "../draft/DraftContext";
import { fakeEngine, type Handler } from "../test/engine";
import { Skills } from "./Skills";

afterEach(() => vi.unstubAllGlobals());

function DirtyToggle() {
  const draft = useDraft();
  return (
    <button type="button" disabled={!draft.doc} onClick={() => draft.update((d) => ({ ...d, label: "임시" }))}>
      dirty
    </button>
  );
}

function renderSkills() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(
    <Providers client={client}>
      <DraftProvider botId="sample">
        <DirtyToggle />
        <Skills />
      </DraftProvider>
    </Providers>,
  );
}

const B = "/v1/builder/bots/sample";

const DOC = {
  id: "sample", label: "샘플", responses: {},
  scenarios: {
    check_weather: {
      label: "날씨 안내",
      trigger: { intent: "weather" },
      slots: { city: { entity: "city", validation: { action: "lookup_city", fail: "틀려요" } } },
      steps: [{ action: "get_forecast", args: {} }, { respond: "r1" }],
    },
  },
  skills: {
    get_forecast: { label: "날씨 API", url: "https://api.example.com/forecast", timeout_ms: 3000, headers: { "X-Key": "abc" } },
    lookup_city: { url: "https://api.example.com/city", timeout_ms: 3000 },
    ping: { url: "https://api.example.com/ping", timeout_ms: 2000 },
  },
};

function engine(options: {
  draft?: Handler;
  secrets?: Handler;
  errors?: Handler;
  test?: Handler;
  setSecret?: Handler;
  deleteSecret?: Handler;
} = {}) {
  const posts: { path: string; body: unknown }[] = [];
  const routes: Record<string, Handler> = {
    [`GET ${B}/draft`]: options.draft ?? (() => ({ body: structuredClone(DOC), headers: { ETag: '"1"' } })),
    [`GET ${B}/secrets`]: options.secrets ?? (() => ({ body: { bot: "sample", items: [{ name: "API_KEY", updated_at: "2026-11-10T01:00:00+00:00" }] } })),
    [`GET ${B}/skills/errors?limit=100`]: options.errors ?? (() => ({ body: { bot: "sample", items: [] } })),
    [`POST ${B}/skills/get_forecast/test`]: async (init) => {
      posts.push({ path: "test", body: JSON.parse(String(init.body)) });
      return options.test ? await options.test(init) : { body: { ok: true, status: 200, ms: 120, result: { temp: 21 }, error: null } };
    },
    [`PUT ${B}/secrets/API_KEY`]: async (init) => {
      posts.push({ path: "put-secret", body: JSON.parse(String(init.body)) });
      return options.setSecret ? await options.setSecret(init) : { status: 204 };
    },
    [`DELETE ${B}/secrets/API_KEY`]: async (init) => {
      posts.push({ path: "delete-secret", body: null });
      return options.deleteSecret ? await options.deleteSecret(init) : { status: 204 };
    },
  };
  return { fetchMock: fakeEngine(routes), posts };
}

describe("스킬 목록", () => {
  it("이름(또는 id)·주소 호스트·연결된 블록 수를 보여준다", async () => {
    engine();
    renderSkills();
    const row = (await screen.findByText("날씨 API")).closest("button") as HTMLElement;
    expect(within(row).getByText("api.example.com · 연결된 블록 1개")).toBeInTheDocument();
    const noLabel = screen.getByText("lookup_city").closest("button") as HTMLElement;
    expect(within(noLabel).getByText("api.example.com · 연결된 블록 1개")).toBeInTheDocument();
    const unused = screen.getByText("ping").closest("button") as HTMLElement;
    expect(within(unused).getByText("api.example.com · 연결된 블록 0개")).toBeInTheDocument();
  });

  it("스킬이 없으면 안내 문구를 보여준다", async () => {
    engine({ draft: () => ({ body: { id: "sample", scenarios: {}, responses: {} }, headers: { ETag: '"1"' } }) });
    renderSkills();
    expect(await screen.findByText("아직 스킬이 없어요. 새 스킬을 만들어 보세요.")).toBeInTheDocument();
  });

  it("새 스킬을 만들면 빈 URL·기본 시간 제한으로 선택되어 에디터가 열린다", async () => {
    engine();
    renderSkills();
    await screen.findByText("날씨 API");
    await userEvent.click(screen.getByRole("button", { name: "새 스킬" }));
    expect(await screen.findAllByText("skill_1")).toHaveLength(2); // the list row and the editor's id
    expect(screen.getByLabelText("URL")).toHaveValue("");
    expect(screen.getByText("주소를 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByLabelText("시간 제한(ms)")).toHaveValue("3000");
  });
});

describe("에디터", () => {
  it("id는 읽기 전용이고, 이름과 URL을 편집할 수 있다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    expect(screen.getByText("get_forecast")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("get_forecast")).toBeNull(); // not an editable field
    await userEvent.type(screen.getByLabelText("이름"), "!");
    expect(await screen.findByText("날씨 API!")).toBeInTheDocument();
  });

  it("URL 형식을 검증한다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("ping"));
    const url = screen.getByLabelText("URL");
    await userEvent.clear(url);
    await userEvent.type(url, "ftp://example.com");
    expect(await screen.findByText("http:// 또는 https://와 호스트로 시작하고, 공백이 없어야 해요")).toBeInTheDocument();
    await userEvent.clear(url);
    await userEvent.type(url, "http://[[::1"); // "[[" types one "[": passes the engine shape check, not a URL
    expect(await screen.findByText("주소 형식이 올바르지 않아요")).toBeInTheDocument();
  });

  it("테스트 URL은 비워 둘 수 있다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("ping"));
    expect(screen.getByText("테스트 실행에서만 이 주소를 써요. 비워 두면 URL을 그대로 써요.")).toBeInTheDocument();
  });

  it("시간 제한은 유효하지 않은 동안 입력한 글자를 그대로 두고, 유효한 값만 반영된다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("ping"));
    const timeout = screen.getByLabelText("시간 제한(ms)");
    await userEvent.clear(timeout);
    await userEvent.type(timeout, "50");
    expect(timeout).toHaveValue("50");
    expect(screen.getByText("100~10000 사이의 정수를 넣어 주세요. 지금은 2000ms로 저장돼요.")).toBeInTheDocument();
    await userEvent.type(timeout, "0");
    expect(timeout).toHaveValue("500");
    expect(screen.getByText("100~10000ms 사이로 설정돼요.")).toBeInTheDocument();
  });

  it("헤더에 비밀값을 넣고, 새 헤더를 추가·삭제한다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    await userEvent.selectOptions(screen.getByLabelText("X-Key에 비밀값 넣기"), "API_KEY");
    expect(await screen.findByDisplayValue("abc{{ secret.API_KEY }}")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("새 헤더 이름"), "Authorization");
    await userEvent.type(screen.getByLabelText("새 헤더 값"), "Bearer ");
    await userEvent.click(screen.getByRole("button", { name: "헤더 추가" }));
    expect(await screen.findByText("Authorization")).toBeInTheDocument();
    expect(screen.getByLabelText("Authorization 값")).toHaveValue("Bearer ");

    await userEvent.click(screen.getByRole("button", { name: "헤더 Authorization 삭제" }));
    expect(screen.queryByText("Authorization")).toBeNull();
  });

  it("헤더 이름 형식이 틀리면 추가 버튼이 꺼지고 이유를 보여준다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("ping"));
    await userEvent.type(screen.getByLabelText("새 헤더 이름"), "bad name");
    await userEvent.type(screen.getByLabelText("새 헤더 값"), "x");
    expect(screen.getByRole("button", { name: "헤더 추가" })).toBeDisabled();
    expect(screen.getByText("헤더 이름 형식이 올바르지 않아요")).toBeInTheDocument();
  });
});

describe("스킬 삭제", () => {
  it("쓰는 블록이 있으면 거절하고 블록 이름을 보여준다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    await userEvent.click(screen.getByRole("button", { name: "스킬 삭제" }));
    expect(await screen.findByText("이 스킬을 쓰는 블록이 있어요: 날씨 안내(check_weather). 그곳에서 먼저 빼 주세요.")).toBeInTheDocument();
    expect(screen.getByText("get_forecast")).toBeInTheDocument(); // still there
  });

  it("쓰는 곳이 없으면 삭제된다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("ping"));
    await userEvent.click(screen.getByRole("button", { name: "스킬 삭제" }));
    await waitFor(() => expect(screen.queryByText("ping")).toBeNull());
  });
});

describe("테스트 실행", () => {
  it("저장 안 된 변경이 있으면 꺼지고 안내한다", async () => {
    engine();
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    await waitFor(() => expect(screen.getByRole("button", { name: "dirty" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "dirty" }));
    expect(screen.getByText("저장 안 된 변경이 있어요. 테스트 실행은 저장된 스킬로만 돼요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "테스트 실행" })).toBeDisabled();
  });

  it("성공 결과를 ok·status·ms와 JSON으로 보여준다", async () => {
    const { posts } = engine();
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    await userEvent.type(screen.getByLabelText("사용자 발화 (선택)"), "내일 날씨 어때");
    await userEvent.click(screen.getByRole("button", { name: "테스트 실행" }));
    expect(await screen.findByText("성공 · 200 · 120ms")).toBeInTheDocument();
    expect(screen.getByText(/"temp": 21/)).toBeInTheDocument();
    expect(posts[0]).toEqual({ path: "test", body: { params: {}, utterance: "내일 날씨 어때" } });
  });

  it("실패를 한국어 종류와 detail로 보여준다", async () => {
    engine({ test: () => ({ body: {
      ok: false, status: 500, ms: 30, result: null,
      error: { at: "2026-11-10T00:00:00+00:00", skill: "get_forecast", kind: "http_status", status: 500, detail: "서버 오류", ms: 30, test: true },
    } }) });
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    await userEvent.click(screen.getByRole("button", { name: "테스트 실행" }));
    expect(await screen.findByText("HTTP 500 응답 · 서버 오류")).toBeInTheDocument();
  });

  it("파라미터 행을 추가·삭제해서 보낸다", async () => {
    const { posts } = engine();
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    await userEvent.click(screen.getByRole("button", { name: "파라미터 추가" }));
    await userEvent.type(screen.getByLabelText("파라미터 1 이름"), "city");
    await userEvent.type(screen.getByLabelText("파라미터 1 값"), "서울");
    await userEvent.click(screen.getByRole("button", { name: "테스트 실행" }));
    await screen.findByText("성공 · 200 · 120ms");
    expect(posts[0]?.body).toEqual({ params: { city: "서울" }, utterance: "" });
  });

  it("오류 내역을 테스트 실행 뒤 새로고침한다", async () => {
    let afterTest = false;
    engine({
      test: () => {
        afterTest = true;
        return { body: { ok: false, status: null, ms: 10, result: null,
          error: { at: "2026-11-10T03:00:00+00:00", skill: "get_forecast", kind: "timeout", status: null, detail: "", ms: 10, test: true } } };
      },
      errors: () => ({ body: { bot: "sample", items: afterTest
        ? [{ at: "2026-11-10T03:00:00+00:00", skill: "get_forecast", kind: "timeout", status: null, detail: "", ms: 10, test: true }] : [] } }),
    });
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "오류 내역" }));
    expect(await screen.findByText("아직 오류가 없어요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "스킬 목록" }));
    await userEvent.click(await screen.findByText("날씨 API"));
    await userEvent.click(screen.getByRole("button", { name: "테스트 실행" }));
    await screen.findByText("실패 · — · 10ms");
    await userEvent.click(screen.getByRole("button", { name: "오류 내역" }));
    expect(await screen.findByText(/시간 안에 답하지 않았어요/)).toBeInTheDocument();
  });
});

describe("오류 내역", () => {
  it("시간·스킬 이름·한국어 종류·상태·상세·ms·테스트 배지를 보여준다", async () => {
    engine({ errors: () => ({ body: { bot: "sample", items: [
      { at: "2026-11-10T01:00:00+00:00", skill: "get_forecast", kind: "blocked", status: null, detail: "10.0.0.1", ms: 5, test: false },
    ] } }) });
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "오류 내역" }));
    const list = await screen.findByRole("list", { name: "오류 내역" });
    expect(within(list).getByText("날씨 API")).toBeInTheDocument(); // the skill's label, not its id
    expect(within(list).getByText(/내부 주소라 막혔어요.*5ms.*10\.0\.0\.1/)).toBeInTheDocument();
    expect(within(list).queryByText("테스트")).toBeNull(); // test: false
  });

  it("불러오지 못하면 다시 시도 버튼을 보여준다", async () => {
    engine({ errors: () => ({ status: 500, body: { detail: "internal error" } }) });
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "오류 내역" }));
    expect(await screen.findByRole("button", { name: /다시 시도/ })).toBeInTheDocument();
  });
});

describe("비밀값", () => {
  it("목록과 수정 시각을 보여주고, 추가하면 비밀번호 칸이 비워진다", async () => {
    engine();
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "비밀값" }));
    expect(await screen.findByText("API_KEY")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("이름"), "NEW_TOKEN");
    const value = screen.getByLabelText("값");
    expect(value).toHaveAttribute("type", "password");
    await userEvent.type(value, "토큰아님-ascii-value");
    expect(screen.getByRole("button", { name: "비밀값 저장" })).toBeDisabled(); // the name must be a plain token
  });

  it("기존 이름으로 값을 바꿔 저장한다(값은 다시 보여주지 않음)", async () => {
    const { posts } = engine();
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "비밀값" }));
    await screen.findByText("API_KEY");
    await userEvent.type(screen.getByLabelText("이름"), "API_KEY");
    await userEvent.type(screen.getByLabelText("값"), "new-secret-value");
    await userEvent.click(screen.getByRole("button", { name: "비밀값 저장" }));
    expect(await screen.findByText("‘API_KEY’ 비밀값을 저장했어요.")).toBeInTheDocument();
    expect(screen.getByLabelText("값")).toHaveValue("");
    expect(posts[0]).toEqual({ path: "put-secret", body: { value: "new-secret-value" } });
  });

  it("422면 엔진 메시지를 그대로 보여준다", async () => {
    engine({ setSecret: () => ({ status: 422, body: { detail: "value must be 1-4000 ASCII characters" } }) });
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "비밀값" }));
    await screen.findByText("API_KEY");
    await userEvent.type(screen.getByLabelText("이름"), "API_KEY");
    await userEvent.type(screen.getByLabelText("값"), "x");
    await userEvent.click(screen.getByRole("button", { name: "비밀값 저장" }));
    expect(await screen.findByText("value must be 1-4000 ASCII characters")).toBeInTheDocument();
  });

  it("확인한 뒤에만 지우고, 취소하면 요청을 보내지 않는다", async () => {
    const { posts } = engine();
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "비밀값" }));
    await userEvent.click(await screen.findByRole("button", { name: "삭제" }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(posts.some((p) => p.path === "delete-secret")).toBe(false);
    vi.stubGlobal("confirm", vi.fn(() => true));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("‘API_KEY’ 비밀값을 지웠어요.")).toBeInTheDocument();
  });
});

describe("리뷰 후 고친 것", () => {
  it("목록에서 쓸 수 없는 주소의 스킬에 경고를 단다", async () => {
    const doc = structuredClone(DOC);
    doc.skills.ping.url = "http://내부.example/ping"; // not ASCII: the engine refuses it
    engine({ draft: () => ({ body: doc, headers: { ETag: '"1"' } }) });
    renderSkills();
    const bad = (await screen.findByText("ping")).closest("button") as HTMLElement;
    expect(within(bad).getByText("주소를 고쳐야 쓸 수 있어요")).toBeInTheDocument();
    const good = screen.getByText("날씨 API").closest("button") as HTMLElement;
    expect(within(good).queryByText("주소를 고쳐야 쓸 수 있어요")).toBeNull();
  });

  it("테스트 실행이 404면 저장한 뒤 다시 하라고 안내한다", async () => {
    engine({ test: () => ({ status: 404, body: { detail: "no skill get_forecast" } }) });
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    await userEvent.click(screen.getByRole("button", { name: "테스트 실행" }));
    expect(await screen.findByText("저장된 초안에 이 스킬이 없어요. 저장한 뒤 다시 실행해 주세요.")).toBeInTheDocument();
  });

  it("테스트 실행이 422면 엔진이 준 문제 목록을 보여준다", async () => {
    engine({ test: () => ({ status: 422, body: { detail: ["skills.ping: url은 http(s) 주소여야 해요"] } }) });
    renderSkills();
    await userEvent.click(await screen.findByText("날씨 API"));
    await userEvent.click(screen.getByRole("button", { name: "테스트 실행" }));
    expect(await screen.findByText("저장된 초안에 고칠 곳이 있어 테스트할 수 없어요: skills.ping: url은 http(s) 주소여야 해요")).toBeInTheDocument();
  });

  it("NUL 문자가 든 비밀값은 저장할 수 없다", async () => {
    engine();
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "비밀값" }));
    await screen.findByText("API_KEY");
    await userEvent.type(screen.getByLabelText("이름"), "API_KEY");
    fireEvent.change(screen.getByLabelText("값"), { target: { value: "abc\0def" } }); // a paste can carry it
    expect(screen.getByText("줄바꿈과 NUL 문자는 쓸 수 없어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "비밀값 저장" })).toBeDisabled();
  });

  it("지우려는 비밀값이 이미 없으면(404) 그렇게 알리고 목록을 다시 읽는다", async () => {
    let reads = 0;
    engine({
      secrets: () => {
        reads += 1;
        return { body: { bot: "sample", items: reads === 1 ? [{ name: "API_KEY", updated_at: "2026-11-10T01:00:00+00:00" }] : [] } };
      },
      deleteSecret: () => ({ status: 404, body: { detail: "no secret API_KEY" } }),
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "비밀값" }));
    await userEvent.click(await screen.findByRole("button", { name: "삭제" }));
    expect(await screen.findByText("‘API_KEY’ 비밀값은 이미 없어요.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "삭제" })).toBeNull());
    expect(reads).toBe(2);
  });

  it("비밀값 칸은 브라우저 자동 완성·비밀번호 저장을 끈다", async () => {
    engine();
    renderSkills();
    await userEvent.click(screen.getByRole("button", { name: "비밀값" }));
    await screen.findByText("API_KEY");
    expect(screen.getByLabelText("이름")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("값")).toHaveAttribute("autocomplete", "new-password");
  });
});
