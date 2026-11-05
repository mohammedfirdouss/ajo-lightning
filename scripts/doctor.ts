import { channels, type Hub, hubGet, loadStack } from "./stack.ts";

const results: boolean[] = [];
async function check(name: string, probe: () => Promise<string>) {
	try {
		console.log(`ok   ${name.padEnd(8)} ${await probe()}`);
		results.push(true);
	} catch (e) {
		console.log(`FAIL ${name.padEnd(8)} ${(e as Error).message}`);
		results.push(false);
	}
}

async function hub(h: Hub, want: number) {
	const info = await hubGet<{ running: boolean }>(h, "/api/info");
	if (!info.running) throw new Error("hub is up but its Lightning node is not running");
	const chans = await channels(h);
	const active = chans.filter((c) => c.active).length;
	if (active < want) throw new Error(`${active} of ${want} channels active`);
	return `running, ${active} of ${chans.length} channels active`;
}

let stack: ReturnType<typeof loadStack> | undefined;
await check("state", async () => {
	stack = loadStack();
	return `${stack.members.length} members, contribution ${stack.contributionSat} sat, pay budget ${stack.budgetSat} sat`;
});
if (stack) {
	const s = stack;
	await check("relay", async () => {
		const res = await fetch(s.relayUrl.replace(/^ws/, "http"), { headers: { accept: "application/nostr+json" } });
		const doc = (await res.json()) as { software?: string };
		return `${s.relayUrl} answers NIP-11 as ${doc.software ?? "a relay"}`;
	});
	await check(s.router.name, () => hub(s.router, s.members.length));
	for (const m of s.members) await check(m.name, () => hub(m, 1));
}
process.exit(results.every(Boolean) ? 0 : 1);
