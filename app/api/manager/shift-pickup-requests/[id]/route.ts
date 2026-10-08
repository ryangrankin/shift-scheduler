import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const requestId = Number(id);

  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action =
    body && typeof body === "object" && "action" in body
      ? body.action
      : undefined;

  if (action !== "approve" && action !== "deny") {
    return NextResponse.json(
      { error: "Action must be approve or deny" },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const managerResult = await client.query(
      `SELECT id, restaurant_id, role
       FROM users
       WHERE id = $1`,
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

    const pickupResult = await client.query(
      `SELECT
         spr.id,
         spr.shift_id,
         spr.requested_by,
         spr.status,
         s.user_id,
         s.pickup_status,
         s.status AS shift_status,
         s.start_time::text AS start_time,
         s.end_time::text AS end_time
       FROM shift_pickup_requests spr
       JOIN shifts s ON s.id = spr.shift_id
       WHERE spr.id = $1
         AND s.restaurant_id = $2
       FOR UPDATE OF spr, s`,
      [requestId, manager.restaurant_id]
    );

    const pickup = pickupResult.rows[0];

    if (!pickup) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (pickup.status !== "pending") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This request has already been reviewed" },
        { status: 409 }
      );
    }

    if (action === "approve") {
      if (pickup.shift_status !== "published") {
  await client.query("ROLLBACK");
  return NextResponse.json(
    { error: "This shift is no longer available" },
    { status: 409 }
  );
}

if (
  pickup.user_id !== null &&
  (
    pickup.pickup_status !== "posted" ||
    pickup.user_id === pickup.requested_by
  )
) {
  await client.query("ROLLBACK");
  return NextResponse.json(
    { error: "This shift is not available for pickup" },
    { status: 409 }
  );
}

      const eligible = await client.query(
  `SELECT 1
   FROM user_positions up
   JOIN shifts s ON s.position_id = up.position_id
   JOIN users u ON u.id = up.user_id
   WHERE s.id = $1
     AND up.user_id = $2
     AND u.is_active = TRUE
     AND u.role = 'employee'
     AND u.restaurant_id = s.restaurant_id`,
  [pickup.shift_id, pickup.requested_by]
);

      if (eligible.rows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Employee is not eligible for this position" },
          { status: 409 }
        );
      }

      const overlap = await client.query(
        `SELECT id
         FROM shifts
         WHERE user_id = $1
           AND id != $2
           AND status != 'cancelled'
           AND start_time < $4::timestamp
           AND end_time > $3::timestamp
         LIMIT 1`,
        [
          pickup.requested_by,
          pickup.shift_id,
          pickup.start_time,
          pickup.end_time,
        ]
      );

      if (overlap.rows.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Employee has an overlapping shift" },
          { status: 409 }
        );
      }

      await client.query(
  `UPDATE shifts
   SET user_id = $1,
       pickup_status = 'not_posted'
   WHERE id = $2`,
  [pickup.requested_by, pickup.shift_id]
);

      await client.query(
        `UPDATE shift_pickup_requests
         SET status = 'denied',
             reviewed_by = $1,
             reviewed_at = NOW()
         WHERE shift_id = $2
           AND status = 'pending'
           AND id != $3`,
        [manager.id, pickup.shift_id, requestId]
      );
    }

    await client.query(
      `UPDATE shift_pickup_requests
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = NOW()
       WHERE id = $3`,
      [action === "approve" ? "approved" : "denied", manager.id, requestId]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      status: action === "approve" ? "approved" : "denied",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Pickup request review error:", error);

    return NextResponse.json(
      { error: "Failed to review pickup request" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}