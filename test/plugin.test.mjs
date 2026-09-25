import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import ompGreppyExtension from "../dist/extension.js";
import { appendNoteToMessages, buildGreppyNote, NOTE_TAG, RepoIndexCache } from "../dist/context.js";
import { childEnv, resolveGreppyBinary } from "../dist/greppy.js";
import { EXIT_INDEX_NOT_READY, formatResult, TOOL_SPECS } from "../dist/tools.js";

const spec = (name) => TOOL_SPECS.find((s) => s.name === name);
const run = (overrides) => ({ code: 0, stdout: "", stderr: "", timedOut: false, aborted: false, ...overrides });

test("positional symbols and queries follow `--` so a leading dash is never parsed as a flag", () => {
  const args = spec("gcallers").build({ symbols: ["-weird", "run"] });
  assert.deepEqual(args.slice(args.indexOf("--")), ["--", "-weird", "run"]);
  const search = spec("gsearch").build({ query: "--all of it" });
  assert.equal(search.at(-2), "--");
  assert.equal(search.at(-1), "--all of it");
  assert.ok(!search.slice(0, -2).includes("--all"));
  const chain = spec("gchain").build({ from: "-a", to: "b" });
  assert.ok(chain.includes("--from=-a") && chain.includes("--to=b"));
});

test("symbol lists accept a comma/space separated string as well as an array", () => {
  const args = spec("gcallees").build({ symbols: "alpha, beta  gamma" });
  assert.deepEqual(args.slice(args.indexOf("--") + 1), ["alpha", "beta", "gamma"]);
  assert.equal(spec("gcallers").build({ symbols: [] }), "symbols is required");
});

test("impact passes depth and direction and rejects an unknown direction", () => {
  const args = spec("gimpact").build({ symbol: "S", depth: 2, direction: "outgoing" });
  assert.deepEqual(args.slice(0, 5), ["impact", "--depth", "2", "--direction", "outgoing"]);
  assert.equal(spec("gimpact").build({ symbol: "S", direction: "sideways" }), "direction must be incoming or outgoing");
});

test("gread switches to read-smart only when smart is set, and never passes --limit", () => {
  const plain = spec("gread").build({ symbols: ["f"], depth: 3 });
  assert.equal(plain[0], "read");
  assert.ok(!plain.includes("--depth"));
  const smart = spec("gread").build({ symbols: ["f"], smart: true, depth: 3, limit: 5 });
  assert.deepEqual(smart.slice(0, 3), ["read-smart", "--depth", "3"]);
  assert.ok(!smart.includes("--limit"));
});

test("every listing call carries a stdout budget; code and paging flags only when asked", () => {
  const args = spec("gsymbol").build({ name: "x" });
  assert.equal(args[args.indexOf("--max-bytes") + 1], "16000");
  assert.ok(!args.includes("--code") && !args.includes("--all") && !args.includes("--offset"));
  const paged = spec("gsymbol").build({ name: "x", code: true, all: true, offset: 20, limit: 5, path: "src/" });
  for (const flag of ["--code", "--all", "--offset", "--limit", "--path"]) assert.ok(paged.includes(flag), flag);
});

test("exit 75 tells the model the index is not ready, and gsearch points at ffjfind", () => {
  const text = formatResult(spec("gsearch"), run({ code: EXIT_INDEX_NOT_READY, stderr: "search: run `greppy index .` first" }), 1000);
  assert.match(text, /run `greppy index \.` first/);
  assert.match(text, /\/greppy-index/);
  assert.match(text, /ffjfind/);
  assert.doesNotMatch(formatResult(spec("gcallers"), run({ code: EXIT_INDEX_NOT_READY }), 1000), /ffjfind/);
});

test("exit 1 is a no-match answer, not a failure; spawn errors and timeouts are explicit", () => {
  assert.equal(formatResult(spec("gsymbol"), run({ code: 1 }), 1000), "no match");
  assert.doesNotMatch(formatResult(spec("gsymbol"), run({ code: 1, stdout: "status: no_matches" }), 1000), /failed/);
  assert.match(formatResult(spec("gsymbol"), run({ code: null, error: "spawn ENOENT" }), 1000), /could not run greppy/);
  assert.match(formatResult(spec("gsymbol"), run({ code: null, timedOut: true }), 120_000), /timed out after 120s/);
  assert.match(formatResult(spec("gsymbol"), run({ code: 64, stderr: "bad" }), 1000), /greppy exit 64\): bad/);
});

test("the note is appended once to the last user message, for string and part content", () => {
  const note = buildGreppyNote(true);
  const messages = [{ role: "user", content: "first" }, { role: "assistant", content: "ok" }, { role: "user", content: "second" }];
  appendNoteToMessages(messages, note);
  appendNoteToMessages(messages, note);
  assert.equal(messages[2].content.split(NOTE_TAG).length - 1, 1);
  assert.equal(messages[0].content, "first");
  const parts = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  appendNoteToMessages(parts, note);
  appendNoteToMessages(parts, note);
  assert.equal(parts[0].content.length, 2);
  const empty = appendNoteToMessages([{ role: "assistant", content: "x" }], note);
  assert.equal(empty.at(-1).role, "user");
});

test("a user message that merely mentions the tag still gets the note", () => {
  const note = buildGreppyNote(true);
  const text = [{ role: "user", content: `does my message contain a ${NOTE_TAG} block?` }];
  appendNoteToMessages(text, note);
  assert.ok(text[0].content.endsWith(note));
  const parts = [{ role: "user", content: [{ type: "text", text: `what is ${NOTE_TAG}?` }] }];
  appendNoteToMessages(parts, note);
  assert.equal(parts[0].content.at(-1).text, note);
});

test("an unindexed repository gets a note that does not promise a ready graph", () => {
  assert.match(buildGreppyNote(false), /no index yet/);
  assert.doesNotMatch(buildGreppyNote(false), /has a greppy code graph/);
});

test("CUDA bin is prepended to the child PATH once, whatever the key casing", () => {
  const cuda = "C:\\CUDA\\v12.9\\bin";
  const env = childEnv({ Path: "C:\\Windows" }, cuda);
  assert.equal(env.Path, `${cuda};C:\\Windows`);
  assert.equal(env.PATH, undefined);
  assert.equal(childEnv({ Path: `C:\\Windows;${cuda}\\` }, cuda).Path, `C:\\Windows;${cuda}\\`);
  assert.deepEqual(childEnv({ PATH: "/usr/bin" }, null), { PATH: "/usr/bin" });
});

test("with CUDA present the child asks for cuda explicitly, but a chosen device wins", () => {
  const cuda = "C:\\CUDA\\v12.9\\bin";
  assert.equal(childEnv({ Path: "C:\\Windows" }, cuda).GREPPY_DEVICE, "cuda");
  assert.equal(childEnv({ Path: "C:\\Windows", GREPPY_DEVICE: "cuda:1" }, cuda).GREPPY_DEVICE, "cuda:1");
  assert.equal(childEnv({ PATH: "/usr/bin" }, null).GREPPY_DEVICE, undefined);
});

test("GREPPY_BIN wins, and a wrong GREPPY_BIN is reported instead of silently replaced", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-greppy-bin-"));
  const fake = path.join(dir, process.platform === "win32" ? "greppy.exe" : "greppy");
  fs.writeFileSync(fake, "");
  assert.equal(resolveGreppyBinary({ GREPPY_BIN: fake, PATH: "" }), fake);
  assert.equal(resolveGreppyBinary({ GREPPY_BIN: path.join(dir, "missing"), PATH: dir }), undefined);
  assert.equal(resolveGreppyBinary({ PATH: dir }), fake);
});

test("the index cache answers immediately and refreshes one root at a time", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = new RepoIndexCache(async () => { calls += 1; await gate; return false; });
  assert.equal(cache.get("bin", "/r"), undefined);
  assert.equal(cache.get("bin", "/r"), undefined);
  assert.equal(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.get("bin", "/r"), false);
  cache.set("/r", true);
  assert.equal(cache.get("bin", "/r"), true);
});

const greppy = resolveGreppyBinary();

test("end to end: the extension registers tools that answer from a real greppy index", { skip: greppy === undefined && "greppy binary not found" }, async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "omp-greppy-e2e-"));
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "a.ts"), [
    "export function clampValue(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }",
    "export function scale(v: number) { return clampValue(v * 2, 0, 10); }",
    "export function main() { return scale(3); }",
    "",
  ].join("\n"));
  const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "init");
  execFileSync(greppy, ["index"], { cwd: repo, stdio: "ignore" });

  const tools = new Map();
  const listeners = new Map();
  ompGreppyExtension({
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: () => {},
    on: (event, listener) => listeners.set(event, listener),
  });
  assert.deepEqual([...tools.keys()].sort(), TOOL_SPECS.map((s) => s.name).sort());

  const call = async (name, params) => (await tools.get(name).execute("id", params, undefined, undefined, { cwd: repo })).content[0].text;
  assert.match(await call("gcallers", { symbols: ["clampValue"] }), /src\/a\.ts:2\s+scale/);
  assert.match(await call("gchain", { from: "main", to: "clampValue" }), /clampValue/);
  assert.match(await call("gimpact", { symbol: "clampValue" }), /main/);
  assert.match(await call("gsymbol", { name: "zzzNoSuch" }), /no definition named/);

  const cwd = process.cwd();
  process.chdir(repo);
  try {
    const out = listeners.get("context")({ messages: [{ role: "user", content: "hello" }] });
    assert.match(out.messages[0].content, /<greppy-tools>/);
  } finally {
    process.chdir(cwd);
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "omp-greppy-nogit-"));
  process.chdir(outside);
  try {
    assert.equal(listeners.get("context")({ messages: [{ role: "user", content: "hello" }] }), undefined);
  } finally {
    process.chdir(cwd);
  }
});
