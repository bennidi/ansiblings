/**
 * Session history management
 * @module nopy.history
 */
import type { NopySession } from './nopy.session.js';
/** Default number of sessions to keep in history */
export declare const DEFAULT_HISTORY_SIZE = 10;
/** History file name */
export declare const HISTORY_FILE = ".nopy.history.json";
/**
 * A session entry in history
 */
export interface HistoryEntry {
    /** Unique identifier (timestamp-based) */
    id: string;
    /** Human-readable name (timestamp + cube names) */
    name: string;
    /** ISO timestamp when session was executed */
    timestamp: string;
    /** The full session data */
    session: NopySession;
}
/**
 * History file structure
 */
export interface SessionHistory {
    /** Array of session entries, newest first */
    entries: HistoryEntry[];
}
/**
 * Gets the path to the history file
 */
export declare function getHistoryPath(): string;
/**
 * Loads the session history from disk
 *
 * @returns The session history or empty history if file doesn't exist
 */
export declare function loadHistory(): SessionHistory;
/**
 * Saves the session history to disk
 *
 * @param history - The history to save
 */
export declare function saveHistory(history: SessionHistory): void;
/**
 * Adds a session to the history
 *
 * @param session - The session to add
 * @param maxEntries - Maximum number of entries to keep
 * @returns The created history entry
 */
export declare function addToHistory(session: NopySession, maxEntries?: number): HistoryEntry;
/**
 * Gets the most recent session from history
 *
 * @returns The last session or undefined if history is empty
 */
export declare function getLastSession(): HistoryEntry | undefined;
/**
 * Gets a session by ID
 *
 * @param id - The session ID
 * @returns The session entry or undefined
 */
export declare function getSessionById(id: string): HistoryEntry | undefined;
/**
 * Lists all sessions in history
 *
 * @returns Array of history entries, newest first
 */
export declare function listHistory(): HistoryEntry[];
/**
 * Clears all session history
 */
export declare function clearHistory(): void;
/**
 * Removes a specific session from history
 *
 * @param id - The session ID to remove
 * @returns true if removed, false if not found
 */
export declare function removeFromHistory(id: string): boolean;
/**
 * Formats history entries for display
 *
 * @param entries - History entries to format
 * @returns Formatted string for console output
 */
export declare function formatHistoryList(entries: HistoryEntry[]): string;
