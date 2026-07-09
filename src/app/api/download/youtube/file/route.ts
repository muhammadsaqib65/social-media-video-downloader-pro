import { NextRequest, NextResponse } from "next/server";
import { openYouTubeStream } from "@/lib/youtube";
import { isValidUrl } from "@/lib/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") || "";
  const quality = request.nextUrl.searchParams.get("quality") || "best";

  if (!url || !isValidUrl(url)) {
    return NextResponse.json(
      { error: "Valid YouTube URL is required" },
      { status: 400 }
    );
  }

  try {
    const { stream, contentType, fileName, qualityLabel } =
      await openYouTubeStream(url, quality);

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
        "X-Video-Quality": qualityLabel,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to download YouTube video";

    const lower = message.toLowerCase();
    let status = 500;
    let friendly = message;

    if (lower.includes("403") || lower.includes("forbidden")) {
      status = 403;
      friendly =
        "YouTube blocked the media stream (403). This is common on Vercel free/serverless IPs. Set YOUTUBE_COOKIE in Vercel env, or try again later / use a different video.";
    } else if (lower.includes("410") || lower.includes("gone")) {
      status = 410;
      friendly =
        "YouTube stream expired (410). Please try downloading again for a fresh link.";
    } else if (
      lower.includes("no downloadable") ||
      lower.includes("no matching") ||
      lower.includes("private") ||
      lower.includes("unavailable")
    ) {
      status = 404;
    }

    return NextResponse.json({ error: friendly }, { status });
  }
}
