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

function pickFormat(formats: any[], itag: number | null) {
  if (itag) {
    const byItag = formats.find((format) => format.itag === itag && format.url);
    if (byItag) return byItag;
  }

  const combined = formats
    .filter((format) => format.hasVideo && format.hasAudio && format.url)
    .sort((a, b) => {
      const aRes = parseInt((a.qualityLabel || "0").match(/\d+/)?.[0] || "0");
      const bRes = parseInt((b.qualityLabel || "0").match(/\d+/)?.[0] || "0");
      return bRes - aRes;
    });

  return combined[0] || null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const itagParam = searchParams.get("itag");

  if (!url) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  const itag = itagParam ? parseInt(itagParam) : null;
  const clients: Array<"ANDROID" | "IOS" | "WEB" | "TV" | "WEB_EMBEDDED"> = ["ANDROID", "IOS", "WEB", "TV", "WEB_EMBEDDED"];
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
        error: lastError,
      });
    } catch {}

    return NextResponse.json({
      error: process.env.YOUTUBE_COOKIE || process.env.YT_COOKIE || process.env.YOUTUBE_COOKIES
        ? "YouTube blocked this download even with cookies. Refresh YOUTUBE_COOKIE or try another video."
        : "YouTube blocked this server IP. Add YOUTUBE_COOKIE in Vercel env and redeploy.",
      details: lastError,
      needsCookie: !(process.env.YOUTUBE_COOKIE || process.env.YT_COOKIE || process.env.YOUTUBE_COOKIES),
    }, { status: 503 });
  }

  const title = info.videoDetails?.title?.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "youtube_video";
  const safeTitle = title.substring(0, 60);
  const format = pickFormat(info.formats, itag);

  if (!format?.url) {
    const videoOnly = info.formats.find((item: any) => item.hasVideo && !item.hasAudio && item.url);

    try {
      await db.insert(downloadLogs).values({
        platform: "youtube",
        url,
        success: false,
        error: videoOnly ? "Selected quality requires merge" : "No downloadable format found",
      });
    } catch {}

    return NextResponse.json({
      error: videoOnly
        ? "This quality requires audio/video merging. Select a combined quality if available."
        : "No downloadable format available. Add or refresh YOUTUBE_COOKIE in Vercel env.",
      requiresMerge: Boolean(videoOnly),
    }, { status: 404 });
  }

  try {
    await db.insert(downloadLogs).values({
      platform: "youtube",
      url,
      success: true,
      fileName: `${safeTitle}.${format.container || "mp4"}`,
    });
  } catch {}

  try {
    const stream = ytdl.downloadFromInfo(info, { format });
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": format.mimeType || "video/mp4",
        "Content-Length": buffer.length.toString(),
        "Content-Disposition": `attachment; filename="${safeTitle}.${format.container || "mp4"}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error?.message?.includes("403")
        ? "YouTube media stream returned 403. Refresh YOUTUBE_COOKIE in Vercel env and redeploy."
        : "Failed to fetch YouTube media stream.",
      details: error?.message || "Unknown stream error",
    }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
