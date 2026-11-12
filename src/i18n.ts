import type { Language } from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Everything the page and its menus say, in each language. Settings stay in English. */
export interface Strings {
	everything: string;
	saved: string;
	justIn: string;
	savedForLater: string;
	newBadge: string;
	readMark: string;
	savedMark: string;
	magazines: (n: number) => string;
	newToday: (n: number) => string;
	updated: (when: string) => string;
	unreadOnly: string;
	markAllRead: string;
	checkForNew: string;
	allCaughtUp: string;
	nothingSaved: string;
	lastCheckFailed: (error: string, time: number, now: number) => string;
	feedUnreadable: (error: string) => string;
	feedEmpty: string;
	notChecked: string;
	fetching: string;
	noMagazines: string;
	nothingYet: string;
	saveForLater: string;
	unsave: string;
	markRead: string;
	markUnread: string;
	removeFromPage: string;
	removeFromSaved: string;
	clipToVault: string;
	clipWith: (template: string) => string;
	copyLink: string;
	moreActions: string;
	support: string;
	undo: string;
	savedNotice: string;
	removedNotice: string;
	unsavedNotice: string;
	andOthers: (first: string) => string;
	markedAllRead: (n: number) => string;
	linkCopied: string;
	clipping: string;
	clipped: (path: string) => string;
	clipShort: (words: number) => string;
	clipFailed: (reason: string) => string;
	clipRefused: (status: number) => string;
	open: string;
	newArticles: (n: number) => string;
	couldNotReach: (names: string) => string;
	checking: string;
	clock: (time: number, now: number) => string;
	dateline: (now: number) => string;
	relative: (time: number, now: number) => string;
}

const en: Strings = {
	everything: "Everything",
	saved: "Saved",
	justIn: "Just in",
	savedForLater: "Saved for later",
	newBadge: "New",
	readMark: "Read",
	savedMark: "Saved",
	magazines: (n) => `${n} ${n === 1 ? "magazine" : "magazines"}`,
	newToday: (n) => (n ? `${n} new today` : "nothing new today"),
	updated: (when) => `updated ${when}`,
	unreadOnly: "Unread only",
	markAllRead: "Mark all as read",
	checkForNew: "Check for new articles",
	allCaughtUp: "All caught up.",
	nothingSaved: "Nothing saved yet. Use the bookmark on any article to keep it here.",
	lastCheckFailed: (error, time, now) => {
		const date = new Date(time);
		const hm = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
		const when = sameDay(time, now)
			? hm
			: `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${hm}`;
		return `The last check could not reach this magazine (${error}), so these are from ${when}.`;
	},
	feedUnreadable: (error) => `This magazine's feed could not be read (${error}).`,
	feedEmpty: "The feed has no articles at the moment.",
	notChecked: "Not checked yet.",
	fetching: "Fetching the latest articles…",
	noMagazines: "No magazines are switched on. Choose them in the plugin's settings.",
	nothingYet: "Nothing here yet. Press the refresh button above to fetch the latest articles.",
	saveForLater: "Save for later",
	unsave: "Remove from saved",
	markRead: "Mark as read",
	markUnread: "Mark as unread",
	removeFromPage: "Remove from the page",
	removeFromSaved: "Remove from saved",
	clipToVault: "Clip to vault",
	clipWith: (template) => `Clip with “${template}”`,
	copyLink: "Copy link",
	moreActions: "More actions",
	support: "Enjoying Magazine Rack? Support it on Ko-fi",
	undo: "Undo",
	savedNotice: "Saved for later.",
	removedNotice: "Removed from the page.",
	unsavedNotice: "Removed from saved.",
	andOthers: (first) => `${first} and others`,
	markedAllRead: (n) => `Marked ${n} ${n === 1 ? "article" : "articles"} as read.`,
	linkCopied: "Link copied.",
	clipping: "Clipping…",
	clipped: (path) => `Clipped to ${path}.`,
	clipShort: (words) =>
		`Only ${words} words came through: the site may keep the rest for signed-in readers. Web Clipper in your browser will get the full text.`,
	clipFailed: (reason) => `Could not clip this page: ${reason}.`,
	clipRefused: (status) =>
		`The site refused the request (HTTP ${status}). Open the article in your browser and use Web Clipper there.`,
	open: "Open",
	newArticles: (n) => (n === 1 ? "1 new article" : `${n || "No"} new articles`),
	couldNotReach: (names) => `could not reach ${names}`,
	checking: "Checking your magazines for new articles…",
	clock: (time, now) => {
		const date = new Date(time);
		const hm = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
		if (sameDay(time, now)) return `at ${hm}`;
		return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${hm}`;
	},
	dateline: (now) =>
		`${new Date(now).toLocaleDateString("en-GB", { weekday: "long" })} ${new Date(now).toLocaleDateString("en-GB", {
			day: "numeric",
			month: "long",
			year: "numeric",
		})}`,
	relative: (time, now) => {
		const diff = now - time;
		if (diff < 0) return "just now";
		if (diff < HOUR) {
			const m = Math.max(1, Math.round(diff / 60000));
			return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
		}
		if (diff < DAY) {
			const h = Math.round(diff / HOUR);
			return `${h} ${h === 1 ? "hour" : "hours"} ago`;
		}
		const days = daysBefore(time, now);
		const date = new Date(time);
		if (days <= 1) return "yesterday";
		if (days < 7) return date.toLocaleDateString("en-GB", { weekday: "long" });
		const sameYear = date.getFullYear() === new Date(now).getFullYear();
		return date.toLocaleDateString(
			"en-GB",
			sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" },
		);
	},
};

const MESES = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const es: Strings = {
	everything: "Todo",
	saved: "Guardados",
	justIn: "Lo último",
	savedForLater: "Guardados para leer después",
	newBadge: "Nuevo",
	readMark: "Leído",
	savedMark: "Guardado",
	magazines: (n) => `${n} ${n === 1 ? "revista" : "revistas"}`,
	newToday: (n) => (n ? `${n} ${n === 1 ? "artículo nuevo" : "artículos nuevos"} hoy` : "nada nuevo hoy"),
	updated: (when) => `actualizado ${when}`,
	unreadOnly: "Solo sin leer",
	markAllRead: "Marcar todo como leído",
	checkForNew: "Buscar artículos nuevos",
	allCaughtUp: "Estás al día.",
	nothingSaved: "Aún no hay nada guardado. Usa el marcador de cualquier artículo para guardarlo aquí.",
	lastCheckFailed: (error, time, now) => {
		const date = new Date(time);
		const hm = date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
		const hour = date.getHours() === 1 ? `la ${hm}` : `las ${hm}`;
		const when = sameDay(time, now) ? `de ${hour}` : `del ${date.getDate()} de ${MESES[date.getMonth()]}, a ${hour}`;
		return `No se pudo consultar esta revista (${error}); estos artículos son ${when}.`;
	},
	feedUnreadable: (error) => `No se pudo leer la fuente de esta revista (${error}).`,
	feedEmpty: "La fuente no tiene artículos en este momento.",
	notChecked: "Aún sin comprobar.",
	fetching: "Buscando los últimos artículos…",
	noMagazines: "No hay ninguna revista activada. Elígelas en los ajustes del complemento.",
	nothingYet: "Aún no hay nada. Pulsa el botón de actualizar, arriba, para traer los últimos artículos.",
	saveForLater: "Guardar para leer después",
	unsave: "Quitar de guardados",
	markRead: "Marcar como leído",
	markUnread: "Marcar como no leído",
	removeFromPage: "Quitar de la página",
	removeFromSaved: "Quitar de guardados",
	clipToVault: "Guardar en la bóveda",
	clipWith: (template) => `Guardar con «${template}»`,
	copyLink: "Copiar enlace",
	moreActions: "Más acciones",
	support: "¿Te gusta Magazine Rack? Apóyalo en Ko-fi",
	undo: "Deshacer",
	savedNotice: "Guardado para leer después.",
	removedNotice: "Se ha quitado de la página.",
	unsavedNotice: "Se ha quitado de guardados.",
	andOthers: (first) => `${first} y otros`,
	markedAllRead: (n) => `${n} ${n === 1 ? "artículo marcado" : "artículos marcados"} como leído${n === 1 ? "" : "s"}.`,
	linkCopied: "Enlace copiado.",
	clipping: "Guardando…",
	clipped: (path) => `Guardado en ${path}.`,
	clipShort: (words) =>
		`Solo han llegado ${words} palabras: puede que el sitio reserve el resto para los lectores con sesión iniciada. Web Clipper, en tu navegador, obtendrá el texto completo.`,
	clipFailed: (reason) => `No se pudo guardar esta página: ${reason}.`,
	clipRefused: (status) =>
		`El sitio rechazó la solicitud (HTTP ${status}). Abre el artículo en tu navegador y usa allí Web Clipper.`,
	open: "Abrir",
	newArticles: (n) => (n === 1 ? "1 artículo nuevo" : n ? `${n} artículos nuevos` : "Ningún artículo nuevo"),
	couldNotReach: (names) => `no se pudo llegar a ${names}`,
	checking: "Buscando artículos nuevos en tus revistas…",
	clock: (time, now) => {
		const date = new Date(time);
		const hm = date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
		const at = date.getHours() === 1 ? `a la ${hm}` : `a las ${hm}`;
		if (sameDay(time, now)) return at;
		return `el ${date.getDate()} de ${MESES[date.getMonth()]} ${at}`;
	},
	dateline: (now) => {
		const d = new Date(now);
		return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
	},
	relative: (time, now) => {
		const diff = now - time;
		if (diff < 0) return "ahora mismo";
		if (diff < HOUR) {
			const m = Math.max(1, Math.round(diff / 60000));
			return `hace ${m} ${m === 1 ? "minuto" : "minutos"}`;
		}
		if (diff < DAY) {
			const h = Math.round(diff / HOUR);
			return `hace ${h} ${h === 1 ? "hora" : "horas"}`;
		}
		const days = daysBefore(time, now);
		const date = new Date(time);
		if (days <= 1) return "ayer";
		if (days < 7) return DIAS[date.getDay()];
		const sameYear = date.getFullYear() === new Date(now).getFullYear();
		return `${date.getDate()} de ${MESES[date.getMonth()]}${sameYear ? "" : ` de ${date.getFullYear()}`}`;
	},
};

function sameDay(a: number, b: number): boolean {
	return new Date(a).toDateString() === new Date(b).toDateString();
}

function daysBefore(time: number, now: number): number {
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	return Math.ceil((today.getTime() - time) / DAY);
}

export function strings(language: Language): Strings {
	return language === "es" ? es : en;
}
