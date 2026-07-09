import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads } from "@/db/schema";
import { extractYouTube } from "@/lib/youtube";
import { isValidUrl } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";

    if (!url || !isValidUrl(url)) {
      return NextResponse.json(
        { error: "Valid YouTube URL is required" },
        { status: 400 }
      );
    }

    try {
      const video = await extractYouTube(url);

      try {
        await db.insert(downloads).values({
          platform: "youtube",
          url: video.sourceUrl,
          title: video.title,
          author: video.author,
          thumbnail: video.thumbnail,
          downloadUrl: video.downloadUrl,
          fileName: video.fileName,
          success: true,
        });
      } catch {
        // ignore logging failures
      }

      return NextResponse.json({
        success: true,
        ...video,
        qualities: video.qualities?.length
          ? video.qualities
          : [
              { label: "best", height: 0, itag: 0, hasAudio: true, container: "mp4", client: "IOS" },
              { label: "1080p", height: 1080, itag: 0, hasAudio: false, container: "mp4", client: "IOS" },
              { label: "720p", height: 720, itag: 0, hasAudio: false, container: "mp4", client: "IOS" },
              { label: "360p", height: 360, itag: 0, hasAudio: true, container: "mp4", client: "ANDROID" },
            ],
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "YouTube download failed";

      // Still return quality options so UI remains usable after deploy
      return NextResponse.json({
        success: true,
        platform: "youtube",
        title: "YouTube Video",
        author: "YouTube",
        thumbnail: "",
        duration: 0,
        sourceUrl: url,
        downloadUrl: `/api/download/youtube/file?url=${encodeURIComponent(url)}&quality=best`,
        fileName: "youtube-video.mp4",
        qualities: [
          { label: "best", height: 0, itag: 0, hasAudio: true, container: "mp4", client: "IOS" },
          { label: "1080p", height: 1080, itag: 0, hasAudio: false, container: "mp4", client: "IOS" },
          { label: "720p", height: 720, itag: 0, hasAudio: false, container: "mp4", client: "IOS" },
          { label: "480p", height: 480, itag: 0, hasAudio: false, container: "mp4", client: "IOS" },
          { label: "360p", height: 360, itag: 0, hasAudio: true, container: "mp4", client: "ANDROID" },
        ],
        selectedQuality: "best",
        warning: message,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "YouTube download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") || "";
  return POST(
    new NextRequest(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
  );
}
