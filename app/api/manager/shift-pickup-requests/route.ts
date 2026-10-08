import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

// GET pending shift pickup requests for this restaurant
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const managerResult = await pool.query(
      `SELECT restaurant_id, role
       FROM users
       WHERE id = $1`,
      [session.user.id]
    );

    const manager = managerResult.rows[0];

    if (!manager || !["manager", "owner"].includes(manager.role)) {
      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    const result = await pool.query(
      `SELECT
         spr.id,
         spr.shift_id,
         spr.requested_by,
         spr.status,
         spr.created_at,
         u.first_name,
         u.last_name,
         p.name AS position_name,
         s.start_time::text AS start_time,
         s.end_time::text AS end_time
       FROM shift_pickup_requests spr
       JOIN shifts s ON spr.shift_id = s.id
       JOIN users u ON spr.requested_by = u.id
       JOIN positions p ON s.position_id = p.id
       WHERE s.restaurant_id = $1
         AND spr.status = 'pending'
       ORDER BY spr.created_at ASC`,
      [manager.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Manager pickup requests GET error:", error);

    return NextResponse.json(
      { error: "Failed to load pickup requests" },
      { status: 500 }
    );
  }
}