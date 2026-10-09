"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type CardType = "none" | "bartender" | "manager";
type Role = "employee" | "manager" | "owner";

type StaffMember = {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  role: Role;
  positions: string[];
  created_at: string;
  date_of_birth: string | null;
  liquor_card_type: CardType;
  liquor_card_expires_on: string | null;
};

type Position = {
  id: number;
  name: string;
};

type AccountRequest = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: "employee" | "manager";
  created_at: string;
};

export default function StaffManagementPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [requests, setRequests] = useState<AccountRequest[]>([]);

  const [currentRole, setCurrentRole] = useState<
    "manager" | "owner" | null
  >(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<number[]>([]);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [liquorCardType, setLiquorCardType] = useState<CardType>("none");
  const [liquorCardExpiresOn, setLiquorCardExpiresOn] = useState("");

  const loadData = useCallback(async () => {
    try {
      const responses = await Promise.all([
        fetch("/api/manager/staff"),
        fetch("/api/manager/staff", { method: "OPTIONS" }),
        fetch("/api/manager/approvals"),
        fetch("/api/manager/permissions"),
      ]);

      if (responses.some((response) => !response.ok)) {
        throw new Error("Failed to load staff information.");
      }

      const [
        staffData,
        positionData,
        requestData,
        permissionData,
      ] = await Promise.all(
        responses.map((response) => response.json())
      );

      setStaff(staffData as StaffMember[]);
      setPositions(positionData as Position[]);
      setRequests(requestData as AccountRequest[]);

      setCurrentRole(
        permissionData.role === "owner" ? "owner" : "manager"
      );

      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load staff information."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleApproval(
    request: AccountRequest,
    action: "approve" | "deny"
  ) {
    const name = `${request.first_name} ${request.last_name}`;

    const confirmed = window.confirm(
      `Are you sure you want to ${action} ${name}'s ${request.role} account?`
    );

    if (!confirmed) return;

    setProcessingId(request.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/manager/approvals", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: request.id,
          action,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to process account request."
        );
      }

      await loadData();

      setMessage(
        action === "approve"
          ? `${name}'s ${request.role} account was approved.`
          : `${name}'s account request was denied.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setProcessingId(null);
    }
  }

  function startEditing(member: StaffMember) {
    setEditingId(member.id);

    setSelectedPositions(
      positions
        .filter((position) =>
          member.positions.includes(position.name)
        )
        .map((position) => position.id)
    );

    setDateOfBirth(member.date_of_birth ?? "");
    setLiquorCardType(member.liquor_card_type ?? "none");
    setLiquorCardExpiresOn(member.liquor_card_expires_on ?? "");

    setError("");
    setMessage("");
  }

  function togglePosition(id: number) {
    setSelectedPositions((current) =>
      current.includes(id)
        ? current.filter((positionId) => positionId !== id)
        : [...current, id]
    );
  }

  async function saveMember(member: StaffMember) {
    if (liquorCardType !== "none" && !liquorCardExpiresOn) {
      setError("Enter an expiration date for the liquor card.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/manager/staff", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: member.id,
          ...(member.role === "employee"
            ? { positionIds: selectedPositions }
            : {}),
          dateOfBirth: dateOfBirth || null,
          liquorCardType,
          liquorCardExpiresOn:
            liquorCardType === "none"
              ? null
              : liquorCardExpiresOn,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to update staff member."
        );
      }

      setEditingId(null);
      await loadData();

      setMessage(
        `${member.first_name} ${member.last_name}'s information was updated.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeEmployee(member: StaffMember) {
    const confirmed = window.confirm(
      `Remove ${member.first_name} ${member.last_name}?\n\n` +
        "Their account will be deactivated and upcoming published shifts " +
        "released for pickup. This cannot be undone from Staff Management."
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/manager/staff/${member.id}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to remove employee."
        );
      }

      setEditingId(null);
      await loadData();

      setMessage(
        `${member.first_name} ${member.last_name} was removed. ` +
          `${data.releasedShifts} upcoming shift(s) released.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setSaving(false);
    }
  }

  function editForm(member: StaffMember) {
    if (editingId !== member.id) return null;

    return (
      <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <h4 className="font-semibold text-gray-900">
          Edit Staff Information
        </h4>

        <p className="mt-1 text-sm text-gray-600">
          These details will be used for scheduling eligibility
          and liquor-card coverage.
        </p>

        {member.role === "employee" && (
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-gray-900">
              Qualified Positions
            </legend>

            <p className="mt-1 text-sm text-gray-600">
              Select every position this employee can work.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {positions.map((position) => (
                <label
                  key={position.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800"
                >
                  <input
                    type="checkbox"
                    checked={selectedPositions.includes(position.id)}
                    onChange={() => togglePosition(position.id)}
                    disabled={saving}
                  />
                  {position.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-800">
            Date of Birth
            <input
              type="date"
              value={dateOfBirth}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDateOfBirth(e.target.value)}
              disabled={saving}
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
            />
          </label>

          <label className="block text-sm font-medium text-gray-800">
            Liquor Card Type
            <select
              value={liquorCardType}
              onChange={(e) => {
                const value = e.target.value as CardType;
                setLiquorCardType(value);

                if (value === "none") {
                  setLiquorCardExpiresOn("");
                }
              }}
              disabled={saving}
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
            >
              <option value="none">None</option>
              <option value="bartender">Bartender Card</option>
              <option value="manager">Manager Card</option>
            </select>
          </label>

          {liquorCardType !== "none" && (
            <label className="block text-sm font-medium text-gray-800">
              Liquor Card Expiration
              <input
                type="date"
                value={liquorCardExpiresOn}
                onChange={(e) =>
                  setLiquorCardExpiresOn(e.target.value)
                }
                disabled={saving}
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
              />
            </label>
          )}
        </div>

        <p className="mt-4 text-xs text-gray-600">
          A bartender card does not count as manager-card supervision.
          Missing information will be treated conservatively when
          scheduling rules are implemented.
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setEditingId(null)}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => void saveMember(member)}
            disabled={saving}
            className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    );
  }

  const employees = staff.filter(
    (member) => member.role === "employee"
  );

  const managers = staff.filter(
    (member) =>
      member.role === "manager" || member.role === "owner"
  );

  return (
    <main className="min-h-screen bg-gray-100 p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-gray-700 hover:underline"
        >
          ← Back to Dashboard
        </Link>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Staff Management
            </h1>

            <p className="mt-2 text-gray-600">
              Manage employees, managers, and account requests.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm">
              {staff.length} Staff Members
            </span>

            <span className="rounded-lg bg-amber-100 px-4 py-2 text-sm font-medium text-amber-800">
              {requests.length} Pending Requests
            </span>
          </div>
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

        {loading ? (
          <p className="mt-8 text-gray-600">Loading staff...</p>
        ) : (
          <>
            {/* ACCOUNT REQUESTS */}
            <section className="mt-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-gray-900">
                  Pending Account Requests ({requests.length})
                </h2>

                <button
                  type="button"
                  onClick={() => void loadData()}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Refresh Requests
                </button>
              </div>

              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                {!requests.length ? (
                  <p className="p-6 text-sm text-gray-600">
                    No pending account requests.
                  </p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {requests.map((request) => (
                      <div
                        key={request.id}
                        className="flex flex-wrap items-center justify-between gap-4 p-5"
                      >
                        <div>
                          <h3 className="font-semibold text-gray-900">
                            {request.first_name}{" "}
                            {request.last_name}
                          </h3>

                          <p className="mt-1 text-sm text-gray-600">
                            {request.email}
                          </p>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                                request.role === "manager"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-blue-100 text-blue-800"
                              }`}
                            >
                              {request.role}
                            </span>

                            <span className="text-xs text-gray-500">
                              Requested{" "}
                              {new Date(
                                request.created_at
                              ).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void handleApproval(
                                request,
                                "approve"
                              )
                            }
                            disabled={processingId !== null}
                            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
                          >
                            {processingId === request.id
                              ? "Processing..."
                              : "Approve"}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void handleApproval(
                                request,
                                "deny"
                              )
                            }
                            disabled={processingId !== null}
                            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="mt-3 text-sm text-gray-600">
                Approved accounts can log in immediately.
                Both Managers and Owners can review Employee
                and Manager requests.
              </p>
            </section>

            {/* EMPLOYEES */}
            <section className="mt-10">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
                Employees ({employees.length})
              </h2>

              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                {!employees.length ? (
                  <p className="p-6 text-gray-600">
                    No employees have been added yet.
                  </p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {employees.map((employee) => (
                      <div key={employee.id} className="p-5">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <h3 className="font-semibold text-gray-900">
                              {employee.first_name}{" "}
                              {employee.last_name}
                            </h3>

                            <p className="mt-1 text-sm text-gray-600">
                              {employee.email ||
                                "No email / no login"}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                editingId === employee.id
                                  ? setEditingId(null)
                                  : startEditing(employee)
                              }
                              disabled={saving}
                              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
                            >
                              {editingId === employee.id
                                ? "Cancel"
                                : "Edit Employee"}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void removeEmployee(employee)
                              }
                              disabled={saving}
                              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                            >
                              Remove Employee
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {employee.positions.length ? (
                            employee.positions.map((position) => (
                              <span
                                key={position}
                                className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                              >
                                {position}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-gray-400">
                              No positions assigned
                            </span>
                          )}
                        </div>

                        {editForm(employee)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* MANAGEMENT */}
            <section className="mt-10">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
                Management ({managers.length})
              </h2>

              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                {!managers.length ? (
                  <p className="p-6 text-gray-600">
                    No managers found.
                  </p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {managers.map((manager) => (
                      <div key={manager.id} className="p-5">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <h3 className="font-semibold text-gray-900">
                              {manager.first_name}{" "}
                              {manager.last_name}
                            </h3>

                            <p className="mt-1 text-sm text-gray-600">
                              {manager.email}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-medium capitalize text-white">
                              {manager.role}
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                editingId === manager.id
                                  ? setEditingId(null)
                                  : startEditing(manager)
                              }
                              disabled={saving}
                              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
                            >
                              {editingId === manager.id
                                ? "Cancel"
                                : "Edit Details"}
                            </button>
                          </div>
                        </div>

                        {editForm(manager)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}