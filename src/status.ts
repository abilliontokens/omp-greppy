/**
 * `greppy index status --json`, parsed and summarised. Shared by the
 * per-prompt note (does this repo have a store at all?) and /greppy-status.
 */

import { childEnv, runGreppy } from "./greppy.js";

export interface IndexStatus {
  status?: string;
  fresh?: boolean;
  healthy?: boolean;
  store_exists?: boolean;
  message?: string;
  root_path?: string;
  stats?: { files?: number; nodes?: number; edges?: number };
  background_job?: {
    kind?: string;
    state?: string;
    completed_spans?: number;
    total_spans?: number;
    backend?: string | null;
    device?: string | null;
  } | null;
}

/** Status JSON, or an error string. greppy exits 75 while indexing but still prints the JSON. */
export async function fetchIndexStatus(bin: string, cwd: string, timeoutMs = 15_000): Promise<IndexStatus | string> {
  const result = await runGreppy(bin, ["index", "status", "--json"], { cwd, env: childEnv(), timeoutMs });
  if (result.error !== undefined) return `could not run greppy (${result.error})`;
  if (result.timedOut) return "greppy index status timed out";
  try {
    return JSON.parse(result.stdout) as IndexStatus;
  } catch {
    return (result.stderr || result.stdout).trim() || `greppy index status exited ${result.code}`;
  }
}

export function summarizeStatus(status: IndexStatus): string {
  const lines = [`index: ${status.status ?? "unknown"} (fresh=${status.fresh ?? "?"}, store=${status.store_exists === true ? "present" : "missing"})`];
  if (status.root_path !== undefined) lines.push(`root: ${status.root_path.replace(/^\\\\\?\\/, "")}`);
  if (status.stats !== undefined) lines.push(`graph: ${status.stats.files ?? "?"} files, ${status.stats.nodes ?? "?"} nodes, ${status.stats.edges ?? "?"} edges`);
  const job = status.background_job;
  if (job != null) {
    const progress = job.total_spans !== undefined ? ` ${job.completed_spans ?? 0}/${job.total_spans}` : "";
    lines.push(`job: ${job.kind ?? "index"} ${job.state ?? "running"}${progress}${job.backend != null ? ` (backend ${job.backend})` : ""}`);
  }
  if (status.message !== undefined && status.fresh !== true) lines.push(status.message);
  return lines.join("\n");
}
