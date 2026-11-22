import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { app } from "../server.js";
import { bearerToken, getFirebaseWebConfig, getMissingFirebaseWebVariables, isFirebaseWebConfigured } from "../lib/firebase.js";

const require = createRequire(import.meta.url);

test("Firebase token verifier keeps a Vercel-compatible CommonJS JWKS dependency", () => {
  assert.doesNotThrow(() => require("jwks-rsa"));
  assert.match(require("jwks-rsa/package.json").version, /^3\./);
  assert.match(require("jwks-rsa/node_modules/jose/package.json").version, /^4\./);
});

test("health endpoint and static app are available without exposing secrets", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.ok, true);
    assert.equal(Object.hasOwn(health, "apiKey"), false);
    assert.equal(Object.hasOwn(health, "privateKey"), false);

    const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /생기부 면접 코치/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("protected APIs reject requests without a Firebase ID token", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /로그인/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Firebase helpers accept bearer tokens and never require private values in web config", () => {
  assert.equal(bearerToken("Bearer firebase-id-token"), "firebase-id-token");
  assert.equal(bearerToken("Basic abc"), "");
  const config = getFirebaseWebConfig();
  assert.equal(Object.hasOwn(config, "privateKey"), false);
  assert.equal(isFirebaseWebConfigured(), Boolean(config.apiKey && config.authDomain && config.projectId && config.appId));
  assert.equal(getMissingFirebaseWebVariables().length === 0, isFirebaseWebConfigured());
});
