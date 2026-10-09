"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Restaurant = {
  id: number;
  name: string;
  created_at: string;
};

export default function RestaurantManagementPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const loadRestaurants = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/restaurants");

      if (response.status === 401 || response.status === 403) {
        setAccessDenied(true);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load restaurants.");
      }

      const data = await response.json();

      setRestaurants(data);
      setAccessDenied(false);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRestaurants();
  }, [loadRestaurants]);

  async function addRestaurant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const restaurantName = name.trim();

    if (restaurantName.length < 2) {
      setError("Restaurant name must contain at least 2 characters.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/restaurants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: restaurantName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add restaurant.");
      }

      setName("");
      await loadRestaurants();
      setMessage(`${data.name} was added successfully.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <p className="text-gray-700">Loading restaurants...</p>
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <div className="mx-auto max-w-xl rounded-xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">
            Access Denied
          </h1>

          <p className="mt-3 text-gray-600">
            Only the App Administrator can manage restaurants.
          </p>

          <Link
            href="/dashboard"
            className="mt-5 inline-block text-sm font-medium text-blue-700 hover:underline"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-gray-700 hover:underline"
        >
          ← Back to Dashboard
        </Link>

        <div className="mt-6">
          <h1 className="text-3xl font-bold text-gray-900">
            Restaurant Management
          </h1>

          <p className="mt-2 text-gray-600">
            Add and manage restaurants available in your scheduling app.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        {message && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800"
          >
            {message}
          </div>
        )}

        {/* ADD RESTAURANT */}
        <section className="mt-8 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">
            Add Restaurant
          </h2>

          <p className="mt-2 text-sm text-gray-600">
            Restaurants you add will eventually appear in the
            registration dropdown.
          </p>

          <form onSubmit={addRestaurant} className="mt-5">
            <label className="block text-sm font-medium text-gray-800">
              Restaurant Name

              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
                maxLength={100}
                placeholder="e.g., Honolulu Burger Co."
                disabled={saving}
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="mt-5 rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? "Adding..." : "+ Add Restaurant"}
            </button>
          </form>
        </section>

        {/* RESTAURANT LIST */}
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">
            Restaurants ({restaurants.length})
          </h2>

          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {restaurants.length === 0 ? (
              <p className="p-6 text-sm text-gray-600">
                No restaurants have been added yet.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {restaurants.map((restaurant) => (
                  <div
                    key={restaurant.id}
                    className="flex flex-wrap items-center justify-between gap-4 p-5"
                  >
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {restaurant.name}
                      </h3>

                      <p className="mt-1 text-sm text-gray-500">
                        Restaurant ID: {restaurant.id}
                      </p>
                    </div>

                    <span className="text-xs text-gray-500">
                      Added{" "}
                      {new Date(
                        restaurant.created_at
                      ).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}