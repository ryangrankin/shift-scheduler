
import { pool } from "@/lib/db";

export type AvailabilityConflict = {
  type: "approved_request" | "weekly_availability";
  message: string;
};

type AvailabilityInput = {
  userId: number;
  startTime: string;
  endTime: string;
};

function timeToMinutes(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

export async function checkAvailabilityConflicts({
  userId,
  startTime,
  endTime,
}: AvailabilityInput): Promise<AvailabilityConflict[]> {
  const conflicts: AvailabilityConflict[] = [];

  // Our scheduling form currently supports same-day shifts.
  const shiftDate = startTime.slice(0, 10);
  const startMinutes = timeToMinutes(startTime.slice(11, 16));
  const endMinutes = timeToMinutes(endTime.slice(11, 16));

  // Get approved date-specific availability requests.
  const requestResult = await pool.query(
    `SELECT
       is_unavailable,
       start_time::text AS start_time,
       end_time::text AS end_time
     FROM availability_requests
     WHERE user_id = $1
       AND request_date = $2::date
       AND status = 'approved'`,
    [userId, shiftDate]
  );

  const approvedRequests = requestResult.rows;

  if (approvedRequests.length > 0) {
    for (const request of approvedRequests) {
      if (request.is_unavailable) {
        conflicts.push({
          type: "approved_request",
          message: `Employee has approved time off on ${shiftDate}.`,
        });
        continue;
      }

      const availableStart = timeToMinutes(request.start_time);
      const availableEnd = timeToMinutes(request.end_time);

      if (
        startMinutes < availableStart ||
        endMinutes > availableEnd
      ) {
        conflicts.push({
          type: "approved_request",
          message:
            `Employee's approved availability on ${shiftDate} ` +
            `is ${request.start_time.slice(0, 5)}–${request.end_time.slice(0, 5)}.`,
        });
      }
    }

    // Approved date-specific requests take precedence over weekly availability.
    return conflicts;
  }

  // JavaScript: Sunday = 0, Monday = 1, etc.
  const [year, month, day] = shiftDate.split("-").map(Number);
  const dayOfWeek = new Date(
    Date.UTC(year, month - 1, day)
  ).getUTCDay();

  const weeklyResult = await pool.query(
    `SELECT
       start_time::text AS start_time,
       end_time::text AS end_time
     FROM availability
     WHERE user_id = $1
       AND day_of_week = $2
     ORDER BY start_time`,
    [userId, dayOfWeek]
  );

  const weeklyAvailability = weeklyResult.rows;

  // No weekly availability on file:
  // Flag for manager review rather than assuming availability.
  if (weeklyAvailability.length === 0) {
    conflicts.push({
      type: "weekly_availability",
      message: `Employee has no availability recorded for this day.`,
    });

    return conflicts;
  }

  // A shift is allowed if it fits entirely within one available interval.
  const fitsAvailableHours = weeklyAvailability.some((slot) => {
    const availableStart = timeToMinutes(slot.start_time);
    const availableEnd = timeToMinutes(slot.end_time);

    return (
      startMinutes >= availableStart &&
      endMinutes <= availableEnd
    );
  });

  if (!fitsAvailableHours) {
    conflicts.push({
      type: "weekly_availability",
      message:
        "Shift falls outside the employee's recurring weekly availability.",
    });
  }

  return conflicts;
}
