export function isValidBookingRange(date, startTime, endTime) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) &&
    /^\d{2}:\d{2}$/.test(String(startTime || "")) &&
    /^\d{2}:\d{2}$/.test(String(endTime || "")) &&
    startTime < endTime
  );
}

export function hasTimeOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

export function confirmedOverlapFilter({ studioId, date, startTime, endTime, excludeId }) {
  return {
    studioId,
    date,
    status: "Confirmed",
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  };
}
