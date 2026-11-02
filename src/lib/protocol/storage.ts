/**
 * Versioned localStorage persistence for the mock. Every access is wrapped: storage can be missing,
 * full or blocked (private mode, previews), and the app must still work in memory.
 */
export const STORAGE_KEY = "score:mock:v1";

export function loadJson<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
