import { sanitizeFileName } from "@/lib/platform";

export type TikTokExtracted = {
  platform: "tiktok";
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

function firstUrl(value: unknown): string {
  if (typeof value === "string" && value.startsWith("http")) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      firstUrl(obj.url_list) ||
      firstUrl(obj.UrlList) ||
      firstUrl(obj.urls) ||
      firstUrl(obj.url) ||
      firstUrl(obj.play) ||
      firstUrl(obj.download) ||
      firstUrl(obj.no_watermark) ||
      firstUrl(obj.nwm_video_url) ||
      firstUrl(obj.playAddr) ||
      firstUrl(obj.downloadAddr)
    );
  }
  return "";
}

function deepFindMedia(obj: unknown, depth = 0): string {
  if (depth > 6 || obj == null) return "";
  if (typeof obj === "string") {
    if (
      obj.startsWith("http") &&
      (obj.includes("tiktokcdn") ||
        obj.includes("musical") ||
        obj.includes(".mp4") ||
        obj.includes("video"))
    ) {
      return obj;
    }
    return "";
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindMedia(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const preferredKeys = [
      "nwm_video_url_HQ",
      "nwm_video_url",
      "play",
      "playAddr",
      "downloadAddr",
      "download",
      "no_watermark",
      "noWatermark",
      "hdplay",
      "wmplay",
    ];
    for (const key of preferredKeys) {
      const found = firstUrl(record[key]);
      if (found) return found;
    }
    for (const value of Object.values(record)) {
      const found = deepFindMedia(value, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

async function resolveCanonicalUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    return response.url || url;
  } catch {
    return url;
  }
}

async function extractFromTikwm(url: string): Promise<Partial<TikTokExtracted> | null> {
  const endpoints = [
    `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
    `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          Referer: "https://www.tikwm.com/",
        },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const json = (await response.json()) as any;
      if (json?.code !== 0 && json?.code !== "0" && !json?.data) continue;

      const data = json.data || json;
      const mediaUrl =
        pickString(
          data.hdplay,
          data.play,
          data.nwm_video_url_HQ,
          data.nwm_video_url,
          data.wmplay
        ) || deepFindMedia(data);

      if (!mediaUrl) continue;

      return {
        title: pickString(data.title, data.desc, "TikTok Video"),
        author: pickString(
          data.author?.nickname,
          data.author?.unique_id,
          data.author?.uniqueId,
          "Unknown"
        ),
        thumbnail: pickString(data.cover, data.origin_cover, data.ai_dynamic_cover),
        duration: Number(data.duration || 0) || 0,
        mediaUrl,
      };
    } catch {
      // try next
    }
  }
  return null;
}

async function extractFromPage(url: string): Promise<Partial<TikTokExtracted> | null> {
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

    const rehydration = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/
    );
    if (rehydration?.[1]) {
      try {
        const parsed = JSON.parse(rehydration[1]);
        const detail =
          parsed?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo
            ?.itemStruct ||
          parsed?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;

        // Sometimes nested differently
        const item =
          detail ||
          parsed?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;

        const maybeItem =
          item ||
          (() => {
            const scope = parsed?.__DEFAULT_SCOPE__ || {};
            for (const value of Object.values(scope)) {
              const candidate = (value as any)?.itemInfo?.itemStruct;
              if (candidate?.video) return candidate;
            }
            return null;
          })();

        if (maybeItem?.video) {
          const video = maybeItem.video;
          const mediaUrl =
            firstUrl(video.playAddr) ||
            firstUrl(video.downloadAddr) ||
            firstUrl(video.bitrateInfo?.[0]?.PlayAddr?.UrlList) ||
            deepFindMedia(video);

          if (mediaUrl) {
            return {
              title: pickString(maybeItem.desc, "TikTok Video"),
              author: pickString(
                maybeItem.author?.nickname,
                maybeItem.author?.uniqueId,
                "Unknown"
              ),
              thumbnail: pickString(
                video.cover,
                video.originCover,
                video.dynamicCover
              ),
              duration: Number(video.duration || 0) || 0,
              mediaUrl: mediaUrl.replace(/\\u002F/g, "/").replace(/\\/g, ""),
            };
          }
        }
      } catch {
        // continue
      }
    }

    // Fallback regex over HTML
    const playMatch =
      html.match(/"playAddr"\s*:\s*"([^"]+)"/) ||
      html.match(/"downloadAddr"\s*:\s*"([^"]+)"/) ||
      html.match(/"play_addr"[^}]*"url_list"\s*:\s*\[\s*"([^"]+)"/);

    if (playMatch?.[1]) {
      const mediaUrl = playMatch[1]
        .replace(/\\u002F/g, "/")
        .replace(/\\\//g, "/")
        .replace(/\\/g, "");
      return {
        title: "TikTok Video",
        author: "Unknown",
        thumbnail: "",
        duration: 0,
        mediaUrl,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

async function extractFromOEmbed(url: string): Promise<Partial<TikTokExtracted> | null> {
  try {
    const response = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
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
      title: data.title || "TikTok Video",
      author: data.author_name || "Unknown",
      thumbnail: data.thumbnail_url || "",
      duration: 0,
    };
  } catch {
    return null;
  }
}

export async function extractTikTok(url: string): Promise<TikTokExtracted> {
  const canonical = await resolveCanonicalUrl(url);

  const [tikwm, page, oembed] = await Promise.all([
    extractFromTikwm(canonical),
    extractFromPage(canonical),
    extractFromOEmbed(canonical),
  ]);

  const mediaUrl = pickString(tikwm?.mediaUrl, page?.mediaUrl);
  const title = pickString(tikwm?.title, page?.title, oembed?.title, "TikTok Video");
  const author = pickString(
    tikwm?.author,
    page?.author,
    oembed?.author,
    "Unknown"
  );
  const thumbnail = pickString(
    tikwm?.thumbnail,
    page?.thumbnail,
    oembed?.thumbnail
  );
  const duration = Number(tikwm?.duration || page?.duration || 0) || 0;

  if (!mediaUrl) {
    // Still return metadata so UI works; file route will try again and show a clear error
    return {
      platform: "tiktok",
      title,
      author,
      thumbnail,
      duration,
      sourceUrl: canonical,
      downloadUrl: `/api/download/tiktok/file?url=${encodeURIComponent(canonical)}`,
      fileName: `${sanitizeFileName(title)}.mp4`,
    };
  }

  return {
    platform: "tiktok",
    title,
    author,
    thumbnail,
    duration,
    sourceUrl: canonical,
    mediaUrl,
    downloadUrl: `/api/download/tiktok/file?url=${encodeURIComponent(canonical)}`,
    fileName: `${sanitizeFileName(title)}.mp4`,
  };
}

export async function openTikTokStream(url: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  fileName: string;
  title: string;
}> {
  const extracted = await extractTikTok(url);
  let mediaUrl = extracted.mediaUrl;

  if (!mediaUrl) {
    // Retry hard extraction once more with resolved URL
    const again = await extractFromTikwm(extracted.sourceUrl);
    mediaUrl = again?.mediaUrl;
  }

  if (!mediaUrl) {
    const page = await extractFromPage(extracted.sourceUrl);
    mediaUrl = page?.mediaUrl;
  }

  if (!mediaUrl) {
    throw new Error(
      "Could not resolve a direct TikTok media file. The video may be private/region-locked, or TikTok blocked this server."
    );
  }

  const response = await fetch(mediaUrl, {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.tiktok.com/",
      Origin: "https://www.tiktok.com",
      Accept: "*/*",
    },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch TikTok media stream (${response.status})`);
  }

  return {
    stream: response.body as ReadableStream<Uint8Array>,
    contentType: response.headers.get("content-type") || "video/mp4",
    fileName: extracted.fileName,
    title: extracted.title,
  };
}
