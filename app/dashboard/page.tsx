
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Employee Dashboard
            </h1>
            <p className="mt-2 text-gray-600">
              Welcome, {session.user.name}!
            </p>
          </div>

          <LogoutButton />
        </header>

        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">
            My Schedule
          </h2>
          <p className="mt-2 text-gray-600">
            Your upcoming shifts will appear here.
          </p>
        </section>
      </div>
    </main>
  );
}
