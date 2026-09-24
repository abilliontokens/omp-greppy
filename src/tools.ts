/**
 * The g* tools: one per question greppy's graph answers, each a thin typed
 * wrapper over one greppy subcommand. greppy already returns compact,
 * located, hinted rows; the wrapper only builds argv, bounds output, and turns
 * exit codes into guidance the model can act on.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { childEnv, resolveGreppyBinary, runGreppy, type RunResult } from "./greppy.js";

type Params = Record<string, unknown>;

/** greppy's own stdout budget per call; keeps one result well inside a turn. */
export const DEFAULT_MAX_BYTES = 16_000;
/** Hard ceiling on text returned to the model, stdout and stderr together. */
const MAX_RESULT_CHARS = 60_000;
const DEFAULT_TIMEOUT_MS = 120_000;

/** Exit code greppy uses when the index is missing, building, or stale. */
export const EXIT_INDEX_NOT_READY = 75;

function str(params: Params, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function int(params: Params, key: string): number | undefined {
  const value = params[key];
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** A symbol list may arrive as an array or a single (space/comma separated) string. */
function list(params: Params, key: string): string[] {
  const value = params[key];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  return raw.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0);
}

interface CommonFlags {
  paging?: boolean;
  code?: boolean;
}

/** Flags shared by the listing commands; order is irrelevant to greppy. */
function commonFlags(params: Params, flags: CommonFlags): string[] {
  const args: string[] = [];
  const scope = str(params, "path");
  if (scope !== undefined) args.push("--path", scope);
  if (flags.paging === true) {
    const limit = int(params, "limit");
    const offset = int(params, "offset");
    if (limit !== undefined) args.push("--limit", String(limit));
    if (offset !== undefined && offset > 0) args.push("--offset", String(offset));
    if (params["all"] === true) args.push("--all");
  }
  if (flags.code === true && params["code"] === true) args.push("--code");
  args.push("--max-bytes", String(int(params, "maxBytes") ?? DEFAULT_MAX_BYTES));
  return args;
}

export type ToolName = "gsymbol" | "gcallers" | "gcallees" | "gimpact" | "gchain" | "gbrief" | "gread" | "gsearch" | "gpattern";

interface ToolSpec {
  name: ToolName;
  label: string;
  description: string;
  promptSnippet: string;
  essential: boolean;
  properties: Record<string, unknown>;
  required: string[];
  /** argv after the binary, or an error message for invalid parameters. */
  build: (params: Params) => string[] | string;
  /** Extra line appended when the index is not ready. */
  notReadyHint?: string;
}

const P = {
  path: { type: "string", description: "Only results under this file or directory (repo-relative)" },
  limit: { type: "number", description: "Max rows (greppy default is a compact first page)" },
  offset: { type: "number", description: "Continue a truncated result at row N" },
  all: { type: "boolean", description: "Every result; only when the default page says evidence was omitted" },
  code: { type: "boolean", description: "Also print source; only when the question needs a body" },
  kind: { type: "string", enum: ["function", "method", "class", "struct", "enum", "trait"], description: "Only definitions of this kind" },
  maxBytes: { type: "number", description: `Stdout budget in bytes (default ${DEFAULT_MAX_BYTES})` },
  cwd: { type: "string", description: "Directory inside the target repository (default: session cwd)" },
  symbol: { type: "string", description: "Symbol name; qualify a duplicated name with its file: `src/data.rs::run`" },
  symbols: { type: "array", items: { type: "string" }, description: "One or more symbol names; qualify duplicates as `file::name`" },
} as const;

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "gsymbol",
    label: "greppy: definition",
    description: "Exact definition lookup from the greppy code graph: every definition whose name contains NAME, with file:line and a one-line hint. Use for 'where is X defined'. Never call it just to locate a symbol before gcallers/gimpact/gchain/gbrief — those take the name directly.",
    promptSnippet: "Where a symbol is defined (graph, exact)",
    essential: true,
    properties: { name: { type: "string", description: "Name or substring of the definition" }, kind: P.kind, code: P.code, path: P.path, limit: P.limit, offset: P.offset, all: P.all, maxBytes: P.maxBytes, cwd: P.cwd },
    required: ["name"],
    build: (p) => {
      const name = str(p, "name");
      if (name === undefined) return "name is required";
      const kind = str(p, "kind");
      return ["search-symbol", ...(kind !== undefined ? ["--kind", kind] : []), ...commonFlags(p, { paging: true, code: true }), "--", name];
    },
  },
  {
    name: "gcallers",
    label: "greppy: callers",
    description: "Every place that uses a symbol — calls, imports, type references — from the greppy code graph, for one or several symbols at once. Use for 'who calls X', deprecation and dead-code questions. For transitive blast radius use gimpact instead of walking callers by hand.",
    promptSnippet: "Who calls / uses a symbol (graph, exact)",
    essential: true,
    properties: { symbols: P.symbols, code: P.code, path: P.path, limit: P.limit, offset: P.offset, all: P.all, maxBytes: P.maxBytes, cwd: P.cwd },
    required: ["symbols"],
    build: (p) => {
      const symbols = list(p, "symbols");
      if (symbols.length === 0) return "symbols is required";
      return ["who-calls", ...commonFlags(p, { paging: true, code: true }), "--", ...symbols];
    },
  },
  {
    name: "gcallees",
    label: "greppy: callees",
    description: "What a symbol uses and where each of those is defined, from the greppy code graph. Accepts several symbols at once.",
    promptSnippet: "What a symbol calls / uses (graph)",
    essential: false,
    properties: { symbols: P.symbols, code: P.code, path: P.path, limit: P.limit, offset: P.offset, all: P.all, maxBytes: P.maxBytes, cwd: P.cwd },
    required: ["symbols"],
    build: (p) => {
      const symbols = list(p, "symbols");
      if (symbols.length === 0) return "symbols is required";
      return ["callees", ...commonFlags(p, { paging: true, code: true }), "--", ...symbols];
    },
  },
  {
    name: "gimpact",
    label: "greppy: impact",
    description: "How far a change to a symbol reaches: the transitive caller tree with hop distance and what each caller does, tests marked. direction 'outgoing' walks what the symbol reaches instead. Use for 'what depends on X', blast radius, change risk — one call replaces recursive caller lookups.",
    promptSnippet: "Transitive blast radius of changing a symbol",
    essential: true,
    properties: {
      symbol: P.symbol,
      depth: { type: "number", description: "Max hop distance (greppy default 6)" },
      direction: { type: "string", enum: ["incoming", "outgoing"], description: "incoming = what breaks if it changes (default); outgoing = what it reaches" },
      path: P.path,
      limit: P.limit,
      offset: P.offset,
      all: P.all,
      maxBytes: P.maxBytes,
      cwd: P.cwd,
    },
    required: ["symbol"],
    build: (p) => {
      const symbol = str(p, "symbol");
      if (symbol === undefined) return "symbol is required";
      const depth = int(p, "depth");
      const direction = str(p, "direction");
      if (direction !== undefined && direction !== "incoming" && direction !== "outgoing") return "direction must be incoming or outgoing";
      return [
        "impact",
        ...(depth !== undefined ? ["--depth", String(depth)] : []),
        ...(direction !== undefined ? ["--direction", direction] : []),
        ...commonFlags(p, { paging: true }),
        "--",
        symbol,
      ];
    },
  },
  {
    name: "gchain",
    label: "greppy: call chain",
    description: "Every call chain from symbol A to symbol B, as a tree of the call sites they hang on. Use for 'how does A reach B' / relationship between two named symbols. Returns locations only; read a returned symbol with gread when its body is needed.",
    promptSnippet: "Call chains from symbol A to symbol B",
    essential: false,
    properties: { from: { type: "string", description: "Starting symbol" }, to: { type: "string", description: "Target symbol" }, path: P.path, limit: P.limit, maxBytes: P.maxBytes, cwd: P.cwd },
    required: ["from", "to"],
    build: (p) => {
      const from = str(p, "from");
      const to = str(p, "to");
      if (from === undefined || to === undefined) return "from and to are required";
      // `--flag=value` keeps a name that starts with '-' from parsing as a flag.
      return ["path", `--from=${from}`, `--to=${to}`, ...commonFlags(p, { paging: true })];
    },
  },
  {
    name: "gbrief",
    label: "greppy: brief",
    description: "What a symbol does in one sentence, its signature, then its body sketched one line per step with the symbol used there. Cheaper than reading the source when you need to understand a function.",
    promptSnippet: "One-sentence summary + step sketch of a symbol",
    essential: false,
    properties: { symbol: P.symbol, code: P.code, path: P.path, maxBytes: P.maxBytes, cwd: P.cwd },
    required: ["symbol"],
    build: (p) => {
      const symbol = str(p, "symbol");
      if (symbol === undefined) return "symbol is required";
      return ["brief", ...commonFlags(p, { code: true }), "--", symbol];
    },
  },
  {
    name: "gread",
    label: "greppy: read symbol",
    description: "Source of one or more symbols by name (not file paths — use read for files). smart:true folds nested blocks below depth into one-line descriptions; head/tail keep only the first/last lines of each definition.",
    promptSnippet: "Source of symbols by name",
    essential: false,
    properties: {
      symbols: P.symbols,
      smart: { type: "boolean", description: "Fold nested blocks into one-line semantic descriptions" },
      depth: { type: "number", description: "With smart: nesting depth kept verbatim (default 1)" },
      head: { type: "number", description: "Only the first N lines of each definition" },
      tail: { type: "number", description: "Only the last N lines of each definition" },
      maxBytes: P.maxBytes,
      cwd: P.cwd,
    },
    required: ["symbols"],
    build: (p) => {
      const symbols = list(p, "symbols");
      if (symbols.length === 0) return "symbols is required";
      const args = [p["smart"] === true ? "read-smart" : "read"];
      const depth = int(p, "depth");
      const head = int(p, "head");
      const tail = int(p, "tail");
      if (p["smart"] === true && depth !== undefined) args.push("--depth", String(depth));
      if (head !== undefined) args.push("--head", String(head));
      if (tail !== undefined) args.push("--tail", String(tail));
      return [...args, ...commonFlags(p, {}), "--", ...symbols];
    },
  },
  {
    name: "gsearch",
    label: "greppy: semantic search",
    description: "Concept-to-code search: the definitions that do what you describe ('restrict a value to a range', 'retry a failed request'), ranked by greppy's local embedding index — no model calls, no cost. Run it once and pick from the ranked definitions; do not rephrase and search again.",
    promptSnippet: "Definitions that do what you describe (local semantic index)",
    essential: true,
    properties: { query: { type: "string", description: "What the code does, in plain language" }, kind: P.kind, code: P.code, path: P.path, limit: P.limit, offset: P.offset, all: P.all, maxBytes: P.maxBytes, cwd: P.cwd },
    required: ["query"],
    build: (p) => {
      const query = str(p, "query");
      if (query === undefined) return "query is required";
      const kind = str(p, "kind");
      return ["search", ...(kind !== undefined ? ["--kind", kind] : []), ...commonFlags(p, { paging: true, code: true }), "--", query];
    },
    notReadyHint: "Use ffjfind (or gsymbol for a known name) until the semantic index is ready.",
  },
  {
    name: "gpattern",
    label: "greppy: pattern",
    description: "Every place a regex (or literal text with fixed:true) matches — comments, strings and config included — together with the definition each match sits in. Use for literal text/config questions when you also want the enclosing symbol.",
    promptSnippet: "Regex/literal matches with their enclosing definition",
    essential: false,
    properties: {
      pattern: { type: "string", description: "Regular expression, or literal text with fixed:true" },
      fixed: { type: "boolean", description: "Treat pattern as literal text" },
      kind: P.kind,
      code: P.code,
      path: P.path,
      limit: P.limit,
      offset: P.offset,
      all: P.all,
      maxBytes: P.maxBytes,
      cwd: P.cwd,
    },
    required: ["pattern"],
    build: (p) => {
      const pattern = typeof p["pattern"] === "string" && p["pattern"].length > 0 ? p["pattern"] : undefined;
      if (pattern === undefined) return "pattern is required";
      const kind = str(p, "kind");
      return [
        "search-pattern",
        ...(p["fixed"] === true ? ["--fixed"] : []),
        ...(kind !== undefined ? ["--kind", kind] : []),
        ...commonFlags(p, { paging: true, code: true }),
        "--",
        pattern,
      ];
    },
  },
];

function clip(text: string): string {
  return text.length <= MAX_RESULT_CHARS ? text : `${text.slice(0, MAX_RESULT_CHARS)}\n… [truncated at ${MAX_RESULT_CHARS} chars; narrow with path/limit or page with offset]`;
}

/** Turn a finished greppy run into the text the model sees. */
export function formatResult(spec: Pick<ToolSpec, "name" | "notReadyHint">, result: RunResult, timeoutMs: number): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (result.error !== undefined) return `${spec.name} failed: could not run greppy (${result.error})`;
  if (result.aborted) return `${spec.name} cancelled`;
  if (result.timedOut) {
    return `${spec.name} timed out after ${Math.round(timeoutMs / 1000)}s; the index may still be building — check /greppy-status.`;
  }
  if (result.code === 0) return clip(stderr.length > 0 && stdout.length > 0 ? `${stdout}\n\n${stderr}` : stdout || stderr || "(no output)");
  if (result.code === 1) return clip(stdout || stderr || "no match");
  if (result.code === EXIT_INDEX_NOT_READY) {
    const lines = [
      stderr || stdout || "index not ready",
      "The greppy index for this repository is missing, building, or stale. Run /greppy-index (or `greppy index` in the repo root), check /greppy-status, then retry.",
    ];
    if (spec.notReadyHint !== undefined) lines.push(spec.notReadyHint);
    return clip(lines.join("\n"));
  }
  return clip(`${spec.name} failed (greppy exit ${result.code ?? "signal"}): ${stderr || stdout || "no output"}`);
}

export interface ToolHost {
  registerTool?: (tool: Record<string, unknown>) => void;
}

export interface ToolDeps {
  resolveBinary?: () => string | undefined;
  run?: typeof runGreppy;
  timeoutMs?: number;
}

function resolveCwd(params: Params, ctx: unknown): { cwd: string } | { error: string } {
  const requested = str(params, "cwd");
  const ctxCwd = (ctx as { cwd?: unknown } | undefined)?.cwd;
  const cwd = path.resolve(requested ?? (typeof ctxCwd === "string" ? ctxCwd : process.cwd()));
  try {
    if (fs.statSync(cwd).isDirectory()) return { cwd };
  } catch {
    // fall through to the error below
  }
  return { error: `cwd is not a directory: ${cwd}` };
}

export function registerGreppyTools(pi: ToolHost, deps: ToolDeps = {}): void {
  if (typeof pi.registerTool !== "function") return;
  const resolveBinary = deps.resolveBinary ?? resolveGreppyBinary;
  const run = deps.run ?? runGreppy;
  const envTimeout = Number(process.env["GREPPY_OMP_TIMEOUT_MS"]);
  const timeoutMs = deps.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);
  for (const spec of TOOL_SPECS) {
    pi.registerTool({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      promptSnippet: spec.promptSnippet,
      approval: "read",
      ...(spec.essential ? { loadMode: "essential" } : {}),
      parameters: { type: "object", properties: spec.properties, required: spec.required, additionalProperties: false },
      execute: async (_toolCallId: string, params: unknown, signal?: AbortSignal, _onUpdate?: unknown, ctx?: unknown) => {
        const text = (t: string) => ({ content: [{ type: "text", text: t }] });
        const p = (params ?? {}) as Params;
        const args = spec.build(p);
        if (typeof args === "string") return text(`${spec.name} failed: ${args}`);
        const where = resolveCwd(p, ctx);
        if ("error" in where) return text(`${spec.name} failed: ${where.error}`);
        const cwd = where.cwd;
        const bin = resolveBinary();
        if (bin === undefined) {
          return text(`${spec.name} failed: greppy binary not found (set GREPPY_BIN, or put greppy on PATH / ~/.local/bin).`);
        }
        const result = await run(bin, args, { cwd, env: childEnv(), timeoutMs, ...(signal !== undefined ? { signal } : {}) });
        return text(formatResult(spec, result, timeoutMs));
      },
    });
  }
}
