import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { setToken } from "../api/token";

afterEach(() => {
  cleanup();
  setToken(""); // also the in-memory fallback
  window.sessionStorage.clear();
  window.localStorage.clear();
});
