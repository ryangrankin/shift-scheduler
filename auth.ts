import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
  },

  callbacks: {
    async jwt({ token, user }) {
  if (user) {
    token.id = user.id;
  }

  if (token.id) {
    const result = await pool.query(
      `SELECT is_active
       FROM users
       WHERE id = $1`,
      [token.id]
    );

    if (!result.rows[0]?.is_active) {
      return null;
    }
  }

  return token;
},

    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = String(token.id);
      }

      return session;
    },
  },

  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },

      async authorize(credentials) {
        const parsed = z
          .object({
            email: z.email(),
            password: z.string().min(1),
          })
          .safeParse(credentials);

        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const result = await pool.query(
          `SELECT id, email, first_name, last_name,
                  password_hash, role, restaurant_id
           FROM users
           WHERE LOWER(email) = LOWER($1)
             AND is_active = TRUE`,
          [email]
        );

        if (result.rows.length === 0) return null;

        const user = result.rows[0];

        const validPassword = await bcrypt.compare(
          password,
          user.password_hash
        );

        if (!validPassword) return null;

        return {
          id: String(user.id),
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
        };
      },
    }),
  ],
});