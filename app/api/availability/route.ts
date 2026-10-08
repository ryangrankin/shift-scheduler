
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const result = await pool.query(
      `SELECT id, day_of_week, start_time, end_time
       FROM availability
       WHERE user_id = $1
       ORDER BY day_of_week, start_time`,
      [session.user.id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Availability GET error:", error);

    return NextResponse.json(
      { error: "Failed to load availability" },
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
    const body = await request.json();
    const { dayOfWeek, startTime, endTime } = body;

    if (
      !Number.isInteger(dayOfWeek) ||
      dayOfWeek < 0 ||
      dayOfWeek > 6 ||
      typeof startTime !== "string" ||
      typeof endTime !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
      startTime >= endTime
    ) {
      return NextResponse.json(
        { error: "Invalid availability information" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `INSERT INTO availability
       (user_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING id, day_of_week, start_time, end_time`,
      [session.user.id, dayOfWeek, startTime, endTime]
    );

    return NextResponse.json(result.rows[0], {
      status: 201,
    });
  } catch (error) {
    console.error("Availability POST error:", error);

    return NextResponse.json(
      { error: "Failed to save availability" },
      { status: 500 }
    );
  }
}

