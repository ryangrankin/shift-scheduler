import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";

const acceptSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const parsed = acceptSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid invitation or password" },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;

  const tokenHash = createHash("sha256")
    .update(token)
    .digest("hex");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock invitation to prevent it being accepted twice.
    const invitationResult = await client.query(
      `SELECT *
       FROM employee_invitations
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );

    const invitation = invitationResult.rows[0];

    if (
      !invitation ||
      invitation.accepted_at !== null ||
      new Date(invitation.expires_at).getTime() <= Date.now()
    ) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Invitation is invalid, expired, or already used" },
        { status: 410 }
      );
    }

    // Only employee and manager accounts can be created through invitations.
    const invitedRole = invitation.invited_role;

    if (invitedRole !== "employee" && invitedRole !== "manager") {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "Invalid invitation role" },
        { status: 400 }
      );
    }

    // Manager invitations must have been issued by an owner.
    if (invitedRole === "manager") {
      const ownerResult = await client.query(
        `SELECT 1
         FROM users
         WHERE id = $1
           AND restaurant_id = $2
           AND role = 'owner'
           AND is_active = TRUE`,
        [invitation.invited_by, invitation.restaurant_id]
      );

      if (ownerResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return NextResponse.json(
          { error: "Manager invitation is not authorized" },
          { status: 403 }
        );
      }
    }

    const existingUser = await client.query(
      `SELECT id
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [invitation.email]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create account using the role stored in the invitation.
    const userResult = await client.query(
      `INSERT INTO users
         (restaurant_id, first_name, last_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        invitation.restaurant_id,
        invitation.first_name,
        invitation.last_name,
        invitation.email,
        passwordHash,
        invitedRole,
      ]
    );

    const userId = userResult.rows[0].id;

    // Copy assigned positions to the new account.
    await client.query(
      `INSERT INTO user_positions (user_id, position_id)
       SELECT $1, eip.position_id
       FROM employee_invitation_positions eip
       JOIN positions p ON p.id = eip.position_id
       WHERE eip.invitation_id = $2
         AND p.restaurant_id = $3`,
      [userId, invitation.id, invitation.restaurant_id]
    );

    // Mark invitation as accepted.
    await client.query(
      `UPDATE employee_invitations
       SET accepted_at = NOW()
       WHERE id = $1`,
      [invitation.id]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Account created successfully",
      role: invitedRole,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Accept invitation error:", error);

    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}