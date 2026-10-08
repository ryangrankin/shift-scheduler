import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  const employeeId = Number(id);

  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
    return NextResponse.json(
      { error: "Invalid employee ID" },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify that the current user is an active manager or owner.
    const managerResult = await client.query(
      `SELECT restaurant_id
       FROM users
       WHERE id = $1
         AND role IN ('manager', 'owner')
         AND is_active = TRUE`,
      [session.user.id]
    );

    const manager = managerResult.rows[0];

    if (!manager) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    // Verify that the employee belongs to this restaurant.
    const employeeResult = await client.query(
      `SELECT id
       FROM users
       WHERE id = $1
         AND restaurant_id = $2
         AND role = 'employee'
         AND is_active = TRUE
       FOR UPDATE`,
      [employeeId, manager.restaurant_id]
    );

    if (employeeResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Active employee not found" },
        { status: 404 }
      );
    }

    // Cancel pickup requests made by the departing employee.
    await client.query(
      `UPDATE shift_pickup_requests
       SET status = 'cancelled'
       WHERE requested_by = $1
         AND status = 'pending'`,
      [employeeId]
    );

    // Cancel requests from others for shifts the employee posted.
    await client.query(
      `UPDATE shift_pickup_requests spr
       SET status = 'cancelled'
       FROM shifts s
       WHERE spr.shift_id = s.id
         AND s.user_id = $1
         AND s.start_time > LOCALTIMESTAMP
         AND spr.status = 'pending'`,
      [employeeId]
    );

    // Release upcoming shifts into the available-shifts pool.
    // Published shifts remain published and become immediately available.
    const releasedResult = await client.query(
      `UPDATE shifts
       SET user_id = NULL,
           pickup_status = 'not_posted'
       WHERE user_id = $1
         AND restaurant_id = $2
         AND start_time > LOCALTIMESTAMP
         AND status IN ('draft', 'published')
       RETURNING id`,
      [employeeId, manager.restaurant_id]
    );

    // Deactivate the employee.
    await client.query(
      `UPDATE users
       SET is_active = FALSE
       WHERE id = $1`,
      [employeeId]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Employee removed successfully",
      releasedShifts: releasedResult.rowCount ?? 0,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Remove employee error:", error);

    return NextResponse.json(
      { error: "Failed to remove employee" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}