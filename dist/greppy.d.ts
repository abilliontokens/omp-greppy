/**
 * Locating and running the greppy binary.
 *
 * Every tool shells out to the same binary with the session cwd; greppy finds
 * the repository root and its store by itself, so no `--root` is passed (that
 * would key the store on a subdirectory when the agent works below the root).
 */
type Env = Record<string, string | undefined>;
/**
 * `GREPPY_BIN`, then `PATH`, then the two install locations the greppy README
 * uses. The fallbacks matter for an omp process started before the user added
 * `~/.local/bin` to `PATH`: it keeps the stale environment for its lifetime.
 */
export declare function resolveGreppyBinary(env?: Env, platform?: NodeJS.Platform): string | undefined;
/**
 * The CUDA toolkit `bin` directory on Windows. greppy's CUDA backend loads
 * `cublas64_*.dll` at runtime and silently falls back to CPU (~25x slower)
 * when the DLL is not on `PATH`; a shell or omp process started before the
 * toolkit install never sees the installer's `PATH` change.
 */
export declare function resolveCudaBin(env?: Env, platform?: NodeJS.Platform, root?: string): string | undefined;
/**
 * Child environment: the parent's, with the CUDA `bin` prepended when missing
 * (`null`: none) and `GREPPY_DEVICE=cuda` unless the caller chose a device, so
 * a CUDA failure surfaces as an error instead of a silent CPU fallback.
 */
export declare function childEnv(env?: Env, cudaBin?: string | null): Env;
export interface RunOptions {
    cwd: string;
    env?: Env;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Bytes kept per stream; greppy's own `--max-bytes` should bound stdout well below this. */
    maxBytes?: number;
}
export interface RunResult {
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    aborted: boolean;
    /** Spawn failure (binary missing, cwd gone), distinct from a non-zero exit. */
    error?: string;
}
export declare function runGreppy(bin: string, args: readonly string[], options: RunOptions): Promise<RunResult>;
/** Nearest ancestor of `start` (inclusive) holding a `.git` directory or file. */
export declare function findRepoRoot(start: string): string | undefined;
export {};
