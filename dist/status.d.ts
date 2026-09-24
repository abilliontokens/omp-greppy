/**
 * `greppy index status --json`, parsed and summarised. Shared by the
 * per-prompt note (does this repo have a store at all?) and /greppy-status.
 */
export interface IndexStatus {
    status?: string;
    fresh?: boolean;
    healthy?: boolean;
    store_exists?: boolean;
    message?: string;
    root_path?: string;
    stats?: {
        files?: number;
        nodes?: number;
        edges?: number;
    };
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
export declare function fetchIndexStatus(bin: string, cwd: string, timeoutMs?: number): Promise<IndexStatus | string>;
export declare function summarizeStatus(status: IndexStatus): string;
