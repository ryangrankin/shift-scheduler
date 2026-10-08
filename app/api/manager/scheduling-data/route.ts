
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

    const employees = await pool.query(
      `SELECT id, first_name, last_name, role
       FROM users
       WHERE restaurant_id = $1
       ORDER BY first_name, last_name`,
      [manager.restaurant_id]
    );

    const positions = await pool.query(
      `SELECT id, name
       FROM positions
       WHERE restaurant_id = $1
       ORDER BY name`,
      [manager.restaurant_id]
    );

    return NextResponse.json({
      employees: employees.rows,
      positions: positions.rows,
    });
  } catch (error) {
    console.error("Scheduling data GET error:", error);

    return NextResponse.json(
      { error: "Failed to load scheduling data" },
      { status: 500 }
    );
  }
}
