
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { checkAvailabilityConflicts } from "@/lib/availability-conflicts";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getManager(userId: string) {
  const result = await pool.query(
    `SELECT id, restaurant_id, role
     FROM users
     WHERE id = $1`,
    [userId]
  );

  const user = result.rows[0];

  if (!user || !["manager", "owner"].includes(user.role)) {
    return null;
  }

  return user;
}

export async function PUT(
  request: Request,
  { params }: RouteContext
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const manager = await getManager(session.user.id);

  if (!manager) {
    return NextResponse.json(
      { error: "Manager access required" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const shiftId = Number(id);

  if (!Number.isSafeInteger(shiftId) || shiftId <= 0) {
    return NextResponse.json(
      { error: "Invalid shift ID" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { userId, positionId, startTime, endTime } = body;

    const timestampPattern =
      /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

    if (
      !Number.isSafeInteger(userId) ||
      !Number.isSafeInteger(positionId) ||
      userId <= 0 ||
      positionId <= 0 ||
      typeof startTime !== "string" ||
      typeof endTime !== "string" ||
      !timestampPattern.test(startTime) ||
      !timestampPattern.test(endTime) ||
      startTime >= endTime ||
      Number.isNaN(new Date(startTime).getTime()) ||
      Number.isNaN(new Date(endTime).getTime())
    ) {
      return NextResponse.json(
        { error: "Invalid shift information" },
        { status: 400 }
      );
    }

    // Verify employee belongs to the manager's restaurant.
    const employeeResult = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND restaurant_id = $2`,
      [userId, manager.restaurant_id]
    );

    if (employeeResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Employee not found in this restaurant" },
        { status: 400 }
      );
    }

    // Verify position belongs to the manager's restaurant.
    const positionResult = await pool.query(
      `SELECT id FROM positions
       WHERE id = $1 AND restaurant_id = $2`,
      [positionId, manager.restaurant_id]
    );

    if (positionResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Position not found in this restaurant" },
        { status: 400 }
      );
    }

    // Prevent overlapping shifts, excluding the shift being edited.
    const overlapResult = await pool.query(
      `SELECT id FROM shifts
       WHERE user_id = $1
         AND id != $2
         AND status != 'cancelled'
         AND start_time < $4::timestamp
         AND end_time > $3::timestamp
       LIMIT 1`,
      [userId, shiftId, startTime, endTime]
    );

    if (overlapResult.rows.length > 0) {
      return NextResponse.json(
        { error: "This employee already has an overlapping shift" },
        { status: 409 }
      );
    }

    // Only draft shifts can be edited.
    const result = await pool.query(
      `UPDATE shifts
       SET user_id = $1,
           position_id = $2,
           start_time = $3::timestamp,
           end_time = $4::timestamp
       WHERE id = $5
         AND restaurant_id = $6
         AND status = 'draft'
       RETURNING id, user_id, position_id,
                 start_time, end_time, status`,
      [
        userId,
        positionId,
        startTime,
        endTime,
        shiftId,
        manager.restaurant_id,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Draft shift not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Manager shift PUT error:", error);

    return NextResponse.json(
      { error: "Failed to update shift" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const manager = await getManager(session.user.id);

  if (!manager) {
    return NextResponse.json(
      { error: "Manager access required" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const shiftId = Number(id);

  if (!Number.isSafeInteger(shiftId) || shiftId <= 0) {
    return NextResponse.json(
      { error: "Invalid shift ID" },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query(
      `DELETE FROM shifts
       WHERE id = $1
         AND restaurant_id = $2
         AND status = 'draft'
       RETURNING id`,
      [shiftId, manager.restaurant_id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Draft shift not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "Draft shift deleted successfully",
    });
  } catch (error) {
    console.error("Manager shift DELETE error:", error);

    return NextResponse.json(
      { error: "Failed to delete shift" },
      { status: 500 }
    );
  }
}


export async function PATCH(
  _request: Request,
  { params }: RouteContext
) {
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

    const { id } = await params;
    const shiftId = Number(id);

    if (!Number.isSafeInteger(shiftId) || shiftId <= 0) {
      return NextResponse.json(
        { error: "Invalid shift ID" },
        { status: 400 }
      );
    }

    // Only draft shifts belonging to this restaurant can be published.
    const result = await pool.query(
      `UPDATE shifts
       SET status = 'published'
       WHERE id = $1
         AND restaurant_id = $2
         AND status = 'draft'
       RETURNING id, user_id, position_id,
                 start_time, end_time, status`,
      [shiftId, manager.restaurant_id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          error: "Draft shift not found or already published",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "Shift published successfully",
      shift: result.rows[0],
    });
  } catch (error) {
    console.error("Manager shift PATCH error:", error);

    return NextResponse.json(
      { error: "Failed to publish shift" },
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

    if (
      !Number.isSafeInteger(userId) ||
      !Number.isSafeInteger(positionId) ||
      userId <= 0 ||
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

    // Confirm employee belongs to this restaurant.
    const employeeResult = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND restaurant_id = $2`,
      [userId, manager.restaurant_id]
    );

    if (employeeResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Employee not found in this restaurant" },
        { status: 400 }
      );
    }

    // Confirm position belongs to this restaurant.
    const positionResult = await pool.query(
      `SELECT id FROM positions
       WHERE id = $1 AND restaurant_id = $2`,
      [positionId, manager.restaurant_id]
    );

    if (positionResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Position not found in this restaurant" },
        { status: 400 }
      );
    }

    // Overlapping shifts cannot be overridden.
    const overlapResult = await pool.query(
      `SELECT id FROM shifts
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

    // Check approved and recurring availability.
    const conflicts = await checkAvailabilityConflicts({
      userId,
      startTime,
      endTime,
    });

    const hasConflict = conflicts.length > 0;
    const reason =
      typeof overrideReason === "string"
        ? overrideReason.trim()
        : "";

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

    if (hasConflict && reason.length < 5) {
      return NextResponse.json(
        {
          error: "Provide an override reason (at least 5 characters).",
          requiresOverride: true,
          conflicts,
        },
        { status: 400 }
      );
    }

    // Save the shift and any approved override information.
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
         start_time,
         end_time,
         status,
         availability_override`,
      [
        manager.restaurant_id,
        userId,
        positionId,
        startTime,
        endTime,
        hasConflict && overrideAvailability,
        hasConflict ? reason : null,
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

