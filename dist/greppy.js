/**
 * Locating and running the greppy binary.
 *
 * Every tool shells out to the same binary with the session cwd; greppy finds
 * the repository root and its store by itself, so no `--root` is passed (that
 * would key the store on a subdirectory when the agent works below the root).
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
function isFile(p) {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
}
function isDir(p) {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
/** The environment key holding the search path (`Path` on most Windows hosts). */
function pathKey(env) {
    return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
}
/**
 * `GREPPY_BIN`, then `PATH`, then the two install locations the greppy README
 * uses. The fallbacks matter for an omp process started before the user added
 * `~/.local/bin` to `PATH`: it keeps the stale environment for its lifetime.
 */
export function resolveGreppyBinary(env = process.env, platform = process.platform) {
    const exe = platform === "win32" ? "greppy.exe" : "greppy";
    const explicit = env["GREPPY_BIN"];
    if (explicit !== undefined && explicit.length > 0)
        return isFile(explicit) ? explicit : undefined;
    const separator = platform === "win32" ? ";" : ":";
    for (const dir of (env[pathKey(env)] ?? "").split(separator)) {
        if (dir.length === 0)
            continue;
        const candidate = path.join(dir, exe);
        if (isFile(candidate))
            return candidate;
    }
    for (const dir of [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), ".cargo", "bin")]) {
        const candidate = path.join(dir, exe);
        if (isFile(candidate))
            return candidate;
    }
    return undefined;
}
const CUDA_ROOT = "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA";
function compareVersionsDesc(a, b) {
    const [ka, kb] = [a, b].map((name) => name.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0));
    for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
        const diff = (kb[i] ?? 0) - (ka[i] ?? 0);
        if (diff !== 0)
            return diff;
    }
    return 0;
}
/**
 * The CUDA toolkit `bin` directory on Windows. greppy's CUDA backend loads
 * `cublas64_*.dll` at runtime and silently falls back to CPU (~25x slower)
 * when the DLL is not on `PATH`; a shell or omp process started before the
 * toolkit install never sees the installer's `PATH` change.
 */
export function resolveCudaBin(env = process.env, platform = process.platform, root = CUDA_ROOT) {
    if (platform !== "win32")
        return undefined;
    const fromEnv = env["CUDA_PATH"];
    if (fromEnv !== undefined && fromEnv.length > 0 && isDir(path.join(fromEnv, "bin")))
        return path.join(fromEnv, "bin");
    let versions;
    try {
        versions = fs.readdirSync(root).filter((name) => /^v\d/i.test(name));
    }
    catch {
        return undefined;
    }
    for (const version of versions.sort(compareVersionsDesc)) {
        const bin = path.join(root, version, "bin");
        if (isDir(bin))
            return bin;
    }
    return undefined;
}
/** Child environment: the parent's, with the CUDA `bin` prepended when missing (`null`: none). */
export function childEnv(env = process.env, cudaBin = resolveCudaBin(env) ?? null) {
    const out = { ...env };
    if (cudaBin === null)
        return out;
    const key = pathKey(out);
    const current = out[key] ?? "";
    const entries = current.split(";").map((entry) => entry.toLowerCase().replace(/[\\/]+$/, ""));
    if (!entries.includes(cudaBin.toLowerCase().replace(/[\\/]+$/, ""))) {
        out[key] = current.length > 0 ? `${cudaBin};${current}` : cudaBin;
    }
    return out;
}
export function runGreppy(bin, args, options) {
    const cap = options.maxBytes ?? 2 * 1024 * 1024;
    const { promise, resolve } = Promise.withResolvers();
    if (options.signal?.aborted === true) {
        resolve({ code: null, stdout: "", stderr: "", timedOut: false, aborted: true });
        return promise;
    }
    let child;
    try {
        child = spawn(bin, args, {
            cwd: options.cwd,
            env: options.env ?? childEnv(),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
    }
    catch (err) {
        resolve({ code: null, stdout: "", stderr: "", timedOut: false, aborted: false, error: err instanceof Error ? err.message : String(err) });
        return promise;
    }
    const out = [];
    const errOut = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    child.stdout.on("data", (chunk) => {
        if (outBytes < cap)
            out.push(chunk.subarray(0, cap - outBytes));
        outBytes += chunk.length;
    });
    child.stderr.on("data", (chunk) => {
        if (errBytes < cap)
            errOut.push(chunk.subarray(0, cap - errBytes));
        errBytes += chunk.length;
    });
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
        timedOut = true;
        child.kill();
    }, options.timeoutMs);
    const onAbort = () => {
        aborted = true;
        child.kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (result) => {
        if (settled)
            return;
        settled = true;
        if (timer !== undefined)
            clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        resolve(result);
    };
    child.on("error", (err) => {
        finish({ code: null, stdout: "", stderr: "", timedOut, aborted, error: err.message });
    });
    child.on("close", (code) => {
        finish({
            code,
            stdout: Buffer.concat(out).toString("utf8"),
            stderr: Buffer.concat(errOut).toString("utf8"),
            timedOut,
            aborted,
        });
    });
    return promise;
}
/** Nearest ancestor of `start` (inclusive) holding a `.git` directory or file. */
export function findRepoRoot(start) {
    let dir = path.resolve(start);
    for (;;) {
        if (fs.existsSync(path.join(dir, ".git")))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
}
