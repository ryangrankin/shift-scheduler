import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import { connection } from "next/server";

export default async function DashboardPage() {
  await connection();

  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const result = await pool.query(
    `SELECT first_name, last_name, role
     FROM users
     WHERE id = $1`,
    [session.user.id]
  );

  const user = result.rows[0];

  if (!user) {
    redirect("/login");
  }

  const isManager = user.role === "manager" || user.role === "owner";

  const buttonClass =
    "mt-5 inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700";

  return (
    <main className="min-h-screen bg-gray-100 p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {user.role === "owner"
                ? "Owner Dashboard"
                : isManager
                ? "Manager Dashboard"
                : "Employee Dashboard"}
            </h1>

            <p className="mt-2 text-gray-600">
              Welcome, {user.first_name}!
            </p>
          </div>

          <LogoutButton />
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {isManager ? (
            <>
              {/* Schedule Management */}
              <section className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900">
                  Schedule Management
                </h2>

                <p className="mt-2 text-gray-600">
                  Create, edit, and publish the restaurant schedule.
                  You can also assign shifts to yourself.
                </p>

                <Link href="/manager/schedule" className={buttonClass}>
                  Manage Schedule
                </Link>
              </section>

              {/* Time-Off Requests */}
              <section className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900">
                  Time-Off Requests
                </h2>

                <p className="mt-2 text-gray-600">
                  Review and approve or deny employee availability
                  and time-off requests.
                </p>

                <Link href="/manager/requests" className={buttonClass}>
                  Review Requests
                </Link>
              </section>

              {/* Shift Pickup Requests */}
              <section className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900">
                  Shift Pickup Requests
                </h2>

                <p className="mt-2 text-gray-600">
                  Review employees requesting to pick up open shifts.
                </p>

                <Link
                  href="/manager/shift-pickup-requests"
                  className={buttonClass}
                >
                  Review Pickup Requests
                </Link>
              </section>

              {/* Staff Management */}
              <section className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900">
                  Staff Management
                </h2>

                <p className="mt-2 text-gray-600">
                  View employees and manage their assigned positions.
                </p>

                <Link
                href="/manager/staff"
                 className="inline-block rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-800"
                >
                     Manage Staff
                </Link>
              </section>
            </>
          ) : (
            <>
              {/* My Schedule */}
              <section className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900">
                  My Schedule
                </h2>

                <p className="mt-2 text-gray-600">
                  View your upcoming shifts and weekly schedule.
                </p>

                <Link href="/employee/schedule" className={buttonClass}>
                  View My Schedule
                </Link>
              </section>

              {/* Post a Shift */}
              <section className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900">
                  Post a Shift
                </h2>

                <p className="mt-2 text-gray-600">
                  Offer an assigned shift for another employee to pick up,
                  subject to manager approval.
                </p>

                <Link href="/employee/schedule" className={buttonClass}>
                    Post a Shift
                </Link>
              </section>

              {/* Pick Up Shifts */}
              <section className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900">
                  Pick Up Shifts
                </h2>

                <p className="mt-2 text-gray-600">
                  Browse available shifts and request to pick them up.
                </p>

                <Link
                  href="/employee/available-shifts"
                  className={buttonClass}
                >
                  View Available Shifts
                </Link>
              </section>

              {/* Time Off & Availability */}
              <section className="rounded-xl bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-900">
                  Time Off & Availability
                </h2>

                <p className="mt-2 text-gray-600">
                  Set your weekly availability and submit requests
                  for specific dates off.
                </p>

                <Link
                  href="/employee/availability"
                  className={buttonClass}
                >
                  Manage Availability
                </Link>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}