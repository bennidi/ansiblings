/**
 * Session history management
 * @module nopy.history
 */
import fs from 'node:fs';
import path from 'node:path';
/** Default number of sessions to keep in history */
export const DEFAULT_HISTORY_SIZE = 10;
/** History file name */
export const HISTORY_FILE = '.nopy.history.json';
/**
 * Gets the path to the history file
 */
export function getHistoryPath() {
    return path.resolve(process.cwd(), HISTORY_FILE);
}
/**
 * Loads the session history from disk
 *
 * @returns The session history or empty history if file doesn't exist
 */
export function loadHistory() {
    const historyPath = getHistoryPath();
    if (!fs.existsSync(historyPath)) {
        return { entries: [] };
    }
    try {
        const content = fs.readFileSync(historyPath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return { entries: [] };
    }
}
/**
 * Saves the session history to disk
 *
 * @param history - The history to save
 */
export function saveHistory(history) {
    const historyPath = getHistoryPath();
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
}
/**
 * Generates a history entry name from session data
 *
 * Format: "YYYY-MM-DD HH:mm - cube1, cube2, ..."
 *
 * @param session - The session to name
 * @param timestamp - ISO timestamp
 * @returns Human-readable name
 */
function generateEntryName(session, timestamp) {
    const date = new Date(timestamp);
    const dateStr = date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const cubeNames = session.cubes.map((c) => c.key).join(', ');
    const truncatedCubes = cubeNames.length > 40 ? `${cubeNames.substring(0, 37)}...` : cubeNames;
    const hosts = session.hosts?.join(', ') || 'no host';
    const truncatedHosts = hosts.length > 20 ? `${hosts.substring(0, 17)}...` : hosts;
    return `${dateStr} - ${truncatedCubes} → ${truncatedHosts}`;
}
/**
 * Generates a unique ID for a history entry
 */
function generateEntryId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}
/**
 * Adds a session to the history
 *
 * @param session - The session to add
 * @param maxEntries - Maximum number of entries to keep
 * @returns The created history entry
 */
export function addToHistory(session, maxEntries = DEFAULT_HISTORY_SIZE) {
    const history = loadHistory();
    const timestamp = new Date().toISOString();
    const entry = {
        id: generateEntryId(),
        name: generateEntryName(session, timestamp),
        timestamp,
        session,
    };
    // Add to beginning (newest first)
    history.entries.unshift(entry);
    // Trim to max size
    if (history.entries.length > maxEntries) {
        history.entries = history.entries.slice(0, maxEntries);
    }
    saveHistory(history);
    return entry;
}
/**
 * Gets the most recent session from history
 *
 * @returns The last session or undefined if history is empty
 */
export function getLastSession() {
    const history = loadHistory();
    return history.entries[0];
}
/**
 * Gets a session by ID
 *
 * @param id - The session ID
 * @returns The session entry or undefined
 */
export function getSessionById(id) {
    const history = loadHistory();
    return history.entries.find((e) => e.id === id);
}
/**
 * Lists all sessions in history
 *
 * @returns Array of history entries, newest first
 */
export function listHistory() {
    const history = loadHistory();
    return history.entries;
}
/**
 * Clears all session history
 */
export function clearHistory() {
    saveHistory({ entries: [] });
}
/**
 * Removes a specific session from history
 *
 * @param id - The session ID to remove
 * @returns true if removed, false if not found
 */
export function removeFromHistory(id) {
    const history = loadHistory();
    const initialLength = history.entries.length;
    history.entries = history.entries.filter((e) => e.id !== id);
    if (history.entries.length < initialLength) {
        saveHistory(history);
        return true;
    }
    return false;
}
/**
 * Formats history entries for display
 *
 * @param entries - History entries to format
 * @returns Formatted string for console output
 */
export function formatHistoryList(entries) {
    if (entries.length === 0) {
        return 'No sessions in history.';
    }
    const lines = ['', 'Session History:', ''];
    entries.forEach((entry, index) => {
        const marker = index === 0 ? '→' : ' ';
        lines.push(`  ${marker} [${index + 1}] ${entry.name}`);
        lines.push(`       ID: ${entry.id}`);
    });
    lines.push('');
    lines.push(`Total: ${entries.length} session(s)`);
    lines.push('');
    return lines.join('\n');
}
