import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, hashPassword, hashSessionToken, readCookie, verifyPassword } from "../lib/auth.js";

test("passwords are salted and can be verified without storing plaintext", async () => {
  const first = await hashPassword("correct-horse-battery-staple");
  const second = await hashPassword("correct-horse-battery-staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct-horse-battery-staple", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(first.includes("correct-horse-battery-staple"), false);
});

test("session helpers create opaque tokens and parse their cookie", () => {
  const token = createSessionToken();
  assert.ok(token.length >= 40);
  assert.equal(hashSessionToken(token).length, 64);
  assert.equal(readCookie(`theme=dark; interview_auth=${encodeURIComponent(token)}`, "interview_auth"), token);
});
