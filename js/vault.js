const ITERATIONS = 310000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let key = null;
let salt = null;

export let data = null;

const toB64 = bytes => {
    let s = '';
    new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
    return btoa(s);
};

const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(pin, saltBytes, iterations) {
    const base = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

export const isOpen = () => key !== null;

export async function seal() {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data)));
    return { v: 1, iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(cipher) };
}

export async function create(pin, initial) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(pin, salt, ITERATIONS);
    data = initial;
    return seal();
}

export async function rekey(pin) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(pin, salt, ITERATIONS);
    return seal();
}

export async function open(blob, pin) {
    const s = fromB64(blob.salt);
    const k = await derive(pin, s, blob.iter || ITERATIONS);
    try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, k, fromB64(blob.data));
        data = JSON.parse(decoder.decode(plain));
        key = k;
        salt = s;
        return true;
    } catch {
        return false;
    }
}

export function lock() {
    key = null;
    salt = null;
    data = null;
}
