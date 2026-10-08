
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
    // Verify manager permissions using the database.
    const managerResult = await pool.query(
      `SELECT id, restaurant_id, role
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

    // Load requests belonging to this restaurant.
    const result = await pool.query(
      `SELECT
         ar.id,
         ar.request_date::text AS request_date,
         ar.start_time,
         ar.end_time,
         ar.is_unavailable,
         ar.reason,
         ar.status,
         ar.created_at,
         u.first_name,
         u.last_name,
         u.id AS employee_id
       FROM availability_requests ar
       JOIN users u ON ar.user_id = u.id
       WHERE u.restaurant_id = $1
       ORDER BY
         CASE WHEN ar.status = 'pending' THEN 0 ELSE 1 END,
         ar.request_date ASC,
         ar.created_at DESC`,
      [manager.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Manager availability requests GET error:", error);

    return NextResponse.json(
      { error: "Failed to load availability requests" },
      { status: 500 }
    );
  }
}
