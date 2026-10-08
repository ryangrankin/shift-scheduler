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
      `SELECT
         s.id,
         s.start_time::text AS start_time,
         s.end_time::text AS end_time,
         s.status,
         s.pickup_status,
         p.name AS position_name,
         r.name AS restaurant_name
       FROM shifts s
       JOIN positions p ON s.position_id = p.id
       JOIN restaurants r ON s.restaurant_id = r.id
       JOIN users u ON s.user_id = u.id
       WHERE s.user_id = $1
         AND s.restaurant_id = u.restaurant_id
         AND s.status = 'published'
       ORDER BY s.start_time ASC`,
      [session.user.id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Employee shifts GET error:", error);

    return NextResponse.json(
      { error: "Failed to load employee shifts" },
      { status: 500 }
    );
  }
}