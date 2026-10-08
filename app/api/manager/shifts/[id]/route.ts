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

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const pattern =
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

  if (!pattern.test(value)) return false;

  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  const parsed = new Date(
    Date.UTC(year, month - 1, day, hour, minute)
  );

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute
  );
}

// ------------------------------------------------------------
// EDIT DRAFT SHIFT
// ------------------------------------------------------------

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

    if (
      !Number.isSafeInteger(shiftId) ||
      shiftId <= 0
    ) {
      return NextResponse.json(
        { error: "Invalid shift ID" },
        { status: 400 }
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

    // ----------------------------------------------------------
    // userId MAY be null because this can be an open shift.
    // ----------------------------------------------------------

    if (
      userId !== null &&
      (
        !Number.isSafeInteger(userId) ||
        userId <= 0
      )
    ) {
      return NextResponse.json(
        { error: "Invalid employee" },
        { status: 400 }
      );
    }

    if (
      !Number.isSafeInteger(positionId) ||
      positionId <= 0 ||
      !validTimestamp(startTime) ||
      !validTimestamp(endTime) ||
      startTime.slice(0, 10) !== endTime.slice(0, 10) ||
      startTime >= endTime
    ) {
      return NextResponse.json(
        { error: "Invalid shift information" },
        { status: 400 }
      );
    }

    if (
      typeof overrideAvailability !== "boolean" ||
      (
        overrideReason !== undefined &&
        typeof overrideReason !== "string"
      )
    ) {
      return NextResponse.json(
        { error: "Invalid override information" },
        { status: 400 }
      );
    }

    // ----------------------------------------------------------
    // Confirm the draft belongs to this restaurant.
    // ----------------------------------------------------------

    const existingShift = await pool.query(
      `SELECT id
       FROM shifts
       WHERE id = $1
         AND restaurant_id = $2
         AND status = 'draft'`,
      [shiftId, manager.restaurant_id]
    );

    if (existingShift.rows.length === 0) {
      return NextResponse.json(
        { error: "Draft shift not found" },
        { status: 404 }
      );
    }

    // ----------------------------------------------------------
    // Verify position.
    // ----------------------------------------------------------

    const positionResult = await pool.query(
      `SELECT id, name
       FROM positions
       WHERE id = $1
         AND restaurant_id = $2`,
      [positionId, manager.restaurant_id]
    );

    if (positionResult.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "Position not found in this restaurant",
        },
        { status: 400 }
      );
    }

    // ----------------------------------------------------------
    // Open/unassigned shift
    //
    // No employee-specific checks are necessary.
    // ----------------------------------------------------------

    if (userId === null) {
      const result = await pool.query(
        `UPDATE shifts
         SET user_id = NULL,
             position_id = $1,
             start_time = $2::timestamp,
             end_time = $3::timestamp,
             availability_override = FALSE,
             override_reason = NULL,
             overridden_by = NULL,
             overridden_at = NULL
         WHERE id = $4
           AND restaurant_id = $5
           AND status = 'draft'
         RETURNING
           id,
           user_id,
           position_id,
           start_time::text AS start_time,
           end_time::text AS end_time,
           status,
           availability_override`,
        [
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
    }

    // ----------------------------------------------------------
    // Verify employee belongs to restaurant and is active.
    // ----------------------------------------------------------

    const employeeResult = await pool.query(
      `SELECT
         id,
         date_of_birth,
         liquor_card_type,
         liquor_card_expires_on
       FROM users
       WHERE id = $1
         AND restaurant_id = $2
         AND role = 'employee'
         AND is_active = TRUE`,
      [userId, manager.restaurant_id]
    );

    if (employeeResult.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "Employee not found or inactive",
        },
        { status: 400 }
      );
    }

    const employee = employeeResult.rows[0];

    // ----------------------------------------------------------
    // Make sure employee is assigned to this position.
    // ----------------------------------------------------------

    const positionAssignment = await pool.query(
      `SELECT 1
       FROM user_positions
       WHERE user_id = $1
         AND position_id = $2`,
      [userId, positionId]
    );

    if (positionAssignment.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "Employee is not assigned to this position",
        },
        { status: 400 }
      );
    }

    // ----------------------------------------------------------
    // FOH liquor-card rule.
    //
    // Under 21 can still work BOH.
    //
    // Under 21 working FOH requires manager-card coverage.
    //
    // We check existing assigned shifts for a valid
    // manager-card holder covering the ENTIRE shift.
    // ----------------------------------------------------------

    const positionName =
      positionResult.rows[0].name
        .toLowerCase()
        .trim();

    if (positionName === "front of house") {
      let age: number | null = null;

      if (employee.date_of_birth) {
        const birthDate = new Date(
          `${employee.date_of_birth
            .toISOString()
            .slice(0, 10)}T00:00:00Z`
        );

        const today = new Date();

        age =
          today.getUTCFullYear() -
          birthDate.getUTCFullYear();

        const birthdayPassed =
          today.getUTCMonth() >
            birthDate.getUTCMonth() ||
          (
            today.getUTCMonth() ===
              birthDate.getUTCMonth() &&
            today.getUTCDate() >=
              birthDate.getUTCDate()
          );

        if (!birthdayPassed) {
          age--;
        }
      }

      // Missing DOB is treated conservatively as under 21.
      const under21 =
        age === null || age < 21;

      if (under21) {
        const managerCoverageResult =
          await pool.query(
            `SELECT 1
             FROM shifts s
             JOIN users u
               ON u.id = s.user_id
             WHERE s.restaurant_id = $1
               AND s.id != $2
               AND s.user_id IS NOT NULL
               AND s.status != 'cancelled'
               AND s.start_time <= $3::timestamp
               AND s.end_time >= $4::timestamp
               AND u.role IN ('manager', 'owner')
               AND u.is_active = TRUE
               AND u.liquor_card_type = 'manager'
               AND (
                 u.liquor_card_expires_on IS NULL
                 OR u.liquor_card_expires_on >= CURRENT_DATE
               )
             LIMIT 1`,
            [
              manager.restaurant_id,
              shiftId,
              startTime,
              endTime,
            ]
          );

        if (
          managerCoverageResult.rows.length === 0
        ) {
          return NextResponse.json(
            {
              error:
                "This employee is under 21 and cannot be scheduled for Front of House without a manager-card holder covering the entire shift.",
            },
            { status: 409 }
          );
        }
      }
    }

    // ----------------------------------------------------------
    // Prevent overlapping shifts.
    // ----------------------------------------------------------

    const overlapResult = await pool.query(
      `SELECT id
       FROM shifts
       WHERE user_id = $1
         AND id != $2
         AND status != 'cancelled'
         AND start_time < $4::timestamp
         AND end_time > $3::timestamp
       LIMIT 1`,
      [
        userId,
        shiftId,
        startTime,
        endTime,
      ]
    );

    if (overlapResult.rows.length > 0) {
      return NextResponse.json(
        {
          error:
            "This employee already has an overlapping shift",
        },
        { status: 409 }
      );
    }

    // ----------------------------------------------------------
    // Check availability.
    // ----------------------------------------------------------

    const conflicts =
      await checkAvailabilityConflicts({
        userId,
        startTime,
        endTime,
      });

    const hasConflict =
      conflicts.length > 0;

    const reason =
      typeof overrideReason === "string"
        ? overrideReason.trim()
        : "";

    if (
      hasConflict &&
      !overrideAvailability
    ) {
      return NextResponse.json(
        {
          error:
            "Availability conflict detected",
          requiresOverride: true,
          conflicts,
        },
        { status: 409 }
      );
    }

    if (
      hasConflict &&
      reason.length < 5
    ) {
      return NextResponse.json(
        {
          error:
            "Override reason must be at least 5 characters",
          requiresOverride: true,
          conflicts,
        },
        { status: 400 }
      );
    }

    // ----------------------------------------------------------
    // Update the shift.
    // ----------------------------------------------------------

    const result = await pool.query(
      `UPDATE shifts
       SET user_id = $1,
           position_id = $2,
           start_time = $3::timestamp,
           end_time = $4::timestamp,
           availability_override = $7,
           override_reason = $8,
           overridden_by = $9,
           overridden_at = CASE
             WHEN $7 THEN CURRENT_TIMESTAMP
             ELSE NULL
           END
       WHERE id = $5
         AND restaurant_id = $6
         AND status = 'draft'
       RETURNING
         id,
         user_id,
         position_id,
         start_time::text AS start_time,
         end_time::text AS end_time,
         status,
         availability_override`,
      [
        userId,
        positionId,
        startTime,
        endTime,
        shiftId,
        manager.restaurant_id,
        hasConflict && overrideAvailability,
        hasConflict ? reason : null,
        hasConflict ? manager.id : null,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Draft shift not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      result.rows[0]
    );
  } catch (error) {
    console.error(
      "Manager shift PUT error:",
      error
    );

    return NextResponse.json(
      { error: "Failed to update shift" },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// DELETE DRAFT SHIFT
// ------------------------------------------------------------

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

  try {
    const manager = await getManager(
      session.user.id
    );

    if (!manager) {
      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const shiftId = Number(id);

    if (
      !Number.isSafeInteger(shiftId) ||
      shiftId <= 0
    ) {
      return NextResponse.json(
        { error: "Invalid shift ID" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `DELETE FROM shifts
       WHERE id = $1
         AND restaurant_id = $2
         AND status = 'draft'
       RETURNING id`,
      [
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

    return NextResponse.json({
      message:
        "Draft shift deleted successfully",
    });
  } catch (error) {
    console.error(
      "Manager shift DELETE error:",
      error
    );

    return NextResponse.json(
      { error: "Failed to delete shift" },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// PUBLISH DRAFT SHIFT
// ------------------------------------------------------------

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
    const manager = await getManager(
      session.user.id
    );

    if (!manager) {
      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const shiftId = Number(id);

    if (
      !Number.isSafeInteger(shiftId) ||
      shiftId <= 0
    ) {
      return NextResponse.json(
        { error: "Invalid shift ID" },
        { status: 400 }
      );
    }

    const shiftResult = await pool.query(
      `SELECT
         id,
         user_id,
         start_time::text AS start_time,
         end_time::text AS end_time,
         availability_override
       FROM shifts
       WHERE id = $1
         AND restaurant_id = $2
         AND status = 'draft'`,
      [
        shiftId,
        manager.restaurant_id,
      ]
    );

    if (shiftResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Draft shift not found" },
        { status: 404 }
      );
    }

    const shift = shiftResult.rows[0];

    // ----------------------------------------------------------
    // Availability only applies when assigned.
    // ----------------------------------------------------------

    const conflicts =
      shift.user_id === null
        ? []
        : await checkAvailabilityConflicts({
            userId: shift.user_id,
            startTime:
              shift.start_time
                .replace(" ", "T")
                .slice(0, 16),
            endTime:
              shift.end_time
                .replace(" ", "T")
                .slice(0, 16),
          });

    const hasConflict =
      conflicts.length > 0;

    if (
      hasConflict &&
      !shift.availability_override
    ) {
      return NextResponse.json(
        {
          error:
            "Availability conflict detected",
          requiresOverride: true,
          conflicts,
        },
        { status: 409 }
      );
    }

    // ----------------------------------------------------------
    // Don't publish overlapping assigned shifts.
    // ----------------------------------------------------------

    if (shift.user_id !== null) {
      const overlapResult =
        await pool.query(
          `SELECT id
           FROM shifts
           WHERE user_id = $1
             AND id != $2
             AND status != 'cancelled'
             AND start_time < $4::timestamp
             AND end_time > $3::timestamp
           LIMIT 1`,
          [
            shift.user_id,
            shiftId,
            shift.start_time,
            shift.end_time,
          ]
        );

      if (overlapResult.rows.length > 0) {
        return NextResponse.json(
          {
            error:
              "This employee has an overlapping shift",
          },
          { status: 409 }
        );
      }
    }

    const result = await pool.query(
      `UPDATE shifts
       SET status = 'published'
       WHERE id = $1
         AND restaurant_id = $2
         AND status = 'draft'
       RETURNING
         id,
         user_id,
         position_id,
         start_time::text AS start_time,
         end_time::text AS end_time,
         status,
         availability_override`,
      [
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

    return NextResponse.json({
      message:
        "Shift published successfully",
      shift: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Manager shift PATCH error:",
      error
    );

    return NextResponse.json(
      { error: "Failed to publish shift" },
      { status: 500 }
    );
  }
}