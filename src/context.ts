/**
 * Per-prompt `<greppy-tools>` note, appended to the last user message on the
 * host `context` event (same seam and shape as omp-find's `<find-tools>`).
 *
 * The note is emitted only where the g* tools can work: a greppy binary exists
 * and the session cwd is inside a git repository. Whether that repository has
 * a store is cached per root and refreshed in the background, so the context
 * hook never waits on a process.
 */

import { findRepoRoot, resolveGreppyBinary } from "./greppy.js";
import { fetchIndexStatus } from "./status.js";

export interface ContextMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

export const NOTE_TAG = "<greppy-tools>";

/** `indexed` undefined means "not checked yet": assume the common case. */
export function buildGreppyNote(indexed: boolean | undefined): string {
  const lead = indexed === false
    ? "greppy is installed but this repository has no index yet: the first g* call builds the graph (minutes on large repos) — the user can run /greppy-index to build it in the background. Until it exists, use the ff tools."
    : "This repository has a greppy code graph. For code-structure questions use the g* tools — exact graph answers, one call each — before grep/read loops:";
  return [
    NOTE_TAG,
    lead,
    "gsymbol NAME = definition · gcallers S = who calls/uses · gimpact S = transitive blast radius · gchain A→B = call chains · gbrief S = what it does · gcallees S = what it uses · gread S = symbol source · gpattern = regex/literal with its enclosing definition.",
    "For concept-to-code discovery prefer gsearch (local embedding index, no model cost) over ffjfind; fall back to ffjfind only when gsearch reports the index is not ready.",
    "Answer from the compact result. Pass symbols straight to gcallers/gimpact/gchain/gbrief (never gsymbol first); add code:true only when a body is needed; never re-run a successful call to confirm it.",
    "</greppy-tools>",
  ].join("\n");
}

/**
 * Fold `note` into the last user message (string content is suffixed, array
 * content gets a text part) or append a user message when none exists. A
 * message already carrying this exact note is left alone; merely mentioning
 * the tag does not count. Mutates and returns `messages`.
 */
export function appendNoteToMessages(messages: ContextMessage[], note: string): ContextMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user") continue;
    if (typeof message.content === "string") {
      if (!message.content.includes(note)) message.content = `${message.content}\n\n${note}`;
      return messages;
    }
    if (Array.isArray(message.content)) {
      if (!message.content.some((part) => part.text === note)) message.content.push({ type: "text", text: note });
      return messages;
    }
  }
  messages.push({ role: "user", content: note });
  return messages;
}

const STATUS_TTL_MS = 5 * 60_000;

interface RepoEntry {
  indexed: boolean | undefined;
  checkedAt: number;
  pending: boolean;
}

/** Per-root store existence, refreshed off the hot path. */
export class RepoIndexCache {
  readonly #entries = new Map<string, RepoEntry>();
  readonly #fetch: (bin: string, root: string) => Promise<boolean | undefined>;

  constructor(fetch?: (bin: string, root: string) => Promise<boolean | undefined>) {
    this.#fetch = fetch ?? (async (bin, root) => {
      const status = await fetchIndexStatus(bin, root);
      return typeof status === "string" ? undefined : status.store_exists === true;
    });
  }

  /** Cached answer now; starts a background refresh when missing or stale. */
  get(bin: string, root: string, now = Date.now()): boolean | undefined {
    const entry = this.#entries.get(root);
    if (entry === undefined || (!entry.pending && now - entry.checkedAt > STATUS_TTL_MS)) void this.refresh(bin, root);
    return entry?.indexed;
  }

  /** Marks a root indexed (e.g. after /greppy-index finishes) without a status call. */
  set(root: string, indexed: boolean): void {
    this.#entries.set(root, { indexed, checkedAt: Date.now(), pending: false });
  }

  async refresh(bin: string, root: string): Promise<void> {
    const previous = this.#entries.get(root);
    if (previous?.pending === true) return;
    this.#entries.set(root, { indexed: previous?.indexed, checkedAt: previous?.checkedAt ?? 0, pending: true });
    let indexed: boolean | undefined;
    try {
      indexed = await this.#fetch(bin, root);
    } catch {
      indexed = undefined;
    }
    this.#entries.set(root, { indexed: indexed ?? previous?.indexed, checkedAt: Date.now(), pending: false });
  }
}

/** The note for `cwd`, or undefined when greppy cannot serve it. */
export function noteForCwd(cwd: string, cache: RepoIndexCache, resolveBinary: () => string | undefined = resolveGreppyBinary): string | undefined {
  const bin = resolveBinary();
  if (bin === undefined) return undefined;
  const root = findRepoRoot(cwd);
  if (root === undefined) return undefined;
  return buildGreppyNote(cache.get(bin, root));
}
