import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

export async function PATCH(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const shiftId =
    body && typeof body === "object" && "shiftId" in body
      ? body.shiftId
      : undefined;

  const action =
    body && typeof body === "object" && "action" in body
      ? body.action
      : undefined;

  if (
    !Number.isSafeInteger(shiftId) ||
    typeof shiftId !== "number" ||
    shiftId <= 0 ||
    (action !== "post" && action !== "withdraw")
  ) {
    return NextResponse.json(
      { error: "Invalid shift or action" },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, restaurant_id, role
       FROM users
       WHERE id = $1`,
      [session.user.id]
    );

    const user = userResult.rows[0];

    if (!user || user.role !== "employee") {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Employee access required" },
        { status: 403 }
      );
    }

    // Lock the shift while updating its posting status.
    const shiftResult = await client.query(
      `SELECT id, pickup_status
       FROM shifts
       WHERE id = $1
         AND user_id = $2
         AND restaurant_id = $3
         AND status = 'published'
         AND start_time > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [shiftId, user.id, user.restaurant_id]
    );

    const shift = shiftResult.rows[0];

    if (!shift) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Shift not found or cannot be changed" },
        { status: 409 }
      );
    }

    if (
      (action === "post" && shift.pickup_status !== "not_posted") ||
      (action === "withdraw" && shift.pickup_status !== "posted")
    ) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        {
          error:
            action === "post"
              ? "This shift is already posted"
              : "This shift is not currently posted",
        },
        { status: 409 }
      );
    }

    const newStatus =
      action === "post" ? "posted" : "not_posted";

    const result = await client.query(
      `UPDATE shifts
       SET pickup_status = $1
       WHERE id = $2
       RETURNING id, pickup_status`,
      [newStatus, shiftId]
    );

    let cancelledRequests = 0;

    if (action === "withdraw") {
      const cancelledResult = await client.query(
        `UPDATE shift_pickup_requests
         SET status = 'cancelled',
             reviewed_at = NOW()
         WHERE shift_id = $1
           AND status = 'pending'`,
        [shiftId]
      );

      cancelledRequests = cancelledResult.rowCount ?? 0;
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      shift: result.rows[0],
      cancelledRequests,
      message:
        action === "post"
          ? "Shift posted successfully"
          : "Shift posting withdrawn and pending requests cancelled",
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Employee post shift error:", error);

    return NextResponse.json(
      { error: "Failed to update shift posting" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}