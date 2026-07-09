import { NextRequest, NextResponse } from "next/server";
import { openYouTubeStream } from "@/lib/youtube";
import { isValidUrl } from "@/lib/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const status =
      lower.includes("410") || lower.includes("gone")
        ? 410
        : lower.includes("private") || lower.includes("unavailable")
          ? 404
          : 500;

    return NextResponse.json(
      {
        error:
          status === 410
            ? "YouTube stream expired or blocked (410). Please try again."
            : message,
      },
      { status }
    );
  }
}
