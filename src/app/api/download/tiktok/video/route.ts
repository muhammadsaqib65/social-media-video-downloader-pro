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

// Get TikTok video download URL
async function getTikTokDownloadUrl(videoUrl: string): Promise<{
  downloadUrl: string;
  title: string;
}> {
  const videoId = extractTikTokVideoId(videoUrl);
  if (!videoId) {
    throw new Error("Invalid TikTok URL");
  }

  // Method 1: TikWM API
  try {
    const response = await fetch("https://www.tikwm.com/api/", {
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
          title: data.data.title || "tiktok_video",
        };
      }
    }
  } catch (e) {
    console.log("TikWM API failed:", e);
  }

  // Method 2: RapidAPI (if available)
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
            title: data.title || "tiktok_video",
          };
        }
      }
    } catch (e) {
      console.log("RapidAPI failed:", e);
    }
  }

  throw new Error("Failed to get download URL. Please try again.");
}

// GET - Download video file
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  try {
    const { downloadUrl, title } = await getTikTokDownloadUrl(url);

    // Fetch the video file
    const videoResponse = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.tiktok.com/",
      },
    });

    if (!videoResponse.ok) {
      throw new Error("Failed to download video file");
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    const contentLength = videoBuffer.byteLength;

    // Generate safe filename
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);

    // Return as downloadable file
    return new NextResponse(videoBuffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": contentLength.toString(),
        "Content-Disposition": `attachment; filename="${safeTitle}.mp4"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error: any) {
    console.error("TikTok download error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to download TikTok video" },
      { status: 500 }
    );
  }
}

// POST - Download video file
export async function POST(request: NextRequest) {
  return GET(request);
}
