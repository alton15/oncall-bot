import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseAgentOutput, extractSlackMessage } from "../output-parser.js";

describe("output-parser", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parseAgentOutput", () => {
    it("parses valid JSON output", () => {
      const raw = '{"status": "success", "summary": "Found 3 files", "details": "...", "confidence": "high"}';
      const result = parseAgentOutput("code-analyzer", raw);

      expect(result.status).toBe("success");
      expect(result.summary).toBe("Found 3 files");
      expect(result.confidence).toBe("high");
    });

    it("returns partial status for non-JSON output", () => {
      const raw = "This is just plain text without JSON";
      const result = parseAgentOutput("code-analyzer", raw);

      expect(result.status).toBe("partial");
      expect(result.details).toBe(raw);
      expect(result.confidence).toBe("low");
    });

    it("returns partial status when required fields are missing", () => {
      const raw = '{"details": "something"}';
      const result = parseAgentOutput("code-analyzer", raw);

      expect(result.status).toBe("partial");
      expect(result.confidence).toBe("low");
    });
  });

  describe("extractSlackMessage", () => {
    it("extracts slack_message from valid JSON", () => {
      const raw = '{"slack_message": "Hello from bot!"}';
      expect(extractSlackMessage(raw)).toBe("Hello from bot!");
    });

    it("returns raw output when no slack_message found", () => {
      const raw = "plain text response";
      expect(extractSlackMessage(raw)).toBe(raw);
    });

    it("returns raw output for invalid JSON", () => {
      const raw = '{"slack_message": broken}';
      expect(extractSlackMessage(raw)).toBe(raw);
    });

    it("extracts slack_message from markdown code block wrapped JSON", () => {
      const raw = '```json\n{"slack_message": "Hello!"}\n```';
      expect(extractSlackMessage(raw)).toBe("Hello!");
    });

    it("extracts slack_message from code block without language tag", () => {
      const raw = '```\n{"slack_message": "No lang tag"}\n```';
      expect(extractSlackMessage(raw)).toBe("No lang tag");
    });

    it("extracts slack_message from double-wrapped JSON string", () => {
      const inner = JSON.stringify({ slack_message: "double wrapped!" });
      const raw = JSON.stringify(inner); // string inside string
      expect(extractSlackMessage(raw)).toBe("double wrapped!");
    });

    it("extracts slack_message when JSON is surrounded by text", () => {
      const raw = 'Here is the response:\n{"slack_message": "embedded"}\nDone.';
      expect(extractSlackMessage(raw)).toBe("embedded");
    });

    it("extracts slack_message from JSON with surrounding text in code block", () => {
      const raw = '```json\nSome prefix text\n{"slack_message": "in block"}\n```';
      expect(extractSlackMessage(raw)).toBe("in block");
    });

    it("extracts slack_message when value contains markdown code blocks", () => {
      const msg = ":mag: *분석*\n```\nasync def get_unit():\n    pass\n```\n끝";
      const raw = JSON.stringify({ status: "success", slack_message: msg });
      expect(extractSlackMessage(raw)).toBe(msg);
    });

    it("extracts slack_message when value contains multiple code blocks", () => {
      const msg = "코드1:\n```python\ndef foo():\n    pass\n```\n코드2:\n```js\nconst x = 1;\n```\n완료";
      const raw = JSON.stringify({ status: "success", slack_message: msg });
      expect(extractSlackMessage(raw)).toBe(msg);
    });
  });
});
