import test from "node:test";
import assert from "node:assert/strict";
import { profileAnalysisSchema, answerFeedbackSchema, sessionReportSchema } from "../lib/schemas.js";
import { createImageInput, parseApiKeys } from "../lib/openai.js";

test("all structured output schemas are strict at the root", () => {
  for (const schema of [profileAnalysisSchema, answerFeedbackSchema, sessionReportSchema]) {
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
  }
});

test("profile analysis requests enough varied interview questions", () => {
  assert.equal(profileAnalysisSchema.properties.questions.minItems, 10);
  assert.ok(profileAnalysisSchema.properties.questions.items.properties.category.enum.includes("사실확인"));
  assert.ok(profileAnalysisSchema.properties.questions.items.properties.category.enum.includes("압박·꼬리질문"));
});

test("report covers the five promised evaluation dimensions", () => {
  assert.deepEqual(sessionReportSchema.properties.dimensions.required.sort(), [
    "authenticity", "communication", "logic", "recordAlignment", "specificity"
  ]);
});

test("multiple API keys are trimmed, deduplicated, and preferred", () => {
  assert.deepEqual(parseApiKeys({
    OPENAI_API_KEYS: " key-one, key-two, key-one ",
    OPENAI_API_KEY: "fallback-key"
  }), ["key-one", "key-two"]);
  assert.deepEqual(parseApiKeys({ OPENAI_API_KEY: "single-key" }), ["single-key"]);
});

test("image records use a base64 image input instead of a document input", () => {
  assert.deepEqual(createImageInput({
    mimetype: "image/png",
    buffer: Buffer.from("image-bytes")
  }), {
    type: "input_image",
    image_url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
    detail: "high"
  });
});
