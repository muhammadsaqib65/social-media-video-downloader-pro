import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads } from "@/db/schema";
import { desc } from "drizzle-orm";
import { detectPlatform, isValidUrl, sanitizeFileName } from "@/lib/platform";
import { extractVideo } from "@/lib/extractors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(downloads)
      .orderBy(desc(downloads.createdAt))
      .limit(50);

    return NextResponse.json({ success: true, downloads: rows });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load downloads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const forcedPlatform =
      body?.platform === "tiktok" ||
      body?.platform === "instagram" ||
      body?.platform === "youtube"
        ? body.platform
        : null;

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    if (!isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const platform = forcedPlatform || detectPlatform(url);
    if (!platform) {
      return NextResponse.json(
        {
          error:
            "Unsupported link. Paste a TikTok, Instagram, or YouTube video URL.",
        },
        { status: 400 }
      );
    }

    let video;
    try {
      video = await extractVideo(url, platform);
    } catch (error) {
      // For YouTube, still return a usable payload so the UI can show download controls
      if (platform === "youtube") {
        const message =
          error instanceof Error ? error.message : "YouTube extraction failed";
        video = {
          platform: "youtube" as const,
          title: "YouTube Video",
          author: "YouTube",
          thumbnail: "",
          duration: 0,
          sourceUrl: url,
          downloadUrl: `/api/download/youtube/file?url=${encodeURIComponent(url)}&quality=best`,
          fileName: `${sanitizeFileName("youtube-video")}.mp4`,
          qualities: [
            {
              label: "best",
              height: 0,
              itag: 0,
              hasAudio: true,
              container: "mp4",
            },
            {
              label: "1080p",
              height: 1080,
              itag: 0,
              hasAudio: false,
              container: "mp4",
            },
            {
              label: "720p",
              height: 720,
              itag: 0,
              hasAudio: false,
              container: "mp4",
            },
            {
              label: "480p",
              height: 480,
              itag: 0,
              hasAudio: false,
              container: "mp4",
            },
            {
              label: "360p",
              height: 360,
              itag: 0,
              hasAudio: true,
              container: "mp4",
            },
          ],
          selectedQuality: "best",
          warning: message,
        };
      } else {
        throw error;
      }
    }

    // Ensure YouTube always includes a qualities array for the UI
    if (video.platform === "youtube") {
      const qualities = Array.isArray((video as any).qualities)
        ? (video as any).qualities
        : [];
      if (!qualities.length) {
        (video as any).qualities = [
          {
            label: "best",
            height: 0,
            itag: 0,
            hasAudio: true,
            container: "mp4",
          },
          {
            label: "1080p",
            height: 1080,
            itag: 0,
            hasAudio: false,
            container: "mp4",
          },
          {
            label: "720p",
            height: 720,
            itag: 0,
            hasAudio: false,
            container: "mp4",
          },
          {
            label: "360p",
            height: 360,
            itag: 0,
            hasAudio: true,
            container: "mp4",
          },
        ];
        (video as any).selectedQuality = "best";
      }
      if (!(video as any).downloadUrl?.startsWith("/api/")) {
        (video as any).downloadUrl = `/api/download/youtube/file?url=${encodeURIComponent(
          video.sourceUrl || url
        )}&quality=${encodeURIComponent((video as any).selectedQuality || "best")}`;
      }
    }

    // Force TikTok/Instagram through file proxy routes
    if (video.platform === "tiktok" && !video.downloadUrl.startsWith("/api/")) {
      video.downloadUrl = `/api/download/tiktok/file?url=${encodeURIComponent(
        video.sourceUrl || url
      )}`;
    }
    if (
      video.platform === "instagram" &&
      !video.downloadUrl.startsWith("/api/")
    ) {
      video.downloadUrl = `/api/download/instagram/file?url=${encodeURIComponent(
        video.sourceUrl || url
      )}`;
    }

    let savedId: number | null = null;
    try {
      const inserted = await db
        .insert(downloads)
        .values({
          platform: video.platform,
          url: video.sourceUrl,
          title: video.title,
          author: video.author,
          thumbnail: video.thumbnail,
          downloadUrl: video.downloadUrl,
          fileName: video.fileName,
          success: true,
        })
        .returning({ id: downloads.id });
      savedId = inserted[0]?.id ?? null;
    } catch {
      // Keep response even if DB logging fails
    }

    return NextResponse.json({
      success: true,
      id: savedId,
      ...video,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process download";

    try {
      await db.insert(downloads).values({
        platform: "unknown",
        url: "",
        success: false,
        error: message,
      });
    } catch {
      // ignore logging failure
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
