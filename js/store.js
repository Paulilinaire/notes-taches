const KEY = 'nt-state';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const defaults = () => ({
    version: 1,
    settings: { name: '', theme: 'bonbon', cycleHint: true },
    reminders: [],
    lists: [{ id: uid(), name: 'Courses', items: [] }],
    activeList: null,
    vault: null,
    cycleHint: null,
});

function normalize(raw) {
    const base = defaults();
    const merged = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
    if (!Array.isArray(merged.lists) || !merged.lists.length) {
        merged.lists = base.lists;
    }
    if (!Array.isArray(merged.reminders)) {
        merged.reminders = [];
    }
    return merged;
}

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            return normalize(JSON.parse(raw));
        }
    } catch {
    }
    return defaults();
}

export const state = load();

export function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
        return true;
    } catch {
        return false;
    }
}

export function isValidBackup(data) {
    return data && typeof data === 'object' && data.settings && Array.isArray(data.lists) && Array.isArray(data.reminders);
}

export function replaceState(data) {
    const next = normalize(data);
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, next);
    save();
}
