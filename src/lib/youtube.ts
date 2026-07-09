import { spawn } from "child_process";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { Innertube, UniversalCache } from "youtubei.js";
import ffmpegPath from "ffmpeg-static";
import { sanitizeFileName } from "@/lib/platform";

export type YouTubeQualityOption = {
  label: string; // e.g. 1080p
  height: number;
  itag: number;
  hasAudio: boolean;
  container: string;
  approxSize?: number;
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

let innertubePromise: Promise<Innertube> | null = null;

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id || null;
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
    innertubePromise = Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
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
  const match = label.match(/(\d{3,4})p/);
  return match ? Number(match[1]) : 0;
}

function formatContainer(mimeType?: string | null): string {
  if (!mimeType) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  return "mp4";
}

function buildQualityOptions(info: any): YouTubeQualityOption[] {
  const progressive = (info.streaming_data?.formats || []) as any[];
  const adaptive = (info.streaming_data?.adaptive_formats || []) as any[];

  const byLabel = new Map<string, YouTubeQualityOption>();

  // Prefer progressive (video+audio) when available (usually 360p)
  for (const format of progressive) {
    if (!format?.has_video) continue;
    const label = format.quality_label || format.quality || `${format.height || 0}p`;
    if (!label || label === "0p") continue;
    const option: YouTubeQualityOption = {
      label: String(label).replace(/\s+/g, ""),
      height: parseHeight(format.quality_label || format.quality, format.height),
      itag: format.itag,
      hasAudio: Boolean(format.has_audio),
      container: formatContainer(format.mime_type),
      approxSize: format.content_length
        ? Number(format.content_length)
        : undefined,
    };

    const existing = byLabel.get(option.label);
    if (!existing || (!existing.hasAudio && option.hasAudio)) {
      byLabel.set(option.label, option);
    }
  }

  // Adaptive video-only formats for higher resolutions
  for (const format of adaptive) {
    if (!format?.has_video || format?.has_audio) continue;
    // Prefer mp4/avc for broader compatibility
    const mime = String(format.mime_type || "");
    if (!mime.includes("mp4") && !mime.includes("avc1") && !mime.includes("av01")) {
      // still allow webm if no mp4 for that resolution
    }

    const label = format.quality_label || `${format.height || 0}p`;
    if (!label || label === "0p") continue;
    const normalized = String(label).replace(/\s+/g, "");
    const existing = byLabel.get(normalized);

    // Keep progressive (with audio) if already present for same label
    if (existing?.hasAudio) continue;

    // Prefer mp4 over webm for the same height
    if (existing) {
      const existingIsMp4 = existing.container === "mp4";
      const nextIsMp4 = formatContainer(mime) === "mp4";
      if (existingIsMp4 && !nextIsMp4) continue;
      if (existingIsMp4 === nextIsMp4 && (existing.approxSize || 0) >= Number(format.content_length || 0)) {
        continue;
      }
    }

    byLabel.set(normalized, {
      label: normalized,
      height: parseHeight(format.quality_label, format.height),
      itag: format.itag,
      hasAudio: false,
      container: formatContainer(mime),
      approxSize: format.content_length
        ? Number(format.content_length)
        : undefined,
    });
  }

  return Array.from(byLabel.values()).sort((a, b) => b.height - a.height);
}

function pickAudioFormat(info: any): any | null {
  const adaptive = (info.streaming_data?.adaptive_formats || []) as any[];
  const audioFormats = adaptive
    .filter((f) => f?.has_audio && !f?.has_video && f?.url)
    .sort((a, b) => {
      const aMp4 = String(a.mime_type || "").includes("mp4") ? 1 : 0;
      const bMp4 = String(b.mime_type || "").includes("mp4") ? 1 : 0;
      if (aMp4 !== bMp4) return bMp4 - aMp4;
      return (b.bitrate || 0) - (a.bitrate || 0);
    });
  return audioFormats[0] || null;
}

function findFormatByItag(info: any, itag: number): any | null {
  const progressive = (info.streaming_data?.formats || []) as any[];
  const adaptive = (info.streaming_data?.adaptive_formats || []) as any[];
  return (
    progressive.find((f) => f.itag === itag) ||
    adaptive.find((f) => f.itag === itag) ||
    null
  );
}

function findQualityOption(
  qualities: YouTubeQualityOption[],
  quality?: string | null
): YouTubeQualityOption {
  if (!qualities.length) {
    throw new Error("No downloadable YouTube qualities found for this video");
  }

  if (!quality || quality === "best") {
    return qualities[0];
  }

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

async function getBestInfo(videoId: string) {
  const yt = await getInnertube();

  // IOS usually provides direct adaptive URLs; ANDROID often provides progressive 360p
  let iosInfo: any = null;
  let androidInfo: any = null;

  try {
    iosInfo = await yt.getBasicInfo(videoId, { client: "IOS" });
  } catch {
    // ignore
  }

  try {
    androidInfo = await yt.getBasicInfo(videoId, { client: "ANDROID" });
  } catch {
    // ignore
  }

  if (!iosInfo && !androidInfo) {
    // last resort
    const webInfo = await yt.getBasicInfo(videoId, { client: "WEB" });
    return { yt, info: webInfo, client: "WEB" as const };
  }

  // Merge format lists: prefer IOS adaptive URLs + ANDROID progressive
  if (iosInfo && androidInfo) {
    const merged = {
      ...iosInfo,
      basic_info: iosInfo.basic_info || androidInfo.basic_info,
      streaming_data: {
        formats: [
          ...(androidInfo.streaming_data?.formats || []),
          ...(iosInfo.streaming_data?.formats || []),
        ],
        adaptive_formats: [
          ...(iosInfo.streaming_data?.adaptive_formats || []),
          ...(androidInfo.streaming_data?.adaptive_formats || []),
        ],
      },
    };
    return { yt, info: merged, client: "IOS" as const };
  }

  return {
    yt,
    info: iosInfo || androidInfo,
    client: (iosInfo ? "IOS" : "ANDROID") as "IOS" | "ANDROID",
  };
}

export async function extractYouTube(url: string): Promise<YouTubeExtracted> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error("Invalid YouTube URL");
  }

  const { info } = await getBestInfo(videoId);

  const title = info.basic_info?.title || "YouTube Video";
  const author =
    info.basic_info?.author ||
    info.basic_info?.channel?.name ||
    "YouTube";
  const duration = info.basic_info?.duration || 0;
  const thumbnail =
    info.basic_info?.thumbnail?.[0]?.url ||
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  const qualities = buildQualityOptions(info);
  const selected = qualities[0]?.label || "best";

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

async function downloadUrlToFile(
  fileUrl: string,
  filePath: string
): Promise<void> {
  const response = await fetch(fileUrl, {
    headers: {
      "User-Agent":
        "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
      Accept: "*/*",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch media stream (${response.status})`);
  }

  const nodeStream = Readable.fromWeb(response.body as any);
  await pipeline(nodeStream, createWriteStream(filePath));
}

async function mergeWithFfmpeg(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary is not available");
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
      else reject(new Error(stderr.slice(-500) || `ffmpeg exited with ${code}`));
    });
  });
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
  if (!videoId) {
    throw new Error("Invalid YouTube URL");
  }

  const { info } = await getBestInfo(videoId);
  const title = info.basic_info?.title || "YouTube Video";
  const qualities = buildQualityOptions(info);
  const selected = findQualityOption(qualities, quality);
  const fileName = `${sanitizeFileName(title)}_${selected.label}.mp4`;

  // Progressive format already includes audio
  if (selected.hasAudio) {
    const format = findFormatByItag(info, selected.itag);
    if (!format?.url) {
      throw new Error(`No stream URL for ${selected.label}`);
    }

    const response = await fetch(format.url, {
      headers: {
        "User-Agent":
          "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
        Accept: "*/*",
      },
    });
    if (!response.ok || !response.body) {
      throw new Error(`YouTube stream fetch failed (${response.status})`);
    }

    return {
      stream: response.body as ReadableStream<Uint8Array>,
      contentType: "video/mp4",
      fileName,
      title,
      qualityLabel: selected.label,
    };
  }

  // Adaptive: download video + audio then mux with ffmpeg
  const videoFormat = findFormatByItag(info, selected.itag);
  const audioFormat = pickAudioFormat(info);

  if (!videoFormat?.url) {
    throw new Error(`No video stream for ${selected.label}`);
  }
  if (!audioFormat?.url) {
    throw new Error("No audio stream available for this video");
  }

  const workDir = await fs.mkdtemp(join(tmpdir(), "yt-dl-"));
  const videoPath = join(workDir, "video.mp4");
  const audioPath = join(workDir, "audio.m4a");
  const outputPath = join(workDir, "output.mp4");

  try {
    await downloadUrlToFile(videoFormat.url, videoPath);
    await downloadUrlToFile(audioFormat.url, audioPath);
    await mergeWithFfmpeg(videoPath, audioPath, outputPath);

    const nodeStream = createReadStream(outputPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    // Cleanup temp files after stream finishes
    const cleanup = async () => {
      try {
        await fs.rm(workDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };

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
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    throw error;
  }
}
