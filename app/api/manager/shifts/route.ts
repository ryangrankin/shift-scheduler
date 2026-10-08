import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { checkAvailabilityConflicts } from "@/lib/availability-conflicts";

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

    const result = await pool.query(
      `SELECT
         s.id,
         s.user_id,
         s.position_id,
         s.start_time::text AS start_time,
         s.end_time::text AS end_time,
         s.status,
         s.availability_override,
         p.name AS position_name,
         u.first_name,
         u.last_name
       FROM shifts s
       JOIN positions p ON s.position_id = p.id
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.restaurant_id = $1
       ORDER BY s.start_time ASC`,
      [manager.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Manager shifts GET error:", error);

    return NextResponse.json(
      { error: "Failed to load shifts" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
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

    const body = await request.json();

    const {
      userId,
      positionId,
      startTime,
      endTime,
      overrideAvailability = false,
      overrideReason,
    } = body;

    const timestampPattern =
      /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

    // Validate shift information.
    if (
      (userId !== null &&
        (!Number.isSafeInteger(userId) || userId <= 0)) ||
      !Number.isSafeInteger(positionId) ||
      positionId <= 0 ||
      typeof startTime !== "string" ||
      typeof endTime !== "string" ||
      !timestampPattern.test(startTime) ||
      !timestampPattern.test(endTime) ||
      startTime.slice(0, 10) !== endTime.slice(0, 10) ||
      startTime >= endTime ||
      Number.isNaN(new Date(startTime).getTime()) ||
      Number.isNaN(new Date(endTime).getTime())
    ) {
      return NextResponse.json(
        { error: "Invalid shift information" },
        { status: 400 }
      );
    }

    if (
      typeof overrideAvailability !== "boolean" ||
      (overrideReason !== undefined &&
        typeof overrideReason !== "string")
    ) {
      return NextResponse.json(
        { error: "Invalid override information" },
        { status: 400 }
      );
    }

    // Confirm position belongs to this restaurant.
    const positionResult = await pool.query(
      `SELECT id
       FROM positions
       WHERE id = $1 AND restaurant_id = $2`,
      [positionId, manager.restaurant_id]
    );

    if (positionResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Position not found in this restaurant" },
        { status: 400 }
      );
    }

    let hasConflict = false;
    let reason: string | null = null;

    // Employee-specific checks only apply to assigned shifts.
    if (userId !== null) {
      // Confirm employee belongs to this restaurant.
      const employeeResult = await pool.query(
        `SELECT id
         FROM users
         WHERE id = $1 AND restaurant_id = $2`,
        [userId, manager.restaurant_id]
      );

      if (employeeResult.rows.length === 0) {
        return NextResponse.json(
          { error: "Employee not found in this restaurant" },
          { status: 400 }
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
        [userId, startTime, endTime]
      );

      if (overlapResult.rows.length > 0) {
        return NextResponse.json(
          {
            error: "This employee already has an overlapping shift",
          },
          { status: 409 }
        );
      }

      // Check employee availability.
      const conflicts = await checkAvailabilityConflicts({
        userId,
        startTime,
        endTime,
      });

      hasConflict = conflicts.length > 0;

      if (hasConflict && !overrideAvailability) {
        return NextResponse.json(
          {
            error: "Availability conflict detected",
            requiresOverride: true,
            conflicts,
          },
          { status: 409 }
        );
      }

      const providedReason =
        typeof overrideReason === "string"
          ? overrideReason.trim()
          : "";

      if (hasConflict && providedReason.length < 5) {
        return NextResponse.json(
          {
            error: "Provide an override reason (at least 5 characters).",
            requiresOverride: true,
            conflicts,
          },
          { status: 400 }
        );
      }

      if (hasConflict) {
        reason = providedReason;
      }
    }

    // Create a draft shift, assigned or unassigned.
    const result = await pool.query(
      `INSERT INTO shifts (
         restaurant_id,
         user_id,
         position_id,
         start_time,
         end_time,
         status,
         availability_override,
         override_reason,
         overridden_by,
         overridden_at
       )
       VALUES (
         $1, $2, $3,
         $4::timestamp, $5::timestamp,
         'draft',
         $6, $7, $8, $9
       )
       RETURNING
         id,
         user_id,
         position_id,
         start_time::text AS start_time,
         end_time::text AS end_time,
         status,
         availability_override`,
      [
        manager.restaurant_id,
        userId,
        positionId,
        startTime,
        endTime,
        hasConflict && overrideAvailability,
        reason,
        hasConflict ? manager.id : null,
        hasConflict ? new Date() : null,
      ]
    );

    return NextResponse.json(result.rows[0], {
      status: 201,
    });
  } catch (error) {
    console.error("Manager shifts POST error:", error);

    return NextResponse.json(
      { error: "Failed to create shift" },
      { status: 500 }
    );
  }
}