import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads } from "@/db/schema";
import { desc } from "drizzle-orm";
import { detectPlatform, isValidUrl } from "@/lib/platform";
import { extractVideo } from "@/lib/extractors";

export const dynamic = "force-dynamic";

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

    const video = await extractVideo(url, platform);

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
