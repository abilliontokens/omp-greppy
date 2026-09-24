/**
 * omp-greppy OMP/pi extension entry.
 *
 * Registers the g* graph tools and the /greppy-* commands, and appends the
 * `<greppy-tools>` note to every prompt in a greppy-capable repository. Every
 * host interaction is best-effort: an unknown host must never fail load.
 */
import { registerGreppyCommands } from "./commands.js";
import { appendNoteToMessages, noteForCwd, RepoIndexCache } from "./context.js";
import { findRepoRoot, resolveGreppyBinary } from "./greppy.js";
import { registerGreppyTools } from "./tools.js";
export default function ompGreppyExtension(pi) {
    const cache = new RepoIndexCache();
    try {
        registerGreppyTools(pi);
    }
    catch {
        // Hosts that reject tool registration keep the commands and note.
    }
    try {
        registerGreppyCommands(pi, cache);
    }
    catch {
        // Hosts without command support skip /greppy-*.
    }
    try {
        // Warm the per-repo index check so the first prompt's note is accurate.
        pi.on?.("session_start", () => {
            const bin = resolveGreppyBinary();
            const root = findRepoRoot(process.cwd());
            if (bin !== undefined && root !== undefined)
                void cache.refresh(bin, root);
        });
    }
    catch {
        // Hosts without an event emitter skip the warm check.
    }
    try {
        pi.on?.("context", (event) => {
            try {
                const payload = event;
                if (payload === undefined || !Array.isArray(payload.messages))
                    return undefined;
                const note = noteForCwd(process.cwd(), cache);
                if (note === undefined)
                    return undefined;
                return { messages: appendNoteToMessages(payload.messages, note) };
            }
            catch {
                return undefined;
            }
        });
    }
    catch {
        // Hosts without context support skip the per-prompt note.
    }
}
