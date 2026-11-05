import { execFileSync } from "node:child_process";

export type Hub = { name: string; url: string; token: string };
export type Connection = { id: number; uri: string };
export type Member = Hub & { pay: Connection; receive: Connection };
export type Stack = {
	contributionSat: number;
	budgetSat: number;
	relayUrl: string;
	router: Hub;
	members: Member[];
};
type Channel = { active: boolean; localBalanceMsat: number };

const root = new URL("..", import.meta.url).pathname;

export function compose(...args: string[]): string {
	return execFileSync("docker", ["compose", ...args], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

export function loadStack(): Stack {
	let raw: string;
	try {
		raw = compose("run", "--rm", "--no-deps", "-T", "--entrypoint", "cat", "seed", "/state/connections.json");
	} catch {
		throw new Error("this compose project has no seeded stack, run ./scripts/up");
	}
	return parseStack(JSON.parse(raw));
}

function parseStack(v: Stack): Stack {
	const hubOk = (h: Hub) => typeof h?.name === "string" && typeof h.url === "string" && typeof h.token === "string";
	const connOk = (c: Connection) => typeof c?.id === "number" && c.uri.startsWith("nostr+walletconnect://");
	const ok =
		Number.isInteger(v?.contributionSat) &&
		Number.isInteger(v.budgetSat) &&
		typeof v.relayUrl === "string" &&
		hubOk(v.router) &&
		Array.isArray(v.members) &&
		v.members.length >= 2 &&
		v.members.every((m) => hubOk(m) && connOk(m.pay) && connOk(m.receive));
	if (!ok) throw new Error("connections.json in the state volume has an unexpected shape, rerun the seed");
	return v;
}

export async function hubGet<T>(hub: Hub, path: string): Promise<T> {
	const res = await fetch(hub.url + path, { headers: { authorization: `Bearer ${hub.token}` } }).catch(() => {
		throw new Error(`${hub.name} is not reachable at ${hub.url}`);
	});
	if (!res.ok) throw new Error(`${hub.name} GET ${path} returned ${res.status}`);
	return (await res.json()) as T;
}

export const channels = (hub: Hub) => hubGet<Channel[]>(hub, "/api/channels");

export async function balanceMsat(hub: Hub): Promise<number> {
	return (await channels(hub)).reduce((sum, c) => sum + c.localBalanceMsat, 0);
}
