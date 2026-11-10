import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessage, sha256Hex, stableJson, truncateText } from "../src/security/util.js";

test("sha256Hex matches the standard digest", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("stableJson sorts keys recursively and handles uncommon values", () => {
  assert.equal(stableJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(stableJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(stableJson([undefined, 1n]), "[null,\"1\"]");
  assert.equal(stableJson(new Date("2026-01-01T00:00:00.000Z")), "{}");
  assert.equal(stableJson(null), "null");
});

test("truncateText respects the limit and marks cut strings", () => {
  assert.equal(truncateText("abc", 3), "abc");
  assert.equal(truncateText("abcd", 3), "ab…");
  assert.equal(truncateText("abcd", 1), "…");
  assert.equal(truncateText("abcd", 0), "");
});

test("errorMessage handles Error, strings and unknowns", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("raw"), "raw");
  assert.equal(errorMessage({ weird: true }), "unknown error");
});
