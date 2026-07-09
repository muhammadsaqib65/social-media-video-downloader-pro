import { db } from "@/db";
import { downloadLogs } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const dynamic = "force-dynamic";

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function parseCookieString(cookieString: string) {
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index === -1) return null;
      return {
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1).trim(),
        domain: ".youtube.com",
        path: "/",
      };
    })
    .filter(Boolean) as Array<{ name: string; value: string; domain: string; path: string }>;
}

function getYouTubeInfoOptions(playerClient: "WEB" | "ANDROID" | "TV" | "WEB_EMBEDDED" | "IOS") {
  const cookie = process.env.YOUTUBE_COOKIE || process.env.YT_COOKIE || process.env.YOUTUBE_COOKIES;
  const options: any = {
    playerClients: [playerClient],
    requestOptions: {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
  };

  if (cookie) {
    options.agent = ytdl.createAgent(parseCookieString(cookie));
  }

  return options;
}

function groupFormatsByQuality(formats: any[]) {
  const qualityMap = new Map<string, any>();

  formats.forEach((format) => {
    if (!format.url || !format.hasVideo) return;

    const qualityLabel = format.qualityLabel || format.quality || "unknown";
    const key = `${qualityLabel}-${format.container}-${format.hasAudio ? "combined" : "video"}`;

    if (!qualityMap.has(key)) {
      qualityMap.set(key, {
        itag: format.itag,
        quality: format.quality,
        qualityLabel,
        container: format.container || "mp4",
        hasVideo: Boolean(format.hasVideo),
        hasAudio: Boolean(format.hasAudio),
        contentLength: format.contentLength,
        needsAudioMerge: Boolean(format.hasVideo && !format.hasAudio),
      });
    }
  });

  return Array.from(qualityMap.values()).sort((a, b) => {
    const aRes = parseInt((a.qualityLabel || a.quality || "0").replace(/\D/g, "")) || 0;
    const bRes = parseInt((b.qualityLabel || b.quality || "0").replace(/\D/g, "")) || 0;
    if (bRes !== aRes) return bRes - aRes;
    return Number(b.hasAudio) - Number(a.hasAudio);
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  const clients: Array<"WEB" | "ANDROID" | "TV" | "WEB_EMBEDDED" | "IOS"> = ["ANDROID", "IOS", "WEB", "TV", "WEB_EMBEDDED"];
  let info: any = null;
  let lastError = "";

  for (const client of clients) {
    try {
      info = await ytdl.getInfo(url, getYouTubeInfoOptions(client));
      if (info?.formats?.length > 0) break;
    } catch (error: any) {
      lastError = error?.message || `${client} extraction failed`;
    }
  }

  if (!info) {
    try {
      await db.insert(downloadLogs).values({
        platform: "youtube",
        url,
        success: false,
        error: lastError || "Failed to extract video info",
      });
    } catch {}

    return NextResponse.json({
      error: process.env.YOUTUBE_COOKIE || process.env.YT_COOKIE || process.env.YOUTUBE_COOKIES
        ? "YouTube still blocked this request even with cookies. Try refreshing your cookies or a different video."
        : "No downloadable YouTube qualities found. Add YOUTUBE_COOKIE in Vercel env and redeploy.",
      details: lastError,
      needsCookie: !(process.env.YOUTUBE_COOKIE || process.env.YT_COOKIE || process.env.YOUTUBE_COOKIES),
    }, { status: 503 });
  }

  const title = info.videoDetails?.title?.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "YouTube Video";
  const thumbnail = info.videoDetails?.thumbnails?.at(-1)?.url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  const duration = parseInt(info.videoDetails?.lengthSeconds || "0");
  const author = typeof info.videoDetails?.author === "string"
    ? info.videoDetails.author
    : info.videoDetails?.author?.name || "YouTube";

  const allFormats = groupFormatsByQuality(info.formats);
  const combinedFormats = allFormats.filter((format) => format.hasVideo && format.hasAudio);
  const displayFormats = combinedFormats.length > 0 ? combinedFormats : allFormats;
  const bestFormat = displayFormats[0] || null;

  try {
    await db.insert(downloadLogs).values({
      platform: "youtube",
      url,
      success: displayFormats.length > 0,
      fileName: `${title}.mp4`,
      error: displayFormats.length > 0 ? null : "No downloadable formats",
    });
  } catch {}

  return NextResponse.json({
    success: true,
    videoId,
    title,
    thumbnail,
    duration,
    author,
    formats: displayFormats,
    allFormats,
    bestFormat,
    downloadUrl: `/api/download/youtube/video?url=${encodeURIComponent(url)}`,
    cookieEnabled: Boolean(process.env.YOUTUBE_COOKIE || process.env.YT_COOKIE || process.env.YOUTUBE_COOKIES),
    note: combinedFormats.length === 0 ? "Only video-only qualities were found; some videos require audio/video merging." : undefined,
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
