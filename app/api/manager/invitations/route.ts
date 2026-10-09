import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { Resend } from "resend";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";

const invitationSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z
    .union([z.email().trim().toLowerCase(), z.literal(""), z.null()])
    .optional(),
  positionIds: z.array(z.number().int().positive()).default([]),
  role: z.enum(["employee", "manager"]).default("employee"),
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
      { error: "Invalid invitation information" },
      { status: 400 }
    );
  }

  const { firstName, lastName, positionIds, role } = parsed.data;
  const email = parsed.data.email?.trim().toLowerCase() || null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify the current user.
    const actorResult = await client.query(
      `SELECT id, restaurant_id, role
       FROM users
       WHERE id = $1
         AND role IN ('manager', 'owner')
         AND is_active = TRUE`,
      [session.user.id]
    );

    const actor = actorResult.rows[0];

    if (!actor) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      );
    }

    // Only Owners can invite managers.
    if (role === "manager" && actor.role !== "owner") {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Only owners can invite managers" },
        { status: 403 }
      );
    }

    // Manager accounts must have an email.
    if (role === "manager" && !email) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Manager invitations require an email address" },
        { status: 400 }
      );
    }

    // Employees must have at least one position.
    if (role === "employee" && positionIds.length === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Select at least one position for the employee" },
        { status: 400 }
      );
    }

    // Validate positions.
    const uniquePositionIds = [...new Set(positionIds)];

    if (uniquePositionIds.length > 0) {
      const positionResult = await client.query(
        `SELECT id
         FROM positions
         WHERE restaurant_id = $1
           AND id = ANY($2::int[])`,
        [actor.restaurant_id, uniquePositionIds]
      );

      if (positionResult.rows.length !== uniquePositionIds.length) {
        await client.query("ROLLBACK");

        return NextResponse.json(
          { error: "One or more positions are invalid" },
          { status: 400 }
        );
      }
    }

    // Employees without email addresses are added directly.
    if (!email) {
      const employeeResult = await client.query(
        `INSERT INTO users
           (restaurant_id, first_name, last_name, email, role, is_active)
         VALUES ($1, $2, $3, NULL, 'employee', TRUE)
         RETURNING id, first_name, last_name, email, role`,
        [actor.restaurant_id, firstName, lastName]
      );

      const employee = employeeResult.rows[0];

      for (const positionId of uniquePositionIds) {
        await client.query(
          `INSERT INTO user_positions (user_id, position_id)
           VALUES ($1, $2)`,
          [employee.id, positionId]
        );
      }

      await client.query("COMMIT");

      return NextResponse.json(
        {
          success: true,
          type: "employee",
          message: "Employee added successfully",
          employee,
        },
        { status: 201 }
      );
    }

    // Check for an existing account.
    const existingUser = await client.query(
      `SELECT id
       FROM users
       WHERE LOWER(email) = $1`,
      [email]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Generate a secure invitation token.
    const token = randomBytes(32).toString("hex");

    const tokenHash = createHash("sha256")
      .update(token)
      .digest("hex");

    // Save invitation with its assigned role.
    const invitationResult = await client.query(
      `INSERT INTO employee_invitations
         (
           restaurant_id,
           invited_by,
           first_name,
           last_name,
           email,
           token_hash,
           expires_at,
           invited_role
         )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         NOW() + INTERVAL '48 hours',
         $7
       )
       RETURNING id`,
      [
        actor.restaurant_id,
        actor.id,
        firstName,
        lastName,
        email,
        tokenHash,
        role,
      ]
    );

    const invitationId = invitationResult.rows[0].id;

    // Assign positions to the invitation.
    for (const positionId of uniquePositionIds) {
      await client.query(
        `INSERT INTO employee_invitation_positions
           (invitation_id, position_id)
         VALUES ($1, $2)`,
        [invitationId, positionId]
      );
    }

    // Build invitation link.
    const baseUrl = (
      process.env.APP_URL || "http://localhost:3001"
    ).replace(/\/$/, "");

    const invitationLink = `${baseUrl}/invite/${token}`;

    // Send invitation email.
    const resend = new Resend(process.env.RESEND_API_KEY);

    const emailResult = await resend.emails.send({
      from:
        process.env.RESEND_FROM_EMAIL ||
        "Shift Scheduler <onboarding@resend.dev>",

      to: email,

      subject: "You're invited to Shift Scheduler",

      text:
        `Hi ${firstName},\n\n` +
        `You've been invited to join your restaurant's Shift Scheduler as a ${role}.\n\n` +
        `Create your account here:\n${invitationLink}\n\n` +
        `This invitation expires in 48 hours.\n\n` +
        `If you weren't expecting this invitation, you can ignore this email.`,
    });

    if (emailResult.error) {
      await client.query("ROLLBACK");

      console.error("Resend invitation error:", emailResult.error);

      return NextResponse.json(
        { error: "Failed to send invitation email" },
        { status: 502 }
      );
    }

    await client.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        type: "invitation",
        message: "Invitation sent successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Create employee/invitation error:", error);

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return NextResponse.json(
        { error: "A pending invitation or employee already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create employee or invitation" },
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
    const actorResult = await pool.query(
      `SELECT restaurant_id, role
       FROM users
       WHERE id = $1
         AND role IN ('manager', 'owner')
         AND is_active = TRUE`,
      [session.user.id]
    );

    const actor = actorResult.rows[0];

    if (!actor) {
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
         ei.invited_role,
         CASE
           WHEN ei.expires_at <= NOW()
             THEN 'expired'
           ELSE 'pending'
         END AS status,
         COALESCE(
           ARRAY_AGG(p.name ORDER BY p.name)
             FILTER (WHERE p.id IS NOT NULL),
           '{}'
         ) AS positions
       FROM employee_invitations ei
       LEFT JOIN employee_invitation_positions eip
         ON eip.invitation_id = ei.id
       LEFT JOIN positions p
         ON p.id = eip.position_id
         AND p.restaurant_id = ei.restaurant_id
       WHERE ei.restaurant_id = $1
         AND ei.accepted_at IS NULL
       GROUP BY ei.id
       ORDER BY ei.created_at DESC`,
      [actor.restaurant_id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Load invitations error:", error);

    return NextResponse.json(
      { error: "Failed to load invitations" },
      { status: 500 }
    );
  }
}