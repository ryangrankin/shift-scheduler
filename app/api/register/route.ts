import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "@/lib/db";

const registerSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.email(),
  password: z.string().min(8),
  restaurantId: z.number().int().positive(),
  role: z.enum(["employee", "manager"]),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid registration information" },
        { status: 400 }
      );
    }

    const {
      firstName,
      lastName,
      email,
      password,
      restaurantId,
      role,
    } = parsed.data;

    const restaurant = await pool.query(
      "SELECT id FROM restaurants WHERE id = $1",
      [restaurantId]
    );

    if (restaurant.rows.length === 0) {
      return NextResponse.json(
        { error: "Restaurant not found" },
        { status: 404 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO users
       (restaurant_id, first_name, last_name,
        email, password_hash, role, is_active, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, 'pending')`,
      [
        restaurantId,
        firstName,
        lastName,
        email.toLowerCase(),
        passwordHash,
        role,
      ]
    );

    return NextResponse.json(
      {
        message:
          "Registration submitted. Your account is pending management approval.",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    console.error("Registration error:", error);

    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}