import "dotenv/config";
import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { del, get, issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned } from "@vercel/blob/client";
import { analyzeStudentRecord, buildSessionReport, evaluateAnswer, getApiKeyCount, model } from "./lib/openai.js";
import { authenticate, bearerToken, getFirebaseWebConfig, getMissingFirebaseWebVariables, isFirebaseAdminConfigured, isFirebaseWebConfigured, verifyFirebaseToken } from "./lib/firebase.js";
import { deleteProfile, deleteSession, getProfile, getSession, listDashboard, listProfileSessionQuestions, saveProfile, saveSession, touchUser, updateSession } from "./lib/repository.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const maxUploadBytes = 20 * 1024 * 1024;
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

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(rootDir, "public")));

app.get("/api/health", (_request, response) => {
  const apiKeyCount = getApiKeyCount();
  response.json({
    ok: true,
    model,
    apiKeyConfigured: apiKeyCount > 0,
    apiKeyCount,
    firebaseWebConfigured: isFirebaseWebConfigured(),
    firebaseAdminConfigured: isFirebaseAdminConfigured(),
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)
  });
});

app.get("/api/config", (_request, response) => {
  const missing = getMissingFirebaseWebVariables();
  if (missing.length) return response.status(503).json({ error: `Firebase 웹 환경변수가 누락되었습니다: ${missing.join(", ")}` });
  response.json({ firebase: getFirebaseWebConfig() });
});

app.get("/api/auth/me", authenticate, (request, response) => {
  response.json({ user: request.user });
});

app.get("/api/dashboard", authenticate, asyncRoute(async (request, response) => {
  await touchUser(request.user);
  response.json(await listDashboard(request.user.id));
}));

app.post("/api/uploads", asyncRoute(async (request, response) => {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return response.status(503).json({ error: "Vercel Blob Store가 이 프로젝트에 연결되지 않았습니다." });
  }
  const result = await handleUploadPresigned({
    request,
    body: request.body,
    // 완료 콜백을 사용하지 않으므로 공개 키는 토큰 발급 경로에서 참조되지 않는다.
    webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || "callback-not-used",
    getSignedToken: async (pathname) => {
      const user = await verifyFirebaseToken(bearerToken(request.headers.authorization));
      if (!pathname.startsWith(`${user.uid}/`)) {
        const error = new Error("업로드 경로가 로그인 사용자와 일치하지 않습니다.");
        error.status = 403;
        throw error;
      }
      const validUntil = Date.now() + 15 * 60 * 1000;
      const token = await issueSignedToken({
        pathname,
        operations: ["put"],
        allowedContentTypes: [...acceptedMimeTypes],
        maximumSizeInBytes: maxUploadBytes,
        validUntil
      });
      return {
        token,
        urlOptions: {
          allowedContentTypes: [...acceptedMimeTypes],
          maximumSizeInBytes: maxUploadBytes,
          validUntil,
          addRandomSuffix: true,
          ttlDays: 1
        }
      };
    }
  });
  response.json(result);
}));

app.post("/api/profiles", authenticate, asyncRoute(async (request, response) => {
  const { pathname, originalFilename, contentType, size } = request.body;
  if (!pathname || !String(pathname).startsWith(`${request.user.id}/`)) {
    return response.status(400).json({ error: "올바른 업로드 파일이 아닙니다." });
  }
  if (!acceptedMimeTypes.has(contentType) || Number(size) > maxUploadBytes) {
    return response.status(400).json({ error: "지원하지 않는 파일이거나 파일 크기가 20MB를 넘습니다." });
  }

  let blob;
  try {
    blob = await get(pathname, { access: "private", useCache: false });
    if (!blob || blob.statusCode !== 200) return response.status(404).json({ error: "업로드 파일을 찾을 수 없습니다. 다시 업로드해 주세요." });
    if (blob.blob.size > maxUploadBytes || blob.blob.contentType !== contentType) {
      return response.status(400).json({ error: "업로드 파일 정보가 일치하지 않습니다." });
    }
    const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());
    const file = { buffer, mimetype: contentType, originalname: safeFilename(originalFilename), size: buffer.length };
    const targetUniversity = String(request.body.targetUniversity || "").trim();
    const targetMajor = String(request.body.targetMajor || "").trim();
    const analysis = await analyzeStudentRecord(file, { university: targetUniversity, major: targetMajor });
    const profile = {
      id: randomUUID(),
      title: String(request.body.title || "").trim() || file.originalname.replace(/\.[^.]+$/, ""),
      targetUniversity,
      targetMajor,
      createdAt: new Date().toISOString(),
      ...analysis,
      concepts: analysis.concepts.map((concept) => ({ ...concept, id: randomUUID() })),
      questions: analysis.questions.map((question) => ({ ...question, id: randomUUID() }))
    };
    await saveProfile(request.user.id, profile);
    response.status(201).json(profile);
  } finally {
    if (pathname) await del(pathname).catch((error) => console.error("임시 업로드 삭제 실패", error));
  }
}));

app.delete("/api/profiles/:profileId", authenticate, asyncRoute(async (request, response) => {
  if (!await deleteProfile(request.user.id, request.params.profileId)) {
    return response.status(404).json({ error: "생기부 분석을 찾을 수 없습니다." });
  }
  response.status(204).end();
}));

app.post("/api/sessions", authenticate, asyncRoute(async (request, response) => {
  const profile = await getProfile(request.user.id, request.body.profileId);
  if (!profile) return response.status(404).json({ error: "먼저 생기부를 등록해 주세요." });
  const mode = request.body.mode === "practice" ? "practice" : "mock";
  const requestedCount = Math.max(3, Math.min(10, Number(request.body.questionCount) || 5));
  const previouslyAsked = await listProfileSessionQuestions(request.user.id, profile.id);
  const session = {
    id: randomUUID(),
    profileId: profile.id,
    profileTitle: profile.title,
    mode,
    status: "active",
    currentIndex: 0,
    questions: selectQuestions(profile.questions, requestedCount, previouslyAsked),
    answers: [],
    report: null,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  await saveSession(request.user.id, session);
  response.status(201).json(session);
}));

app.get("/api/sessions/:sessionId", authenticate, asyncRoute(async (request, response) => {
  const session = await getSession(request.user.id, request.params.sessionId);
  if (!session) return response.status(404).json({ error: "면접 기록을 찾을 수 없습니다." });
  response.json(session);
}));

app.post("/api/sessions/:sessionId/answers", authenticate, asyncRoute(async (request, response) => {
  const answerText = String(request.body.answer || "").trim();
  if (!answerText) return response.status(400).json({ error: "답변을 입력해 주세요." });
  const session = await getSession(request.user.id, request.params.sessionId);
  if (!session || session.status !== "active") return response.status(404).json({ error: "진행 중인 면접을 찾을 수 없습니다." });
  const question = session.questions[session.currentIndex];
  if (!question) return response.status(400).json({ error: "남은 질문이 없습니다. 면접을 종료해 주세요." });
  const profile = await getProfile(request.user.id, session.profileId);
  if (!profile) return response.status(404).json({ error: "연결된 생기부 분석이 없습니다." });
  const feedback = session.mode === "practice" ? await evaluateAnswer({ profile, question, answer: answerText }) : null;
  const answer = {
    id: randomUUID(),
    questionId: question.id,
    question: question.question,
    answer: answerText,
    durationSeconds: Math.max(0, Number(request.body.durationSeconds) || 0),
    feedback,
    createdAt: new Date().toISOString()
  };
  const answers = [...session.answers, answer];
  const nextIndex = session.currentIndex + 1;
  await updateSession(request.user.id, session.id, { answers, currentIndex: nextIndex });
  response.status(201).json({ answer, nextIndex, finished: nextIndex >= session.questions.length });
}));

app.post("/api/sessions/:sessionId/finish", authenticate, asyncRoute(async (request, response) => {
  const session = await getSession(request.user.id, request.params.sessionId);
  if (!session) return response.status(404).json({ error: "면접 기록을 찾을 수 없습니다." });
  if (session.report) return response.json(session);
  if (!session.answers.length) return response.status(400).json({ error: "최소 한 개의 답변이 필요합니다." });
  const profile = await getProfile(request.user.id, session.profileId);
  if (!profile) return response.status(404).json({ error: "연결된 생기부 분석이 없습니다." });
  const report = await buildSessionReport({
    profile,
    answers: session.answers.map(({ question, answer, durationSeconds }) => ({ question, answer, durationSeconds }))
  });
  const completedAt = new Date().toISOString();
  await updateSession(request.user.id, session.id, { report, status: "completed", completedAt });
  response.json({ ...session, report, status: "completed", completedAt });
}));

app.delete("/api/sessions/:sessionId", authenticate, asyncRoute(async (request, response) => {
  if (!await deleteSession(request.user.id, request.params.sessionId)) {
    return response.status(404).json({ error: "면접 기록을 찾을 수 없습니다." });
  }
  response.status(204).end();
}));

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error.status || 500;
  response.status(status).json({
    error: status === 500 ? "요청 처리 중 오류가 발생했습니다." : error.message,
    detail: process.env.NODE_ENV === "development" ? error.message : undefined
  });
});

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function safeFilename(value) {
  return path.basename(String(value || "record")).replace(/[\u0000-\u001f]/g, "").slice(0, 180) || "record";
}

function selectQuestions(questions, count, previouslyAsked = []) {
  const shuffled = shuffleQuestions(Array.isArray(questions) ? questions : []);
  const previousIds = new Set(previouslyAsked.map((question) => question.id).filter(Boolean));
  const previousTexts = new Set(previouslyAsked.map((question) => normalizeQuestion(question.question)).filter(Boolean));
  const unseen = shuffled.filter((question) => !previousIds.has(question.id) && !previousTexts.has(normalizeQuestion(question.question)));
  const candidates = [...unseen, ...shuffled.filter((question) => !unseen.includes(question))];
  const selected = [];
  const categories = new Set();
  for (const question of candidates) {
    if (!categories.has(question.category) && !isSimilarToSelected(question, selected)) {
      selected.push(question);
      categories.add(question.category);
    }
    if (selected.length === count) return selected;
  }
  for (const question of candidates) {
    if (!selected.includes(question) && !isSimilarToSelected(question, selected)) selected.push(question);
    if (selected.length === count) break;
  }
  return selected;
}

function shuffleQuestions(questions) {
  const result = [...questions];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function normalizeQuestion(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isSimilarToSelected(question, selected) {
  const words = questionWords(question.question);
  const normalized = normalizeQuestion(question.question);
  return selected.some((item) => {
    if (normalized === normalizeQuestion(item.question)) return true;
    const otherWords = questionWords(item.question);
    const intersection = [...words].filter((word) => otherWords.has(word)).length;
    const union = new Set([...words, ...otherWords]).size;
    return union > 0 && intersection / union >= 0.72;
  });
}

function questionWords(value) {
  return new Set(String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((word) => word.length > 1));
}

export { app, selectQuestions };
export default app;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => console.log(`면접 코치가 http://localhost:${port} 에서 실행 중입니다.`));
}
