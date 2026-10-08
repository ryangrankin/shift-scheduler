
"use client";

import { useEffect, useState } from "react";

type Availability = {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

type AvailabilityRequest = {
  id: number;
  request_date: string;
  start_time: string | null;
  end_time: string | null;
  is_unavailable: boolean;
  reason: string | null;
  status: "pending" | "approved" | "denied";
};

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;

  return `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(date: string) {
  const [year, month, day] = date
    .slice(0, 10)
    .split("-")
    .map(Number);

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    "en-US",
    {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  );
}

function getMinimumRequestDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const today = new Date(
    `${getPart("year")}-${getPart("month")}-${getPart("day")}T00:00:00Z`
  );

  today.setUTCDate(today.getUTCDate() + 14);

  return today.toISOString().slice(0, 10);
}

export default function AvailabilityPage() {
  const [tab, setTab] = useState<"weekly" | "dates">("weekly");

  const [availability, setAvailability] = useState<Availability[]>([]);
  const [requests, setRequests] = useState<AvailabilityRequest[]>([]);

  // Add weekly availability
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  // Edit weekly availability
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDay, setEditDay] = useState(1);
  const [editStart, setEditStart] = useState("09:00");
  const [editEnd, setEditEnd] = useState("17:00");

  // Specific date requests
  const [requestDate, setRequestDate] = useState("");
  const [isUnavailable, setIsUnavailable] = useState(true);
  const [requestStart, setRequestStart] = useState("09:00");
  const [requestEnd, setRequestEnd] = useState("17:00");
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const minDate = getMinimumRequestDate();

  async function loadAvailability() {
    const response = await fetch("/api/availability");

    if (!response.ok) {
      throw new Error("Could not load weekly availability.");
    }

    const data = await response.json();
    setAvailability(data);
  }

  async function loadRequests() {
    const response = await fetch("/api/availability-requests");

    if (!response.ok) {
      throw new Error("Could not load availability requests.");
    }

    const data = await response.json();
    setRequests(data);
  }

  useEffect(() => {
    Promise.all([loadAvailability(), loadRequests()]).catch(() => {
      setError("Could not load your availability information.");
    });
  }, []);

  function switchTab(nextTab: "weekly" | "dates") {
    setTab(nextTab);
    setError("");
    setMessage("");
    setEditingId(null);
  }

  async function saveWeekly(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (startTime >= endTime) {
      setError("End time must be after start time.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayOfWeek,
          startTime,
          endTime,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save availability.");
      }

      await loadAvailability();
      setMessage("Weekly availability saved successfully!");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save availability."
      );
    } finally {
      setLoading(false);
    }
  }

  function startEditing(item: Availability) {
    setEditingId(item.id);
    setEditDay(item.day_of_week);
    setEditStart(item.start_time.slice(0, 5));
    setEditEnd(item.end_time.slice(0, 5));
    setError("");
    setMessage("");
  }

  async function saveEdit(id: number) {
    setError("");
    setMessage("");

    if (editStart >= editEnd) {
      setError("End time must be after start time.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/availability/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayOfWeek: editDay,
          startTime: editStart,
          endTime: editEnd,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update availability.");
      }

      await loadAvailability();
      setEditingId(null);
      setMessage("Availability updated successfully!");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update availability."
      );
    } finally {
      setLoading(false);
    }
  }

  async function deleteAvailability(id: number) {
    if (!window.confirm("Delete this weekly availability entry?")) {
      return;
    }

    setError("");
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch(`/api/availability/${id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete availability.");
      }

      await loadAvailability();

      if (editingId === id) {
        setEditingId(null);
      }

      setMessage("Availability deleted successfully!");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete availability."
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!requestDate) {
      setError("Please select a date.");
      return;
    }

    if (requestDate < getMinimumRequestDate()) {
      setError("Requests must be submitted at least 14 days in advance.");
      return;
    }

    if (!isUnavailable && requestStart >= requestEnd) {
      setError("End time must be after start time.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/availability-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestDate,
          isUnavailable,
          startTime: isUnavailable ? null : requestStart,
          endTime: isUnavailable ? null : requestEnd,
          reason,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to submit request.");
      }

      await loadRequests();

      setRequestDate("");
      setReason("");
      setIsUnavailable(true);
      setMessage("Request submitted! Waiting for manager approval.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit request."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-6 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            My Availability
          </h1>
          <p className="mt-2 text-gray-600">
            Manage your regular availability and request changes
            for specific dates.
          </p>
        </header>

        <div className="mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => switchTab("weekly")}
            className={`rounded-lg px-5 py-3 font-medium ${
              tab === "weekly"
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-700 hover:bg-gray-200"
            }`}
          >
            Weekly Availability
          </button>

          <button
            type="button"
            onClick={() => switchTab("dates")}
            className={`rounded-lg px-5 py-3 font-medium ${
              tab === "dates"
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-700 hover:bg-gray-200"
            }`}
          >
            Specific Date Requests
          </button>
        </div>

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

        {tab === "weekly" ? (
          <>
            <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-2 text-xl font-semibold text-gray-900">
                Add Weekly Availability
              </h2>

              <p className="mb-6 text-sm text-gray-600">
                These hours repeat every week until you change them.
              </p>

              <form onSubmit={saveWeekly} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    Day of Week
                  </label>

                  <select
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                  >
                    {days.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Available From
                    </label>
                    <input
                      type="time"
                      required
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Available Until
                    </label>
                    <input
                      type="time"
                      required
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Save Availability"}
                </button>
              </form>
            </section>

            <section className="rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
                My Weekly Availability
              </h2>

              {availability.length === 0 ? (
                <p className="text-gray-500">
                  You haven't added any weekly availability yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {availability.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-gray-200 p-4"
                    >
                      {editingId === item.id ? (
                        <div className="space-y-4">
                          <select
                            value={editDay}
                            onChange={(e) =>
                              setEditDay(Number(e.target.value))
                            }
                            className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                          >
                            {days.map((day, index) => (
                              <option key={day} value={index}>
                                {day}
                              </option>
                            ))}
                          </select>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                              type="time"
                              value={editStart}
                              onChange={(e) =>
                                setEditStart(e.target.value)
                              }
                              className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                            />

                            <input
                              type="time"
                              value={editEnd}
                              onChange={(e) =>
                                setEditEnd(e.target.value)
                              }
                              className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                            />
                          </div>

                          <div className="flex gap-3">
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => saveEdit(item.id)}
                              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                              Save Changes
                            </button>

                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => setEditingId(null)}
                              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <p className="font-semibold text-gray-900">
                              {days[item.day_of_week]}
                            </p>
                            <p className="mt-1 text-sm text-gray-600">
                              {formatTime(item.start_time)} –{" "}
                              {formatTime(item.end_time)}
                            </p>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => startEditing(item)}
                              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => deleteAvailability(item.id)}
                              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-2 text-xl font-semibold text-gray-900">
                Request a One-Time Change
              </h2>

              <p className="mb-6 text-sm text-gray-600">
                Requests must be submitted at least 14 days in advance
                and require manager approval. Your regular weekly
                availability will not be changed.
              </p>

              <form onSubmit={saveRequest} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    Requested Date
                  </label>

                  <input
                    type="date"
                    required
                    min={minDate}
                    value={requestDate}
                    onChange={(e) => setRequestDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                  />

                  <p className="mt-2 text-xs text-gray-500">
                    Earliest request date: {formatDate(minDate)}
                  </p>
                </div>

                <fieldset className="space-y-3">
                  <legend className="mb-2 text-sm font-medium text-gray-700">
                    Availability Change
                  </legend>

                  <label className="flex items-center gap-3 text-gray-900">
                    <input
                      type="radio"
                      name="requestType"
                      checked={isUnavailable}
                      onChange={() => setIsUnavailable(true)}
                    />
                    Unavailable all day
                  </label>

                  <label className="flex items-center gap-3 text-gray-900">
                    <input
                      type="radio"
                      name="requestType"
                      checked={!isUnavailable}
                      onChange={() => setIsUnavailable(false)}
                    />
                    Available during specific hours
                  </label>
                </fieldset>

                {!isUnavailable && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Available From
                      </label>
                      <input
                        type="time"
                        required
                        value={requestStart}
                        onChange={(e) => setRequestStart(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Available Until
                      </label>
                      <input
                        type="time"
                        required
                        value={requestEnd}
                        onChange={(e) => setRequestEnd(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    Reason (Optional)
                  </label>

                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Add a note for your manager..."
                    className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {loading ? "Submitting..." : "Submit Request"}
                </button>
              </form>
            </section>

            <section className="rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
                My Requests
              </h2>

              {requests.length === 0 ? (
                <p className="text-gray-500">
                  You haven't submitted any requests yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {requests.map((request) => (
                    <div
                      key={request.id}
                      className="rounded-lg border border-gray-200 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-semibold text-gray-900">
                          {formatDate(request.request_date)}
                        </span>

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

                      <p className="mt-3 text-sm text-gray-600">
                        {request.is_unavailable
                          ? "Unavailable all day"
                          : request.start_time && request.end_time
                          ? `${formatTime(request.start_time)} – ${formatTime(request.end_time)}`
                          : "Specific hours requested"}
                      </p>

                      {request.reason && (
                        <p className="mt-2 text-sm text-gray-500">
                          Note: {request.reason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
