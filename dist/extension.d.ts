/**
 * omp-greppy OMP/pi extension entry.
 *
 * Registers the g* graph tools and the /greppy-* commands, and appends the
 * `<greppy-tools>` note to every prompt in a greppy-capable repository. Every
 * host interaction is best-effort: an unknown host must never fail load.
 */
interface GreppyExtensionHost {
    registerCommand?: unknown;
    registerTool?: unknown;
    on?: (event: string, listener: (...args: never[]) => unknown) => void;
}
export default function ompGreppyExtension(pi: GreppyExtensionHost): void;
export {};
