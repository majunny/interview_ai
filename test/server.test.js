import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "../server.js";

test("health endpoint and static app are available without exposing a key", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.ok, true);
    assert.equal(Object.hasOwn(health, "apiKey"), false);

    const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /생기부 면접 코치/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("accounts persist with cookies and isolate each user's records", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "interview-auth-test-"));
  const previousDataDir = process.env.DATA_DIR;
  const previousInviteCode = process.env.INVITE_CODE;
  process.env.DATA_DIR = dataDir;
  process.env.INVITE_CODE = "friends-only";
  await writeFile(path.join(dataDir, "database.json"), JSON.stringify({
    profiles: [{ id: "legacy-profile", title: "기존 분석", createdAt: new Date().toISOString() }],
    sessions: []
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const anonymousDashboard = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(anonymousDashboard.status, 401);

    const rejectedRegistration = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "초대 없음", email: "blocked@example.com", password: "password-0000" })
    });
    assert.equal(rejectedRegistration.status, 403);

    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "첫 사용자", email: "first@example.com", password: "password-1234", inviteCode: "friends-only" })
    });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get("set-cookie").split(";", 1)[0];
    assert.match(cookie, /^interview_auth=/);

    const firstDashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: cookie } });
    assert.equal(firstDashboard.status, 200);
    assert.equal((await firstDashboard.json()).profiles.length, 1);

    const secondRegistration = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "두 번째", email: "second@example.com", password: "password-5678", inviteCode: "friends-only" })
    });
    const secondCookie = secondRegistration.headers.get("set-cookie").split(";", 1)[0];
    const secondDashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: secondCookie } });
    assert.equal((await secondDashboard.json()).profiles.length, 0);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    assert.equal(logout.status, 204);
    const afterLogout = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(afterLogout.status, 401);
  } finally {
    server.close();
    await once(server, "close");
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousInviteCode === undefined) delete process.env.INVITE_CODE;
    else process.env.INVITE_CODE = previousInviteCode;
    await rm(dataDir, { recursive: true, force: true });
  }
});
