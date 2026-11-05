import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** The circle's passcode, kept only as a salted scrypt hash. */
export type Lock = { salt: string; hash: string };

const COST = { N: 16_384, r: 8, p: 1 };
const LENGTH = 32;

const derive = (code: string, salt: Buffer) =>
	new Promise<Buffer>((resolve, reject) => scrypt(code.normalize("NFC"), salt, LENGTH, COST, (e, key) => (e ? reject(e) : resolve(key))));

export async function lock(code: string): Promise<Lock> {
	const salt = randomBytes(16);
	return { salt: salt.toString("hex"), hash: (await derive(code, salt)).toString("hex") };
}

export async function opens(l: Lock, code: string): Promise<boolean> {
	return timingSafeEqual(await derive(code, Buffer.from(l.salt, "hex")), Buffer.from(l.hash, "hex"));
}

export const PASSCODE = { min: 6, max: 64 };

/** Counts wrong passcodes per address. After `max` of them within `windowMs`, that address waits out the window. */
export function limiter({ max = 5, windowMs = 15 * 60_000, now = Date.now } = {}) {
	const fails = new Map<string, number[]>();
	const recent = (addr: string) => (fails.get(addr) ?? []).filter((t) => now() - t < windowMs);
	return {
		/** Milliseconds this address must still wait, or 0. */
		wait(addr: string) {
			const r = recent(addr);
			return r.length < max ? 0 : r[0] + windowMs - now();
		},
		fail(addr: string) {
			fails.set(addr, [...recent(addr), now()]);
		},
		clear(addr: string) {
			fails.delete(addr);
		},
	};
}
