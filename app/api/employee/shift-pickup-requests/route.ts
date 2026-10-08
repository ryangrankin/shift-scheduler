import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { checkAvailabilityConflicts } from "@/lib/availability-conflicts";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const shiftId = body?.shiftId;

    if (!Number.isSafeInteger(shiftId) || shiftId <= 0) {
      return NextResponse.json(
        { error: "Invalid shift ID" },
        { status: 400 }
      );
    }

    const employeeResult = await pool.query(
      `SELECT id, restaurant_id
       FROM users
       WHERE id = $1`,
      [session.user.id]
    );

    const employee = employeeResult.rows[0];

    if (!employee) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );
    }

    const shiftResult = await pool.query(
  `SELECT
     id,
     position_id,
     start_time::text AS start_time,
     end_time::text AS end_time
   FROM shifts
   WHERE id = $1
     AND restaurant_id = $2
     AND (
       user_id IS NULL
       OR (
         pickup_status = 'posted'
         AND user_id <> $3
       )
     )
     AND status = 'published'
     AND start_time > CURRENT_TIMESTAMP`,
  [shiftId, employee.restaurant_id, employee.id]
);

    const shift = shiftResult.rows[0];

    if (!shift) {
      return NextResponse.json(
        { error: "This shift is no longer available" },
        { status: 404 }
      );
    }

    // Check whether the employee is assigned to this position.
    const positionResult = await pool.query(
      `SELECT 1
       FROM user_positions
       WHERE user_id = $1
         AND position_id = $2`,
      [employee.id, shift.position_id]
    );

    if (positionResult.rows.length === 0) {
      return NextResponse.json(
        {
          error: "You are not assigned to this position",
        },
        { status: 403 }
      );
    }

    // Prevent overlapping shifts.
    const overlapResult = await pool.query(
      `SELECT id
       FROM shifts
       WHERE user_id = $1
         AND status != 'cancelled'
         AND start_time < $3::timestamp
         AND end_time > $2::timestamp
       LIMIT 1`,
      [
        employee.id,
        shift.start_time,
        shift.end_time,
      ]
    );

    if (overlapResult.rows.length > 0) {
      return NextResponse.json(
        {
          error: "You already have a shift during these hours",
        },
        { status: 409 }
      );
    }

    const conflicts = await checkAvailabilityConflicts({
  userId: employee.id,
  startTime: shift.start_time.replace(" ", "T").slice(0, 16),
  endTime: shift.end_time.replace(" ", "T").slice(0, 16),
});

if (conflicts.length > 0 && body.confirmAvailabilityOverride !== true) {
  return NextResponse.json(
    {
      error: "This shift is outside your availability.",
      requiresConfirmation: true,
      conflicts,
    },
    { status: 409 }
  );
}

    // Prevent duplicate requests.
    const existingRequest = await pool.query(
      `SELECT id
       FROM shift_pickup_requests
       WHERE shift_id = $1
         AND requested_by = $2`,
      [shiftId, employee.id]
    );

    if (existingRequest.rows.length > 0) {
      return NextResponse.json(
        {
          error: "You have already requested this shift",
        },
        { status: 409 }
      );
    }

    const result = await pool.query(
      `INSERT INTO shift_pickup_requests
         (shift_id, requested_by, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, shift_id, requested_by, status, created_at`,
      [shiftId, employee.id]
    );

    return NextResponse.json(
      {
        message: "Shift pickup request submitted",
        request: result.rows[0],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Shift pickup request POST error:", error);

    return NextResponse.json(
      { error: "Failed to submit shift pickup request" },
      { status: 500 }
    );
  }
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
    const userResult = await pool.query(
      `SELECT id, restaurant_id, role
       FROM users
       WHERE id = $1`,
      [session.user.id]
    );

    const user = userResult.rows[0];

    if (!user || user.role !== "employee") {
      return NextResponse.json(
        { error: "Employee access required" },
        { status: 403 }
      );
    }

    const result = await pool.query(
      `SELECT
         spr.id,
         spr.shift_id,
         spr.status,
         spr.created_at,
         spr.reviewed_at,
         p.name AS position_name,
         s.start_time::text AS start_time,
         s.end_time::text AS end_time
       FROM shift_pickup_requests spr
       JOIN shifts s ON s.id = spr.shift_id
       JOIN positions p ON p.id = s.position_id
       WHERE spr.requested_by = $1
         AND s.restaurant_id = $2
       ORDER BY spr.created_at DESC`,
      [user.id, user.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Employee pickup requests GET error:", error);

    return NextResponse.json(
      { error: "Failed to load pickup requests" },
      { status: 500 }
    );
  }
}