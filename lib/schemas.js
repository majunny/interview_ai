export const profileAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["studentOverview", "activities", "strengths", "riskPoints", "questions"],
  properties: {
    studentOverview: { type: "string" },
    activities: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "category", "evidence", "themes"],
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          evidence: { type: "string" },
          themes: { type: "array", items: { type: "string" } }
        }
      }
    },
    strengths: { type: "array", minItems: 3, items: { type: "string" } },
    riskPoints: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      minItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "question", "intent", "evidence", "followUps"],
        properties: {
          category: {
            type: "string",
            enum: ["지원동기", "학업역량", "탐구활동", "전공적합성", "협업·인성", "사실확인", "압박·꼬리질문"]
          },
          question: { type: "string" },
          intent: { type: "string" },
          evidence: { type: "string" },
          followUps: { type: "array", minItems: 1, items: { type: "string" } }
        }
      }
    }
  }
};

export const answerFeedbackSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "verdict", "goodPoints", "improvements", "factualRisks", "betterAnswer", "followUpQuestion"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    verdict: { type: "string" },
    goodPoints: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    factualRisks: { type: "array", items: { type: "string" } },
    betterAnswer: { type: "string" },
    followUpQuestion: { type: "string" }
  }
};

const answerReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["question", "score", "good", "improve", "betterAnswer"],
  properties: {
    question: { type: "string" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    good: { type: "string" },
    improve: { type: "string" },
    betterAnswer: { type: "string" }
  }
};

export const sessionReportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["totalScore", "summary", "dimensions", "strengths", "improvements", "answerReviews", "finalAdvice"],
  properties: {
    totalScore: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    dimensions: {
      type: "object",
      additionalProperties: false,
      required: ["specificity", "logic", "authenticity", "communication", "recordAlignment"],
      properties: {
        specificity: { type: "integer", minimum: 0, maximum: 100 },
        logic: { type: "integer", minimum: 0, maximum: 100 },
        authenticity: { type: "integer", minimum: 0, maximum: 100 },
        communication: { type: "integer", minimum: 0, maximum: 100 },
        recordAlignment: { type: "integer", minimum: 0, maximum: 100 }
      }
    },
    strengths: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    answerReviews: { type: "array", items: answerReviewSchema },
    finalAdvice: { type: "string" }
  }
};
