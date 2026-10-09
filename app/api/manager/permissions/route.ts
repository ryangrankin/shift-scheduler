import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const result = await pool.query(
      `SELECT role
       FROM users
       WHERE id = $1
         AND is_active = TRUE
         AND role IN ('manager', 'owner')`,
      [session.user.id]
    );

    if (!result.rows.length) {
      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      role: result.rows[0].role,
    });
  } catch (error) {
    console.error("Load management permissions error:", error);

    return NextResponse.json(
      { error: "Failed to load permissions" },
      { status: 500 }
    );
  }
}