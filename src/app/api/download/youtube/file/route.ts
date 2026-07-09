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

    if (lower.includes("cookie")) status = 503;
    else if (lower.includes("403") || lower.includes("forbidden") || lower.includes("blocked"))
      status = 403;
    else if (lower.includes("410") || lower.includes("gone")) status = 410;
    else if (lower.includes("private") || lower.includes("unavailable") || lower.includes("no downloadable"))
      status = 404;

    return NextResponse.json({ error: message }, { status });
  }
}
