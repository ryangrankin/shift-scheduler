import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT id, name
       FROM restaurants
       ORDER BY name ASC`
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Load public restaurants error:", error);

    return NextResponse.json(
      { error: "Failed to load restaurants" },
      { status: 500 }
    );
  }
}