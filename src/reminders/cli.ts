import { parseArgs } from "node:util";
import { sats } from "../round/types.ts";
import { reminder } from "./reminders.ts";
import { reminderInput } from "./templates.ts";

const { values } = parseArgs({
	options: {
		lang: { type: "string", default: "en" },
		amount: { type: "string" },
		due: { type: "string" },
		member: { type: "string" },
	},
});

if (!values.amount || !values.due || !values.member) {
	console.error("usage: scripts/remind --lang en|pcm|yo|fr|wo --amount <sats> --due YYYY-MM-DD --member <seat>");
	process.exit(2);
}

try {
	const input = reminderInput({ lang: values.lang, amount: sats(Number(values.amount)), due: values.due, member: Number(values.member) });
	const start = performance.now();
	const r = await reminder(input);
	console.error(`source=${r.source} ms=${Math.round(performance.now() - start)}`);
	console.log(r.text);
	process.exit(0);
} catch (e) {
	console.error((e as Error).message);
	process.exit(2);
}
