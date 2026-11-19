import test from "node:test";
import assert from "node:assert/strict";
import { isValidBookingRange, hasTimeOverlap, confirmedOverlapFilter } from "../lib/booking-utils.js";

test("accepts a well-formed forward booking window", () => {
  assert.equal(isValidBookingRange("2026-12-10", "09:00", "11:30"), true);
});

test("rejects malformed and reversed booking windows", () => {
  assert.equal(isValidBookingRange("10-12-2026", "09:00", "11:00"), false);
  assert.equal(isValidBookingRange("2026-12-10", "11:00", "09:00"), false);
});

test("detects overlapping time windows but allows adjacent sessions", () => {
  assert.equal(hasTimeOverlap("09:00", "11:00", "10:30", "12:00"), true);
  assert.equal(hasTimeOverlap("09:00", "11:00", "11:00", "12:00"), false);
});

test("builds a confirmed-only MongoDB overlap query", () => {
  const query = confirmedOverlapFilter({ studioId: "studio-1", date: "2026-12-10", startTime: "09:00", endTime: "11:00" });
  assert.deepEqual(query, {
    studioId: "studio-1", date: "2026-12-10", status: "Confirmed",
    startTime: { $lt: "11:00" }, endTime: { $gt: "09:00" },
  });
});
