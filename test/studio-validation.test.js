import test from "node:test";
import assert from "node:assert/strict";
import { buildStudioDocument, normalizeStudioUpdate } from "../lib/studio-validation.js";

const user = { userId: "user-1", name: "Test Host", email: "host@example.test" };

test("builds a studio document with trusted host identity", () => {
  const { document, error } = buildStudioDocument({
    title: "Northlight Studio", category: "Photo Studio", hourlyRate: "85",
    securityDeposit: "100", maxCapacity: "8", location: "Dhaka",
    imageUrl: "https://images.example.test/studio.jpg", overview: "A bright production space.",
    hostEmail: "spoofed@example.test",
  }, user);
  assert.equal(error, undefined);
  assert.equal(document.hostEmail, user.email);
  assert.equal(document.hourlyRate, 85);
});

test("rejects invalid studio rates and missing fields", () => {
  assert.equal(buildStudioDocument({}, user).error, "title is required.");
  const result = buildStudioDocument({
    title: "Studio", category: "Photo Studio", hourlyRate: "0",
    location: "Dhaka", imageUrl: "https://example.test/a.jpg", overview: "Overview",
  }, user);
  assert.match(result.error, /valid rates/);
});

test("normalizes only allowed studio updates and validates numbers", () => {
  const result = normalizeStudioUpdate({ title: "  Updated Studio  ", hourlyRate: "120", ownerId: "attacker" });
  assert.equal(result.update.title, "Updated Studio");
  assert.equal(result.update.hourlyRate, 120);
  assert.equal("ownerId" in result.update, false);
  assert.ok(normalizeStudioUpdate({ hourlyRate: -5 }).error);
});
