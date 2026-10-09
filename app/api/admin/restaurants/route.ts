import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { z } from "zod";

async function isAppAdmin(userId: string) {
  const result = await pool.query(
    `SELECT id
     FROM users
     WHERE id = $1
       AND is_active = TRUE
       AND approval_status = 'approved'
       AND is_app_admin = TRUE`,
    [userId]
  );

  return result.rows.length > 0;
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    if (!(await isAppAdmin(session.user.id))) {
      return NextResponse.json(
        { error: "App Admin access required" },
        { status: 403 }
      );
    }

    const result = await pool.query(
      `SELECT id, name, created_at
       FROM restaurants
       ORDER BY name ASC`
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Load restaurants error:", error);

    return NextResponse.json(
      { error: "Failed to load restaurants" },
      { status: 500 }
    );
  }
}

const restaurantSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const parsed = restaurantSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Restaurant name must be 2–100 characters" },
      { status: 400 }
    );
  }

  try {
    if (!(await isAppAdmin(session.user.id))) {
      return NextResponse.json(
        { error: "App Admin access required" },
        { status: 403 }
      );
    }

    const result = await pool.query(
      `INSERT INTO restaurants (name)
       VALUES ($1)
       RETURNING id, name, created_at`,
      [parsed.data.name]
    );

    return NextResponse.json(result.rows[0], {
      status: 201,
    });
  } catch (error) {
    console.error("Create restaurant error:", error);

    return NextResponse.json(
      { error: "Failed to create restaurant" },
      { status: 500 }
    );
  }
}