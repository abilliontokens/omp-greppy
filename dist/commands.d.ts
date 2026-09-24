/**
 * `/greppy-status` (binary, CUDA, index state) and `/greppy-index` (build or
 * refresh the index in the background, notifying on completion).
 */
import type { RepoIndexCache } from "./context.js";
interface CommandCtx {
    cwd?: string;
    ui?: {
        notify?: (text: string, kind?: string) => void;
    };
}
export interface CommandHost {
    registerCommand?: (name: string, def: {
        description: string;
        handler: (args: unknown, ctx: CommandCtx) => Promise<void>;
    }) => void;
}
export declare function registerGreppyCommands(pi: CommandHost, cache: RepoIndexCache): void;
export {};
