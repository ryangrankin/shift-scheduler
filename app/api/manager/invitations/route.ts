import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { Resend } from "resend";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";

const invitationSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),

  // Email is now optional.
  email: z
    .union([
      z.email().trim().toLowerCase(),
      z.literal(""),
      z.null(),
    ])
    .optional(),

  positionIds: z
    .array(z.number().int().positive())
    .min(1),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const parsed = invitationSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid employee information" },
      { status: 400 }
    );
  }

  const {
    firstName,
    lastName,
    email: rawEmail,
    positionIds,
  } = parsed.data;

  // Convert empty string to null.
  const email =
    typeof rawEmail === "string" &&
    rawEmail.trim() !== ""
      ? rawEmail.trim().toLowerCase()
      : null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ------------------------------------------------------------
    // Verify manager
    // ------------------------------------------------------------

    const managerResult = await client.query(
      `SELECT id, restaurant_id, role
       FROM users
       WHERE id = $1`,
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

    // ------------------------------------------------------------
    // Validate positions
    // ------------------------------------------------------------

    const positionResult = await client.query(
      `SELECT id
       FROM positions
       WHERE restaurant_id = $1
         AND id = ANY($2::int[])`,
      [manager.restaurant_id, positionIds]
    );

    if (
      positionResult.rows.length !==
      new Set(positionIds).size
    ) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "One or more positions are invalid" },
        { status: 400 }
      );
    }

    // ============================================================
    // NO EMAIL
    //
    // Create the employee directly.
    // They can be scheduled and managed, but they don't have
    // employee login access yet.
    // ============================================================

    if (!email) {
      const employeeResult = await client.query(
        `INSERT INTO users (
           restaurant_id,
           first_name,
           last_name,
           email,
           role,
           is_active
         )
         VALUES ($1, $2, $3, NULL, 'employee', TRUE)
         RETURNING id, first_name, last_name, email, role`,
        [
          manager.restaurant_id,
          firstName,
          lastName,
        ]
      );

      const employee =
        employeeResult.rows[0];

      // Assign positions immediately.
      for (const positionId of positionIds) {
        await client.query(
          `INSERT INTO user_positions (
             user_id,
             position_id
           )
           VALUES ($1, $2)`,
          [
            employee.id,
            positionId,
          ]
        );
      }

      await client.query("COMMIT");

      return NextResponse.json(
        {
          success: true,
          type: "employee",
          message:
            "Employee added successfully",
          employee,
        },
        { status: 201 }
      );
    }

    // ============================================================
    // EMAIL PROVIDED
    //
    // Existing invitation flow.
    // ============================================================

    const existingUser = await client.query(
      `SELECT id
       FROM users
       WHERE LOWER(email) = $1`,
      [email]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        {
          error:
            "An account with this email already exists",
        },
        { status: 409 }
      );
    }

    const token = randomBytes(32).toString("hex");

    const tokenHash = createHash("sha256")
      .update(token)
      .digest("hex");

    const invitationResult =
      await client.query(
        `INSERT INTO employee_invitations (
           restaurant_id,
           invited_by,
           first_name,
           last_name,
           email,
           token_hash,
           expires_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           NOW() + INTERVAL '48 hours'
         )
         RETURNING id`,
        [
          manager.restaurant_id,
          manager.id,
          firstName,
          lastName,
          email,
          tokenHash,
        ]
      );

    const invitationId =
      invitationResult.rows[0].id;

    // Assign positions to the invitation.
    for (const positionId of positionIds) {
      await client.query(
        `INSERT INTO employee_invitation_positions (
           invitation_id,
           position_id
         )
         VALUES ($1, $2)`,
        [
          invitationId,
          positionId,
        ]
      );
    }

    const baseUrl =
      process.env.APP_URL ||
      "http://localhost:3001";

    const invitationLink =
      `${baseUrl}/invite/${token}`;

    const resend = new Resend(
      process.env.RESEND_API_KEY
    );

    const emailResult =
      await resend.emails.send({
        from:
          process.env.RESEND_FROM_EMAIL ||
          "Shift Scheduler <onboarding@resend.dev>",

        to: email,

        subject:
          "You're invited to Shift Scheduler",

        text:
          `Hi ${firstName},\n\n` +
          `You've been invited to join your restaurant's Shift Scheduler.\n\n` +
          `Create your account here:\n${invitationLink}\n\n` +
          `This invitation expires in 48 hours.\n\n` +
          `If you weren't expecting this invitation, you can ignore this email.`,
      });

    if (emailResult.error) {
      await client.query("ROLLBACK");

      console.error(
        "Resend invitation error:",
        emailResult.error
      );

      return NextResponse.json(
        {
          error:
            "Failed to send invitation email",
        },
        { status: 502 }
      );
    }

    await client.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        type: "invitation",
        message:
          "Invitation sent successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "Create employee/invitation error:",
      error
    );

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return NextResponse.json(
        {
          error:
            "A pending invitation or employee already exists",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error:
          "Failed to create employee or invitation",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

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

    if (
      !manager ||
      !["manager", "owner"].includes(manager.role)
    ) {
      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    const result = await pool.query(
      `SELECT
         ei.id,
         ei.first_name,
         ei.last_name,
         ei.email,
         ei.created_at,
         ei.expires_at,
         CASE
           WHEN ei.expires_at <= NOW()
             THEN 'expired'
           ELSE 'pending'
         END AS status,
         COALESCE(
           ARRAY_AGG(
             p.name
             ORDER BY p.name
           )
           FILTER (WHERE p.id IS NOT NULL),
           '{}'
         ) AS positions
       FROM employee_invitations ei
       LEFT JOIN employee_invitation_positions eip
         ON eip.invitation_id = ei.id
       LEFT JOIN positions p
         ON p.id = eip.position_id
       WHERE ei.restaurant_id = $1
         AND ei.accepted_at IS NULL
       GROUP BY ei.id
       ORDER BY ei.created_at DESC`,
      [manager.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error(
      "Load invitations error:",
      error
    );

    return NextResponse.json(
      { error: "Failed to load invitations" },
      { status: 500 }
    );
  }
}