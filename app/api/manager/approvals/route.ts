import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { z } from "zod";

type Approver = {
  id: number;
  restaurant_id: number;
  role: string;
  is_app_admin: boolean;
};

async function getApprover(userId: string): Promise<Approver | null> {
  const result = await pool.query(
    `SELECT id, restaurant_id, role, is_app_admin
     FROM users
     WHERE id = $1
       AND is_active = TRUE
       AND approval_status = 'approved'`,
    [userId]
  );

  const user = result.rows[0] as Approver | undefined;

  if (
    !user ||
    (!user.is_app_admin && !["manager", "owner"].includes(user.role))
  ) {
    return null;
  }

  return user;
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
    const approver = await getApprover(session.user.id);

    if (!approver) {
      return NextResponse.json(
        { error: "Manager or App Admin access required" },
        { status: 403 }
      );
    }

    // App Admin sees requests from all restaurants.
    // Managers and Owners see only their own restaurant.
    const result = await pool.query(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.email,
         u.role,
         u.created_at,
         u.restaurant_id,
         r.name AS restaurant_name
       FROM users u
       JOIN restaurants r ON r.id = u.restaurant_id
       WHERE u.approval_status = 'pending'
         AND u.is_active = FALSE
         AND u.role IN ('employee', 'manager')
         AND ($1::boolean = TRUE OR u.restaurant_id = $2)
       ORDER BY u.created_at ASC`,
      [approver.is_app_admin, approver.restaurant_id]
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

    const approverResult = await client.query(
      `SELECT id, restaurant_id, role, is_app_admin
       FROM users
       WHERE id = $1
         AND is_active = TRUE
         AND approval_status = 'approved'`,
      [session.user.id]
    );

    const approver = approverResult.rows[0] as Approver | undefined;

    if (
      !approver ||
      (!approver.is_app_admin &&
        !["manager", "owner"].includes(approver.role))
    ) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Manager or App Admin access required" },
        { status: 403 }
      );
    }

    const result = await client.query(
      `UPDATE users
       SET approval_status = $1,
           is_active = $2
       WHERE id = $3
         AND ($4::boolean = TRUE OR restaurant_id = $5)
         AND approval_status = 'pending'
         AND is_active = FALSE
         AND role IN ('employee', 'manager')
       RETURNING id, first_name, last_name, role, restaurant_id`,
      [
        action === "approve" ? "approved" : "denied",
        action === "approve",
        userId,
        approver.is_app_admin,
        approver.restaurant_id,
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