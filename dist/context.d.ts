/**
 * Per-prompt `<greppy-tools>` note, appended to the last user message on the
 * host `context` event (same seam and shape as omp-find's `<find-tools>`).
 *
 * The note is emitted only where the g* tools can work: a greppy binary exists
 * and the session cwd is inside a git repository. Whether that repository has
 * a store is cached per root and refreshed in the background, so the context
 * hook never waits on a process.
 */
export interface ContextMessage {
    role: string;
    content: string | Array<{
        type: string;
        text?: string;
    }>;
}
export declare const NOTE_TAG = "<greppy-tools>";
/** `indexed` undefined means "not checked yet": assume the common case. */
export declare function buildGreppyNote(indexed: boolean | undefined): string;
/**
 * Fold `note` into the last user message (string content is suffixed, array
 * content gets a text part) or append a user message when none exists. A
 * message already carrying this exact note is left alone; merely mentioning
 * the tag does not count. Mutates and returns `messages`.
 */
export declare function appendNoteToMessages(messages: ContextMessage[], note: string): ContextMessage[];
/** Per-root store existence, refreshed off the hot path. */
export declare class RepoIndexCache {
    #private;
    constructor(fetch?: (bin: string, root: string) => Promise<boolean | undefined>);
    /** Cached answer now; starts a background refresh when missing or stale. */
    get(bin: string, root: string, now?: number): boolean | undefined;
    /** Marks a root indexed (e.g. after /greppy-index finishes) without a status call. */
    set(root: string, indexed: boolean): void;
    refresh(bin: string, root: string): Promise<void>;
}
/** The note for `cwd`, or undefined when greppy cannot serve it. */
export declare function noteForCwd(cwd: string, cache: RepoIndexCache, resolveBinary?: () => string | undefined): string | undefined;
