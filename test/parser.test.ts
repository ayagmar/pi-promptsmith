import test from "node:test";
import assert from "node:assert/strict";
import { parseEnhancedPrompt } from "../src/parser.js";
import { SENTINEL_CLOSE, SENTINEL_OPEN } from "../src/constants.js";

void test("parseEnhancedPrompt extracts the enclosed prompt", () => {
  assert.equal(
    parseEnhancedPrompt(`${SENTINEL_OPEN}\nBetter prompt\n${SENTINEL_CLOSE}`),
    "Better prompt"
  );
});

void test("parseEnhancedPrompt rejects missing sentinel blocks", () => {
  assert.throws(() => parseEnhancedPrompt("plain text"), /sentinel block/i);
});

void test("parseEnhancedPrompt rejects multiple blocks", () => {
  assert.throws(
    () =>
      parseEnhancedPrompt(
        `${SENTINEL_OPEN}one${SENTINEL_CLOSE}\n${SENTINEL_OPEN}two${SENTINEL_CLOSE}`
      ),
    /multiple sentinel blocks/i
  );
});

void test("parseEnhancedPrompt rejects text outside the sentinel block", () => {
  assert.throws(
    () => parseEnhancedPrompt(`prefix ${SENTINEL_OPEN}prompt${SENTINEL_CLOSE}`),
    /outside the sentinel block/i
  );
});

void test("parseEnhancedPrompt rejects empty sentinel blocks", () => {
  assert.throws(
    () => parseEnhancedPrompt(`${SENTINEL_OPEN}\n\n${SENTINEL_CLOSE}`),
    /empty enhanced prompt/i
  );
});
