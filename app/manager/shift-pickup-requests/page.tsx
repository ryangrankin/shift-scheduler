"use client";

import { useCallback, useEffect, useState } from "react";

type PickupRequest = {
  id: number;
  shift_id: number;
  requested_by: number;
  status: string;
  first_name: string;
  last_name: string;
  position_name: string;
  start_time: string;
  end_time: string;
};

export default function ManagerShiftPickupRequestsPage() {
  const [requests, setRequests] = useState<PickupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadRequests = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/manager/shift-pickup-requests",
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load requests");
      }

      setRequests(data);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load requests"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function reviewRequest(
    requestId: number,
    action: "approve" | "deny"
  ) {
    setProcessingId(requestId);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/manager/shift-pickup-requests/${requestId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to review request");
      }

      setMessage(
        action === "approve"
          ? "Shift pickup request approved. The employee has been assigned."
          : "Shift pickup request denied."
      );

      await loadRequests();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong"
      );
    } finally {
      setProcessingId(null);
    }
  }

  function formatDate(value: string) {
    const date = value.slice(0, 10);
    const [year, month, day] = date.split("-");
    return `${month}/${day}/${year}`;
  }

  function formatTime(value: string) {
    const time = value.slice(11, 16);
    const [hours, minutes] = time.split(":").map(Number);
    const hour = hours % 12 || 12;
    return `${hour}:${String(minutes).padStart(2, "0")} ${
      hours >= 12 ? "PM" : "AM"
    }`;
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 20 }}>
      <div style={{ marginBottom: 30 }}>
        <h1>Shift Pickup Requests</h1>
        <p>Review employees requesting to work available shifts.</p>
      </div>

      {error && (
        <p style={{ color: "crimson", marginBottom: 16 }}>
          {error}
        </p>
      )}

      {message && (
        <p style={{ color: "green", marginBottom: 16 }}>
          {message}
        </p>
      )}

      {loading ? (
        <p>Loading requests...</p>
      ) : requests.length === 0 ? (
        <div
          style={{
            padding: 24,
            border: "1px solid #ddd",
            borderRadius: 8,
          }}
        >
          <p>No pending shift pickup requests.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {requests.map((request) => (
            <div
              key={request.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 20,
              }}
            >
              <h3 style={{ marginTop: 0 }}>
                {request.first_name} {request.last_name}
              </h3>

              <p>
                <strong>Position:</strong> {request.position_name}
              </p>

              <p>
                <strong>Date:</strong> {formatDate(request.start_time)}
              </p>

              <p>
                <strong>Time:</strong>{" "}
                {formatTime(request.start_time)} –{" "}
                {formatTime(request.end_time)}
              </p>

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 20,
                }}
              >
                <button
                  type="button"
                  disabled={processingId !== null}
                  onClick={() => reviewRequest(request.id, "approve")}
                  style={{
                    background: "#15803d",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    padding: "10px 18px",
                    cursor: "pointer",
                  }}
                >
                  {processingId === request.id
                    ? "Processing..."
                    : "Approve"}
                </button>

                <button
                  type="button"
                  disabled={processingId !== null}
                  onClick={() => reviewRequest(request.id, "deny")}
                  style={{
                    background: "#dc2626",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    padding: "10px 18px",
                    cursor: "pointer",
                  }}
                >
                  {processingId === request.id
                    ? "Processing..."
                    : "Deny"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}