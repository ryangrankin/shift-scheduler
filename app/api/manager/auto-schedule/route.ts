import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { checkAvailabilityConflicts } from "@/lib/availability-conflicts";

type Shift = {
  id: number;
  position_id: number;
  position_name: string;
  start_time: string;
  end_time: string;
};

type Employee = {
  id: number;
  position_id: number;
  date_of_birth: string | null;
  liquor_card_type: "none" | "bartender" | "manager";
  liquor_card_expires_on: string | null;
};

type AssignedShift = {
  userId: number;
  start: string;
  end: string;
};

function hoursBetween(start: string, end: string) {
  return (
    (new Date(end.replace(" ", "T")).getTime() -
      new Date(start.replace(" ", "T")).getTime()) /
    3600000
  );
}

function dateKey(value: string) {
  return value.replace(" ", "T").slice(0, 10);
}

function getAge(dateOfBirth: string | null) {
  if (!dateOfBirth) return null;

  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const today = new Date();

  let age = today.getUTCFullYear() - birth.getUTCFullYear();

  const birthdayPassed =
    today.getUTCMonth() > birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() &&
      today.getUTCDate() >= birth.getUTCDate());

  if (!birthdayPassed) {
    age--;
  }

  return age;
}

function hasValidManagerCard(employee: Employee) {
  if (employee.liquor_card_type !== "manager") {
    return false;
  }

  if (!employee.liquor_card_expires_on) {
    return false;
  }

  const expiration = new Date(
    `${employee.liquor_card_expires_on}T23:59:59Z`
  );

  return expiration >= new Date();
}

function overlaps(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
) {
  return (
    firstStart < secondEnd &&
    firstEnd > secondStart
  );
}

function worksEntireShift(
  assigned: AssignedShift,
  shift: Shift
) {
  return (
    assigned.start <= shift.start_time &&
    assigned.end >= shift.end_time
  );
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const weekStart = body?.weekStart;

  if (
    typeof weekStart !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)
  ) {
    return NextResponse.json(
      {
        error:
          "A valid weekStart date is required (YYYY-MM-DD)",
      },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ------------------------------------------------------------
    // Verify manager
    // ------------------------------------------------------------

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

    // Prevent two auto-scheduling operations from running
    // against the same restaurant at the same time.
    await client.query(
      `SELECT id
       FROM restaurants
       WHERE id = $1
       FOR UPDATE`,
      [manager.restaurant_id]
    );

    // ------------------------------------------------------------
    // Get unassigned draft shifts
    // ------------------------------------------------------------

    const shiftsResult = await client.query(
      `SELECT
         s.id,
         s.position_id,
         p.name AS position_name,
         s.start_time::text AS start_time,
         s.end_time::text AS end_time
       FROM shifts s
       JOIN positions p
         ON p.id = s.position_id
       WHERE s.restaurant_id = $1
         AND s.user_id IS NULL
         AND s.status = 'draft'
         AND s.start_time >= $2::date
         AND s.start_time < $2::date + INTERVAL '7 days'
         AND s.start_time > LOCALTIMESTAMP
       ORDER BY s.start_time, s.id
       FOR UPDATE`,
      [manager.restaurant_id, weekStart]
    );

    const shifts = shiftsResult.rows as Shift[];

    // ------------------------------------------------------------
    // Get active employees and their positions
    // ------------------------------------------------------------

    const employeesResult = await client.query(
      `SELECT
         u.id,
         up.position_id,
         u.date_of_birth::text AS date_of_birth,
         u.liquor_card_type,
         u.liquor_card_expires_on::text AS liquor_card_expires_on
       FROM users u
       JOIN user_positions up
         ON up.user_id = u.id
       WHERE u.restaurant_id = $1
         AND u.role = 'employee'
         AND u.is_active = TRUE`,
      [manager.restaurant_id]
    );

    const employees =
      employeesResult.rows as Employee[];

    // ------------------------------------------------------------
    // Get ALL existing assignments for the week
    // ------------------------------------------------------------

    const existingResult = await client.query(
      `SELECT
         user_id,
         start_time::text AS start_time,
         end_time::text AS end_time
       FROM shifts
       WHERE restaurant_id = $1
         AND user_id IS NOT NULL
         AND status != 'cancelled'
         AND start_time < $2::date + INTERVAL '7 days'
         AND end_time > $2::date`,
      [manager.restaurant_id, weekStart]
    );

    const assigned: AssignedShift[] =
      existingResult.rows.map((row) => ({
        userId: row.user_id,
        start: row.start_time,
        end: row.end_time,
      }));

    // ------------------------------------------------------------
    // Track fairness
    // ------------------------------------------------------------

    const hours = new Map<number, number>();
    const shiftCounts = new Map<number, number>();
    const workingDays = new Map<number, Set<string>>();

    for (const shift of assigned) {
      const shiftHours = hoursBetween(
        shift.start,
        shift.end
      );

      hours.set(
        shift.userId,
        (hours.get(shift.userId) ?? 0) + shiftHours
      );

      shiftCounts.set(
        shift.userId,
        (shiftCounts.get(shift.userId) ?? 0) + 1
      );

      if (!workingDays.has(shift.userId)) {
        workingDays.set(
          shift.userId,
          new Set<string>()
        );
      }

      workingDays
        .get(shift.userId)!
        .add(dateKey(shift.start));
    }

    let assignedCount = 0;
    let unfilledCount = 0;

    // ------------------------------------------------------------
    // Process shifts in chronological order
    // ------------------------------------------------------------

    for (const shift of shifts) {
      const candidates = employees.filter(
        (employee) =>
          employee.position_id === shift.position_id
      );

      const eligible: number[] = [];

      for (const employee of candidates) {
        // --------------------------------------------------------
        // 1. Age / liquor rule
        // --------------------------------------------------------

        const age = getAge(employee.date_of_birth);

        const isFOH =
          shift.position_name.toLowerCase() ===
          "front of house";

        if (isFOH) {
          // Missing DOB is treated conservatively as under 21.
          const under21 = age === null || age < 21;

          if (under21) {
            /*
             * Under-21 FOH employees require a manager-card
             * holder to be working for the ENTIRE shift.
             *
             * First find existing manager-card coverage.
             */
            const hasManagerCoverage =
              employees.some((managerEmployee) => {
                if (
                  managerEmployee.id === employee.id
                ) {
                  return false;
                }

                if (
                  !hasValidManagerCard(
                    managerEmployee
                  )
                ) {
                  return false;
                }

                return assigned.some(
                  (existingShift) =>
                    existingShift.userId ===
                      managerEmployee.id &&
                    worksEntireShift(
                      existingShift,
                      shift
                    )
                );
              });

            if (!hasManagerCoverage) {
              continue;
            }
          }
        }

        // --------------------------------------------------------
        // 2. Prevent overlapping shifts
        // --------------------------------------------------------

        const hasOverlap = assigned.some(
          (existing) =>
            existing.userId === employee.id &&
            overlaps(
              existing.start,
              existing.end,
              shift.start_time,
              shift.end_time
            )
        );

        if (hasOverlap) {
          continue;
        }

        // --------------------------------------------------------
        // 3. Strict availability
        // --------------------------------------------------------

        const conflicts =
          await checkAvailabilityConflicts({
            userId: employee.id,
            startTime: shift.start_time
              .replace(" ", "T")
              .slice(0, 16),
            endTime: shift.end_time
              .replace(" ", "T")
              .slice(0, 16),
          });

        if (conflicts.length > 0) {
          continue;
        }

        eligible.push(employee.id);
      }

      // ----------------------------------------------------------
      // Nobody qualifies
      // ----------------------------------------------------------

      if (eligible.length === 0) {
        unfilledCount++;
        continue;
      }

      // ----------------------------------------------------------
      // Fairness ranking
      //
      // 1. Fewest weekly hours
      // 2. Fewest shifts
      // 3. Prefer someone who is NOT already working that day
      // 4. Stable ID tie-breaker
      // ----------------------------------------------------------

      const shiftDate = dateKey(shift.start_time);

      eligible.sort((a, b) => {
        const hoursDifference =
          (hours.get(a) ?? 0) -
          (hours.get(b) ?? 0);

        if (hoursDifference !== 0) {
          return hoursDifference;
        }

        const shiftCountDifference =
          (shiftCounts.get(a) ?? 0) -
          (shiftCounts.get(b) ?? 0);

        if (shiftCountDifference !== 0) {
          return shiftCountDifference;
        }

        const aWorksThatDay =
          workingDays.get(a)?.has(shiftDate) ?? false;

        const bWorksThatDay =
          workingDays.get(b)?.has(shiftDate) ?? false;

        if (
          aWorksThatDay !== bWorksThatDay
        ) {
          return aWorksThatDay ? 1 : -1;
        }

        return a - b;
      });

      const selectedUserId = eligible[0];

      // ----------------------------------------------------------
      // Assign the shift
      // ----------------------------------------------------------

      const updateResult = await client.query(
        `UPDATE shifts
         SET user_id = $1
         WHERE id = $2
           AND restaurant_id = $3
           AND user_id IS NULL
           AND status = 'draft'
         RETURNING id`,
        [
          selectedUserId,
          shift.id,
          manager.restaurant_id,
        ]
      );

      if (updateResult.rows.length === 0) {
        continue;
      }

      assigned.push({
        userId: selectedUserId,
        start: shift.start_time,
        end: shift.end_time,
      });

      hours.set(
        selectedUserId,
        (hours.get(selectedUserId) ?? 0) +
          hoursBetween(
            shift.start_time,
            shift.end_time
          )
      );

      shiftCounts.set(
        selectedUserId,
        (shiftCounts.get(selectedUserId) ?? 0) + 1
      );

      if (!workingDays.has(selectedUserId)) {
        workingDays.set(
          selectedUserId,
          new Set<string>()
        );
      }

      workingDays
        .get(selectedUserId)!
        .add(shiftDate);

      assignedCount++;
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      assignedCount,
      unfilledCount,
      message:
        `Assigned ${assignedCount} shift(s). ` +
        `${unfilledCount} remain unassigned.`,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "Auto scheduling error:",
      error
    );

    return NextResponse.json(
      {
        error: "Failed to generate schedule",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}