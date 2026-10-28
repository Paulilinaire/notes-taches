import { iso } from './dates.js';

const FREQUENCIES = { WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };

const pad = n => String(n).padStart(2, '0');

const unfold = text => text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');

const unescapeText = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseLine(line) {
    const colon = line.indexOf(':');
    if (colon < 0) {
        return null;
    }
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    return { name, value: line.slice(colon + 1) };
}

function parseStart(value) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?/);
    if (!m) {
        return null;
    }
    const [, y, mo, d, h, mi, utc] = m;
    if (h === undefined) {
        return { date: `${y}-${mo}-${d}`, time: '' };
    }
    if (utc) {
        const local = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
        return { date: iso(local), time: `${pad(local.getHours())}:${pad(local.getMinutes())}` };
    }
    return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

function parseRepeat(rrule) {
    if (!rrule) {
        return 'none';
    }
    const parts = Object.fromEntries(rrule.toUpperCase().split(';').map(p => p.split('=')));
    const interval = parts.INTERVAL && parts.INTERVAL !== '1';
    const complexDays = parts.BYDAY && (parts.FREQ !== 'WEEKLY' || parts.BYDAY.includes(','));
    if (parts.UNTIL || parts.COUNT || interval || complexDays || parts.BYMONTHDAY || parts.BYSETPOS) {
        return null;
    }
    return FREQUENCIES[parts.FREQ] ?? null;
}

/**
 * @return {{uid: string, title: string, date: string, time: string, repeat: string, simplified: boolean}[]}
 */
export function parseIcs(text) {
    const events = [];
    let current = null;
    let depth = 0;
    for (const raw of unfold(text)) {
        const line = raw.trim();
        const upper = line.toUpperCase();
        if (upper === 'BEGIN:VEVENT') {
            current = {};
            depth = 0;
        } else if (upper === 'END:VEVENT') {
            if (current) {
                events.push(current);
            }
            current = null;
        } else if (current && upper.startsWith('BEGIN:')) {
            depth++;
        } else if (current && upper.startsWith('END:')) {
            depth--;
        } else if (current && depth === 0) {
            const prop = parseLine(line);
            if (prop && !(prop.name in current)) {
                current[prop.name] = prop.value;
            }
        }
    }

    const byUid = new Map();
    events.forEach(e => {
        if (!e.DTSTART || e['RECURRENCE-ID'] || e.STATUS?.toUpperCase() === 'CANCELLED') {
            return;
        }
        const start = parseStart(e.DTSTART);
        if (!start) {
            return;
        }
        const repeat = parseRepeat(e.RRULE);
        const title = unescapeText(e.SUMMARY || '').trim().slice(0, 80) || 'Sans titre';
        const uid = e.UID || `${title}|${start.date}|${start.time}`;
        byUid.set(uid, { uid, title, date: start.date, time: start.time, repeat: repeat ?? 'none', simplified: repeat === null });
    });
    return [...byUid.values()];
}
