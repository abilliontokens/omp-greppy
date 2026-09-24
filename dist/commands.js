/**
 * `/greppy-status` (binary, CUDA, index state) and `/greppy-index` (build or
 * refresh the index in the background, notifying on completion).
 */
import { childEnv, findRepoRoot, resolveCudaBin, resolveGreppyBinary, runGreppy } from "./greppy.js";
import { fetchIndexStatus, summarizeStatus } from "./status.js";
function notify(ctx, text, kind) {
    try {
        ctx?.ui?.notify?.(text, kind);
    }
    catch {
        // Notify is best-effort.
    }
}
/** Roots with an index build started by this session. */
const building = new Set();
export function registerGreppyCommands(pi, cache) {
    if (typeof pi.registerCommand !== "function")
        return;
    pi.registerCommand("greppy-status", {
        description: "Show the greppy binary, CUDA runtime and index state for this repository",
        handler: async (_args, ctx) => {
            const bin = resolveGreppyBinary();
            if (bin === undefined) {
                notify(ctx, "greppy: binary not found (set GREPPY_BIN, or put greppy on PATH / ~/.local/bin)", "error");
                return;
            }
            const cwd = ctx?.cwd ?? process.cwd();
            const root = findRepoRoot(cwd);
            const lines = [`greppy: ${bin}`];
            if (process.platform === "win32")
                lines.push(`cuda: ${resolveCudaBin() ?? "not found — inference runs on CPU"}`);
            if (root === undefined) {
                lines.push(`${cwd} is not inside a git repository; the g* tools and note are off here.`);
                notify(ctx, lines.join("\n"), "warn");
                return;
            }
            const status = await fetchIndexStatus(bin, root);
            if (typeof status === "string") {
                lines.push(`index: ${status}`);
                notify(ctx, lines.join("\n"), "warn");
                return;
            }
            cache.set(root, status.store_exists === true);
            lines.push(summarizeStatus(status));
            if (building.has(root))
                lines.push("an index build started by /greppy-index is still running");
            notify(ctx, lines.join("\n"), status.fresh === true ? "info" : "warn");
        },
    });
    pi.registerCommand("greppy-index", {
        description: "Build or refresh the greppy index for this repository in the background",
        handler: async (_args, ctx) => {
            const bin = resolveGreppyBinary();
            if (bin === undefined) {
                notify(ctx, "greppy: binary not found (set GREPPY_BIN, or put greppy on PATH / ~/.local/bin)", "error");
                return;
            }
            const root = findRepoRoot(ctx?.cwd ?? process.cwd());
            if (root === undefined) {
                notify(ctx, "greppy-index: not inside a git repository", "warn");
                return;
            }
            if (building.has(root)) {
                notify(ctx, `greppy-index: already building ${root}; /greppy-status shows progress`, "info");
                return;
            }
            building.add(root);
            notify(ctx, `greppy-index: building ${root} in the background; /greppy-status shows progress`, "info");
            // Not awaited: the graph build takes minutes on large repositories and the
            // command must return. greppy publishes snapshots atomically, so an
            // interrupted build is recovered by the next `greppy index`.
            void runGreppy(bin, ["index"], { cwd: root, env: childEnv() }).then((result) => {
                building.delete(root);
                if (result.code === 0) {
                    cache.set(root, true);
                    const summary = result.stdout.trim().split("\n").slice(-2).join("\n");
                    notify(ctx, `greppy-index: done\n${summary}`, "info");
                }
                else {
                    const reason = result.error ?? (result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`);
                    notify(ctx, `greppy-index: failed\n${reason}`, "error");
                }
            });
        },
    });
}
