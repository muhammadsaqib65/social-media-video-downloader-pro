import { sanitizeFileName } from "@/lib/platform";

export type InstagramExtracted = {
  platform: "instagram";
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  sourceUrl: string;
  downloadUrl: string;
  fileName: string;
  mediaUrl?: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstHttp(value: unknown): string {
  if (typeof value === "string" && value.startsWith("http")) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstHttp(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      firstHttp(obj.video_url) ||
      firstHttp(obj.url) ||
      firstHttp(obj.src) ||
      firstHttp(obj.download_url) ||
      firstHttp(obj.video) ||
      firstHttp(obj.videos)
    );
  }
  return "";
}

function deepFindVideo(obj: unknown, depth = 0): string {
  if (depth > 7 || obj == null) return "";
  if (typeof obj === "string") {
    if (
      obj.startsWith("http") &&
      (obj.includes(".mp4") ||
        obj.includes("video") ||
        obj.includes("cdninstagram") ||
        obj.includes("fbcdn"))
    ) {
      return obj;
    }
    return "";
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindVideo(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    for (const key of [
      "video_url",
      "video_versions",
      "contentUrl",
      "download_url",
      "url",
    ]) {
      const found = firstHttp(record[key]);
      if (found) return found;
    }
    for (const value of Object.values(record)) {
      const found = deepFindVideo(value, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

async function extractFromOEmbed(url: string) {
  try {
    const response = await fetch(
      `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`,
      {
        headers: { "User-Agent": UA },
        cache: "no-store",
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title || "Instagram Video",
      author: data.author_name || "Unknown",
      thumbnail: data.thumbnail_url || "",
    };
  } catch {
    return null;
  }
}

async function extractFromPage(url: string): Promise<Partial<InstagramExtracted> | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const html = await response.text();

    // JSON-LD contentUrl often contains mp4 for public reels
    const ldRegex =
      /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
    let ldMatch: RegExpExecArray | null;
    while ((ldMatch = ldRegex.exec(html)) !== null) {
      try {
        const json = JSON.parse(ldMatch[1]);
        const mediaUrl = firstHttp(json?.contentUrl) || deepFindVideo(json);
        if (mediaUrl) {
          return {
            title: pickString(json?.caption, json?.name, "Instagram Video"),
            author: pickString(json?.author?.name, json?.author, "Unknown"),
            thumbnail: pickString(json?.thumbnailUrl),
            mediaUrl,
          };
        }
      } catch {
        // continue
      }
    }

    const videoMatch =
      html.match(/"video_url"\s*:\s*"([^"]+)"/) ||
      html.match(/"contentUrl"\s*:\s*"(https:[^"]+\.mp4[^"]*)"/) ||
      html.match(/(https:\/\/[^"'\s]+cdninstagram[^"'\s]+\.mp4[^"'\s]*)/);

    if (videoMatch?.[1]) {
      const mediaUrl = videoMatch[1]
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/")
        .replace(/\\/g, "");
      return {
        title: "Instagram Video",
        author: "Unknown",
        thumbnail: "",
        mediaUrl,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export async function extractInstagram(url: string): Promise<InstagramExtracted> {
  const [page, oembed] = await Promise.all([
    extractFromPage(url),
    extractFromOEmbed(url),
  ]);

  const title = pickString(page?.title, oembed?.title, "Instagram Video");
  const author = pickString(page?.author, oembed?.author, "Unknown");
  const thumbnail = pickString(page?.thumbnail, oembed?.thumbnail);
  const mediaUrl = pickString(page?.mediaUrl);

  return {
    platform: "instagram",
    title,
    author,
    thumbnail,
    duration: 0,
    sourceUrl: url,
    mediaUrl: mediaUrl || undefined,
    downloadUrl: `/api/download/instagram/file?url=${encodeURIComponent(url)}`,
    fileName: `${sanitizeFileName(title)}.mp4`,
  };
}

export async function openInstagramStream(url: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  fileName: string;
  title: string;
}> {
  const extracted = await extractInstagram(url);
  let mediaUrl = extracted.mediaUrl;

  if (!mediaUrl) {
    const again = await extractFromPage(url);
    mediaUrl = again?.mediaUrl;
  }

  if (!mediaUrl) {
    throw new Error(
      "Could not resolve a direct Instagram media file. The post may be private, login-gated, or blocked on this server."
    );
  }

  const response = await fetch(mediaUrl, {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.instagram.com/",
      Origin: "https://www.instagram.com",
      Accept: "*/*",
    },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to fetch Instagram media stream (${response.status})`
    );
  }

  return {
    stream: response.body as ReadableStream<Uint8Array>,
    contentType: response.headers.get("content-type") || "video/mp4",
    fileName: extracted.fileName,
    title: extracted.title,
  };
}
