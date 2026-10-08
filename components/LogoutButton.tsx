
"use client";

import { signOut } from "next-auth/react";

export default function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-lg bg-gray-900 px-4 py-2 text-white hover:bg-gray-700"
    >
      Log Out
    </button>
  );
}
