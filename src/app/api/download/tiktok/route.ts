import { db } from "@/db";
import { downloadLogs } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Extract video ID from TikTok URL
function extractTikTokVideoId(url: string): string | null {
  const patterns = [
    /tiktok\.com\/@[^/]+\/video\/(\d+)/,
    /tiktok\.com\/video\/(\d+)/,
    /vm\.tiktok\.com\/([A-Za-z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1] || match[0];
  }
  return null;
}

// Get TikTok video download URL using multiple methods
async function getTikTokDownloadUrl(videoUrl: string): Promise<{
  downloadUrl: string;
  title: string;
  thumbnail: string;
  author: string;
}> {
  const videoId = extractTikTokVideoId(videoUrl);
  if (!videoId) {
    throw new Error("Invalid TikTok URL");
  }

  // Method 1: Try TikWM API (no watermark)
  try {
    const tiktokApiUrl = `https://www.tikwm.com/api/`;
    const response = await fetch(tiktokApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `url=${encodeURIComponent(videoUrl)}&count=12&cursor=0&web=1&hd=1`,
    });

    if (response.ok) {
      const data = await response.json();
      if (data.code === 0 && data.data?.play) {
        return {
          downloadUrl: data.data.hdplay || data.data.play,
          title: data.data.title || "TikTok Video",
          thumbnail: data.data.cover || "",
          author: data.data.author?.nickname || "Unknown",
        };
      }
    }
  } catch (e) {
    console.log("TikWM API failed:", e);
  }

  // Method 2: Try RapidAPI TikTok Downloader (if key available)
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  if (rapidApiKey) {
    try {
      const response = await fetch("https://tiktok-api-downloader.p.rapidapi.com/v1/video/id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": rapidApiKey,
          "X-RapidAPI-Host": "tiktok-api-downloader.p.rapidapi.com",
        },
        body: JSON.stringify({ url: videoUrl }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.download_url) {
          return {
            downloadUrl: data.download_url,
            title: data.title || "TikTok Video",
            thumbnail: data.thumbnail || "",
            author: data.author || "Unknown",
          };
        }
      }
    } catch (e) {
      console.log("RapidAPI failed:", e);
    }
  }

  // Method 3: Try snaptik API
  try {
    const videoIdMatch = videoUrl.match(/tiktok\.com\/video\/(\d+)/);
    if (videoIdMatch) {
      const snapResponse = await fetch(`https://snaptik.app/abcd.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `url=${encodeURIComponent(videoUrl)}`,
      });

      if (snapResponse.ok) {
        const html = await snapResponse.text();
        const urlMatch = html.match(/"(https:\/\/[^"]+?\.mp4[^"]*)"/);
        if (urlMatch) {
          return {
            downloadUrl: urlMatch[1],
            title: "TikTok Video",
            thumbnail: "",
            author: "Unknown",
          };
        }
      }
    }
  } catch (e) {
    console.log("Snaptik API failed:", e);
  }

  throw new Error("Failed to get download URL. Please try again.");
}

// GET - Get video info
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  try {
    const videoData = await getTikTokDownloadUrl(url);

    // Log the download
    try {
      await db.insert(downloadLogs).values({
        platform: "tiktok",
        url: url,
        success: true,
        fileName: `${videoData.title.replace(/[^a-z0-9]/gi, '_')}.mp4`,
      });
    } catch {}

    return NextResponse.json({
      success: true,
      ...videoData,
      downloadEndpoint: `/api/download/tiktok/video?url=${encodeURIComponent(url)}`,
    });
  } catch (error: any) {
    // Log error
    try {
      await db.insert(downloadLogs).values({
        platform: "tiktok",
        url: url,
        success: false,
        error: error?.message || "Unknown error",
      });
    } catch {}

    return NextResponse.json(
      { error: error?.message || "Failed to fetch TikTok video" },
      { status: 500 }
    );
  }
}

// POST - Get video info
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const videoData = await getTikTokDownloadUrl(url);

    // Log the download
    try {
      await db.insert(downloadLogs).values({
        platform: "tiktok",
        url: url,
        success: true,
        fileName: `${videoData.title.replace(/[^a-z0-9]/gi, '_')}.mp4`,
      });
    } catch {}

    return NextResponse.json({
      success: true,
      ...videoData,
      downloadEndpoint: `/api/download/tiktok/video?url=${encodeURIComponent(url)}`,
    });
  } catch (error: any) {
    try {
      await db.insert(downloadLogs).values({
        platform: "tiktok",
        url: "",
        success: false,
        error: error?.message || "Unknown error",
      });
    } catch {}

    return NextResponse.json(
      { error: error?.message || "Failed to fetch TikTok video" },
      { status: 500 }
    );
  }
}
