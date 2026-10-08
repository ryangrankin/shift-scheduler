"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type CardType = "none" | "bartender" | "manager";
type StaffMember = {
  id: number; first_name: string; last_name: string; email: string;
  role: "employee" | "manager" | "owner"; positions: string[];
  created_at: string; date_of_birth: string | null;
  liquor_card_type: CardType; liquor_card_expires_on: string | null;
};
type Position = { id: number; name: string };
type Invitation = {
  id: number; first_name: string; last_name: string; email: string;
  created_at: string; expires_at: string; status: "pending" | "expired";
  positions: string[];
};

export default function StaffManagementPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<number[]>([]);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [liquorCardType, setLiquorCardType] = useState<CardType>("none");
  const [liquorCardExpiresOn, setLiquorCardExpiresOn] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePositionIds, setInvitePositionIds] = useState<number[]>([]);

  const loadData = useCallback(async () => {
    try {
      const responses = await Promise.all([
        fetch("/api/manager/staff"),
        fetch("/api/manager/staff", { method: "OPTIONS" }),
        fetch("/api/manager/invitations"),
      ]);
      if (responses.some((response) => !response.ok)) throw new Error("Load failed");
      const [staffData, positionData, invitationData] = await Promise.all(responses.map((r) => r.json()));
      setStaff(staffData as StaffMember[]);
      setPositions(positionData as Position[]);
      setInvitations(invitationData as Invitation[]);
      setError("");
    } catch {
      setError("Could not load staff information.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  function startEditing(member: StaffMember) {
    setEditingId(member.id);
    setSelectedPositions(positions.filter((p) => member.positions.includes(p.name)).map((p) => p.id));
    setDateOfBirth(member.date_of_birth ?? "");
    setLiquorCardType(member.liquor_card_type ?? "none");
    setLiquorCardExpiresOn(member.liquor_card_expires_on ?? "");
    setError(""); setMessage("");
  }

  function togglePosition(id: number, invitation = false) {
    const setter = invitation ? setInvitePositionIds : setSelectedPositions;
    setter((current) => current.includes(id) ? current.filter((n) => n !== id) : [...current, id]);
  }

  async function saveMember(member: StaffMember) {
    if (liquorCardType !== "none" && !liquorCardExpiresOn) {
      setError("Enter an expiration date for the liquor card."); return;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/manager/staff", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: member.id,
          ...(member.role === "employee" ? { positionIds: selectedPositions } : {}),
          dateOfBirth: dateOfBirth || null,
          liquorCardType,
          liquorCardExpiresOn: liquorCardType === "none" ? null : liquorCardExpiresOn,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update staff member.");
      setEditingId(null);
      await loadData();
      setMessage(`${member.first_name} ${member.last_name}'s information was updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setSaving(false); }
  }

  async function removeEmployee(member: StaffMember) {
    if (!window.confirm(`Remove ${member.first_name} ${member.last_name}?\n\nTheir account will be deactivated and upcoming published shifts released for pickup. This cannot be undone from Staff Management.`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/manager/staff/${member.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to remove employee.");
      setEditingId(null);
      await loadData();
      setMessage(`${member.first_name} ${member.last_name} was removed. ${data.releasedShifts} upcoming shift(s) released.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setSaving(false); }
  }

  async function sendInvitation(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (!invitePositionIds.length) {
    setError("Select at least one position for the employee.");
    return;
  }

  const firstName = inviteFirstName.trim();
  const lastName = inviteLastName.trim();
  const email = inviteEmail.trim();

  if (!firstName || !lastName) {
    setError("First and last name are required.");
    return;
  }

  setSendingInvite(true);
  setError("");
  setMessage("");

  try {
    const response = await fetch("/api/manager/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        firstName,
        lastName,
        email: email || null,
        positionIds: invitePositionIds,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to add employee.");
    }

    setInviteFirstName("");
    setInviteLastName("");
    setInviteEmail("");
    setInvitePositionIds([]);
    setShowInviteForm(false);

    await loadData();

    setMessage(
      email
        ? `Invitation sent to ${email}.`
        : `${firstName} ${lastName} was added as an employee.`
    );
  } catch (err) {
    setError(
      err instanceof Error ? err.message : "Something went wrong."
    );
  } finally {
    setSendingInvite(false);
  }
}

  function editForm(member: StaffMember) {
    if (editingId !== member.id) return null;
    return (
      <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <h4 className="font-semibold text-gray-900">Edit Staff Information</h4>
        <p className="mt-1 text-sm text-gray-600">These details will be used for scheduling eligibility and liquor-card coverage.</p>
        {member.role === "employee" && (
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-gray-900">Qualified Positions</legend>
            <p className="mt-1 text-sm text-gray-600">Select every position this employee can work.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {positions.map((position) => (
                <label key={position.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800">
                  <input type="checkbox" checked={selectedPositions.includes(position.id)} onChange={() => togglePosition(position.id)} disabled={saving} />
                  {position.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-800">
            Date of Birth
            <input type="date" value={dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDateOfBirth(e.target.value)} disabled={saving} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900" />
          </label>
          <label className="block text-sm font-medium text-gray-800">
            Liquor Card Type
            <select value={liquorCardType} onChange={(e) => { const value = e.target.value as CardType; setLiquorCardType(value); if (value === "none") setLiquorCardExpiresOn(""); }} disabled={saving} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900">
              <option value="none">None</option>
              <option value="bartender">Bartender Card</option>
              <option value="manager">Manager Card</option>
            </select>
          </label>
          {liquorCardType !== "none" && (
            <label className="block text-sm font-medium text-gray-800">
              Liquor Card Expiration
              <input type="date" value={liquorCardExpiresOn} onChange={(e) => setLiquorCardExpiresOn(e.target.value)} disabled={saving} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900" />
            </label>
          )}
        </div>
        <p className="mt-4 text-xs text-gray-600">A bartender card does not count as manager-card supervision. Missing information will be treated conservatively when scheduling rules are implemented.</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={() => setEditingId(null)} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">Cancel</button>
          <button type="button" onClick={() => void saveMember(member)} disabled={saving} className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save Changes"}</button>
        </div>
      </div>
    );
  }

  const employees = staff.filter((m) => m.role === "employee");
  const managers = staff.filter((m) => m.role === "manager" || m.role === "owner");

  return (
    <main className="min-h-screen bg-gray-100 p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/dashboard" className="text-sm font-medium text-gray-700 hover:underline">← Back to Dashboard</Link>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Staff Management</h1>
            <p className="mt-2 text-gray-600">Manage your restaurant&apos;s employees and positions.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm">{staff.length} Staff Members</span>
            <button type="button" onClick={() => setShowInviteForm((v) => !v)} className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white">{showInviteForm ? "Cancel Invitation" : "+ Invite Employee"}</button>
          </div>
        </div>

        {showInviteForm && (
          <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Invite New Employee</h2>
            <p className="mt-2 text-sm text-gray-600">Send an email invitation so the employee can create their own account. Invitations expire after 48 hours.</p>
            <form onSubmit={sendInvitation} className="mt-6 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700">First Name<input type="text" required maxLength={100} value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900" /></label>
                <label className="block text-sm font-medium text-gray-700">Last Name<input type="text" required maxLength={100} value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900" /></label>
              </div>
              <label className="block text-sm font-medium text-gray-700">Email Address<input type="email" onChange={(e) => setInviteEmail(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900" /></label>
              <fieldset>
                <legend className="text-sm font-semibold text-gray-900">Assign Positions</legend>
                <p className="mt-1 text-sm text-gray-600">Select every position this employee can work.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {positions.map((p) => <label key={p.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm text-gray-800"><input type="checkbox" checked={invitePositionIds.includes(p.id)} onChange={() => togglePosition(p.id, true)} disabled={sendingInvite} />{p.name}</label>)}
                </div>
              </fieldset>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowInviteForm(false)} disabled={sendingInvite} className="rounded-lg border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700">Cancel</button>
                <button type="submit" disabled={sendingInvite || loading} className="rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{sendingInvite ? "Sending..." : "Send Invitation"}</button>
              </div>
            </form>
          </section>
        )}

        {error && <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {message && <div role="status" className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

        {loading ? <p className="mt-8 text-gray-600">Loading staff...</p> : (
          <>
            <section className="mt-8">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">Pending Invitations ({invitations.length})</h2>
              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                {!invitations.length ? <p className="p-6 text-sm text-gray-600">No pending invitations.</p> : (
                  <div className="divide-y divide-gray-100">{invitations.map((invitation) => (
                    <div key={invitation.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
                      <div>
                        <h3 className="font-semibold text-gray-900">{invitation.first_name} {invitation.last_name}</h3>
                        <p className="mt-1 text-sm text-gray-600">{invitation.email}</p>
                        <div className="mt-3 flex flex-wrap gap-2">{invitation.positions.map((p) => <span key={p} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{p}</span>)}</div>
                        <p className="mt-3 text-xs text-gray-500">Invited {new Date(invitation.created_at).toLocaleDateString()}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${invitation.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{invitation.status === "pending" ? "Awaiting Acceptance" : "Expired"}</span>
                    </div>
                  ))}</div>
                )}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">Employees ({employees.length})</h2>
              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                {!employees.length ? <p className="p-6 text-gray-600">No employees have been added yet.</p> : (
                  <div className="divide-y divide-gray-100">{employees.map((employee) => (
                    <div key={employee.id} className="p-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div><h3 className="font-semibold text-gray-900">{employee.first_name} {employee.last_name}</h3><p className="mt-1 text-sm text-gray-600">{employee.email}</p></div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => editingId === employee.id ? setEditingId(null) : startEditing(employee)} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50">{editingId === employee.id ? "Cancel" : "Edit Employee"}</button>
                          <button type="button" onClick={() => void removeEmployee(employee)} disabled={saving} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50">Remove Employee</button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">{employee.positions.length ? employee.positions.map((p) => <span key={p} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{p}</span>) : <span className="text-sm text-gray-400">No positions assigned</span>}</div>
                      {editForm(employee)}
                    </div>
                  ))}</div>
                )}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">Management ({managers.length})</h2>
              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                {!managers.length ? <p className="p-6 text-gray-600">No managers found.</p> : (
                  <div className="divide-y divide-gray-100">{managers.map((manager) => (
                    <div key={manager.id} className="p-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div><h3 className="font-semibold text-gray-900">{manager.first_name} {manager.last_name}</h3><p className="mt-1 text-sm text-gray-600">{manager.email}</p></div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-medium capitalize text-white">{manager.role}</span>
                          <button type="button" onClick={() => editingId === manager.id ? setEditingId(null) : startEditing(manager)} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50">{editingId === manager.id ? "Cancel" : "Edit Details"}</button>
                        </div>
                      </div>
                      {editForm(manager)}
                    </div>
                  ))}</div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
