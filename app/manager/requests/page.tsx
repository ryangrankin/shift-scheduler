
"use client";

import { useEffect, useState } from "react";

type AvailabilityRequest = {
  id: number;
  request_date: string;
  start_time: string | null;
  end_time: string | null;
  is_unavailable: boolean;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  first_name: string;
  last_name: string;
  employee_id: number;
};

function formatDate(date: string) {
  const [year, month, day] = date
    .slice(0, 10)
    .split("-")
    .map(Number);

  return new Date(
    Date.UTC(year, month - 1, day)
  ).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;

  return `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

export default function ManagerRequestsPage() {
  const [requests, setRequests] = useState<AvailabilityRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadRequests() {
    const response = await fetch(
      "/api/manager/availability-requests",
      { cache: "no-store" }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to load requests.");
    }

    setRequests(data);
  }

  useEffect(() => {
    loadRequests()
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load requests."
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function reviewRequest(
    id: number,
    status: "approved" | "denied"
  ) {
    const action = status === "approved" ? "approve" : "deny";

    if (!window.confirm(`Are you sure you want to ${action} this request?`)) {
      return;
    }

    setReviewingId(id);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/manager/availability-requests/${id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to review request.");
      }

      await loadRequests();

      setMessage(
        `Request ${status === "approved" ? "approved" : "denied"} successfully!`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to review request."
      );
    } finally {
      setReviewingId(null);
    }
  }

  const pending = requests.filter(
    (request) => request.status === "pending"
  );

  const history = requests.filter(
    (request) => request.status !== "pending"
  );

  function renderRequest(request: AvailabilityRequest) {
    return (
      <div
        key={request.id}
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {request.first_name} {request.last_name}
            </h3>

            <p className="mt-1 text-sm text-gray-600">
              {formatDate(request.request_date)}
            </p>
          </div>

          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
              request.status === "approved"
                ? "bg-green-100 text-green-800"
                : request.status === "denied"
                ? "bg-red-100 text-red-800"
                : "bg-yellow-100 text-yellow-800"
            }`}
          >
            {request.status}
          </span>
        </div>

        <div className="mt-4 space-y-2 text-sm text-gray-700">
          <p>
            <span className="font-medium">Request: </span>
            {request.is_unavailable
              ? "Unavailable all day"
              : request.start_time && request.end_time
              ? `Available ${formatTime(request.start_time)} – ${formatTime(request.end_time)}`
              : "Specific availability change"}
          </p>

          {request.reason && (
            <p>
              <span className="font-medium">Reason: </span>
              {request.reason}
            </p>
          )}
        </div>

        {request.status === "pending" && (
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={reviewingId !== null}
              onClick={() => reviewRequest(request.id, "approved")}
              className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
            >
              {reviewingId === request.id ? "Processing..." : "Approve"}
            </button>

            <button
              type="button"
              disabled={reviewingId !== null}
              onClick={() => reviewRequest(request.id, "denied")}
              className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {reviewingId === request.id ? "Processing..." : "Deny"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Availability Requests
          </h1>

          <p className="mt-2 text-gray-600">
            Review and manage employee availability requests.
          </p>
        </header>

        {error && (
          <p className="mb-5 rounded-lg bg-red-50 p-4 text-red-700">
            {error}
          </p>
        )}

        {message && (
          <p className="mb-5 rounded-lg bg-green-50 p-4 text-green-700">
            {message}
          </p>
        )}

        {loading ? (
          <p className="text-gray-600">Loading requests...</p>
        ) : (
          <>
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
                Pending Requests ({pending.length})
              </h2>

              {pending.length === 0 ? (
                <div className="rounded-xl bg-white p-6 text-gray-500">
                  No pending requests.
                </div>
              ) : (
                <div className="space-y-4">
                  {pending.map(renderRequest)}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
                Request History ({history.length})
              </h2>

              {history.length === 0 ? (
                <div className="rounded-xl bg-white p-6 text-gray-500">
                  No reviewed requests yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map(renderRequest)}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
