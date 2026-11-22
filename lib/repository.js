import { getDatabase } from "./firebase.js";

function userDocument(userId) {
  return getDatabase().collection("users").doc(userId);
}

function collection(userId, name) {
  return userDocument(userId).collection(name);
}

export async function touchUser(user) {
  await userDocument(user.id).set({
    email: user.email,
    name: user.name,
    photoURL: user.photoURL,
    lastSeenAt: new Date().toISOString()
  }, { merge: true });
}

export async function listDashboard(userId) {
  const [profilesSnapshot, sessionsSnapshot] = await Promise.all([
    collection(userId, "profiles").get(),
    collection(userId, "sessions").get()
  ]);
  const profiles = profilesSnapshot.docs.map((doc) => doc.data()).sort(newestFirst);
  const sessions = sessionsSnapshot.docs.map((doc) => doc.data()).sort(newestFirst);
  return { profiles, sessions };
}

export async function getProfile(userId, profileId) {
  const snapshot = await collection(userId, "profiles").doc(profileId).get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function saveProfile(userId, profile) {
  await collection(userId, "profiles").doc(profile.id).set(profile);
}

export async function deleteProfile(userId, profileId) {
  const profileRef = collection(userId, "profiles").doc(profileId);
  const [profile, sessions] = await Promise.all([
    profileRef.get(),
    collection(userId, "sessions").where("profileId", "==", profileId).get()
  ]);
  if (!profile.exists) return false;
  const batch = getDatabase().batch();
  batch.delete(profileRef);
  sessions.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return true;
}

export async function getSession(userId, sessionId) {
  const snapshot = await collection(userId, "sessions").doc(sessionId).get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function saveSession(userId, session) {
  await collection(userId, "sessions").doc(session.id).set(session);
}

export async function updateSession(userId, sessionId, values) {
  await collection(userId, "sessions").doc(sessionId).update(values);
}

export async function deleteSession(userId, sessionId) {
  const ref = collection(userId, "sessions").doc(sessionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.delete();
  return true;
}

function newestFirst(a, b) {
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}
