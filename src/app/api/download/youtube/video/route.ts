import { NextRequest, NextResponse } from "next/server";
import { extractVideo } from "@/lib/extractors";
import { isValidUrl } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") || "";

  if (!url || !isValidUrl(url)) {
    return NextResponse.json({ error: "Valid URL is required" }, { status: 400 });
  }

  try {
    const video = await extractVideo(url, "youtube");
    return NextResponse.json({ success: true, ...video });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve YouTube video";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
