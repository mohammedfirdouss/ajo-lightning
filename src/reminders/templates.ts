import type { Sats } from "../round/types.ts";

export type Lang = "en" | "pcm" | "yo" | "fr" | "wo";

/** Round state only. A member is their seat number, so no name or phone number can reach a reminder. */
export type ReminderInput = { lang: Lang; amount: Sats; due: string; member: number };

type Language = { name: string; template: (r: ReminderInput) => string };

/** The Yoruba and Wolof templates still need a check by a native speaker. */
export const LANGUAGES: Record<Lang, Language> = {
	en: {
		name: "English",
		template: (r) =>
			`Hi Member ${r.member}, your ajo contribution of ${r.amount} sats is due on ${r.due}. Please pay this round's payee from your wallet before then.`,
	},
	pcm: {
		name: "Nigerian Pidgin",
		template: (r) =>
			`Member ${r.member}, how far? Your ajo money, ${r.amount} sats, go due for ${r.due}. Abeg pay the person wey get this round from your wallet before that day.`,
	},
	yo: {
		name: "Yoruba",
		template: (r) =>
			`Ẹ n lẹ, Ọmọ ẹgbẹ́ ${r.member}. Owó àjọ yín, ${r.amount} sats, yóò pé ní ${r.due}. Ẹ jọ̀ọ́ ẹ san án fún ẹni tí ó kàn láti inú àpamọ́wọ́ yín ṣáájú ọjọ́ náà.`,
	},
	fr: {
		name: "French",
		template: (r) =>
			`Bonjour Membre ${r.member}, votre cotisation de ${r.amount} sats à la tontine est due le ${r.due}. Merci de payer le bénéficiaire de ce tour depuis votre portefeuille avant cette date.`,
	},
	wo: {
		name: "Wolof",
		template: (r) =>
			`Salaam aleekum Mbokk ${r.member}. Sa natt, ${r.amount} sats, dafay jot ci ${r.due}. Fey ki am tour bi ak sa portefeuille balaa bés boobu.`,
	},
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function reminderInput(raw: { lang: string; amount: Sats; due: string; member: number }): ReminderInput {
	if (!Object.hasOwn(LANGUAGES, raw.lang)) throw new RangeError(`not a language: ${JSON.stringify(raw.lang)}, use ${Object.keys(LANGUAGES).join(", ")}`);
	if (!DATE.test(raw.due) || Number.isNaN(Date.parse(raw.due))) throw new RangeError(`not a YYYY-MM-DD date: ${JSON.stringify(raw.due)}`);
	if (!Number.isSafeInteger(raw.member) || raw.member < 1) throw new RangeError(`not a member seat: ${raw.member}`);
	return { lang: raw.lang as Lang, amount: raw.amount, due: raw.due, member: raw.member };
}
