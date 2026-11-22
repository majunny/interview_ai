import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSessionToken, hashPassword, hashSessionToken, readCookie, verifyPassword } from "./lib/auth.js";
import { analyzeStudentRecord, buildSessionReport, evaluateAnswer, getApiKeyCount, model } from "./lib/openai.js";
import { readDatabase, updateDatabase } from "./lib/store.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const authCookieName = "interview_auth";
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;
const acceptedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (acceptedMimeTypes.has(file.mimetype)) return callback(null, true);
    const error = new Error("PDF, DOC, DOCX, TXT, JPG, PNG, WEBP, GIF 파일만 업로드할 수 있습니다.");
    error.status = 400;
    callback(error, false);
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(rootDir, "public")));

app.get("/api/health", (_request, response) => {
  const apiKeyCount = getApiKeyCount();
  response.json({ ok: true, model, apiKeyConfigured: apiKeyCount > 0, apiKeyCount, registrationRequiresInvite: Boolean(process.env.INVITE_CODE) });
});

app.post("/api/auth/register", async (request, response) => {
  const name = String(request.body.name || "").trim();
  const email = normalizeEmail(request.body.email);
  const password = String(request.body.password || "");
  if (process.env.INVITE_CODE && hashSessionToken(String(request.body.inviteCode || "")) !== hashSessionToken(process.env.INVITE_CODE)) {
    return response.status(403).json({ error: "초대 코드가 올바르지 않습니다." });
  }
  if (name.length < 2 || name.length > 30) return response.status(400).json({ error: "이름은 2~30자로 입력해 주세요." });
  if (!isValidEmail(email)) return response.status(400).json({ error: "올바른 이메일 주소를 입력해 주세요." });
  if (password.length < 8 || password.length > 128) return response.status(400).json({ error: "비밀번호는 8~128자로 입력해 주세요." });

  const user = { id: randomUUID(), name, email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
  const token = createSessionToken();
  const authSession = makeAuthSession(user.id, token);
  await updateDatabase((database) => {
    if (database.users.some((item) => item.email === email)) {
      const error = new Error("이미 가입된 이메일입니다.");
      error.status = 409;
      throw error;
    }
    database.users.push(user);
    database.authSessions.push(authSession);
    // 로그인 도입 전에 저장된 로컬 기록은 최초 가입자가 이어서 사용한다.
    if (database.users.length === 1) {
      database.profiles.forEach((profile) => { if (!profile.userId) profile.userId = user.id; });
      database.sessions.forEach((session) => { if (!session.userId) session.userId = user.id; });
    }
  });
  setAuthCookie(response, token);
  response.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (request, response) => {
  const email = normalizeEmail(request.body.email);
  const password = String(request.body.password || "");
  const database = await readDatabase();
  const user = database.users.find((item) => item.email === email);
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    return response.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  }
  const token = createSessionToken();
  await updateDatabase((nextDatabase) => {
    nextDatabase.authSessions = nextDatabase.authSessions.filter((item) => new Date(item.expiresAt).getTime() > Date.now());
    nextDatabase.authSessions.push(makeAuthSession(user.id, token));
  });
  setAuthCookie(response, token);
  response.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", authenticate, async (request, response) => {
  await updateDatabase((database) => {
    database.authSessions = database.authSessions.filter((item) => item.tokenHash !== request.authTokenHash);
  });
  clearAuthCookie(response);
  response.status(204).end();
});

app.get("/api/auth/me", authenticate, (request, response) => {
  response.json({ user: publicUser(request.user) });
});

app.get("/api/dashboard", authenticate, async (request, response) => {
  const database = await readDatabase();
  response.json({
    profiles: database.profiles.filter((item) => item.userId === request.user.id).map(publicProfile),
    sessions: database.sessions.filter((item) => item.userId === request.user.id).map(publicSession).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  });
});

app.post("/api/profiles", authenticate, upload.single("record"), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: "생기부 파일을 선택해 주세요." });
  const targetUniversity = request.body.targetUniversity?.trim() || "";
  const targetMajor = request.body.targetMajor?.trim() || "";
  const analysis = await analyzeStudentRecord(request.file, { university: targetUniversity, major: targetMajor });
  const createdAt = new Date().toISOString();
  const profile = {
    id: randomUUID(),
    userId: request.user.id,
    title: request.body.title?.trim() || request.file.originalname.replace(/\.[^.]+$/, ""),
    targetUniversity,
    targetMajor,
    originalFilename: request.file.originalname,
    createdAt,
    ...analysis,
    questions: analysis.questions.map((question) => ({ ...question, id: randomUUID() }))
  };
  await updateDatabase((database) => database.profiles.push(profile));
  response.status(201).json(publicProfile(profile));
});

app.delete("/api/profiles/:profileId", authenticate, async (request, response) => {
  const removed = await updateDatabase((database) => {
    const before = database.profiles.length;
    database.profiles = database.profiles.filter((item) => item.id !== request.params.profileId || item.userId !== request.user.id);
    database.sessions = database.sessions.filter((item) => item.profileId !== request.params.profileId || item.userId !== request.user.id);
    return before !== database.profiles.length;
  });
  if (!removed) return response.status(404).json({ error: "생기부 분석을 찾을 수 없습니다." });
  response.status(204).end();
});

app.post("/api/sessions", authenticate, async (request, response) => {
  const database = await readDatabase();
  const profile = database.profiles.find((item) => item.id === request.body.profileId && item.userId === request.user.id);
  if (!profile) return response.status(404).json({ error: "먼저 생기부를 등록해 주세요." });
  const mode = request.body.mode === "practice" ? "practice" : "mock";
  const requestedCount = Math.max(3, Math.min(10, Number(request.body.questionCount) || 5));
  const questions = selectQuestions(profile.questions, requestedCount);
  const session = {
    id: randomUUID(),
    userId: request.user.id,
    profileId: profile.id,
    profileTitle: profile.title,
    mode,
    status: "active",
    currentIndex: 0,
    questions,
    answers: [],
    report: null,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  await updateDatabase((nextDatabase) => nextDatabase.sessions.push(session));
  response.status(201).json(publicSession(session));
});

app.get("/api/sessions/:sessionId", authenticate, async (request, response) => {
  const database = await readDatabase();
  const session = database.sessions.find((item) => item.id === request.params.sessionId && item.userId === request.user.id);
  if (!session) return response.status(404).json({ error: "면접 기록을 찾을 수 없습니다." });
  response.json(publicSession(session));
});

app.post("/api/sessions/:sessionId/answers", authenticate, async (request, response) => {
  const answerText = String(request.body.answer || "").trim();
  if (!answerText) return response.status(400).json({ error: "답변을 입력해 주세요." });

  const database = await readDatabase();
  const session = database.sessions.find((item) => item.id === request.params.sessionId && item.userId === request.user.id);
  if (!session || session.status !== "active") return response.status(404).json({ error: "진행 중인 면접을 찾을 수 없습니다." });
  const question = session.questions[session.currentIndex];
  if (!question) return response.status(400).json({ error: "남은 질문이 없습니다. 면접을 종료해 주세요." });
  const profile = database.profiles.find((item) => item.id === session.profileId && item.userId === request.user.id);
  if (!profile) return response.status(404).json({ error: "연결된 생기부 분석이 없습니다." });

  const feedback = session.mode === "practice"
    ? await evaluateAnswer({ profile, question, answer: answerText })
    : null;
  const answer = {
    id: randomUUID(),
    questionId: question.id,
    question: question.question,
    answer: answerText,
    durationSeconds: Math.max(0, Number(request.body.durationSeconds) || 0),
    feedback,
    createdAt: new Date().toISOString()
  };

  await updateDatabase((nextDatabase) => {
    const nextSession = nextDatabase.sessions.find((item) => item.id === session.id && item.userId === request.user.id);
    nextSession.answers.push(answer);
    nextSession.currentIndex += 1;
  });
  response.status(201).json({ answer, nextIndex: session.currentIndex + 1, finished: session.currentIndex + 1 >= session.questions.length });
});

app.post("/api/sessions/:sessionId/finish", authenticate, async (request, response) => {
  const database = await readDatabase();
  const session = database.sessions.find((item) => item.id === request.params.sessionId && item.userId === request.user.id);
  if (!session) return response.status(404).json({ error: "면접 기록을 찾을 수 없습니다." });
  if (session.report) return response.json(publicSession(session));
  if (!session.answers.length) return response.status(400).json({ error: "최소 한 개의 답변이 필요합니다." });
  const profile = database.profiles.find((item) => item.id === session.profileId && item.userId === request.user.id);
  if (!profile) return response.status(404).json({ error: "연결된 생기부 분석이 없습니다." });
  const report = await buildSessionReport({
    profile,
    answers: session.answers.map(({ question, answer, durationSeconds }) => ({ question, answer, durationSeconds }))
  });
  await updateDatabase((nextDatabase) => {
    const nextSession = nextDatabase.sessions.find((item) => item.id === session.id && item.userId === request.user.id);
    nextSession.report = report;
    nextSession.status = "completed";
    nextSession.completedAt = new Date().toISOString();
  });
  response.json(publicSession({ ...session, report, status: "completed", completedAt: new Date().toISOString() }));
});

app.delete("/api/sessions/:sessionId", authenticate, async (request, response) => {
  const removed = await updateDatabase((database) => {
    const before = database.sessions.length;
    database.sessions = database.sessions.filter((item) => item.id !== request.params.sessionId || item.userId !== request.user.id);
    return before !== database.sessions.length;
  });
  if (!removed) return response.status(404).json({ error: "면접 기록을 찾을 수 없습니다." });
  response.status(204).end();
});

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
  response.status(status).json({ error: status === 500 ? "요청 처리 중 오류가 발생했습니다." : error.message, detail: process.env.NODE_ENV === "development" ? error.message : undefined });
});

function publicProfile(profile) {
  return { ...profile, userId: undefined, originalFilename: undefined };
}

function publicSession(session) {
  return { ...session, userId: undefined };
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function makeAuthSession(userId, token) {
  const createdAt = new Date();
  return {
    id: randomUUID(),
    userId,
    tokenHash: hashSessionToken(token),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + sessionDurationMs).toISOString()
  };
}

function setAuthCookie(response, token) {
  response.cookie(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionDurationMs,
    path: "/"
  });
}

function clearAuthCookie(response) {
  response.clearCookie(authCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

async function authenticate(request, response, next) {
  try {
    const token = readCookie(request.headers.cookie, authCookieName);
    if (!token) return response.status(401).json({ error: "로그인이 필요합니다." });
    const tokenHash = hashSessionToken(token);
    const database = await readDatabase();
    const authSession = database.authSessions.find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt).getTime() > Date.now());
    const user = authSession && database.users.find((item) => item.id === authSession.userId);
    if (!user) {
      clearAuthCookie(response);
      return response.status(401).json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." });
    }
    request.user = user;
    request.authTokenHash = tokenHash;
    next();
  } catch (error) {
    next(error);
  }
}

function selectQuestions(questions, count) {
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  const selected = [];
  const categories = new Set();
  for (const question of shuffled) {
    if (!categories.has(question.category)) {
      selected.push(question);
      categories.add(question.category);
    }
    if (selected.length === count) return selected;
  }
  for (const question of shuffled) {
    if (!selected.some((item) => item.id === question.id)) selected.push(question);
    if (selected.length === count) break;
  }
  return selected;
}

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`면접 코치가 http://localhost:${port} 에서 실행 중입니다.`);
  });
}
