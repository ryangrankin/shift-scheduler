
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";


type Employee = {
  id: number;
  first_name: string;
  last_name: string;
  role: string;
};

type Position = {
  id: number;
  name: string;
};

type Shift = {
  id: number;
  user_id: number | null;
  position_id: number;
  start_time: string;
  end_time: string;
  status: "draft" | "published" | "cancelled";
  position_name: string;
  first_name: string | null;
  last_name: string | null;
};

type ShiftForm = {
  userId: string;
  positionId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
};

const emptyForm: ShiftForm = {
  userId: "",
  positionId: "",
  shiftDate: "",
  startTime: "09:00",
  endTime: "17:00",
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeek(date: Date) {
  const result = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  const day = result.getDay();
  const daysFromMonday = (day + 6) % 7;

  result.setDate(result.getDate() - daysFromMonday);

  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatTime(value: string) {
  const [hours, minutes] = value
    .slice(11, 16)
    .split(":")
    .map(Number);

  const period = hours >= 12 ? "PM" : "AM";

  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatWeekRange(start: Date) {
  const end = addDays(start, 6);

  const first = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const last = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${first} – ${last}`;
}

export default function ManagerSchedulePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const [weekStart, setWeekStart] = useState<Date | null>(null);

  const [form, setForm] = useState<ShiftForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [publishingId, setPublishingId] = useState<number | null>(null);

  const [autoScheduling, setAutoScheduling] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [availabilityConflicts, setAvailabilityConflicts] = useState<
        { type: string; message: string }[]
 >([]);

    const [overrideReason, setOverrideReason] = useState("");
    const [showOverride, setShowOverride] = useState(false);

  const days = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart ?? new Date(2000, 0, 3), index)
  );

  useEffect(() => {
  setWeekStart(startOfWeek(new Date()));
}, []);

  function updateForm(field: keyof ShiftForm, value: string) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  async function loadData() {
    const [dataResponse, shiftsResponse] = await Promise.all([
      fetch("/api/manager/scheduling-data", {
        cache: "no-store",
      }),
      fetch("/api/manager/shifts", {
        cache: "no-store",
      }),
    ]);

    const schedulingData = await dataResponse.json();
    const shiftsData = await shiftsResponse.json();

    if (!dataResponse.ok) {
      throw new Error(
        schedulingData.error || "Failed to load scheduling data."
      );
    }

    if (!shiftsResponse.ok) {
      throw new Error(
        shiftsData.error || "Failed to load shifts."
      );
    }

    setEmployees(schedulingData.employees);
    setPositions(schedulingData.positions);
    setShifts(shiftsData);
  }

  useEffect(() => {
    loadData()
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load scheduling data."
        );
      })
      .finally(() => setLoading(false));
  }, []);

  function openCreateForm(date?: string) {
    setEditingId(null);
    setForm({
      ...emptyForm,
      shiftDate: date ?? dateKey(new Date()),
    });
    setShowOverride(false);
    setAvailabilityConflicts([]);
    setOverrideReason("");
    setShowForm(true);
    setError("");
    setMessage("");
  }

  function startEditing(shift: Shift) {
    setEditingId(shift.id);

    setForm({
      userId: String(shift.user_id ?? ""),
      positionId: String(shift.position_id),
      shiftDate: shift.start_time.slice(0, 10),
      startTime: shift.start_time.slice(11, 16),
      endTime: shift.end_time.slice(11, 16),
    });

    setShowOverride(false);
    setAvailabilityConflicts([]);
    setOverrideReason("");

    setShowForm(true);
    setError("");
    setMessage("");
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
    setError("");
  }

 
async function saveShift(
  e: React.FormEvent<HTMLFormElement>,
  overrideAvailability = false
) {
  e.preventDefault();

  setError("");
  setMessage("");

  if (
    !form.positionId ||
    !form.shiftDate ||
    !form.startTime ||
    !form.endTime
  ) {
    setError("Please complete all shift fields.");
    return;
  }

  if (form.startTime >= form.endTime) {
    setError("End time must be after start time.");
    return;
  }

  if (overrideAvailability && overrideReason.trim().length < 5) {
    setError("Please provide an override reason of at least 5 characters.");
    return;
  }

  setSaving(true);

  try {
    const isEditing = editingId !== null;

    const response = await fetch(
      isEditing
        ? `/api/manager/shifts/${editingId}`
        : "/api/manager/shifts",
      {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: form.userId === "" ? null : Number(form.userId),
          positionId: Number(form.positionId),
          startTime: `${form.shiftDate}T${form.startTime}`,
          endTime: `${form.shiftDate}T${form.endTime}`,
          overrideAvailability,
          overrideReason: overrideAvailability
            ? overrideReason.trim()
            : undefined,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      if (data.requiresOverride && Array.isArray(data.conflicts)) {
        setAvailabilityConflicts(data.conflicts);
        setShowOverride(true);
        setError("");
        return;
      }

      throw new Error(data.error || "Failed to save shift.");
    }

    await loadData();

    setWeekStart(startOfWeek(parseDate(form.shiftDate)));
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });

    setShowOverride(false);
    setAvailabilityConflicts([]);
    setOverrideReason("");

    setMessage(
      overrideAvailability
        ? "Shift saved with manager override!"
        : isEditing
        ? "Draft shift updated successfully!"
        : "Shift saved as a draft!"
    );
  } catch (err) {
    setError(
      err instanceof Error ? err.message : "Failed to save shift."
    );
  } finally {
    setSaving(false);
  }
}
 

  async function deleteShift(shiftId: number) {
    if (!window.confirm("Delete this draft shift?")) {
      return;
    }

    setError("");
    setMessage("");
    setDeletingId(shiftId);

    try {
      const response = await fetch(
        `/api/manager/shifts/${shiftId}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete shift.");
      }

      await loadData();

      if (editingId === shiftId) {
        closeForm();
      }

      setMessage("Draft shift deleted successfully!");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete shift."
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function autoSchedule() {
  if (!weekStart) return;

  const selectedWeek = dateKey(weekStart);

  const confirmed = window.confirm(
    `Auto Schedule: ${formatWeekRange(weekStart)}\n\n` +
      "This will automatically assign employees to unassigned draft shifts.\n\n" +
      "The system will consider positions, availability, " +
      "approved time off, overlapping shifts, and fairness.\n\n" +
      "Existing assignments and published shifts will not be changed.\n\n" +
      "Continue?"
  );

  if (!confirmed) return;

  setError("");
  setMessage("");
  setAutoScheduling(true);

  try {
    const response = await fetch("/api/manager/auto-schedule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        weekStart: selectedWeek,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to auto schedule.");
    }

    await loadData();

    setMessage(
      `Auto Scheduling complete! ${data.assignedCount} shift(s) assigned. ` +
        `${data.unfilledCount} shift(s) remain unassigned.`
    );
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Failed to auto schedule."
    );
  } finally {
    setAutoScheduling(false);
  }
}

  if (weekStart === null) {
  return <main className="p-8">Loading schedule...</main>;
}

  return (
    
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Schedule Management
            </h1>
            <p className="mt-1 text-gray-600">
              Build and manage your restaurant&apos;s weekly schedule.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Back to Dashboard
          </Link>
        </header>

        {message && (
          <p className="mb-5 rounded-lg bg-green-50 p-4 text-green-700">
            {message}
          </p>
        )}

        {error && (
          <p className="mb-5 rounded-lg bg-red-50 p-4 text-red-700">
            {error}
          </p>
        )}

        {/* Calendar */}
        <section className="rounded-xl bg-white p-4 shadow-sm md:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {formatWeekRange(weekStart)}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Weekly Schedule
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  setWeekStart(addDays(weekStart, -7))
                }
                className="rounded-lg border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50"
              >
                ←
              </button>

              <button
                onClick={() =>
                  setWeekStart(startOfWeek(new Date()))
                }
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Today
              </button>

              <button
                onClick={() =>
                  setWeekStart(addDays(weekStart, 7))
                }
                className="rounded-lg border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50"
              >
                →
              </button>

              <button
                type="button"
                onClick={autoSchedule}
                disabled={autoScheduling || loading || saving}
                className="rounded-lg border border-blue-600 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
             {autoScheduling ? "Scheduling..." : "Auto Schedule"}
            </button>

              <button
                onClick={() => openCreateForm()}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
              >
                + Add Shift
              </button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-4 text-sm text-gray-600">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-yellow-200" />
              Draft
            </span>

            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-green-200" />
              Published
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="grid min-w-[840px] grid-cols-7 gap-2">
              {days.map((day) => {
                const key = dateKey(day);
                const isToday = key === dateKey(new Date());

                const dayShifts = shifts.filter(
                  (shift) =>
                    shift.start_time.slice(0, 10) === key &&
                    shift.status !== "cancelled"
                );

                async function publishShift(shiftId: number) {
  const confirmed = window.confirm(
    "Publish this shift? It will become visible to the assigned employee."
  );

  if (!confirmed) return;

  setError("");
  setMessage("");
  setPublishingId(shiftId);

  try {
    const response = await fetch(
      `/api/manager/shifts/${shiftId}`,
      {
        method: "PATCH",
      }
    );

    const data = await response.json();

    if (!response.ok) {
  if (data.requiresOverride) {
    const messages = (data.conflicts ?? [])
      .map((conflict: { message: string }) => conflict.message)
      .join("\n");

    alert(
      `Cannot publish this shift because of an availability conflict.\n\n` +
      `${messages}\n\n` +
      `Edit the shift and provide a manager override reason before publishing.`
    );
    return;
  }

  alert(data.error || "Failed to publish shift");
  return;
}

    await loadData();

    setMessage("Shift published successfully!");
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Failed to publish shift."
    );
  } finally {
    setPublishingId(null);
  }
}

                return (
                  <div
                    key={key}
                    className="min-h-[260px] rounded-lg border border-gray-200 bg-gray-50"
                  >
                    <button
                      type="button"
                      onClick={() => openCreateForm(key)}
                      className={`w-full rounded-t-lg border-b border-gray-200 p-3 text-center hover:bg-gray-100 ${
                        isToday ? "bg-blue-50" : "bg-white"
                      }`}
                    >
                      <p className="text-xs font-medium uppercase text-gray-500">
                        {day.toLocaleDateString("en-US", {
                          weekday: "short",
                        })}
                      </p>

                      <p
                        className={`mt-1 text-xl font-semibold ${
                          isToday ? "text-blue-700" : "text-gray-900"
                        }`}
                      >
                        {day.getDate()}
                      </p>

                      <p className="mt-1 text-xs text-gray-400">
                        + Add
                      </p>
                    </button>

                    <div className="space-y-2 p-2">
                      {loading ? (
                        <p className="text-xs text-gray-400">
                          Loading...
                        </p>
                      ) : dayShifts.length === 0 ? (
                        <p className="py-4 text-center text-xs text-gray-400">
                          No shifts
                        </p>
                      ) : (
                        dayShifts.map((shift) => (
                          <div
                            key={shift.id}
                            className={`rounded-lg border p-2 text-xs ${
                              shift.status === "published"
                                ? "border-green-200 bg-green-100"
                                : "border-yellow-200 bg-yellow-100"
                            }`}
                          >
                            <p className="font-semibold text-gray-900">
                              {shift.first_name && shift.last_name
                                ? `${shift.first_name} ${shift.last_name}`
                                : "Unassigned"}
                            </p>

                            <p className="mt-1 text-gray-700">
                              {shift.position_name}
                            </p>

                            <p className="mt-1 font-medium text-gray-800">
                              {formatTime(shift.start_time)}
                            </p>

                            <p className="text-gray-800">
                              {formatTime(shift.end_time)}
                            </p>

                            <p className="mt-2 capitalize text-gray-600">
                              {shift.status}
                            </p>

                            {shift.status === "draft" && (
                              <div className="mt-2 flex flex-wrap gap-2 border-t border-gray-300 pt-2">
                                
<button
  type="button"
  onClick={() => publishShift(shift.id)}
  disabled={publishingId !== null || deletingId !== null || saving}
  className="font-semibold text-green-800 hover:underline disabled:opacity-50"
>
  {publishingId === shift.id ? "Publishing..." : "Publish"}
</button>

                                <button
                                  onClick={() => startEditing(shift)}
                                  className="font-semibold text-blue-700 hover:underline"
                                >
                                  Edit
                                </button>

                                <button
                                  onClick={() => deleteShift(shift.id)}
                                  disabled={deletingId !== null}
                                  className="font-semibold text-red-700 hover:underline disabled:opacity-50"
                                >
                                  {deletingId === shift.id
                                    ? "Deleting..."
                                    : "Delete"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Shift form */}
        {showForm && (
          <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingId !== null
                  ? "Edit Draft Shift"
                  : "Create a Shift"}
              </h2>

              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Close ✕
              </button>
            </div>

            <form onSubmit={saveShift} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="employee"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    Employee
                  </label>

                  <select
  value={form.userId}
  onChange={(e) =>
    setForm((current) => ({
      ...current,
      userId: e.target.value,
    }))
  }
>
  <option value="">Open Shift (Unassigned)</option>

  {employees.map((employee) => (
    <option key={employee.id} value={employee.id}>
      {employee.first_name} {employee.last_name}
    </option>
  ))}
</select>
                </div>

                <div>
                  <label
                    htmlFor="position"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    Position
                  </label>

                  <select
                    id="position"
                    value={form.positionId}
                    onChange={(e) =>
                      updateForm("positionId", e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                  >
                    <option value="">Select a position</option>
                    {positions.map((position) => (
                      <option key={position.id} value={position.id}>
                        {position.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="shift-date"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Shift Date
                </label>

                <input
                  id="shift-date"
                  type="date"
                  required
                  value={form.shiftDate}
                  onChange={(e) =>
                    updateForm("shiftDate", e.target.value)
                  }
                  className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="shift-start"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    Start Time
                  </label>

                  <input
                    id="shift-start"
                    type="time"
                    required
                    value={form.startTime}
                    onChange={(e) =>
                      updateForm("startTime", e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                  />
                </div>

                <div>
                  <label
                    htmlFor="shift-end"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    End Time
                  </label>

                  <input
                    id="shift-end"
                    type="time"
                    required
                    value={form.endTime}
                    onChange={(e) =>
                      updateForm("endTime", e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
                  />
                </div>
              </div>

            
{showOverride && (
  <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
    <h3 className="mb-2 font-semibold text-amber-900">
      ⚠ Availability Conflict
    </h3>

    <p className="mb-3 text-sm text-amber-800">
      This shift conflicts with the employee&apos;s availability.
      A manager override is required to continue.
    </p>

    <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-amber-900">
      {availabilityConflicts.map((conflict, index) => (
        <li key={index}>{conflict.message}</li>
      ))}
    </ul>

    <label
      htmlFor="override-reason"
      className="mb-2 block text-sm font-medium text-gray-800"
    >
      Reason for override
    </label>

    <textarea
      id="override-reason"
      value={overrideReason}
      onChange={(e) => setOverrideReason(e.target.value)}
      placeholder="Explain why this employee must be scheduled outside their availability..."
      rows={3}
      className="w-full rounded-lg border border-gray-300 p-3 text-gray-900"
    />

    <button
      type="button"
      disabled={saving || overrideReason.trim().length < 5}
      onClick={(e) => {
        const formElement = e.currentTarget.closest("form");
        if (formElement) {
          saveShift(
            {
              preventDefault: () => {},
            } as React.FormEvent<HTMLFormElement>,
            true
          );
        }
      }}
      className="mt-3 rounded-lg bg-amber-700 px-5 py-2 font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
    >
      {saving ? "Saving..." : "Override & Save Shift"}
    </button>
  </div>
)}


              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving || loading}
                  className="rounded-lg bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : editingId !== null
                    ? "Save Changes"
                    : "Save Draft Shift"}
                </button>

                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="rounded-lg border border-gray-300 px-6 py-3 font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}


//deployment test