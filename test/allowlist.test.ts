import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AppAllowlist,
  MemoryAppAllowlistStore,
  isAppPackageName,
  normalizeAppPackage,
} from "../src/security/index.js";

test("the allowlist is empty by default: nothing is allowed", () => {
  const allowlist = new AppAllowlist();
  assert.deepEqual(allowlist.list(), []);
  assert.equal(allowlist.isAllowed("com.example.notes"), false);
  assert.equal(allowlist.isAllowed("com.android.settings"), false);
});

test("adding, deduplicating and removing apps", () => {
  const allowlist = new AppAllowlist();
  allowlist.add(" com.example.notes ");
  allowlist.add("com.example.notes");
  allowlist.add("com.example.browser");
  assert.deepEqual(allowlist.list(), ["com.example.browser", "com.example.notes"]);
  assert.equal(allowlist.isAllowed("com.example.notes"), true);
  assert.equal(allowlist.isAllowed(" com.example.notes "), true);
  assert.equal(allowlist.isAllowed("com.example.other"), false);

  assert.equal(allowlist.remove("com.example.notes"), true);
  assert.equal(allowlist.remove("com.example.notes"), false);
  assert.deepEqual(allowlist.list(), ["com.example.browser"]);

  allowlist.clear();
  assert.deepEqual(allowlist.list(), []);
});

test("a shared store persists the allowlist across daemon restarts", () => {
  const store = new MemoryAppAllowlistStore();
  const first = new AppAllowlist(store);
  first.add("com.example.notes");
  const second = new AppAllowlist(store);
  assert.deepEqual(second.list(), ["com.example.notes"]);
  second.clear();
  const third = new AppAllowlist(store);
  assert.deepEqual(third.list(), []);
});

test("invalid or malformed package names are rejected", () => {
  const allowlist = new AppAllowlist();
  for (const value of ["", " ", "notes", "com..notes", ".com.notes", "com.notes.", "com.exa mple", "com.ex-ample"]) {
    assert.throws(() => allowlist.add(value), TypeError, `expected ${JSON.stringify(value)} to be rejected`);
    assert.equal(isAppPackageName(value), false);
  }
  assert.throws(() => normalizeAppPackage(`com.example.${"a".repeat(300)}`), TypeError);
  assert.equal(isAppPackageName("com.example.app_2"), true);
});

test("package names are treated case-sensitively", () => {
  const allowlist = new AppAllowlist();
  allowlist.add("com.example.Notes");
  assert.equal(allowlist.isAllowed("com.example.Notes"), true);
  assert.equal(allowlist.isAllowed("com.example.notes"), false);
});
