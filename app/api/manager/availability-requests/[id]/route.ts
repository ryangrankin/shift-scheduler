
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(
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

  const { id } = await params;
  const requestId = Number(id);

  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return NextResponse.json(
      { error: "Invalid request ID" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { status } = body;

    if (status !== "approved" && status !== "denied") {
      return NextResponse.json(
        { error: "Status must be approved or denied" },
        { status: 400 }
      );
    }

    // Check manager permissions directly in the database.
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

    // Only update pending requests from the manager's restaurant.
    const result = await pool.query(
      `UPDATE availability_requests ar
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = CURRENT_TIMESTAMP
       FROM users employee
       WHERE ar.id = $3
         AND ar.user_id = employee.id
         AND employee.restaurant_id = $4
         AND ar.status = 'pending'
       RETURNING
         ar.id,
         ar.request_date::text AS request_date,
         ar.status,
         ar.reviewed_by,
         ar.reviewed_at`,
      [
        status,
        manager.id,
        requestId,
        manager.restaurant_id,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "Pending request not found or you do not have permission to review it",
        },
        { status: 404 }
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Manager availability request PATCH error:", error);

    return NextResponse.json(
      { error: "Failed to review availability request" },
      { status: 500 }
    );
  }
}
