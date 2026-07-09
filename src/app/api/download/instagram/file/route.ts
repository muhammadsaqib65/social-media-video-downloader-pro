import { NextRequest, NextResponse } from "next/server";
import { openInstagramStream } from "@/lib/instagram";
import { isValidUrl } from "@/lib/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") || "";

  if (!url || !isValidUrl(url)) {
    return NextResponse.json(
      { error: "Valid Instagram URL is required" },
      { status: 400 }
    );
  }

  try {
    const { stream, contentType, fileName } = await openInstagramStream(url);

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to download Instagram video";

    const lower = message.toLowerCase();
    const status = lower.includes("cookie")
      ? 503
      : lower.includes("private") || lower.includes("blocked")
        ? 403
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
