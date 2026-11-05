import Anthropic from "@anthropic-ai/sdk";
import { LANGUAGES, type ReminderInput } from "./templates.ts";

export type Reminder = { text: string; source: "ai" | "template" };

export const MODEL = "claude-opus-5-5";
export const TIMEOUT_MS = 4500;

/** Builds the request from the four round fields by name, so an extra field on the caller's object never reaches the model. */
export function promptFor({ lang, amount, due, member }: ReminderInput) {
	return {
		system:
			"You write one short WhatsApp reminder for a member of a rotating savings circle (ajo, esusu, tontine) that pays over Bitcoin Lightning. " +
			"Each member pays this round's payee directly from their own wallet. Reply with the message only, under 40 words, with no emoji and no quotes.",
		content: `Write it in ${LANGUAGES[lang].name}. Address the member as "Member ${member}". Write the amount exactly as "${amount} sats" and the due date exactly as "${due}".`,
	};
}

export async function reminder(input: ReminderInput, client = defaultClient()): Promise<Reminder> {
	const template: Reminder = { text: LANGUAGES[input.lang].template(input), source: "template" };
	if (!client) return template;
	const { system, content } = promptFor(input);
	try {
		const response = await client.beta.messages.create(
			{
				model: MODEL,
				max_tokens: 1024,
				output_config: { effort: "low" },
				betas: ["server-side-fallback-2026-07-01"],
				fallbacks: "default",
				system,
				messages: [{ role: "user", content }],
			},
			{ timeout: TIMEOUT_MS, maxRetries: 0 },
		);
		if (response.stop_reason !== "end_turn") return template;
		const text = response.content
			.flatMap((b) => (b.type === "text" ? [b.text] : []))
			.join("")
			.trim();
		const namesRound = text.includes(String(input.amount)) && text.includes(input.due);
		return namesRound && text.length <= 400 ? { text, source: "ai" } : template;
	} catch {
		return template;
	}
}

function defaultClient() {
	return process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined;
}
