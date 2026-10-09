import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { z } from "zod";

async function isAppAdmin(userId: string) {
  const result = await pool.query(
    `SELECT id
     FROM users
     WHERE id = $1
       AND is_app_admin = TRUE
       AND is_active = TRUE
       AND approval_status = 'approved'`,
    [userId]
  );

  return result.rows.length > 0;
}

// List first-manager requests for restaurants without a manager.
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
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.email,
         u.created_at,
         r.id AS restaurant_id,
         r.name AS restaurant_name
       FROM users u
       JOIN restaurants r ON r.id = u.restaurant_id
       WHERE u.role = 'manager'
         AND u.approval_status = 'pending'
         AND u.is_active = FALSE
         AND NOT EXISTS (
           SELECT 1
           FROM users m
           WHERE m.restaurant_id = u.restaurant_id
             AND m.role IN ('manager', 'owner')
             AND m.is_active = TRUE
             AND m.approval_status = 'approved'
         )
       ORDER BY u.created_at ASC`
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Load first-manager requests error:", error);

    return NextResponse.json(
      { error: "Failed to load requests" },
      { status: 500 }
    );
  }
}

const approvalSchema = z.object({
  userId: z.number().int().positive(),
  action: z.enum(["approve", "deny"]),
});

// Approve or deny a restaurant's first Manager.
export async function PATCH(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const parsed = approvalSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const adminResult = await client.query(
      `SELECT id
       FROM users
       WHERE id = $1
         AND is_app_admin = TRUE
         AND is_active = TRUE
         AND approval_status = 'approved'`,
      [session.user.id]
    );

    if (adminResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "App Admin access required" },
        { status: 403 }
      );
    }

    const { userId, action } = parsed.data;

    // Lock the target restaurant to prevent simultaneous first-manager approvals.
    const targetResult = await client.query(
      `SELECT u.id, u.restaurant_id
       FROM users u
       WHERE u.id = $1
         AND u.role = 'manager'
         AND u.approval_status = 'pending'
         AND u.is_active = FALSE`,
      [userId]
    );

    const target = targetResult.rows[0];

    if (!target) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Pending Manager request not found" },
        { status: 404 }
      );
    }

    await client.query(
      `SELECT id FROM restaurants WHERE id = $1 FOR UPDATE`,
      [target.restaurant_id]
    );

    const existingManager = await client.query(
      `SELECT id
       FROM users
       WHERE restaurant_id = $1
         AND role IN ('manager', 'owner')
         AND is_active = TRUE
         AND approval_status = 'approved'
       LIMIT 1`,
      [target.restaurant_id]
    );

    if (existingManager.rows.length > 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "This restaurant already has management" },
        { status: 409 }
      );
    }

    const result = await client.query(
      `UPDATE users
       SET approval_status = $1,
           is_active = $2
       WHERE id = $3
         AND role = 'manager'
         AND approval_status = 'pending'
         AND is_active = FALSE
       RETURNING id, first_name, last_name, restaurant_id`,
      [
        action === "approve" ? "approved" : "denied",
        action === "approve",
        userId,
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      user: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("First-manager approval error:", error);

    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}