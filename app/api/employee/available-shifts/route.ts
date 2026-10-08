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
         p.name AS position_name,
         r.name AS restaurant_name
       FROM shifts s
       JOIN positions p ON s.position_id = p.id
       JOIN restaurants r ON s.restaurant_id = r.id
       JOIN users u ON u.restaurant_id = s.restaurant_id
       WHERE u.id = $1
         AND (
            s.user_id IS NULL
         OR (
            s.pickup_status = 'posted'
            AND s.user_id != $2
         )
        )
         AND s.status = 'published'
         AND s.start_time > CURRENT_TIMESTAMP
       ORDER BY s.start_time ASC`,
      [session.user.id, session.user.id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Available shifts GET error:", error);

    return NextResponse.json(
      { error: "Failed to load available shifts" },
      { status: 500 }
    );
  }
}