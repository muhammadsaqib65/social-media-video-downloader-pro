import { db } from "@/db";
import { downloadLogs } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type InstagramMedia = {
  downloadUrl: string;
  title: string;
  thumbnail: string;
  author: string;
  type: "video" | "image";
};

function getInstagramCookie() {
  const fullCookie = process.env.INSTAGRAM_COOKIE;
  const sessionId = process.env.IG_SESSIONID;

  if (fullCookie) return fullCookie;
  if (sessionId) return `sessionid=${sessionId};`;
  return "";
}

function decodeInstagramUrl(value: string) {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
}

function findFirstMatch(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeInstagramUrl(match[1]);
  }
  return "";
}

async function getFromInstagramPage(url: string): Promise<InstagramMedia | null> {
  const cookie = getInstagramCookie();
  if (!cookie) return null;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookie,
    },
  });

  if (!response.ok) return null;

  const html = await response.text();
  const videoUrl = findFirstMatch(html, [
    /"video_url":"([^"]+)"/,
    /"playback_url":"([^"]+)"/,
    /property="og:video" content="([^"]+)"/,
    /property="og:video:secure_url" content="([^"]+)"/,
  ]);

  const imageUrl = findFirstMatch(html, [
    /"display_url":"([^"]+)"/,
    /property="og:image" content="([^"]+)"/,
  ]);

  const title = findFirstMatch(html, [
    /property="og:title" content="([^"]+)"/,
    /"caption":"([^"]{1,140})"/,
  ]) || "instagram_media";

  const author = findFirstMatch(html, [
    /"owner":\{"[^}]*"username":"([^"]+)"/,
    /"username":"([^"]+)"/,
  ]) || "Instagram";

  if (videoUrl) {
    return {
      downloadUrl: videoUrl,
      title,
      thumbnail: imageUrl,
      author,
      type: "video",
    };
  }

  if (imageUrl) {
    return {
      downloadUrl: imageUrl,
      title,
      thumbnail: imageUrl,
      author,
      type: "image",
    };
  }

  return null;
}

async function getInstagramDownloadUrl(url: string): Promise<InstagramMedia> {
  const instagramPattern = /^https?:\/\/(www\.)?(instagram\.com|dd\.instagram\.com)\/(p|reel|tv|stories)\/\S+/;
  if (!instagramPattern.test(url)) {
    throw new Error("Invalid Instagram URL");
  }

  const pageMedia = await getFromInstagramPage(url).catch(() => null);
  if (pageMedia?.downloadUrl) return pageMedia;

  const rapidApiKey = process.env.RAPIDAPI_KEY;
  if (rapidApiKey) {
    try {
      const response = await fetch("https://instagram-bulk-scraper-latest.p.rapidapi.com/api/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": rapidApiKey,
          "X-RapidAPI-Host": "instagram-bulk-scraper-latest.p.rapidapi.com",
        },
        body: JSON.stringify({ url }),
      });

      if (response.ok) {
        const data = await response.json();
        const media = data?.[0]?.media?.[0];
        if (media?.url || media?.download_url) {
          return {
            downloadUrl: media.url || media.download_url,
            title: data[0].caption?.substring(0, 80) || "instagram_post",
            thumbnail: media.thumbnail || media.display_url || "",
            author: data[0].author?.username || "Instagram",
            type: media.type === "VIDEO" ? "video" : "image",
          };
        }
      }
    } catch {}
  }

  try {
    const oembedResponse = await fetch(`https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (oembedResponse.ok) {
      const oembed = await oembedResponse.json();
      return {
        downloadUrl: oembed.thumbnail_url || "",
        title: oembed.title || "Instagram Media",
        thumbnail: oembed.thumbnail_url || "",
        author: oembed.author_name || "Instagram",
        type: "image",
      };
    }
  } catch {}

  throw new Error(
    getInstagramCookie()
      ? "Could not resolve a direct Instagram media file. Refresh INSTAGRAM_COOKIE/IG_SESSIONID or try a public reel/post."
      : "Instagram blocks many server requests. Add INSTAGRAM_COOKIE or IG_SESSIONID in Vercel env and redeploy."
  );
}

async function respondWithInfo(url: string) {
  const videoData = await getInstagramDownloadUrl(url);

  try {
    await db.insert(downloadLogs).values({
      platform: "instagram",
      url,
      success: Boolean(videoData.downloadUrl),
      fileName: `${videoData.title.replace(/[^a-z0-9]/gi, "_")}.${videoData.type === "video" ? "mp4" : "jpg"}`,
      error: videoData.downloadUrl ? null : "No direct media file",
    });
  } catch {}

  return NextResponse.json({
    success: Boolean(videoData.downloadUrl),
    ...videoData,
    cookieEnabled: Boolean(getInstagramCookie()),
    downloadEndpoint: `/api/download/instagram/video?url=${encodeURIComponent(url)}`,
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  try {
    return await respondWithInfo(url);
  } catch (error: any) {
    try {
      await db.insert(downloadLogs).values({
        platform: "instagram",
        url,
        success: false,
        error: error?.message || "Unknown error",
      });
    } catch {}

    return NextResponse.json({ error: error?.message || "Failed to fetch Instagram media" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    return await respondWithInfo(url);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to fetch Instagram media" }, { status: 503 });
  }
}
