import { spawn } from "child_process";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { Innertube, Platform, UniversalCache } from "youtubei.js";
import ffmpegPath from "ffmpeg-static";
import { sanitizeFileName } from "@/lib/platform";
import { fetchJson } from "@/lib/providers";

export type YouTubeQualityOption = {
  label: string;
  height: number;
  itag: number;
  hasAudio: boolean;
  container: string;
  approxSize?: number;
  client: string;
  url?: string;
};

export type YouTubeExtracted = {
  platform: "youtube";
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  sourceUrl: string;
  downloadUrl: string;
  fileName: string;
  videoId: string;
  qualities: YouTubeQualityOption[];
  selectedQuality: string;
  warning?: string;
};

type ClientName =
  | "IOS"
  | "ANDROID"
  | "TV"
  | "MWEB"
  | "WEB"
  | "ANDROID_VR"
  | "YTMUSIC";

type ResolvedFormat = {
  itag: number;
  label: string;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
  container: string;
  approxSize?: number;
  url: string;
  client: string;
  mimeType?: string;
};

// Required by youtubei.js to decipher signatureCipher URLs
Platform.shim.eval = async (data: { output: string }) => {
  // eslint-disable-next-line no-new-func
  return new Function(data.output)();
};

let innertubePromise: Promise<Innertube> | null = null;

const STREAM_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.youtube.com",
  Referer: "https://www.youtube.com/",
};

const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.private.coffee",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.darkness.services",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.ducks.party",
  "https://pipedapi.qdi.fi",
  "https://pipedapi.r4fo.com",
  "https://pipedapi.smnz.de",
  "https://pipedapi.tokhmi.xyz",
];

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return v;

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (
        parts[0] === "shorts" ||
        parts[0] === "embed" ||
        parts[0] === "live" ||
        parts[0] === "v"
      ) {
        return parts[1] || null;
      }
    }
  } catch {
    // fall through
  }

  const match = url.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{6,})/
  );
  return match?.[1] || null;
}

async function getInnertube() {
  if (!innertubePromise) {
    const cookie = process.env.YOUTUBE_COOKIE?.trim() || undefined;

    innertubePromise = Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      retrieve_player: true,
      lang: "en",
      location: "US",
      cookie,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers || {});
        if (!headers.has("User-Agent")) {
          headers.set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
          );
        }
        if (!headers.has("Accept-Language")) {
          headers.set("Accept-Language", "en-US,en;q=0.9");
        }
        if (cookie && !headers.has("Cookie")) {
          headers.set("Cookie", cookie);
        }
        return fetch(input, { ...init, headers });
      },
    }).catch((error) => {
      innertubePromise = null;
      throw error;
    });
  }
  return innertubePromise;
}

function parseHeight(label?: string | null, height?: number | null): number {
  if (typeof height === "number" && height > 0) return height;
  if (!label) return 0;
  const match = String(label).match(/(\d{3,4})\s*p/i);
  return match ? Number(match[1]) : 0;
}

function formatContainer(mimeType?: string | null): string {
  if (!mimeType) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  return "mp4";
}

async function resolveFormatUrl(format: any, player: any): Promise<string | null> {
  if (format?.url && typeof format.url === "string") return format.url;

  if (typeof format?.decipher === "function" && player) {
    try {
      const deciphered = await format.decipher(player);
      if (typeof deciphered === "string" && deciphered.startsWith("http")) {
        return deciphered;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function collectResolvedFormats(
  info: any,
  client: string,
  player: any
): Promise<ResolvedFormat[]> {
  const progressive = (info?.streaming_data?.formats || []) as any[];
  const adaptive = (info?.streaming_data?.adaptive_formats || []) as any[];
  const all = [...progressive, ...adaptive];
  const resolved: ResolvedFormat[] = [];

  for (const format of all) {
    if (!format?.has_video && !format?.has_audio) continue;
    const url = await resolveFormatUrl(format, player);
    if (!url) continue;

    const label =
      format.quality_label ||
      format.quality ||
      (format.height ? `${format.height}p` : format.has_audio ? "audio" : "unknown");

    resolved.push({
      itag: format.itag || 0,
      label: String(label).replace(/\s+/g, ""),
      height: parseHeight(format.quality_label || format.quality, format.height),
      hasAudio: Boolean(format.has_audio),
      hasVideo: Boolean(format.has_video),
      container: formatContainer(format.mime_type),
      approxSize: format.content_length ? Number(format.content_length) : undefined,
      url,
      client,
      mimeType: format.mime_type,
    });
  }

  return resolved;
}

async function loadFromYoutubei(videoId: string): Promise<{
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  formats: ResolvedFormat[];
} | null> {
  try {
    const yt = await getInnertube();
    const clients: ClientName[] = [
      "IOS",
      "ANDROID_VR",
      "TV",
      "MWEB",
      "ANDROID",
      "WEB",
      "YTMUSIC",
    ];

    let title = "YouTube Video";
    let author = "YouTube";
    let duration = 0;
    let thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    const allFormats: ResolvedFormat[] = [];

    for (const client of clients) {
      try {
        // Prefer getInfo, fall back to getBasicInfo
        let info: any;
        try {
          info = await yt.getInfo(videoId, { client });
        } catch {
          info = await yt.getBasicInfo(videoId, { client });
        }

        if (info?.basic_info?.title) {
          title = info.basic_info.title;
          author =
            info.basic_info.author ||
            info.basic_info.channel?.name ||
            author;
          duration = info.basic_info.duration || duration;
          thumbnail = info.basic_info.thumbnail?.[0]?.url || thumbnail;
        }

        const resolved = await collectResolvedFormats(
          info,
          client,
          yt.session.player
        );
        allFormats.push(...resolved);

        const videoQualities = new Set(
          allFormats.filter((f) => f.hasVideo).map((f) => f.label)
        );
        if (videoQualities.size >= 3) break;
      } catch {
        // try next client
      }
    }

    if (!allFormats.length) return null;
    return { title, author, duration, thumbnail, formats: allFormats };
  } catch {
    return null;
  }
}

async function loadFromPiped(videoId: string): Promise<{
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  formats: ResolvedFormat[];
} | null> {
  for (const base of PIPED_INSTANCES) {
    try {
      const result = await fetchJson(`${base}/streams/${videoId}`, {
        headers: { Accept: "application/json" },
        timeoutMs: 8000,
      });
      if (!result.ok || !result.data) continue;

      const data = result.data as any;
      if (!data.title && !data.videoStreams) continue;

      const formats: ResolvedFormat[] = [];
      for (const stream of data.videoStreams || []) {
        if (!stream?.url) continue;
        if (String(stream.mimeType || "").includes("mpegurl")) continue; // skip HLS
        if (String(stream.quality || "").toUpperCase().includes("LBRY")) continue;

        const height = parseHeight(stream.quality, stream.height);
        const label =
          stream.quality && String(stream.quality).includes("p")
            ? String(stream.quality).replace(/\s+/g, "")
            : height
              ? `${height}p`
              : "best";

        formats.push({
          itag: Number(stream.itag || 0),
          label,
          height,
          hasAudio: !stream.videoOnly,
          hasVideo: true,
          container: formatContainer(stream.mimeType),
          approxSize:
            stream.contentLength && stream.contentLength > 0
              ? Number(stream.contentLength)
              : undefined,
          url: stream.url,
          client: `piped:${new URL(base).host}`,
          mimeType: stream.mimeType,
        });
      }

      for (const stream of data.audioStreams || []) {
        if (!stream?.url) continue;
        formats.push({
          itag: Number(stream.itag || 0),
          label: "audio",
          height: 0,
          hasAudio: true,
          hasVideo: false,
          container: formatContainer(stream.mimeType),
          approxSize:
            stream.contentLength && stream.contentLength > 0
              ? Number(stream.contentLength)
              : undefined,
          url: stream.url,
          client: `piped:${new URL(base).host}`,
          mimeType: stream.mimeType,
        });
      }

      if (!formats.some((f) => f.hasVideo)) continue;

      return {
        title: data.title || "YouTube Video",
        author: data.uploader || "YouTube",
        duration: Number(data.duration || 0) || 0,
        thumbnail:
          data.thumbnailUrl ||
          `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        formats,
      };
    } catch {
      // next instance
    }
  }
  return null;
}

async function loadFromOEmbed(url: string, videoId: string) {
  try {
    const result = await fetchJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { timeoutMs: 6000 }
    );
    if (!result.ok || !result.data) return null;
    const data = result.data as any;
    return {
      title: data.title || "YouTube Video",
      author: data.author_name || "YouTube",
      duration: 0,
      thumbnail:
        data.thumbnail_url ||
        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch {
    return null;
  }
}

function buildQualityOptions(formats: ResolvedFormat[]): YouTubeQualityOption[] {
  const byLabel = new Map<string, YouTubeQualityOption & { score: number }>();

  for (const format of formats) {
    if (!format.hasVideo) continue;
    if (!format.label || format.label === "0p" || format.label === "unknown") continue;
    if (format.label.toLowerCase() === "audio") continue;

    let score = 0;
    if (format.hasAudio) score += 1000;
    if (format.container === "mp4") score += 100;
    if (format.mimeType?.includes("avc1")) score += 40;
    if (format.client.startsWith("IOS") || format.client.includes("piped")) score += 30;
    score += Math.min(format.approxSize || 0, 50_000_000) / 1_000_000;
    score += format.height;

    const existing = byLabel.get(format.label);
    if (!existing || score > existing.score) {
      byLabel.set(format.label, {
        label: format.label,
        height: format.height,
        itag: format.itag,
        hasAudio: format.hasAudio,
        container: format.container,
        approxSize: format.approxSize,
        client: format.client,
        url: format.url,
        score,
      });
    }
  }

  return Array.from(byLabel.values())
    .map(({ score: _score, ...rest }) => rest)
    .sort((a, b) => b.height - a.height || a.label.localeCompare(b.label));
}

function defaultQualities(): YouTubeQualityOption[] {
  return [
    { label: "best", height: 0, itag: 0, hasAudio: true, container: "mp4", client: "fallback" },
    { label: "1080p", height: 1080, itag: 0, hasAudio: false, container: "mp4", client: "fallback" },
    { label: "720p", height: 720, itag: 0, hasAudio: false, container: "mp4", client: "fallback" },
    { label: "480p", height: 480, itag: 0, hasAudio: false, container: "mp4", client: "fallback" },
    { label: "360p", height: 360, itag: 0, hasAudio: true, container: "mp4", client: "fallback" },
  ];
}

function findQualityOption(
  qualities: YouTubeQualityOption[],
  quality?: string | null
): YouTubeQualityOption {
  if (!qualities.length) return defaultQualities()[0];
  if (!quality || quality === "best") return qualities[0];

  const exact = qualities.find(
    (q) => q.label.toLowerCase() === quality.toLowerCase()
  );
  if (exact) return exact;

  const height = parseHeight(quality, null);
  if (height > 0) {
    const byHeight = qualities.find((q) => q.height === height);
    if (byHeight) return byHeight;
  }
  return qualities[0];
}

async function loadFormats(videoId: string, sourceUrl: string) {
  // 1) youtubei (best quality when not IP-blocked)
  const ytjs = await loadFromYoutubei(videoId);
  if (ytjs?.formats?.length) {
    return { ...ytjs, warning: undefined as string | undefined };
  }

  // 2) Piped public instances (works better on some cloud IPs)
  const piped = await loadFromPiped(videoId);
  if (piped?.formats?.length) {
    return {
      ...piped,
      warning:
        "Using Piped fallback (YouTube direct API blocked on this server). Some higher resolutions may be limited.",
    };
  }

  // 3) metadata only
  const oembed = await loadFromOEmbed(sourceUrl, videoId);
  return {
    title: oembed?.title || "YouTube Video",
    author: oembed?.author || "YouTube",
    duration: oembed?.duration || 0,
    thumbnail:
      oembed?.thumbnail ||
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    formats: [] as ResolvedFormat[],
    warning:
      "YouTube blocked this server IP. Set YOUTUBE_COOKIE in Vercel env vars for full quality support.",
  };
}

async function fetchMediaToFile(fileUrl: string, filePath: string) {
  const response = await fetch(fileUrl, {
    headers: STREAM_HEADERS,
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch media stream (${response.status})`);
  }
  const nodeStream = Readable.fromWeb(response.body as any);
  await pipeline(nodeStream, createWriteStream(filePath));
  const stat = await fs.stat(filePath);
  if (!stat.size) throw new Error("Downloaded media file is empty");
}

async function mergeWithFfmpeg(
  videoPath: string,
  audioPath: string,
  outputPath: string
) {
  if (!ffmpegPath) throw new Error("ffmpeg binary is not available on this server");

  await new Promise<void>((resolve, reject) => {
    const ff = spawn(
      ffmpegPath as string,
      [
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-c",
        "copy",
        "-shortest",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    ff.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-600) || `ffmpeg exited with code ${code}`));
    });
  });
}

export async function extractYouTube(url: string): Promise<YouTubeExtracted> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const loaded = await loadFormats(videoId, sourceUrl);
  const qualities = buildQualityOptions(loaded.formats);
  const finalQualities = qualities.length ? qualities : defaultQualities();
  const selected = finalQualities[0].label;

  return {
    platform: "youtube",
    title: loaded.title,
    author: loaded.author,
    thumbnail: loaded.thumbnail,
    duration: loaded.duration,
    sourceUrl,
    downloadUrl: `/api/download/youtube/file?url=${encodeURIComponent(
      sourceUrl
    )}&quality=${encodeURIComponent(selected)}`,
    fileName: `${sanitizeFileName(loaded.title)}.mp4`,
    videoId,
    qualities: finalQualities,
    selectedQuality: selected,
    warning: loaded.warning,
  };
}

export async function openYouTubeStream(
  url: string,
  quality?: string | null
): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  fileName: string;
  title: string;
  qualityLabel: string;
}> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const loaded = await loadFormats(videoId, sourceUrl);
  const qualities = buildQualityOptions(loaded.formats);
  const finalQualities = qualities.length ? qualities : defaultQualities();
  const selected = findQualityOption(finalQualities, quality);
  const fileName = `${sanitizeFileName(loaded.title)}_${selected.label}.mp4`;

  if (!loaded.formats.length) {
    throw new Error(
      "No downloadable YouTube streams on this server. Add YOUTUBE_COOKIE in Vercel Environment Variables (copy cookie from youtube.com while logged in), then redeploy."
    );
  }

  // Progressive candidates
  const progressive = loaded.formats
    .filter(
      (f) =>
        f.hasVideo &&
        f.hasAudio &&
        (selected.label === "best" ||
          f.label === selected.label ||
          f.height === selected.height ||
          selected.height === 0)
    )
    .sort((a, b) => b.height - a.height);

  // Adaptive video candidates
  const adaptiveVideo = loaded.formats
    .filter(
      (f) =>
        f.hasVideo &&
        !f.hasAudio &&
        (selected.label === "best" ||
          f.label === selected.label ||
          f.height === selected.height ||
          selected.height === 0)
    )
    .sort((a, b) => b.height - a.height);

  const audioCandidates = loaded.formats
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.approxSize || 0) - (a.approxSize || 0));

  // 1) progressive direct
  for (const candidate of progressive) {
    try {
      const response = await fetch(candidate.url, {
        headers: STREAM_HEADERS,
        redirect: "follow",
      });
      if (!response.ok || !response.body) continue;
      return {
        stream: response.body as ReadableStream<Uint8Array>,
        contentType: "video/mp4",
        fileName: `${sanitizeFileName(loaded.title)}_${candidate.label}.mp4`,
        title: loaded.title,
        qualityLabel: candidate.label,
      };
    } catch {
      // next
    }
  }

  // 2) adaptive merge
  if (adaptiveVideo.length && audioCandidates.length && ffmpegPath) {
    const workDir = await fs.mkdtemp(join(tmpdir(), "yt-dl-"));
    const videoPath = join(workDir, "video.bin");
    const audioPath = join(workDir, "audio.bin");
    const outputPath = join(workDir, "output.mp4");

    const cleanup = async () => {
      try {
        await fs.rm(workDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };

    try {
      let videoOk = false;
      for (const candidate of adaptiveVideo) {
        try {
          await fetchMediaToFile(candidate.url, videoPath);
          videoOk = true;
          break;
        } catch {
          // next
        }
      }
      if (!videoOk) throw new Error("Failed to fetch adaptive video stream");

      let audioOk = false;
      for (const candidate of audioCandidates) {
        try {
          await fetchMediaToFile(candidate.url, audioPath);
          audioOk = true;
          break;
        } catch {
          // next
        }
      }
      if (!audioOk) throw new Error("Failed to fetch audio stream");

      await mergeWithFfmpeg(videoPath, audioPath, outputPath);

      const nodeStream = createReadStream(outputPath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const reader = webStream.getReader();
          const pump = async (): Promise<void> => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  controller.close();
                  await cleanup();
                  break;
                }
                controller.enqueue(value);
              }
            } catch (error) {
              await cleanup();
              controller.error(error);
            }
          };
          void pump();
        },
        cancel: async () => {
          nodeStream.destroy();
          await cleanup();
        },
      });

      return {
        stream,
        contentType: "video/mp4",
        fileName,
        title: loaded.title,
        qualityLabel: selected.label,
      };
    } catch (error) {
      await cleanup();
      // fall through to any remaining progressive
    }
  }

  // 3) any video stream as last resort
  for (const candidate of loaded.formats.filter((f) => f.hasVideo)) {
    try {
      const response = await fetch(candidate.url, {
        headers: STREAM_HEADERS,
        redirect: "follow",
      });
      if (!response.ok || !response.body) continue;
      return {
        stream: response.body as ReadableStream<Uint8Array>,
        contentType: candidate.mimeType || "video/mp4",
        fileName: `${sanitizeFileName(loaded.title)}_${candidate.label}.mp4`,
        title: loaded.title,
        qualityLabel: candidate.label,
      };
    } catch {
      // next
    }
  }

  throw new Error(
    "Could not download YouTube media from this server. Set YOUTUBE_COOKIE in Vercel and redeploy."
  );
}
