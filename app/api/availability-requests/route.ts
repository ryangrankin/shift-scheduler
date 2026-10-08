
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
      `SELECT id, request_date::text AS request_date,
              start_time, end_time, is_unavailable,
              reason, status, created_at
       FROM availability_requests
       WHERE user_id = $1
       ORDER BY request_date DESC, created_at DESC`,
      [session.user.id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Availability requests GET error:", error);

    return NextResponse.json(
      { error: "Failed to load requests" },
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

    const {
      requestDate,
      startTime,
      endTime,
      isUnavailable,
      reason,
    } = body;

    if (
      typeof requestDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(requestDate) ||
      !Number.isFinite(Date.parse(requestDate)) ||
      typeof isUnavailable !== "boolean" ||
      (reason !== undefined &&
        (typeof reason !== "string" || reason.length > 1000))
    ) {
      return NextResponse.json(
        { error: "Invalid request information" },
        { status: 400 }
      );
    }

    const todayInHawaii = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Honolulu",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const minimumDate = new Date(
      `${todayInHawaii}T00:00:00Z`
    );

    minimumDate.setUTCDate(minimumDate.getUTCDate() + 14);

    const earliestAllowed = minimumDate
      .toISOString()
      .slice(0, 10);

    if (requestDate < earliestAllowed) {
      return NextResponse.json(
        {
          error:
            "Availability requests must be submitted at least 14 days in advance.",
        },
        { status: 400 }
      );
    }

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (
      !isUnavailable &&
      (typeof startTime !== "string" ||
        typeof endTime !== "string" ||
        !timePattern.test(startTime) ||
        !timePattern.test(endTime) ||
        startTime >= endTime)
    ) {
      return NextResponse.json(
        { error: "Invalid time range" },
        { status: 400 }
      );
    }

    const existing = await pool.query(
      `SELECT id FROM availability_requests
       WHERE user_id = $1
         AND request_date = $2
         AND status IN ('pending', 'approved')
       LIMIT 1`,
      [session.user.id, requestDate]
    );

    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "You already have an active request for this date" },
        { status: 409 }
      );
    }

    const result = await pool.query(
      `INSERT INTO availability_requests
       (user_id, request_date, start_time, end_time,
        is_unavailable, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, request_date::text AS request_date,
                 start_time, end_time, is_unavailable,
                 reason, status`,
      [
        session.user.id,
        requestDate,
        isUnavailable ? null : startTime,
        isUnavailable ? null : endTime,
        isUnavailable,
        reason?.trim() || null,
      ]
    );

    return NextResponse.json(result.rows[0], {
      status: 201,
    });
  } catch (error) {
    console.error("Availability requests POST error:", error);

    return NextResponse.json(
      { error: "Failed to submit request" },
      { status: 500 }
    );
  }
}
