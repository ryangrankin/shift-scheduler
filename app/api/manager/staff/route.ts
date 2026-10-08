
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";

type StaffUpdate = {
  userId?: unknown;
  positionIds?: unknown;
  dateOfBirth?: unknown;
  liquorCardType?: unknown;
  liquorCardExpiresOn?: unknown;
};

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

async function getManager(userId: string) {
  const result = await pool.query(
    `SELECT id, restaurant_id, role
     FROM users
     WHERE id = $1
       AND is_active = TRUE`,
    [userId]
  );

  const manager = result.rows[0];

  if (!manager || !["manager", "owner"].includes(manager.role)) {
    return null;
  }

  return manager;
}

// GET: Load staff members and their positions.
export async function GET() {
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

    const result = await pool.query(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.email,
         u.role,
         u.created_at,
         TO_CHAR(u.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
         u.liquor_card_type,
         TO_CHAR(
           u.liquor_card_expires_on,
           'YYYY-MM-DD'
         ) AS liquor_card_expires_on,
         COALESCE(
           ARRAY_AGG(p.name ORDER BY p.name)
             FILTER (WHERE p.id IS NOT NULL),
           ARRAY[]::text[]
         ) AS positions
       FROM users u
       LEFT JOIN user_positions up
         ON up.user_id = u.id
       LEFT JOIN positions p
         ON p.id = up.position_id
         AND p.restaurant_id = u.restaurant_id
       WHERE u.restaurant_id = $1
         AND u.is_active = TRUE
       GROUP BY
         u.id,
         u.first_name,
         u.last_name,
         u.email,
         u.role,
         u.created_at,
         u.date_of_birth,
         u.liquor_card_type,
         u.liquor_card_expires_on
       ORDER BY u.last_name, u.first_name`,
      [manager.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Staff management GET error:", error);

    return NextResponse.json(
      { error: "Failed to load staff" },
      { status: 500 }
    );
  }
}

// PATCH: Update employee positions and/or liquor-card information.
export async function PATCH(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: StaffUpdate;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }

  const {
    userId,
    positionIds,
    dateOfBirth,
    liquorCardType,
    liquorCardExpiresOn,
  } = body;

  if (
    typeof userId !== "number" ||
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    return NextResponse.json(
      { error: "Invalid staff member" },
      { status: 400 }
    );
  }

  const updatingPositions = positionIds !== undefined;

  const updatingProfile =
    dateOfBirth !== undefined ||
    liquorCardType !== undefined ||
    liquorCardExpiresOn !== undefined;

  if (!updatingPositions && !updatingProfile) {
    return NextResponse.json(
      { error: "No changes provided" },
      { status: 400 }
    );
  }

  if (updatingPositions) {
    if (
      !Array.isArray(positionIds) ||
      !positionIds.every(
        (id) =>
          typeof id === "number" &&
          Number.isSafeInteger(id) &&
          id > 0
      ) ||
      new Set(positionIds).size !== positionIds.length
    ) {
      return NextResponse.json(
        { error: "Invalid positions" },
        { status: 400 }
      );
    }
  }

  if (updatingProfile) {
    const validCardTypes = ["none", "bartender", "manager"];

    if (
      !(dateOfBirth === null || isValidDate(dateOfBirth)) ||
      typeof liquorCardType !== "string" ||
      !validCardTypes.includes(liquorCardType) ||
      !(
        liquorCardExpiresOn === null ||
        isValidDate(liquorCardExpiresOn)
      )
    ) {
      return NextResponse.json(
        { error: "Invalid employee profile information" },
        { status: 400 }
      );
    }

    if (
      dateOfBirth !== null &&
      dateOfBirth > new Date().toISOString().slice(0, 10)
    ) {
      return NextResponse.json(
        { error: "Date of birth cannot be in the future" },
        { status: 400 }
      );
    }

    if (
      (liquorCardType === "none" && liquorCardExpiresOn !== null) ||
      (liquorCardType !== "none" && liquorCardExpiresOn === null)
    ) {
      return NextResponse.json(
        {
          error:
            "A liquor card requires an expiration date. " +
            "Select None if the employee has no card.",
        },
        { status: 400 }
      );
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const managerResult = await client.query(
      `SELECT id, restaurant_id, role
       FROM users
       WHERE id = $1
         AND is_active = TRUE`,
      [session.user.id]
    );

    const manager = managerResult.rows[0];

    if (
      !manager ||
      !["manager", "owner"].includes(manager.role)
    ) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    const staffResult = await client.query(
      `SELECT id, role
       FROM users
       WHERE id = $1
         AND restaurant_id = $2
         AND is_active = TRUE
       FOR UPDATE`,
      [userId, manager.restaurant_id]
    );

    const staffMember = staffResult.rows[0];

    if (!staffMember) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Staff member not found" },
        { status: 404 }
      );
    }

    // Only employees can have their assigned positions changed.
    if (updatingPositions && staffMember.role !== "employee") {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Only employee positions can be edited here" },
        { status: 403 }
      );
    }

    // Only owners can edit another manager's profile.
    // Managers may edit their own liquor-card information.
    if (
      updatingProfile &&
      staffMember.role !== "employee" &&
      manager.role !== "owner" &&
      Number(manager.id) !== userId
    ) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "You cannot edit this manager's profile" },
        { status: 403 }
      );
    }

    if (updatingPositions && Array.isArray(positionIds)) {
      const positionsResult = await client.query(
        `SELECT id
         FROM positions
         WHERE restaurant_id = $1
           AND id = ANY($2::int[])`,
        [manager.restaurant_id, positionIds]
      );

      if (positionsResult.rows.length !== positionIds.length) {
        await client.query("ROLLBACK");

        return NextResponse.json(
          { error: "One or more positions are invalid" },
          { status: 400 }
        );
      }

      await client.query(
        `DELETE FROM user_positions
         WHERE user_id = $1`,
        [userId]
      );

      for (const positionId of positionIds) {
        await client.query(
          `INSERT INTO user_positions (user_id, position_id)
           VALUES ($1, $2)`,
          [userId, positionId]
        );
      }
    }

    if (updatingProfile) {
      await client.query(
        `UPDATE users
         SET date_of_birth = $1::date,
             liquor_card_type = $2,
             liquor_card_expires_on = $3::date
         WHERE id = $4
           AND restaurant_id = $5`,
        [
          dateOfBirth,
          liquorCardType,
          liquorCardExpiresOn,
          userId,
          manager.restaurant_id,
        ]
      );
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Staff information updated successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Update staff information error:", error);

    return NextResponse.json(
      { error: "Failed to update staff information" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// OPTIONS: Load available positions for Staff Management.
export async function OPTIONS() {
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

    const result = await pool.query(
      `SELECT id, name
       FROM positions
       WHERE restaurant_id = $1
       ORDER BY name`,
      [manager.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Load staff positions error:", error);

    return NextResponse.json(
      { error: "Failed to load positions" },
      { status: 500 }
    );
  }
}
