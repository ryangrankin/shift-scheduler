
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

  const { id } = await params;
  const availabilityId = Number(id);

  if (!Number.isSafeInteger(availabilityId) || availabilityId <= 0) {
    return NextResponse.json(
      { error: "Invalid availability ID" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { dayOfWeek, startTime, endTime } = body;

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (
      !Number.isInteger(dayOfWeek) ||
      dayOfWeek < 0 ||
      dayOfWeek > 6 ||
      typeof startTime !== "string" ||
      typeof endTime !== "string" ||
      !timePattern.test(startTime) ||
      !timePattern.test(endTime) ||
      startTime >= endTime
    ) {
      return NextResponse.json(
        { error: "Invalid availability information" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `UPDATE availability
       SET day_of_week = $1,
           start_time = $2,
           end_time = $3
       WHERE id = $4 AND user_id = $5
       RETURNING id, day_of_week, start_time, end_time`,
      [
        dayOfWeek,
        startTime,
        endTime,
        availabilityId,
        session.user.id,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Availability not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Availability PUT error:", error);

    return NextResponse.json(
      { error: "Failed to update availability" },
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

  const { id } = await params;
  const availabilityId = Number(id);

  if (!Number.isSafeInteger(availabilityId) || availabilityId <= 0) {
    return NextResponse.json(
      { error: "Invalid availability ID" },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query(
      `DELETE FROM availability
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [availabilityId, session.user.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Availability not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "Availability deleted successfully",
    });
  } catch (error) {
    console.error("Availability DELETE error:", error);

    return NextResponse.json(
      { error: "Failed to delete availability" },
      { status: 500 }
    );
  }
}
