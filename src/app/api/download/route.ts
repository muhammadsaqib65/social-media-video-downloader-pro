import { db } from "@/db";
import { downloads } from "@/db/schema";
import { desc, sql, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET - List all downloads or filter by platform
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const limit = parseInt(searchParams.get("limit") || "20");

  try {
    let results;
    
    if (platform) {
      results = await db.select().from(downloads)
        .where(eq(downloads.platform, platform))
        .orderBy(desc(downloads.createdAt))
        .limit(limit);
    } else {
      results = await db.select().from(downloads)
        .orderBy(desc(downloads.createdAt))
        .limit(limit);
    }

    return NextResponse.json({ success: true, downloads: results });
  } catch (error) {
    console.error("Error fetching downloads:", error);
    return NextResponse.json({ error: "Failed to fetch downloads" }, { status: 500 });
  }
}

// POST - Create a new download record
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform, url, fileName, fileSize } = body;

    if (!platform || !url) {
      return NextResponse.json({ error: "Platform and URL are required" }, { status: 400 });
    }

    const result = await db.insert(downloads).values({
      platform,
      url,
      fileName: fileName || null,
      fileSize: fileSize || null,
      success: true,
    }).returning();

    return NextResponse.json({ success: true, download: result[0] });
  } catch (error) {
    console.error("Error creating download:", error);
    return NextResponse.json({ error: "Failed to create download record" }, { status: 500 });
  }
}

// DELETE - Clear download history
export async function DELETE(request: NextRequest) {
  try {
    await db.delete(downloads);
    return NextResponse.json({ success: true, message: "Download history cleared" });
  } catch (error) {
    console.error("Error clearing downloads:", error);
    return NextResponse.json({ error: "Failed to clear downloads" }, { status: 500 });
  }
}