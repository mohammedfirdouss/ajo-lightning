import { type Reminder, reminder } from "../reminders/reminders.ts";
import { LANGUAGES, type ReminderInput } from "../reminders/templates.ts";
import type { RoundId } from "../round/types.ts";
import type { Cadence } from "./source.ts";

export function dueDate(start: string, cadence: Cadence, n: RoundId) {
	const d = new Date(`${start}T00:00:00Z`);
	if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7 * (n - 1));
	else d.setUTCMonth(d.getUTCMonth() + (n - 1));
	return d.toISOString().slice(0, 10);
}

/**
 * Returns a reminder at once. The first ask for an input starts the slow call and gets the template. A later
 * ask gets whatever that call returned, so a page never waits on the model and the next render shows its text.
 * A call that fails leaves the template.
 */
export function reminders(write: (input: ReminderInput) => Promise<Reminder> = reminder) {
	const ready = new Map<string, string>();
	const asked = new Set<string>();
	return (input: ReminderInput): string => {
		const key = JSON.stringify(input);
		if (!asked.has(key)) {
			asked.add(key);
			write(input).then(
				(r) => ready.set(key, r.text),
				() => {},
			);
		}
		return ready.get(key) ?? LANGUAGES[input.lang].template(input);
	};
}
