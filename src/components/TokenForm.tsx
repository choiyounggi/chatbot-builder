import { type FormEvent, useState } from "react";
import { isValidToken, setToken } from "../api/token";

/** Shown when the engine answers 401: it runs with CHATCORE_ADMIN_TOKEN.
 * `rejected`: a token was already sent and the engine said no. */
export function TokenForm({ onSaved, rejected }: { onSaved: () => void; rejected: boolean }) {
  const [value, setValue] = useState("");
  const token = value.trim();
  const malformed = token !== "" && !isValidToken(token);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation(); // never submits an enclosing form
    if (!token || malformed) return;
    setToken(token);
    setValue("");
    onSaved();
  };
  return (
    <form className="notice" data-tone="warn" onSubmit={submit}>
      <h2>관리자 토큰이 필요해요</h2>
      <p>엔진이 <code>CHATCORE_ADMIN_TOKEN</code>으로 보호되어 있어요. 엔진을 켤 때 정한 토큰을 입력해 주세요. 이 탭을 닫으면 잊어버려요.</p>
      {rejected && <p role="alert" className="help" data-tone="error">입력한 토큰을 엔진이 받지 않았어요. 엔진을 켤 때 정한 값과 같은지 확인해 주세요.</p>}
      <div className="field">
        <label htmlFor="admin-token">관리자 토큰</label>
        <input id="admin-token" className="input" type="password" autoComplete="off" value={value} autoFocus={rejected}
               aria-invalid={malformed} aria-describedby="admin-token-help" onChange={(e) => setValue(e.target.value)} />
        <p id="admin-token-help" className="help" data-tone={malformed ? "error" : undefined}>
          {malformed ? "토큰에는 영문·숫자·기호만 들어가요. 붙여넣을 때 섞인 공백이나 따옴표가 있는지 확인해 주세요." : ""}
        </p>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn--primary" disabled={!token || malformed}>토큰 저장</button>
      </div>
    </form>
  );
}
