"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    restaurantId: "1",
    role: "employee",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          restaurantId: Number(form.restaurantId),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Registration failed.");
        return;
      }

      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-md text-center">
          <h1 className="mb-4 text-3xl font-bold text-gray-900">
            Registration Submitted!
          </h1>

          <p className="mb-6 text-gray-600">
            Your account is pending management approval.
            Once approved, you can log in using your email and password.
          </p>

          <button
            onClick={() => router.push("/login")}
            className="w-full rounded-lg bg-gray-900 p-3 font-semibold text-white hover:bg-gray-700"
          >
            Back to Login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-md">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">
          Create an Account
        </h1>

        <p className="mb-6 text-gray-600">
          Register for access to your restaurant's schedule.
          All accounts require management approval.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="First Name"
            required
            value={form.firstName}
            onChange={(e) =>
              setForm({ ...form, firstName: e.target.value })
            }
            className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
          />

          <input
            type="text"
            placeholder="Last Name"
            required
            value={form.lastName}
            onChange={(e) =>
              setForm({ ...form, lastName: e.target.value })
            }
            className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
          />

          <input
            type="email"
            placeholder="Email"
            required
            value={form.email}
            onChange={(e) =>
              setForm({ ...form, email: e.target.value })
            }
            className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
          />

          <input
            type="password"
            placeholder="Password (8+ characters)"
            required
            minLength={8}
            value={form.password}
            onChange={(e) =>
              setForm({ ...form, password: e.target.value })
            }
            className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
          />

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Register As
            </label>

            <select
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900"
            >
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gray-900 p-3 font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Request Account"}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}

        <p className="mt-6 text-center text-sm text-gray-600">
          Already have an account?{" "}
          <a
            href="/login"
            className="font-semibold text-gray-900 underline"
          >
            Log in
          </a>
        </p>
      </div>
    </main>
  );
}