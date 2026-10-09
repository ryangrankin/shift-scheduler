import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { z } from "zod";

async function getManager(userId: string) {
  const result = await pool.query(
    `SELECT id, restaurant_id, role
     FROM users
     WHERE id = $1
       AND is_active = TRUE
       AND approval_status = 'approved'`,
    [userId]
  );

  const manager = result.rows[0];

  if (!manager || !["manager", "owner"].includes(manager.role)) {
    return null;
  }

  return manager;
}

// GET: View pending account requests.
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const manager = await getManager(session.user.id);

    if (!manager) {
      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    const result = await pool.query(
      `SELECT id, first_name, last_name, email, role, created_at
       FROM users
       WHERE restaurant_id = $1
         AND approval_status = 'pending'
         AND is_active = FALSE
       ORDER BY created_at ASC`,
      [manager.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Load account requests error:", error);

    return NextResponse.json(
      { error: "Failed to load account requests" },
      { status: 500 }
    );
  }
}

const approvalSchema = z.object({
  userId: z.number().int().positive(),
  action: z.enum(["approve", "deny"]),
});

// PATCH: Approve or deny an account request.
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
      { error: "Invalid approval request" },
      { status: 400 }
    );
  }

  const { userId, action } = parsed.data;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const managerResult = await client.query(
      `SELECT id, restaurant_id, role
       FROM users
       WHERE id = $1
         AND is_active = TRUE
         AND approval_status = 'approved'`,
      [session.user.id]
    );

    const manager = managerResult.rows[0];

    if (!manager || !["manager", "owner"].includes(manager.role)) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    const result = await client.query(
      `UPDATE users
       SET approval_status = $1,
           is_active = $2
       WHERE id = $3
         AND restaurant_id = $4
         AND approval_status = 'pending'
         AND is_active = FALSE
         AND role IN ('employee', 'manager')
       RETURNING id, first_name, last_name, role`,
      [
        action === "approve" ? "approved" : "denied",
        action === "approve",
        userId,
        manager.restaurant_id,
      ]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Pending account request not found" },
        { status: 404 }
      );
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message:
        action === "approve"
          ? "Account approved successfully"
          : "Account request denied",
      user: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Account approval error:", error);

    return NextResponse.json(
      { error: "Failed to process account request" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}