import { spawn } from "child_process";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { Innertube, Platform, UniversalCache } from "youtubei.js";
import ffmpegPath from "ffmpeg-static";
import { sanitizeFileName } from "@/lib/platform";

export type YouTubeQualityOption = {
  label: string;
  height: number;
  itag: number;
  hasAudio: boolean;
  container: string;
  approxSize?: number;
  client: string;
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
};

type ClientName = "IOS" | "ANDROID" | "TV" | "MWEB" | "WEB";

type ResolvedFormat = {
  itag: number;
  label: string;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
  container: string;
  approxSize?: number;
  url: string;
  client: ClientName;
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
      // On serverless, local session generation is often more reliable
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
  const match = String(label).match(/(\d{3,4})p/);
  return match ? Number(match[1]) : 0;
}

function formatContainer(mimeType?: string | null): string {
  if (!mimeType) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  return "mp4";
}

async function resolveFormatUrl(
  format: any,
  player: any
): Promise<string | null> {
  if (format?.url && typeof format.url === "string") {
    return format.url;
  }

  if (typeof format?.decipher === "function" && player) {
    try {
      const deciphered = await format.decipher(player);
      if (typeof deciphered === "string" && deciphered.startsWith("http")) {
        return deciphered;
      }
    } catch {
      // ignore and try next strategy
    }
  }

  return null;
}

async function collectResolvedFormats(
  info: any,
  client: ClientName,
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
      itag: format.itag,
      label: String(label).replace(/\s+/g, ""),
      height: parseHeight(format.quality_label || format.quality, format.height),
      hasAudio: Boolean(format.has_audio),
      hasVideo: Boolean(format.has_video),
      container: formatContainer(format.mime_type),
      approxSize: format.content_length
        ? Number(format.content_length)
        : undefined,
      url,
      client,
      mimeType: format.mime_type,
    });
  }

  return resolved;
}

async function loadFormats(videoId: string): Promise<{
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  formats: ResolvedFormat[];
  player: any;
}> {
  const yt = await getInnertube();
  const clients: ClientName[] = ["IOS", "TV", "MWEB", "ANDROID", "WEB"];

  let title = "YouTube Video";
  let author = "YouTube";
  let duration = 0;
  let thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const allFormats: ResolvedFormat[] = [];
  const errors: string[] = [];

  for (const client of clients) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      if (info?.basic_info?.title) {
        title = info.basic_info.title;
        author =
          info.basic_info.author ||
          info.basic_info.channel?.name ||
          author;
        duration = info.basic_info.duration || duration;
        thumbnail =
          info.basic_info.thumbnail?.[0]?.url ||
          thumbnail;
      }

      const resolved = await collectResolvedFormats(
        info,
        client,
        yt.session.player
      );
      allFormats.push(...resolved);

      // If we already have several playable video qualities, stop early
      const videoQualities = new Set(
        allFormats.filter((f) => f.hasVideo).map((f) => f.label)
      );
      if (videoQualities.size >= 3) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${client}: ${message}`);
    }
  }

  if (!allFormats.length) {
    throw new Error(
      `No downloadable YouTube qualities found for this video. ${
        errors[0] ? `Details: ${errors[0]}` : "YouTube may be blocking this server IP (common on Vercel)."
      }`
    );
  }

  return {
    title,
    author,
    duration,
    thumbnail,
    formats: allFormats,
    player: yt.session.player,
  };
}

function buildQualityOptions(formats: ResolvedFormat[]): YouTubeQualityOption[] {
  const byLabel = new Map<string, YouTubeQualityOption & { score: number }>();

  for (const format of formats) {
    if (!format.hasVideo) continue;
    if (!format.label || format.label === "0p" || format.label === "unknown") {
      continue;
    }

    // Score: progressive with audio > mp4 > higher size > prefer IOS/TV clients
    let score = 0;
    if (format.hasAudio) score += 1000;
    if (format.container === "mp4") score += 100;
    if (format.mimeType?.includes("avc1")) score += 40;
    if (format.client === "IOS") score += 30;
    if (format.client === "TV" || format.client === "MWEB") score += 20;
    score += Math.min(format.approxSize || 0, 50_000_000) / 1_000_000;

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
        score,
      });
    }
  }

  return Array.from(byLabel.values())
    .map(({ score: _score, ...rest }) => rest)
    .sort((a, b) => b.height - a.height || a.label.localeCompare(b.label));
}

function pickAudioFormat(formats: ResolvedFormat[]): ResolvedFormat | null {
  const audios = formats
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => {
      const aMp4 = a.container === "mp4" ? 1 : 0;
      const bMp4 = b.container === "mp4" ? 1 : 0;
      if (aMp4 !== bMp4) return bMp4 - aMp4;
      return (b.approxSize || 0) - (a.approxSize || 0);
    });
  return audios[0] || null;
}

function findQualityOption(
  qualities: YouTubeQualityOption[],
  quality?: string | null
): YouTubeQualityOption {
  if (!qualities.length) {
    throw new Error("No downloadable YouTube qualities found for this video");
  }

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

function findResolvedFormat(
  formats: ResolvedFormat[],
  option: YouTubeQualityOption
): ResolvedFormat | null {
  // Prefer exact itag + client match, then itag, then label
  return (
    formats.find(
      (f) =>
        f.itag === option.itag &&
        f.client === option.client &&
        f.hasVideo
    ) ||
    formats.find((f) => f.itag === option.itag && f.hasVideo) ||
    formats.find(
      (f) =>
        f.label === option.label &&
        f.hasVideo &&
        f.hasAudio === option.hasAudio
    ) ||
    formats.find((f) => f.label === option.label && f.hasVideo) ||
    null
  );
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
  if (!stat.size) {
    throw new Error("Downloaded media file is empty");
  }
}

async function mergeWithFfmpeg(
  videoPath: string,
  audioPath: string,
  outputPath: string
) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary is not available on this server");
  }

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
      else {
        reject(
          new Error(stderr.slice(-600) || `ffmpeg exited with code ${code}`)
        );
      }
    });
  });
}

export async function extractYouTube(url: string): Promise<YouTubeExtracted> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const { title, author, duration, thumbnail, formats } =
    await loadFormats(videoId);

  const qualities = buildQualityOptions(formats);
  if (!qualities.length) {
    throw new Error("No downloadable YouTube qualities found for this video");
  }

  const selected = qualities[0].label;
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const proxyDownloadUrl = `/api/download/youtube/file?url=${encodeURIComponent(
    sourceUrl
  )}&quality=${encodeURIComponent(selected)}`;

  return {
    platform: "youtube",
    title,
    author,
    thumbnail,
    duration,
    sourceUrl,
    downloadUrl: proxyDownloadUrl,
    fileName: `${sanitizeFileName(title)}.mp4`,
    videoId,
    qualities,
    selectedQuality: selected,
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

  const { title, formats } = await loadFormats(videoId);
  const qualities = buildQualityOptions(formats);
  const selected = findQualityOption(qualities, quality);
  const videoFormat = findResolvedFormat(formats, selected);

  if (!videoFormat) {
    throw new Error(`Could not resolve stream for ${selected.label}`);
  }

  const fileName = `${sanitizeFileName(title)}_${selected.label}.mp4`;

  // Prefer adaptive (IOS/TV) first — progressive googlevideo URLs often return 403 on cloud IPs
  const videoCandidates = formats
    .filter(
      (f) =>
        f.hasVideo &&
        (f.itag === selected.itag ||
          f.label === selected.label ||
          f.height === selected.height)
    )
    .sort((a, b) => {
      // Prefer clients that usually work on serverless
      const rank = (c: string) =>
        c === "IOS" ? 0 : c === "TV" ? 1 : c === "MWEB" ? 2 : c === "WEB" ? 3 : 4;
      // Prefer video-only adaptive for high res reliability, then progressive
      const typeRank = (f: ResolvedFormat) =>
        f.hasAudio ? 1 : 0;
      if (typeRank(a) !== typeRank(b)) return typeRank(a) - typeRank(b);
      if (rank(a.client) !== rank(b.client)) return rank(a.client) - rank(b.client);
      return (b.approxSize || 0) - (a.approxSize || 0);
    });

  const progressiveCandidates = videoCandidates.filter((f) => f.hasAudio);
  const adaptiveVideoCandidates = videoCandidates.filter((f) => !f.hasAudio);

  // 1) Try progressive direct stream first only if available (fast path)
  for (const candidate of progressiveCandidates) {
    try {
      const response = await fetch(candidate.url, {
        headers: STREAM_HEADERS,
        redirect: "follow",
      });
      if (!response.ok || !response.body) continue;

      return {
        stream: response.body as ReadableStream<Uint8Array>,
        contentType: "video/mp4",
        fileName: `${sanitizeFileName(title)}_${candidate.label}.mp4`,
        title,
        qualityLabel: candidate.label,
      };
    } catch {
      // fall through to adaptive merge
    }
  }

  // 2) Adaptive video + audio merge (more reliable on Vercel when progressive is 403)
  const audioCandidates = formats
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => {
      const rank = (c: string) =>
        c === "IOS" ? 0 : c === "TV" ? 1 : c === "MWEB" ? 2 : 3;
      if (rank(a.client) !== rank(b.client)) return rank(a.client) - rank(b.client);
      const aMp4 = a.container === "mp4" ? 1 : 0;
      const bMp4 = b.container === "mp4" ? 1 : 0;
      if (aMp4 !== bMp4) return bMp4 - aMp4;
      return (b.approxSize || 0) - (a.approxSize || 0);
    });

  if (!adaptiveVideoCandidates.length) {
    throw new Error(
      `Failed to fetch media stream (403). Progressive streams blocked and no adaptive formats for ${selected.label}.`
    );
  }
  if (!audioCandidates.length) {
    throw new Error("No audio stream available for this video");
  }

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
    let lastVideoError = "unknown";
    for (const candidate of adaptiveVideoCandidates) {
      try {
        await fetchMediaToFile(candidate.url, videoPath);
        videoOk = true;
        break;
      } catch (error) {
        lastVideoError =
          error instanceof Error ? error.message : String(error);
      }
    }
    if (!videoOk) {
      throw new Error(
        `Failed to fetch video stream for ${selected.label}. ${lastVideoError}`
      );
    }

    let audioOk = false;
    let lastAudioError = "unknown";
    for (const candidate of audioCandidates) {
      try {
        await fetchMediaToFile(candidate.url, audioPath);
        audioOk = true;
        break;
      } catch (error) {
        lastAudioError =
          error instanceof Error ? error.message : String(error);
      }
    }
    if (!audioOk) {
      throw new Error(`Failed to fetch audio stream. ${lastAudioError}`);
    }

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
      title,
      qualityLabel: selected.label,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
