import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads } from "@/db/schema";
import { extractTikTok } from "@/lib/tiktok";
import { isValidUrl } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim() : "";

    if (!url || !isValidUrl(url)) {
      return NextResponse.json(
        { error: "Valid TikTok URL is required" },
        { status: 400 }
      );
    }

    const video = await extractTikTok(url);

    try {
      await db.insert(downloads).values({
        platform: "tiktok",
        url: video.sourceUrl,
        title: video.title,
        author: video.author,
        thumbnail: video.thumbnail,
        downloadUrl: video.downloadUrl,
        fileName: video.fileName,
        success: true,
      });
    } catch {
      // ignore logging failure
    }

    return NextResponse.json({ success: true, ...video });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "TikTok download failed";
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
