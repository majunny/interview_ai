import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let firebaseApp;

export function getFirebaseWebConfig() {
  return {
    apiKey: process.env.FIREBASE_WEB_API_KEY || process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || undefined
  };
}

export function isFirebaseWebConfigured() {
  return getMissingFirebaseWebVariables().length === 0;
}

export function getMissingFirebaseWebVariables() {
  const config = getFirebaseWebConfig();
  return [
    ["FIREBASE_WEB_API_KEY", config.apiKey],
    ["FIREBASE_AUTH_DOMAIN", config.authDomain],
    ["FIREBASE_PROJECT_ID", config.projectId],
    ["FIREBASE_APP_ID", config.appId]
  ].filter(([, value]) => !value).map(([name]) => name);
}

export function isFirebaseAdminConfigured() {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

export function getFirebaseAdminApp() {
  if (firebaseApp) return firebaseApp;
  if (!isFirebaseAdminConfigured()) {
    const error = new Error("Firebase Admin 환경변수가 설정되지 않았습니다.");
    error.status = 503;
    throw error;
  }
  firebaseApp = getApps()[0] || initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
  return firebaseApp;
}

export function getAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getDatabase() {
  return getFirestore(getFirebaseAdminApp());
}

export function bearerToken(header = "") {
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

export async function verifyFirebaseToken(token) {
  if (!token) {
    const error = new Error("로그인이 필요합니다.");
    error.status = 401;
    throw error;
  }
  try {
    return await getAdminAuth().verifyIdToken(token);
  } catch (cause) {
    if (cause?.status === 503) throw cause;
    const tokenProjectId = getTokenAudience(token);
    const configuredProjectId = process.env.FIREBASE_PROJECT_ID;
    const projectMismatch = tokenProjectId && configuredProjectId && tokenProjectId !== configuredProjectId;
    console.error("Firebase ID token verification failed", {
      code: cause?.code || cause?.errorInfo?.code || "unknown",
      message: cause?.message,
      tokenProjectId,
      configuredProjectId
    });
    const error = new Error(projectMismatch
      ? "Firebase 웹 앱과 서버의 프로젝트가 서로 다릅니다. 환경변수를 확인해 주세요."
      : "Firebase 로그인 토큰을 검증하지 못했습니다. 서버 환경변수를 확인해 주세요.");
    error.status = 401;
    error.cause = cause;
    throw error;
  }
}

export function getTokenAudience(token) {
  try {
    const payload = String(token).split(".")[1];
    if (!payload) return "";
    return String(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).aud || "");
  } catch {
    return "";
  }
}

export async function authenticate(request, response, next) {
  try {
    const decoded = await verifyFirebaseToken(bearerToken(request.headers.authorization));
    request.user = {
      id: decoded.uid,
      name: decoded.name || decoded.email?.split("@")[0] || "사용자",
      email: decoded.email || "",
      photoURL: decoded.picture || ""
    };
    next();
  } catch (error) {
    response.status(error.status || 401).json({ error: error.message });
  }
}
