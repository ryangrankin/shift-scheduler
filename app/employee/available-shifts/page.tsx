"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type AvailableShift = {
  id: number;
  start_time: string;
  end_time: string;
  position_name: string;
  restaurant_name: string;
};

type PickupRequest = {
  id: number;
  shift_id: number;
  status: "pending" | "approved" | "denied" | "cancelled";
  created_at: string;
  reviewed_at: string | null;
  position_name: string;
  start_time: string;
  end_time: string;
};

function formatDate(timestamp: string) {
  const [year, month, day] = timestamp
    .slice(0, 10)
    .split("-")
    .map(Number);

  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(timestamp: string) {
  const [hour, minute] = timestamp
    .slice(11, 16)
    .split(":")
    .map(Number);

  const period = hour >= 12 ? "PM" : "AM";
  const formattedHour = hour % 12 || 12;

  return `${formattedHour}:${String(minute).padStart(2, "0")} ${period}`;
}

const statusStyles: Record<PickupRequest["status"], string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-700",
};

export default function AvailableShiftsPage() {
  const [shifts, setShifts] = useState<AvailableShift[]>([]);
  const [requests, setRequests] = useState<PickupRequest[]>([]);

  const [loading, setLoading] = useState(true);
  const [requestingId, setRequestingId] = useState<number | null>(null);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const [shiftsResponse, requestsResponse] = await Promise.all([
        fetch("/api/employee/available-shifts", {
          cache: "no-store",
        }),
        fetch("/api/employee/shift-pickup-requests", {
          cache: "no-store",
        }),
      ]);

      if (!shiftsResponse.ok || !requestsResponse.ok) {
        throw new Error("Failed to load shifts or pickup requests");
      }

      const shiftsData: AvailableShift[] = await shiftsResponse.json();
      const requestsData: PickupRequest[] = await requestsResponse.json();

      setShifts(shiftsData);
      setRequests(requestsData);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load shift information."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function requestShift(shiftId: number) {
    setRequestingId(shiftId);
    setError("");
    setMessage("");

    try {
      let response = await fetch(
  "/api/employee/shift-pickup-requests",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ shiftId }),
  }
);

let data = await response.json();

if (response.status === 409 && data.requiresConfirmation === true) {
  const confirmed = window.confirm(
    "Outside Your Availability\n\n" +
    "This shift conflicts with your saved availability. " +
    "Are you sure you want to request it?"
  );

  if (!confirmed) {
    return;
  }

  response = await fetch(
    "/api/employee/shift-pickup-requests",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shiftId,
        confirmAvailabilityOverride: true,
      }),
    }
  );

  data = await response.json();
}

      if (!response.ok) {
        const conflictMessages = Array.isArray(data.conflicts)
          ? data.conflicts
              .map((conflict: { message: string }) => conflict.message)
              .join(" ")
          : "";

        throw new Error(
          [data.error || "Could not request shift", conflictMessages]
            .filter(Boolean)
            .join(" ")
        );
      }

      setMessage(
        "Shift pickup request submitted! A manager must approve it before the shift is assigned to you."
      );

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setRequestingId(null);
    }
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

        <h1 className="mt-6 text-3xl font-bold text-gray-900">
          Pick Up Shifts
        </h1>

        <p className="mt-2 text-gray-600">
          Browse available shifts, request to pick them up, and track
          the status of your requests. All pickups require manager approval.
        </p>

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

        {/* AVAILABLE SHIFTS */}

        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-gray-900">
            Available Shifts
          </h2>

          <p className="mt-1 text-sm text-gray-600">
            Open shifts and shifts posted by your coworkers.
          </p>

          {loading ? (
            <p className="mt-6 text-gray-600">
              Loading available shifts...
            </p>
          ) : shifts.length === 0 ? (
            <div className="mt-6 rounded-xl bg-white p-8 text-center shadow-sm">
              <p className="font-medium text-gray-900">
                No available shifts
              </p>
              <p className="mt-2 text-sm text-gray-600">
                There are currently no shifts available for pickup.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {shifts.map((shift) => {
                const existingRequest = requests.find(
                  (request) => request.shift_id === shift.id
                );

                const requesting = requestingId === shift.id;

                return (
                  <div
                    key={shift.id}
                    className="rounded-xl bg-white p-6 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {shift.position_name}
                        </h3>

                        <p className="mt-1 text-sm text-gray-600">
                          {shift.restaurant_name}
                        </p>

                        <p className="mt-3 font-medium text-gray-900">
                          {formatDate(shift.start_time)}
                        </p>

                        <p className="mt-1 text-sm text-gray-700">
                          {formatTime(shift.start_time)} –{" "}
                          {formatTime(shift.end_time)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => requestShift(shift.id)}
                        disabled={
                          requestingId !== null ||
                          Boolean(existingRequest)
                        }
                        className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                      >
                        {requesting
                          ? "Submitting..."
                          : existingRequest?.status === "pending"
                          ? "Request Pending"
                          : existingRequest
                          ? "Already Requested"
                          : "Request Shift"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* MY PICKUP REQUESTS */}

        <section className="mt-12">
          <h2 className="text-2xl font-semibold text-gray-900">
            My Pickup Requests
          </h2>

          <p className="mt-1 text-sm text-gray-600">
            Track the status of shifts you've requested.
          </p>

          {loading ? (
            <p className="mt-6 text-gray-600">
              Loading your requests...
            </p>
          ) : requests.length === 0 ? (
            <div className="mt-6 rounded-xl bg-white p-8 text-center shadow-sm">
              <p className="font-medium text-gray-900">
                No pickup requests yet
              </p>
              <p className="mt-2 text-sm text-gray-600">
                When you request a shift, it will appear here.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-xl bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {request.position_name}
                      </h3>

                      <p className="mt-2 font-medium text-gray-900">
                        {formatDate(request.start_time)}
                      </p>

                      <p className="mt-1 text-sm text-gray-700">
                        {formatTime(request.start_time)} –{" "}
                        {formatTime(request.end_time)}
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                        statusStyles[request.status] ??
                        "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {request.status}
                    </span>
                  </div>

                  {request.status === "pending" && (
                    <p className="mt-4 text-sm text-gray-600">
                      Waiting for manager approval.
                    </p>
                  )}

                  {request.status === "approved" && (
                    <p className="mt-4 text-sm text-green-700">
                      Approved! This shift has been added to your schedule.
                    </p>
                  )}

                  {request.status === "denied" && (
                    <p className="mt-4 text-sm text-red-700">
                      Your pickup request was denied.
                    </p>
                  )}

                  {request.status === "cancelled" && (
                    <p className="mt-4 text-sm text-gray-600">
                      This pickup request was cancelled.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}