import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads } from "@/db/schema";
import { detectPlatform, isValidUrl } from "@/lib/platform";
import { extractVideo } from "@/lib/extractors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    if (!isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const platform = detectPlatform(url);
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

    try {
      await db.insert(downloads).values({
        platform: video.platform,
        url: video.sourceUrl,
        title: video.title,
        author: video.author,
        thumbnail: video.thumbnail,
        downloadUrl: video.downloadUrl,
        fileName: video.fileName,
        success: true,
      });
    } catch {
      // Don't fail extraction if logging fails
    }

    return NextResponse.json({
      success: true,
      ...video,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract video";
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
