import OpenAI, { toFile } from "openai";
import { profileAnalysisSchema, answerFeedbackSchema, sessionReportSchema } from "./schemas.js";

const model = process.env.OPENAI_MODEL || "gpt-6.2-sol";
let nextKeyIndex = 0;

export function parseApiKeys(environment = process.env) {
  const multipleKeys = String(environment.OPENAI_API_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (multipleKeys.length) return [...new Set(multipleKeys)];
  return environment.OPENAI_API_KEY?.trim() ? [environment.OPENAI_API_KEY.trim()] : [];
}

export function getApiKeyCount() {
  return parseApiKeys().length;
}

function nextClient() {
  const keys = parseApiKeys();
  if (!keys.length) {
    const error = new Error("OPENAI_API_KEYS 또는 OPENAI_API_KEY가 설정되지 않았습니다. .env.example을 참고해 .env 파일을 만들어 주세요.");
    error.status = 503;
    throw error;
  }
  const key = keys[nextKeyIndex % keys.length];
  nextKeyIndex = (nextKeyIndex + 1) % keys.length;
  return new OpenAI({ apiKey: key });
}

const interviewerRules = `당신은 대한민국 대학 학생부종합전형 면접 코치다.
- 반드시 제공된 학교생활기록부 근거와 학생 답변만 사용한다. 기록에 없는 사실은 지어내지 않는다.
- 답변을 결론-구체적 행동-배운 점-지원 전공과의 연결 순서로 평가한다.
- 학생의 경험을 대신 창작하지 말고, 예시 답변에는 제공된 사실만 넣는다.
- 한국어 고등학생이 실제 면접에서 말할 수 있는 자연스러운 구어체를 쓴다.
- 좋은 점과 개선점을 모두 구체적으로 말한다. 막연한 칭찬은 피한다.
- 사실 불일치나 과장 가능성은 명시적으로 표시한다.`;

async function structuredResponse({ input, schema, name, effort = "medium", api = nextClient() }) {
  const response = await api.responses.create({
    model,
    store: false,
    reasoning: { effort },
    input: [
      { role: "developer", content: interviewerRules },
      ...input
    ],
    text: {
      format: {
        type: "json_schema",
        name,
        strict: true,
        schema
      }
    }
  });

  if (!response.output_text) throw new Error("AI가 분석 결과를 반환하지 않았습니다.");
  return JSON.parse(response.output_text);
}

export async function analyzeStudentRecord(file, target = {}) {
  const api = nextClient();
  const prompt = { type: "input_text", text: `이 학교생활기록부를 면접 준비용으로 분석하라. 지원 대학은 '${target.university || "미정"}', 지원 학과는 '${target.major || "미정"}'이다. 개인정보(이름, 생년월일, 주소, 연락처)는 결과에 옮기지 마라. 활동은 기록 속 근거를 짧게 인용하지 말고 요약하라. 서로 다른 범주의 예상 질문을 최소 10개 만들고 각 질문의 평가 의도, 근거, 가능한 꼬리질문을 작성하라.` };

  if (file.mimetype.startsWith("image/")) {
    return structuredResponse({
      name: "student_record_analysis",
      schema: profileAnalysisSchema,
      api,
      input: [{
        role: "user",
        content: [createImageInput(file), prompt]
      }]
    });
  }

  // 문서 업로드와 분석은 같은 프로젝트 키로 처리해야 file_id에 접근할 수 있다.
  const uploaded = await api.files.create({
    file: await toFile(file.buffer, file.originalname, { type: file.mimetype }),
    purpose: "user_data"
  });

  try {
    const fileContent = { type: "input_file", file_id: uploaded.id };
    if (file.mimetype === "application/pdf") fileContent.detail = "high";
    const analysis = await structuredResponse({
      name: "student_record_analysis",
      schema: profileAnalysisSchema,
      api,
      input: [{
        role: "user",
        content: [
          fileContent,
          prompt
        ]
      }]
    });
    return analysis;
  } finally {
    await api.files.delete(uploaded.id).catch(() => {});
  }
}

export function createImageInput(file) {
  return {
    type: "input_image",
    image_url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    detail: "high"
  };
}

export function compactProfile(profile) {
  return {
    targetUniversity: profile.targetUniversity,
    targetMajor: profile.targetMajor,
    studentOverview: profile.studentOverview,
    activities: profile.activities,
    strengths: profile.strengths,
    riskPoints: profile.riskPoints
  };
}

export async function evaluateAnswer({ profile, question, answer }) {
  return structuredResponse({
    name: "answer_feedback",
    schema: answerFeedbackSchema,
    effort: "low",
    input: [{
      role: "user",
      content: `학생부 분석:\n${JSON.stringify(compactProfile(profile))}\n\n질문:\n${question.question}\n질문의 의도: ${question.intent}\n학생부 근거: ${question.evidence}\n\n학생 답변:\n${answer}\n\n답변을 평가하고, 학생부와 어긋날 수 있는 표현을 따로 지적하라. betterAnswer는 학생 답변의 사실을 유지하면서 45~75초 분량으로 다듬어라. followUpQuestion은 방금 답변을 파고드는 한 문장 질문으로 작성하라.`
    }]
  });
}

export async function buildSessionReport({ profile, answers }) {
  return structuredResponse({
    name: "interview_session_report",
    schema: sessionReportSchema,
    input: [{
      role: "user",
      content: `학생부 분석:\n${JSON.stringify(compactProfile(profile))}\n\n모의면접 문답:\n${JSON.stringify(answers)}\n\n전체 면접을 평가하라. specificity는 구체성, logic은 논리 구조, authenticity는 진정성, communication은 전달력, recordAlignment는 학생부 일치도다. 답변별로 잘한 점, 개선점, 학생이 실제로 말할 수 있는 개선 답변을 작성하라. 답이 비어 있으면 낮게 평가하고 그 사실을 밝혀라.`
    }]
  });
}

export { model };
