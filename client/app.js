import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { upload } from "@vercel/blob/client";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const state = { user: null, profiles: [], sessions: [], profileId: null, session: null, timer: null, seconds: 0, recognition: null };
let auth;

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-view]");
  if (target) state.user ? navigate(target.dataset.view) : renderAuth();
});

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (auth?.currentUser) headers.set("Authorization", `Bearer ${await auth.currentUser.getIdToken()}`);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "요청을 처리하지 못했습니다.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function initialize() {
  try {
    const { firebase } = await api("/api/config");
    auth = getAuth(initializeApp(firebase));
    await new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, () => { unsubscribe(); resolve(); });
    });
    const health = await api("/api/health");
    const status = document.querySelector("#api-status");
    status.textContent = health.apiKeyConfigured ? `${health.model} · 키 ${health.apiKeyCount}개` : "API 키 필요";
    status.classList.add(health.apiKeyConfigured ? "good" : "bad");
    if (!auth.currentUser) return renderAuth();
    const { user } = await api("/api/auth/me");
    state.user = user;
    await loadDashboard();
    updateAccountArea();
    renderHome();
  } catch (error) {
    showToast(error.message);
    renderAuth();
  }
}

async function loadDashboard() {
  const dashboard = await api("/api/dashboard");
  state.profiles = dashboard.profiles;
  state.sessions = dashboard.sessions;
  state.profileId = state.profiles[0]?.id || null;
}

function renderAuth() {
  stopTimer();
  document.querySelector("#main-nav").hidden = true;
  document.querySelector("#account-area").innerHTML = "";
  app.innerHTML = `
    <section class="auth-layout">
      <div class="auth-copy"><span class="eyebrow">Private interview coach</span><h1>내 기록은<br>나만 볼 수 있게.</h1><p>계정마다 생기부 분석과 면접 기록을 분리해 안전하게 저장합니다.</p></div>
      <section class="card auth-card">
        <span class="eyebrow">Google sign in</span>
        <h2>다시 만나서 반가워요</h2>
        <p class="subtle">Google 계정으로 로그인하면 어느 기기에서든 내 분석과 면접 기록을 이어서 볼 수 있습니다.</p>
        <button class="btn btn-primary auth-submit" id="google-login" type="button">Google로 계속하기 →</button>
        <p class="auth-note">비밀번호는 이 서비스에 저장되지 않습니다.</p>
      </section>
    </section>`;
  document.querySelector("#google-login").onclick = loginWithGoogle;
}

async function loginWithGoogle() {
  const button = document.querySelector("#google-login");
  button.disabled = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    const { user } = await api("/api/auth/me");
    state.user = user;
    await loadDashboard();
    updateAccountArea();
    renderHome();
    showToast("로그인했습니다.");
  } catch (error) {
    showToast(firebaseErrorMessage(error));
    button.disabled = false;
  }
}

function updateAccountArea() {
  document.querySelector("#main-nav").hidden = !state.user;
  const area = document.querySelector("#account-area");
  area.innerHTML = state.user ? `<div class="account-menu"><span><b>${escapeHtml(state.user.name)}</b>님</span><button class="logout-button" id="logout" type="button">로그아웃</button></div>` : "";
  document.querySelector("#logout")?.addEventListener("click", logout);
}

async function logout() {
  await signOut(auth);
  stopTimer();
  state.user = null;
  state.profiles = [];
  state.sessions = [];
  state.profileId = null;
  state.session = null;
  renderAuth();
  showToast("로그아웃했습니다.");
}

function navigate(view) {
  stopTimer();
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  if (view === "record") renderRecord();
  else if (view === "history") renderHistory();
  else renderHome();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderHome() {
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">학생부종합전형 면접 코치</span>
        <h1>내 기록에서<br>답을 찾는 면접.</h1>
        <p>생기부의 활동과 배움을 근거로 질문을 만들고, 답변의 구체성·논리·기록 일치도를 꼼꼼하게 피드백합니다.</p>
        <div class="actions">
          <button class="btn btn-primary" data-view="record">생기부로 시작하기 →</button>
          <button class="btn btn-secondary" data-view="history">지난 면접 보기</button>
        </div>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="orb"></div>
        <div class="question-card one"><small>FOLLOW UP</small>그 활동에서 본인이 직접 결정한 것은 무엇인가요?</div>
        <div class="question-card two"><small>RECORD BASED</small>탐구 과정에서 예상과 달랐던 점을 설명해 보세요.</div>
      </div>
    </section>
    <section class="steps">
      <article class="step"><b>01 · ANALYZE</b><h3>기록을 읽고</h3><p>활동, 역량, 예상 검증 포인트를 구조화합니다.</p></article>
      <article class="step"><b>02 · INTERVIEW</b><h3>실제로 답하고</h3><p>연습 모드 또는 피드백 없는 실전 모드로 진행합니다.</p></article>
      <article class="step"><b>03 · IMPROVE</b><h3>근거 있게 고치고</h3><p>좋은 점, 부족한 점, 개선 답변을 한눈에 확인합니다.</p></article>
    </section>`;
}

function renderRecord() {
  if (!state.profiles.length) return renderUpload();
  const selected = state.profiles.find((item) => item.id === state.profileId) || state.profiles[0];
  state.profileId = selected.id;
  app.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">Record analysis</span><h1>생기부 분석</h1></div><button class="btn btn-secondary" id="new-profile">+ 새 생기부</button></div>
    <div class="grid sidebar">
      <aside class="card"><h3>분석 목록</h3><div class="profile-list">${state.profiles.map(profile => `
        <button class="profile-item ${profile.id === selected.id ? "active" : ""}" data-profile="${profile.id}"><b>${escapeHtml(profile.title)}</b><small>${formatDate(profile.createdAt)}</small></button>`).join("")}</div></aside>
      <section class="card">
        <div class="page-head"><div><span class="tag orange">${escapeHtml(selected.targetMajor || "지원 전공 미설정")}</span><h2 style="margin-top:12px">${escapeHtml(selected.title)}</h2><p class="subtle">${escapeHtml(selected.studentOverview)}</p></div><button class="btn btn-danger" id="delete-profile">삭제</button></div>
        <div class="tag-row">${selected.strengths.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>
        <div class="analysis-block"><h3>주요 활동</h3>${selected.activities.map(activity => `<article class="activity"><b>${escapeHtml(activity.title)}</b><p>${escapeHtml(activity.evidence)}</p><div class="tag-row">${activity.themes.map(theme => `<span class="tag">${escapeHtml(theme)}</span>`).join("")}</div></article>`).join("")}</div>
        <div class="analysis-block"><h3>예상 질문 ${selected.questions.length}개</h3>${selected.questions.slice(0, 6).map(q => `<div class="question-preview"><span class="tag orange">${escapeHtml(q.category)}</span><p>${escapeHtml(q.question)}</p></div>`).join("")}</div>
        <div class="analysis-block"><h3>면접 시작</h3><div class="grid two">
          <label class="card mode-card selected"><input type="radio" name="mode" value="practice" checked><span class="mode-icon">✎</span><h3>코칭 연습</h3><p class="subtle">매 답변 직후 잘한 점과 개선 답변을 확인합니다.</p></label>
          <label class="card mode-card"><input type="radio" name="mode" value="mock"><span class="mode-icon">●</span><h3>실전 모의면접</h3><p class="subtle">중간 피드백 없이 끝까지 진행한 뒤 종합 평가를 받습니다.</p></label>
        </div><div class="field"><label for="question-count">질문 수</label><select id="question-count"><option value="3">3문항 · 빠른 연습</option><option value="5" selected>5문항 · 기본</option><option value="8">8문항 · 집중</option><option value="10">10문항 · 실전</option></select></div><button class="btn btn-primary" id="start-interview">면접 시작하기 →</button></div>
      </section>
    </div>`;

  document.querySelector("#new-profile").onclick = renderUpload;
  document.querySelectorAll("[data-profile]").forEach(button => button.onclick = () => { state.profileId = button.dataset.profile; renderRecord(); });
  document.querySelectorAll(".mode-card").forEach(card => card.onclick = () => { document.querySelectorAll(".mode-card").forEach(x => x.classList.remove("selected")); card.classList.add("selected"); card.querySelector("input").checked = true; });
  document.querySelector("#delete-profile").onclick = deleteProfile;
  document.querySelector("#start-interview").onclick = startInterview;
}

function renderUpload() {
  app.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">First step</span><h1>생기부 등록</h1></div>${state.profiles.length ? '<button class="btn btn-secondary" id="back-record">← 분석 목록</button>' : ""}</div>
    <div class="grid two">
      <form class="card" id="upload-form">
        <h2>파일로 분석하기</h2><p class="subtle">PDF가 가장 정확하며, 촬영한 생기부 이미지도 분석할 수 있습니다.</p>
        <label class="dropzone" id="dropzone"><input type="file" id="record-file" name="record" accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp,.gif" required><strong>파일을 선택하거나 여기로 끌어오세요</strong><span class="subtle">PDF · DOCX · TXT · JPG · PNG · WEBP · GIF / 최대 20MB</span><img class="file-preview hidden" id="file-preview" alt="선택한 이미지 미리보기"><div class="file-name" id="file-name"></div><div class="file-error hidden" id="file-error" role="alert"></div></label>
        <div class="field"><label for="title">분석 이름</label><input id="title" name="title" placeholder="예: 2027학년도 수시 면접"></div>
        <div class="grid two"><div class="field"><label for="university">지원 대학</label><input id="university" name="targetUniversity" placeholder="선택 입력"></div><div class="field"><label for="major">지원 학과</label><input id="major" name="targetMajor" placeholder="예: 컴퓨터공학과"></div></div>
        <div class="privacy-note">원본 파일은 비공개 임시 저장소에 업로드되며 분석 직후 삭제됩니다. 분석 결과와 면접 기록만 계정별로 저장됩니다.</div>
        <button class="btn btn-primary" type="submit">생기부 분석하기 →</button>
      </form>
      <section class="card"><span class="eyebrow">What you get</span><h2 style="margin-top:18px">면접관이 볼 지점을<br>먼저 찾아드립니다.</h2><div class="analysis-block"><h3>활동 근거 중심 질문</h3><p class="subtle">단순 요약이 아니라 ‘직접 한 일’, ‘배운 점’, ‘전공 연결’을 확인하는 질문을 만듭니다.</p></div><div class="analysis-block"><h3>과장·불일치 점검</h3><p class="subtle">생기부에 없는 내용을 덧붙이거나 사실과 어긋날 가능성이 있는 답변을 표시합니다.</p></div><div class="analysis-block"><h3>말할 수 있는 개선 답변</h3><p class="subtle">암기용 모범답안 대신, 본인의 기록과 표현을 살린 45~75초 답변으로 다듬습니다.</p></div></section>
    </div>`;
  document.querySelector("#back-record")?.addEventListener("click", renderRecord);
  const fileInput = document.querySelector("#record-file");
  const fileName = document.querySelector("#file-name");
  const fileError = document.querySelector("#file-error");
  const preview = document.querySelector("#file-preview");
  let previewUrl = null;
  const showSelectedFile = () => {
    const file = fileInput.files[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.classList.add("hidden");
    preview.removeAttribute("src");
    fileError.classList.add("hidden");
    fileError.textContent = "";
    fileName.textContent = file ? `${file.name} · ${formatFileSize(file.size)}` : "";
    if (file?.type.startsWith("image/")) {
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.classList.remove("hidden");
    }
  };
  fileInput.onchange = showSelectedFile;
  const dropzone = document.querySelector("#dropzone");
  dropzone.ondragover = event => { event.preventDefault(); dropzone.classList.add("dragging"); };
  dropzone.ondragleave = () => dropzone.classList.remove("dragging");
  dropzone.ondrop = event => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    showSelectedFile();
  };
  document.querySelector("#upload-form").onsubmit = uploadProfile;
}

async function uploadProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.record.files[0];
  const error = validateRecordFile(file);
  if (error) {
    const errorElement = document.querySelector("#file-error");
    errorElement.textContent = error;
    errorElement.classList.remove("hidden");
    return showToast(error);
  }
  showLoading("생기부를 읽고 질문을 만들고 있어요", "문서 길이에 따라 1~2분 정도 걸릴 수 있습니다.");
  try {
    const idToken = await auth.currentUser.getIdToken();
    const contentType = recordContentType(file);
    const uploadName = `${auth.currentUser.uid}/${crypto.randomUUID()}-${safeUploadName(file.name)}`;
    const blob = await upload(uploadName, file, {
      access: "private",
      handleUploadUrl: "/api/uploads",
      headers: { Authorization: `Bearer ${idToken}` },
      contentType,
      multipart: file.size > 5 * 1024 * 1024
    });
    const profile = await api("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pathname: blob.pathname,
        originalFilename: file.name,
        contentType,
        size: file.size,
        title: form.elements.title.value,
        targetUniversity: form.elements.targetUniversity.value,
        targetMajor: form.elements.targetMajor.value
      })
    });
    state.profiles.unshift(profile); state.profileId = profile.id; renderRecord(); showToast("생기부 분석이 완료되었습니다.");
  } catch (error) { showToast(error.message); }
  finally { hideLoading(); }
}

function validateRecordFile(file) {
  if (!file) return "생기부 파일을 선택해 주세요.";
  const allowedExtensions = ["pdf", "doc", "docx", "txt", "jpg", "jpeg", "png", "webp", "gif"];
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!allowedExtensions.includes(extension)) return "지원하지 않는 파일 형식입니다.";
  if (file.size > 20 * 1024 * 1024) return "파일 크기는 20MB 이하여야 합니다.";
  return "";
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function safeUploadName(value) {
  return String(value).normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "").slice(-120) || "record";
}

function recordContentType(file) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return ({
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif"
  })[extension] || "application/octet-stream";
}

async function deleteProfile() {
  if (!confirm("이 분석과 연결된 모든 면접 기록을 삭제할까요?")) return;
  await api(`/api/profiles/${state.profileId}`, { method: "DELETE" });
  state.profiles = state.profiles.filter(item => item.id !== state.profileId);
  state.sessions = state.sessions.filter(item => item.profileId !== state.profileId);
  state.profileId = state.profiles[0]?.id || null;
  renderRecord(); showToast("삭제했습니다.");
}

async function startInterview() {
  showLoading("면접실을 준비하고 있어요", "활동 범주가 겹치지 않도록 질문을 고르는 중입니다.");
  try {
    state.session = await api("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: state.profileId, mode: document.querySelector('input[name="mode"]:checked').value, questionCount: document.querySelector("#question-count").value }) });
    renderInterview();
  } catch (error) { showToast(error.message); }
  finally { hideLoading(); }
}

function renderInterview(feedback = null) {
  const session = state.session;
  const question = session.questions[session.currentIndex];
  if (!question) return finishInterview();
  state.seconds = 0;
  app.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">${session.mode === "practice" ? "Coaching mode" : "Mock interview"}</span><h1>${session.mode === "practice" ? "코칭 연습" : "실전 모의면접"}</h1></div><button class="btn btn-secondary" id="quit">나가기</button></div>
    <div class="interview-layout">
      <section class="card interview-stage">
        <div class="progress-row"><span>${session.currentIndex + 1} / ${session.questions.length}</span><div class="progress"><span style="width:${((session.currentIndex + 1) / session.questions.length) * 100}%"></span></div><span>${escapeHtml(question.category)}</span></div>
        <div class="interviewer"><div class="avatar">Q</div><small>${escapeHtml(question.category)}</small><h2>${escapeHtml(question.question)}</h2></div>
        <div class="answer-area"><div class="answer-toolbar"><span class="timer" id="timer">00:00</span><button class="btn btn-secondary mic-btn" id="mic">🎙 음성으로 답하기</button></div><textarea id="answer" placeholder="답변을 입력하거나 마이크 버튼을 눌러 말해 보세요."></textarea><div class="actions"><button class="btn btn-primary" id="submit-answer">답변 완료 →</button></div></div>
        <div id="feedback-slot"></div>
      </section>
      <aside class="card side-note"><h3>답변 체크</h3><ol><li>첫 문장에 결론이 있나요?</li><li>내가 직접 한 행동이 드러나나요?</li><li>구체적인 상황이나 결과가 있나요?</li><li>배운 점을 전공과 연결했나요?</li></ol><div class="privacy-note">실전 모드에서는 답변 중 피드백을 보여주지 않습니다.</div></aside>
    </div>`;
  document.querySelector("#quit").onclick = () => { if (confirm("면접을 중단하고 나갈까요? 기록은 임시 저장됩니다.")) navigate("record"); };
  document.querySelector("#submit-answer").onclick = submitAnswer;
  document.querySelector("#mic").onclick = toggleRecognition;
  startTimer();
  if (feedback) showFeedback(feedback);
}

async function submitAnswer() {
  const answer = document.querySelector("#answer").value.trim();
  if (!answer) return showToast("답변을 입력해 주세요.");
  stopTimer(); stopRecognition();
  showLoading(state.session.mode === "practice" ? "답변을 코칭하고 있어요" : "답변을 저장하고 있어요", "생기부 근거와 답변을 비교하는 중입니다.");
  try {
    const result = await api(`/api/sessions/${state.session.id}/answers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer, durationSeconds: state.seconds }) });
    state.session.answers.push(result.answer); state.session.currentIndex = result.nextIndex;
    if (state.session.mode === "practice") {
      hideLoading();
      renderAnswerFeedback(result.answer.feedback, result.finished);
    } else if (result.finished) await finishInterview();
    else { hideLoading(); renderInterview(); }
  } catch (error) { hideLoading(); showToast(error.message); startTimer(); }
}

function renderAnswerFeedback(feedback, finished) {
  const question = state.session.questions[state.session.currentIndex - 1];
  app.innerHTML = `<div class="page-head"><div><span class="eyebrow">Answer feedback</span><h1>답변 코칭</h1></div></div><section class="card feedback"><div class="feedback-score">${feedback.score}</div><span class="tag orange">${escapeHtml(question.category)}</span><h2 style="margin-top:14px">${escapeHtml(feedback.verdict)}</h2><div class="grid two"><div><h3>잘한 점</h3><ul>${feedback.goodPoints.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div><div><h3>보완할 점</h3><ul>${feedback.improvements.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div></div>${feedback.factualRisks.length ? `<div class="privacy-note"><b>사실 확인 필요</b><br>${feedback.factualRisks.map(escapeHtml).join("<br>")}</div>` : ""}<h3>이렇게 다듬어 보세요</h3><p class="better-answer">${escapeHtml(feedback.betterAnswer)}</p><h3>이어질 수 있는 꼬리질문</h3><p>${escapeHtml(feedback.followUpQuestion)}</p><div class="actions"><button class="btn btn-primary" id="continue">${finished ? "종합 리포트 보기" : "다음 질문 →"}</button></div></section>`;
  document.querySelector("#continue").onclick = finished ? finishInterview : renderInterview;
}

async function finishInterview() {
  showLoading("전체 면접을 분석하고 있어요", "답변별 강점과 개선 답변, 종합 점수를 만드는 중입니다.");
  try {
    state.session = await api(`/api/sessions/${state.session.id}/finish`, { method: "POST" });
    const existing = state.sessions.findIndex(item => item.id === state.session.id);
    if (existing >= 0) state.sessions[existing] = state.session; else state.sessions.unshift(state.session);
    renderReport(state.session);
  } catch (error) { showToast(error.message); }
  finally { hideLoading(); }
}

function renderReport(session) {
  const report = session.report;
  const labels = { specificity: "구체성", logic: "논리", authenticity: "진정성", communication: "전달력", recordAlignment: "기록 일치" };
  app.innerHTML = `<div class="page-head"><div><span class="eyebrow">Interview report</span><h1>면접 리포트</h1></div><button class="btn btn-secondary" data-view="history">기록 목록</button></div>
    <section class="card report-hero"><div class="score-ring" style="--score:${report.totalScore}%"><strong>${report.totalScore}</strong></div><div><span class="tag orange">${session.mode === "practice" ? "코칭 연습" : "실전 모의면접"}</span><h2 style="margin-top:14px">${escapeHtml(report.summary)}</h2><p class="subtle">${escapeHtml(session.profileTitle)} · ${formatDate(session.completedAt)}</p></div></section>
    <div class="grid two" style="margin-top:20px"><section class="card"><h3>평가 항목</h3><div class="dimensions">${Object.entries(report.dimensions).map(([key, value]) => `<div class="dimension"><span>${labels[key]}</span><div class="bar"><span style="width:${value}%"></span></div><b>${value}</b></div>`).join("")}</div></section><section class="card"><h3>다음 연습의 초점</h3><ul>${report.improvements.map(x => `<li class="subtle">${escapeHtml(x)}</li>`).join("")}</ul></section></div>
    <section class="card" style="margin-top:20px"><h2>답변별 분석</h2>${report.answerReviews.map((review, index) => `<article class="review"><div class="review-q"><h3>Q${index + 1}. ${escapeHtml(review.question)}</h3><span class="score-badge">${review.score}</span></div><p><b>좋았던 점</b> · ${escapeHtml(review.good)}</p><p><b>보완할 점</b> · ${escapeHtml(review.improve)}</p><p class="better-answer">${escapeHtml(review.betterAnswer)}</p></article>`).join("")}</section>
    <section class="card" style="margin-top:20px"><h3>최종 조언</h3><p class="subtle">${escapeHtml(report.finalAdvice)}</p><div class="actions"><button class="btn btn-primary" data-view="record">다시 연습하기</button></div></section>`;
}

function renderHistory() {
  app.innerHTML = `<div class="page-head"><div><span class="eyebrow">Your archive</span><h1>면접 기록</h1></div></div>${state.sessions.length ? `<div class="grid sidebar"><aside class="card"><h3>최근 기록</h3><div class="history-list">${state.sessions.map(session => `<button class="history-item" data-session="${session.id}"><b>${escapeHtml(session.profileTitle)}</b><small>${formatDate(session.createdAt)} · ${session.mode === "practice" ? "코칭" : "실전"} · ${session.status === "completed" ? `${session.report.totalScore}점` : "진행 중"}</small></button>`).join("")}</div></aside><section class="card empty"><div class="icon">Q.</div><h2>기록을 선택해 주세요</h2><p class="subtle">완료된 면접의 답변과 종합 리포트를 다시 볼 수 있습니다.</p></section></div>` : `<section class="card empty"><div class="icon">Q.</div><h2>아직 면접 기록이 없습니다</h2><p class="subtle">생기부를 분석하고 첫 면접을 시작해 보세요.</p><button class="btn btn-primary" data-view="record">시작하기</button></section>`}`;
  document.querySelectorAll("[data-session]").forEach(button => button.onclick = async () => {
    try { const session = await api(`/api/sessions/${button.dataset.session}`); session.report ? renderReport(session) : resumeSession(session); }
    catch (error) { showToast(error.message); }
  });
}

function resumeSession(session) { state.session = session; renderInterview(); }
function startTimer() { stopTimer(); state.timer = setInterval(() => { state.seconds += 1; const el = document.querySelector("#timer"); if (el) el.textContent = `${String(Math.floor(state.seconds / 60)).padStart(2, "0")}:${String(state.seconds % 60).padStart(2, "0")}`; }, 1000); }
function stopTimer() { if (state.timer) clearInterval(state.timer); state.timer = null; }

function toggleRecognition() {
  if (state.recognition) return stopRecognition();
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return showToast("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 사용을 권장합니다.");
  const recognition = new Recognition(); recognition.lang = "ko-KR"; recognition.interimResults = true; recognition.continuous = true;
  const textarea = document.querySelector("#answer"); const initial = textarea.value;
  recognition.onresult = event => { let text = ""; for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript; textarea.value = `${initial}${initial ? " " : ""}${text}`; };
  recognition.onerror = () => { stopRecognition(); showToast("음성 인식이 중단되었습니다."); };
  recognition.onend = () => {
    if (state.recognition === recognition) state.recognition = null;
    resetRecognitionButton();
  };
  recognition.start(); state.recognition = recognition;
  document.querySelector("#mic").classList.add("recording"); document.querySelector("#mic").textContent = "■ 인식 중지";
}

function stopRecognition() { if (!state.recognition) return; const recognition = state.recognition; state.recognition = null; try { recognition.stop(); } catch {} resetRecognitionButton(); }
function resetRecognitionButton() { const button = document.querySelector("#mic"); if (button) { button.classList.remove("recording"); button.textContent = "🎙 음성으로 답하기"; } }
function showLoading(title, subtitle) { document.body.insertAdjacentHTML("beforeend", `<div class="loading" id="loading"><div class="loading-card"><div class="spinner"></div><h2>${escapeHtml(title)}</h2><p class="subtle">${escapeHtml(subtitle)}</p></div></div>`); }
function hideLoading() { document.querySelector("#loading")?.remove(); }
function showToast(message) { toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 3200); }
function formatDate(value) { if (!value) return ""; return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function firebaseErrorMessage(error) {
  if (error?.code === "auth/popup-closed-by-user") return "로그인 창이 닫혔습니다.";
  if (error?.code === "auth/popup-blocked") return "브라우저에서 로그인 팝업을 허용해 주세요.";
  if (error?.code === "auth/unauthorized-domain") return "Firebase Authentication의 승인된 도메인에 이 주소를 추가해 주세요.";
  return error?.message || "Google 로그인에 실패했습니다.";
}

initialize();
