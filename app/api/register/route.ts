
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

    const result = await pool.query(
      `INSERT INTO users
       (restaurant_id, first_name, last_name,
        email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'employee')
       RETURNING id, first_name, last_name, email, role`,
      [
        restaurantId,
        firstName,
        lastName,
        email.toLowerCase(),
        passwordHash,
      ]
    );

    return NextResponse.json(
      { user: result.rows[0] },
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
