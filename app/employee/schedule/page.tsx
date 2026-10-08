"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Shift = {
  id: number;
  start_time: string;
  end_time: string;
  status: string;
  pickup_status: "not_posted" | "posted";
  position_name: string;
  restaurant_name: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMonday(date: Date) {
  const monday = new Date(date);
  const day = monday.getDay();

  monday.setDate(monday.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  return monday;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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

export default function EmployeeSchedulePage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [weekStart, setWeekStart] = useState<Date | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [processingId, setProcessingId] = useState<number | null>(null);

  const loadShifts = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/employee/shifts", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load schedule");
      }

      const data: Shift[] = await response.json();

      setShifts(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load your schedule."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setWeekStart(getMonday(new Date()));
    void loadShifts();
  }, [loadShifts]);

  function changeWeek(amount: number) {
    setWeekStart((current) => {
      if (current === null) return current;

      const next = new Date(current);
      next.setDate(next.getDate() + amount * 7);

      return next;
    });

    setMessage("");
    setError("");
  }

  async function updateShiftPosting(
    shiftId: number,
    action: "post" | "withdraw"
  ) {
    setProcessingId(shiftId);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/employee/post-shift", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shiftId,
          action,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update shift posting");
      }

      setShifts((current) =>
        current.map((shift) =>
          shift.id === shiftId
            ? {
                ...shift,
                pickup_status: data.shift.pickup_status,
              }
            : shift
        )
      );

      setMessage(
        action === "post"
          ? "Your shift has been posted for pickup. You are still responsible for this shift until a manager approves a transfer."
          : "Your shift posting has been withdrawn."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong"
      );
    } finally {
      setProcessingId(null);
    }
  }

  if (weekStart === null) {
    return <main className="p-8">Loading schedule...</main>;
  }

  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);

    return date;
  });

  const weekEnd = weekDates[6];

  return (
    <main
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "32px 20px",
      }}
    >
      <Link href="/dashboard">← Back to Dashboard</Link>

      <h1 style={{ marginTop: "24px" }}>My Schedule</h1>

      <p>
        View your upcoming published shifts and post shifts for
        other employees to pick up.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          margin: "32px 0 20px",
        }}
      >
        <button
          type="button"
          onClick={() => changeWeek(-1)}
        >
          ← Previous
        </button>

        <h2
          style={{
            fontSize: "18px",
            textAlign: "center",
          }}
        >
          {weekStart.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}

          {" – "}

          {weekEnd.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </h2>

        <button
          type="button"
          onClick={() => changeWeek(1)}
        >
          Next →
        </button>
      </div>

      {loading && <p>Loading schedule...</p>}

      {error && (
        <p
          style={{
            color: "#dc2626",
            marginBottom: "16px",
          }}
        >
          {error}
        </p>
      )}

      {message && (
        <p
          style={{
            color: "#15803d",
            marginBottom: "16px",
          }}
        >
          {message}
        </p>
      )}

      {!loading && !error && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: "8px",
            overflowX: "auto",
          }}
        >
          {weekDates.map((date, index) => {
            const dateString = formatDate(date);

            const dayShifts = shifts.filter(
              (shift) =>
                shift.start_time.slice(0, 10) === dateString
            );

            return (
              <div
                key={dateString}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  padding: "12px 8px",
                  minHeight: "180px",
                  minWidth: "110px",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: "12px",
                  }}
                >
                  {DAYS[index]} {date.getDate()}
                </div>

                {dayShifts.length === 0 ? (
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#888",
                    }}
                  >
                    No shifts
                  </p>
                ) : (
                  dayShifts.map((shift) => {
                    const isPosted =
                      shift.pickup_status === "posted";

                    return (
                      <div
                        key={shift.id}
                        style={{
                          background: isPosted
                            ? "#fef3c7"
                            : "#dcfce7",
                          color: isPosted
                            ? "#92400e"
                            : "#166534",
                          borderRadius: "6px",
                          padding: "10px 8px",
                          marginBottom: "8px",
                          fontSize: "12px",
                        }}
                      >
                        <strong>{shift.position_name}</strong>

                        <div style={{ marginTop: "6px" }}>
                          {formatTime(shift.start_time)}
                          {" – "}
                          {formatTime(shift.end_time)}
                        </div>

                        {isPosted && (
                          <div
                            style={{
                              marginTop: "8px",
                              fontWeight: 600,
                            }}
                          >
                            Posted for Pickup
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={processingId !== null}
                          onClick={() =>
                            updateShiftPosting(
                              shift.id,
                              isPosted ? "withdraw" : "post"
                            )
                          }
                          style={{
                            marginTop: "10px",
                            padding: "7px 9px",
                            borderRadius: "5px",
                            border: "none",
                            background: isPosted
                              ? "#92400e"
                              : "#166534",
                            color: "white",
                            cursor:
                              processingId !== null
                                ? "not-allowed"
                                : "pointer",
                            width: "100%",
                            fontSize: "11px",
                            opacity:
                              processingId !== null ? 0.6 : 1,
                          }}
                        >
                          {processingId === shift.id
                            ? "Updating..."
                            : isPosted
                            ? "Withdraw Posting"
                            : "Post Shift"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}

      <p
        style={{
          marginTop: "24px",
          fontSize: "13px",
          color: "#6b7280",
        }}
      >
        Posting a shift does not remove you from the schedule.
        You remain responsible for working it until another
        employee is approved to take it.
      </p>
    </main>
  );
}