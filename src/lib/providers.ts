export async function fetchJson<T = any>(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
  const timeoutMs = init?.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, data, text };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: error instanceof Error ? error.message : "fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function firstHttpUrl(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") {
    if (value.startsWith("http://") || value.startsWith("https://")) return value;
    // sometimes escaped
    const unescaped = value.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (unescaped.startsWith("http")) return unescaped;
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstHttpUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of [
      "url",
      "src",
      "video_url",
      "download_url",
      "downloadUrl",
      "play",
      "hdplay",
      "contentUrl",
      "url_list",
      "UrlList",
    ]) {
      const found = firstHttpUrl(obj[key], depth + 1);
      if (found) return found;
    }
    for (const val of Object.values(obj)) {
      const found = firstHttpUrl(val, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

export function collectHttpUrls(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || value == null) return out;
  if (typeof value === "string") {
    if (value.startsWith("http") && !out.includes(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHttpUrls(item, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const val of Object.values(value as Record<string, unknown>)) {
      collectHttpUrls(val, out, depth + 1);
    }
  }
  return out;
}
