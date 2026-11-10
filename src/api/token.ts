// The admin token lives in sessionStorage: gone when the tab closes, never sent anywhere
// but the engine. When storage is blocked it lives in memory for this page instead.
const KEY = "chatbot-builder.admin-token";
let memory: string | null = null;

/** Header values must be printable ASCII: a pasted zero-width space or smart quote would break every request. */
export function isValidToken(token: string): boolean {
  return /^[\x21-\x7E]+$/.test(token);
}

export function getToken(): string | null {
  try {
    return window.sessionStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setToken(token: string): void {
  memory = token && isValidToken(token) ? token : null;
  try {
    if (memory) window.sessionStorage.setItem(KEY, memory);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: the in-memory copy serves this page
  }
}
