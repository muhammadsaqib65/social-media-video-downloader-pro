import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(downloads)
      .orderBy(desc(downloads.createdAt))
      .limit(30);

    return NextResponse.json({ success: true, history: rows });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");

    if (!idParam) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    await db.delete(downloads).where(eq(downloads.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete history item";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
