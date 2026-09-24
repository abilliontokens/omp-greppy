/**
 * The g* tools: one per question greppy's graph answers, each a thin typed
 * wrapper over one greppy subcommand. greppy already returns compact,
 * located, hinted rows; the wrapper only builds argv, bounds output, and turns
 * exit codes into guidance the model can act on.
 */
import { runGreppy, type RunResult } from "./greppy.js";
type Params = Record<string, unknown>;
/** greppy's own stdout budget per call; keeps one result well inside a turn. */
export declare const DEFAULT_MAX_BYTES = 16000;
/** Exit code greppy uses when the index is missing, building, or stale. */
export declare const EXIT_INDEX_NOT_READY = 75;
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
export declare const TOOL_SPECS: readonly ToolSpec[];
/** Turn a finished greppy run into the text the model sees. */
export declare function formatResult(spec: Pick<ToolSpec, "name" | "notReadyHint">, result: RunResult, timeoutMs: number): string;
export interface ToolHost {
    registerTool?: (tool: Record<string, unknown>) => void;
}
export interface ToolDeps {
    resolveBinary?: () => string | undefined;
    run?: typeof runGreppy;
    timeoutMs?: number;
}
export declare function registerGreppyTools(pi: ToolHost, deps?: ToolDeps): void;
export {};
