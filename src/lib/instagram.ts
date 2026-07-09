import { sanitizeFileName } from "@/lib/platform";
import { fetchJson, firstHttpUrl } from "@/lib/providers";

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
  warning?: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const IG_APP_ID = "936619743392459";
// Used by many web downloaders for public shortcode media
const IG_DOC_ID = "8845758582119845";

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function extractShortcode(url: string): string | null {
  const match = url.match(
    /instagram\.com\/(?:p|reel|reels|tv|stories\/[^/]+)\/([^/?#]+)/i
  );
  if (match?.[1]) return match[1];
  // bare shortcode fallback
  const bare = url.match(/\/([A-Za-z0-9_-]{8,15})\/?(?:\?|$)/);
  return bare?.[1] || null;
}

function normalizeInstagramUrl(url: string): string {
  const shortcode = extractShortcode(url);
  if (!shortcode) return url;
  if (/\/reel\//i.test(url) || /\/reels\//i.test(url)) {
    return `https://www.instagram.com/reel/${shortcode}/`;
  }
  if (/\/tv\//i.test(url)) return `https://www.instagram.com/tv/${shortcode}/`;
  return `https://www.instagram.com/p/${shortcode}/`;
}

function rawCookie(): string | undefined {
  const full = process.env.INSTAGRAM_COOKIE?.trim();
  if (full) return full;
  const session = process.env.IG_SESSIONID?.trim();
  if (!session) return undefined;
  return session.includes("=") ? session : `sessionid=${session}`;
}

function hasInstagramAuth(): boolean {
  return Boolean(rawCookie() || process.env.RAPIDAPI_KEY?.trim());
}

function cookieHeader(): Record<string, string> {
  const cookie = rawCookie();
  return cookie ? { Cookie: cookie } : {};
}

function decodeEscapedUrl(value: string): string {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\/g, "")
    .replace(/&amp;/g, "&");
}

function deepFindVideo(obj: unknown, depth = 0): string {
  if (depth > 10 || obj == null) return "";
  if (typeof obj === "string") {
    const v = decodeEscapedUrl(obj);
    if (
      v.startsWith("http") &&
      (v.includes(".mp4") ||
        v.includes("video") ||
        v.includes("cdninstagram") ||
        v.includes("fbcdn"))
    ) {
      return v;
    }
    return "";
  }
  if (Array.isArray(obj)) {
    // Prefer highest bandwidth video_versions style arrays
    const sorted = [...obj].sort((a: any, b: any) => {
      const ab = Number(a?.bandwidth || a?.bit_rate || a?.width || 0);
      const bb = Number(b?.bandwidth || b?.bit_rate || b?.width || 0);
      return bb - ab;
    });
    for (const item of sorted) {
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
      "video_dash_manifest",
      "url",
      "src",
    ]) {
      if (key in record) {
        const found = deepFindVideo(record[key], depth + 1);
        if (found) return found;
      }
    }
    for (const value of Object.values(record)) {
      const found = deepFindVideo(value, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function parseMediaFromHtml(html: string): Partial<InstagramExtracted> | null {
  const patterns = [
    /"video_url"\s*:\s*"(https:[^"]+)"/,
    /"contentUrl"\s*:\s*"(https:[^"]+)"/,
    /"playback_url"\s*:\s*"(https:[^"]+)"/,
    /(https:\/\/[^"'\\\s]+(?:cdninstagram|fbcdn)[^"'\\\s]*\.mp4[^"'\\\s]*)/,
  ];

  let mediaUrl = "";
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) {
      mediaUrl = decodeEscapedUrl(match);
      break;
    }
  }
  if (!mediaUrl) return null;

  const title =
    html.match(/"caption"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"title"\s*:\s*"([^"]+)"/)?.[1] ||
    "Instagram Video";
  const author =
    html.match(/"username"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"owner"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"/)?.[1] ||
    "Unknown";
  const thumbnail =
    html.match(/"thumbnailUrl"\s*:\s*"(https:[^"]+)"/)?.[1] ||
    html.match(/"display_url"\s*:\s*"(https:[^"]+)"/)?.[1] ||
    "";

  return {
    title: decodeEscapedUrl(title).replace(/\\n/g, " ").slice(0, 180),
    author,
    thumbnail: thumbnail ? decodeEscapedUrl(thumbnail) : "",
    mediaUrl,
  };
}

async function extractFromGraphql(
  shortcode: string
): Promise<Partial<InstagramExtracted> | null> {
  const variables = {
    shortcode,
    fetch_tagged_user_count: null,
    hoisted_comment_id: null,
    hoisted_reply_id: null,
  };

  const endpoints = [
    // GET style used by downloadgram
    `https://www.instagram.com/graphql/query/?doc_id=${IG_DOC_ID}&variables=${encodeURIComponent(
      JSON.stringify(variables)
    )}`,
    // alternate doc ids seen in the wild
    `https://www.instagram.com/graphql/query/?doc_id=10015901848480474&variables=${encodeURIComponent(
      JSON.stringify({ shortcode })
    )}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": UA,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "X-IG-App-ID": IG_APP_ID,
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://www.instagram.com/",
          Origin: "https://www.instagram.com",
          ...cookieHeader(),
        },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const json = await response.json();
      const media =
        json?.data?.xdt_shortcode_media ||
        json?.data?.shortcode_media ||
        json?.data?.media ||
        null;
      if (!media) {
        // sometimes nested deeper
        const deep = deepFindVideo(json);
        if (deep) {
          return {
            title: "Instagram Video",
            author: "Unknown",
            thumbnail: "",
            mediaUrl: deep,
          };
        }
        continue;
      }

      const mediaUrl =
        firstHttpUrl(media.video_url) ||
        deepFindVideo(media.video_versions) ||
        deepFindVideo(media);
      if (!mediaUrl) continue;

      return {
        title: pickString(
          media.edge_media_to_caption?.edges?.[0]?.node?.text,
          media.title,
          "Instagram Video"
        ),
        author: pickString(media.owner?.username, media.owner?.full_name, "Unknown"),
        thumbnail: pickString(media.display_url, media.thumbnail_src),
        mediaUrl: decodeEscapedUrl(mediaUrl),
      };
    } catch {
      // next
    }
  }

  // POST form variant
  try {
    const response = await fetch("https://www.instagram.com/graphql/query", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-IG-App-ID": IG_APP_ID,
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://www.instagram.com/",
        Origin: "https://www.instagram.com",
        ...cookieHeader(),
      },
      body: new URLSearchParams({
        doc_id: IG_DOC_ID,
        variables: JSON.stringify(variables),
      }).toString(),
      cache: "no-store",
    });
    if (response.ok) {
      const json = await response.json();
      const media =
        json?.data?.xdt_shortcode_media || json?.data?.shortcode_media || null;
      const mediaUrl =
        firstHttpUrl(media?.video_url) ||
        deepFindVideo(media?.video_versions) ||
        deepFindVideo(json);
      if (mediaUrl) {
        return {
          title: pickString(
            media?.edge_media_to_caption?.edges?.[0]?.node?.text,
            "Instagram Video"
          ),
          author: pickString(media?.owner?.username, "Unknown"),
          thumbnail: pickString(media?.display_url),
          mediaUrl: decodeEscapedUrl(mediaUrl),
        };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

async function extractFromEmbed(
  shortcode: string
): Promise<Partial<InstagramExtracted> | null> {
  const candidates = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/p/${shortcode}/embed/`,
    `https://www.instagram.com/reel/${shortcode}/embed/`,
  ];

  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          ...cookieHeader(),
        },
        redirect: "follow",
        cache: "no-store",
      });
      if (!response.ok) continue;
      const html = await response.text();
      const parsed = parseMediaFromHtml(html);
      if (parsed?.mediaUrl) return parsed;
    } catch {
      // next
    }
  }
  return null;
}

async function extractFromPage(
  url: string
): Promise<Partial<InstagramExtracted> | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
        ...cookieHeader(),
      },
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const html = await response.text();

    // JSON-LD
    const ldRegex =
      /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
    let ldMatch: RegExpExecArray | null;
    while ((ldMatch = ldRegex.exec(html)) !== null) {
      try {
        const json = JSON.parse(ldMatch[1]);
        const mediaUrl = firstHttpUrl(json?.contentUrl) || deepFindVideo(json);
        if (mediaUrl) {
          return {
            title: pickString(json?.caption, json?.name, "Instagram Video"),
            author: pickString(json?.author?.name, json?.author, "Unknown"),
            thumbnail: pickString(json?.thumbnailUrl),
            mediaUrl: decodeEscapedUrl(mediaUrl),
          };
        }
      } catch {
        // continue
      }
    }

    // Additional data scripts
    const scriptRegex =
      /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      try {
        const json = JSON.parse(scriptMatch[1]);
        const mediaUrl = deepFindVideo(json);
        if (mediaUrl) {
          return {
            title: "Instagram Video",
            author: "Unknown",
            thumbnail: "",
            mediaUrl: decodeEscapedUrl(mediaUrl),
          };
        }
      } catch {
        // continue
      }
    }

    return parseMediaFromHtml(html);
  } catch {
    return null;
  }
}

async function extractFromRapidApi(
  url: string
): Promise<Partial<InstagramExtracted> | null> {
  const key = process.env.RAPIDAPI_KEY?.trim();
  if (!key) return null;

  // Common RapidAPI Instagram download hosts (user may have any of these)
  const hosts = [
    process.env.RAPIDAPI_IG_HOST?.trim(),
    "instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com",
    "instagram120.p.rapidapi.com",
    "instagram-bulk-profile-scrapper.p.rapidapi.com",
  ].filter(Boolean) as string[];

  for (const host of hosts) {
    const endpoints = [
      `https://${host}/get-info-rapidapi?url=${encodeURIComponent(url)}`,
      `https://${host}/media?url=${encodeURIComponent(url)}`,
      `https://${host}/?url=${encodeURIComponent(url)}`,
    ];
    for (const endpoint of endpoints) {
      try {
        const result = await fetchJson(endpoint, {
          headers: {
            "X-RapidAPI-Key": key,
            "X-RapidAPI-Host": host,
            Accept: "application/json",
          },
          timeoutMs: 12000,
        });
        if (!result.ok || !result.data) continue;
        const mediaUrl = deepFindVideo(result.data) || firstHttpUrl(result.data);
        if (!mediaUrl) continue;
        const data = result.data as any;
        return {
          title: pickString(data.title, data.caption, "Instagram Video"),
          author: pickString(data.username, data.author, data.owner, "Unknown"),
          thumbnail: pickString(data.thumbnail, data.thumb, data.cover),
          mediaUrl: decodeEscapedUrl(mediaUrl),
        };
      } catch {
        // next
      }
    }
  }
  return null;
}

async function extractFromProviders(
  url: string
): Promise<Partial<InstagramExtracted> | null> {
  // Best-effort third parties (often blocked, but cheap to try)
  const attempts: Array<() => Promise<Partial<InstagramExtracted> | null>> = [
    async () => {
      const result = await fetchJson("https://api.downloadgram.org/media", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Origin: "https://downloadgram.org",
          Referer: "https://downloadgram.org/",
        },
        body: JSON.stringify({ url }),
        timeoutMs: 10000,
      });
      if (!result.ok || !result.data) return null;
      const mediaUrl = deepFindVideo(result.data) || firstHttpUrl(result.data);
      if (!mediaUrl) return null;
      return {
        title: pickString((result.data as any).title, "Instagram Video"),
        author: pickString((result.data as any).author, "Unknown"),
        thumbnail: pickString((result.data as any).thumbnail),
        mediaUrl: decodeEscapedUrl(mediaUrl),
      };
    },
    async () => {
      const result = await fetchJson("https://v3.saveig.app/api/ajaxSearch", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Origin: "https://saveig.app",
          Referer: "https://saveig.app/en",
        },
        body: `q=${encodeURIComponent(url)}&t=media&lang=en`,
        timeoutMs: 10000,
      });
      const text = result.text || "";
      const mediaUrl =
        text.match(
          /(https:\/\/[^"'\\\s]+(?:cdninstagram|fbcdn)[^"'\\\s]*\.mp4[^"'\\\s]*)/
        )?.[1] || deepFindVideo(result.data);
      if (!mediaUrl) return null;
      return {
        title: "Instagram Video",
        author: "Unknown",
        thumbnail: "",
        mediaUrl: decodeEscapedUrl(mediaUrl),
      };
    },
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result?.mediaUrl) return result;
    } catch {
      // next
    }
  }
  return null;
}

function warningMessage(hasMedia: boolean): string | undefined {
  if (hasMedia) return undefined;
  if (rawCookie()) {
    return "Instagram cookie is set, but this post could not be resolved. It may be private, restricted, expired, or region-locked.";
  }
  if (process.env.RAPIDAPI_KEY?.trim()) {
    return "Could not resolve this Instagram post via available providers.";
  }
  return "Instagram blocks most cloud servers without login. Add INSTAGRAM_COOKIE in Vercel (full cookie from instagram.com while logged in), then redeploy.";
}

export async function extractInstagram(url: string): Promise<InstagramExtracted> {
  const normalized = normalizeInstagramUrl(url);
  const shortcode = extractShortcode(normalized);

  const tasks: Array<Promise<Partial<InstagramExtracted> | null>> = [
    extractFromPage(normalized),
    extractFromProviders(normalized),
    extractFromRapidApi(normalized),
  ];
  if (shortcode) {
    tasks.unshift(extractFromGraphql(shortcode), extractFromEmbed(shortcode));
  }

  const results = await Promise.all(tasks);
  const found = results.find((r) => r?.mediaUrl);

  // Metadata-only fallback from any successful partial
  const meta = results.find((r) => r?.title || r?.author || r?.thumbnail);

  const title = pickString(found?.title, meta?.title, "Instagram Video");
  const author = pickString(found?.author, meta?.author, "Unknown");
  const thumbnail = pickString(found?.thumbnail, meta?.thumbnail);
  const mediaUrl = found?.mediaUrl;

  return {
    platform: "instagram",
    title,
    author,
    thumbnail,
    duration: 0,
    sourceUrl: normalized,
    mediaUrl,
    downloadUrl: `/api/download/instagram/file?url=${encodeURIComponent(normalized)}`,
    fileName: `${sanitizeFileName(title)}.mp4`,
    warning: warningMessage(Boolean(mediaUrl)),
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
    const shortcode = extractShortcode(extracted.sourceUrl);
    const retries = [
      () => (shortcode ? extractFromGraphql(shortcode) : Promise.resolve(null)),
      () => (shortcode ? extractFromEmbed(shortcode) : Promise.resolve(null)),
      () => extractFromPage(extracted.sourceUrl),
      () => extractFromRapidApi(extracted.sourceUrl),
      () => extractFromProviders(extracted.sourceUrl),
    ];
    for (const retry of retries) {
      try {
        const result = await retry();
        if (result?.mediaUrl) {
          mediaUrl = result.mediaUrl;
          break;
        }
      } catch {
        // next
      }
    }
  }

  if (!mediaUrl) {
    throw new Error(
      hasInstagramAuth()
        ? "Could not resolve a direct Instagram media file. The post may be private, restricted, or unavailable."
        : "Instagram blocked this server without login. In Vercel → Settings → Environment Variables add INSTAGRAM_COOKIE (copy full cookie header from instagram.com while logged in), then Redeploy."
    );
  }

  const headerVariants: Record<string, string>[] = [
    {
      "User-Agent": UA,
      Referer: "https://www.instagram.com/",
      Origin: "https://www.instagram.com",
      Accept: "*/*",
      ...cookieHeader(),
    },
    {
      "User-Agent": UA,
      Referer: "https://www.instagram.com/",
      Accept: "*/*",
    },
    {
      "User-Agent": "Mozilla/5.0",
      Accept: "*/*",
    },
  ];

  let lastStatus = 0;
  for (const headers of headerVariants) {
    try {
      const response = await fetch(mediaUrl, {
        headers,
        redirect: "follow",
      });
      lastStatus = response.status;
      if (!response.ok || !response.body) continue;

      return {
        stream: response.body as ReadableStream<Uint8Array>,
        contentType: response.headers.get("content-type") || "video/mp4",
        fileName: extracted.fileName,
        title: extracted.title,
      };
    } catch {
      // next header variant
    }
  }

  throw new Error(
    `Failed to fetch Instagram media stream (${lastStatus || 403}). Try a public reel/post or refresh INSTAGRAM_COOKIE.`
  );
}
