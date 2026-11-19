import test from "node:test";
import assert from "node:assert/strict";
import { uploadImageToImgBB } from "../lib/imgbb.js";

test("rejects image upload when ImgBB is not configured", async () => {
  await assert.rejects(() => uploadImageToImgBB("ZmFrZQ==", ""), { message: /not configured/ });
});

test("rejects empty and oversized images before making a request", async () => {
  await assert.rejects(() => uploadImageToImgBB("", "test-key"), { message: /smaller than 6 MB/ });
  await assert.rejects(() => uploadImageToImgBB("x".repeat(8_000_001), "test-key"), { message: /smaller than 6 MB/ });
});
