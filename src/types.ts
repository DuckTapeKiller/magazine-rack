export interface Magazine {
	id: string;
	name: string;
	homepage: string;
	/** One or more feed URLs; their articles are merged and sorted by date. */
	feeds: string[];
	/** Some feeds put the name of the editor who posted the piece in the author field, not the writer. */
	showAuthor: boolean;
	enabled: boolean;
	/** Accent colour for the magazine's section, as #rrggbb. */
	color: string;
	/** Words in a headline, or parts of a web address (anything with a "/"), whose articles are left out. */
	leaveOut: string[];
}

export interface Article {
	title: string;
	url: string;
	author?: string;
	/** Milliseconds since the epoch, when the feed gives a readable date. */
	date?: number;
	summary?: string;
	/** Picture from the feed itself. */
	image?: string;
	/** A thumbnail too small for a large card, used only when the article page offers no picture. */
	thumbnail?: string;
	/** The feed it came from, so a failed feed can keep its earlier articles. */
	feed?: string;
	/** When the plugin first saw it, for keeping a history of undated articles. */
	firstSeen?: number;
	/** The last check that found it in its feed: history is kept from then. */
	lastSeen?: number;
}

/** An article put aside to read later; kept after it leaves the feed. */
export interface SavedArticle {
	article: Article;
	magazineId: string;
	/** Copies, so the card still looks right if the magazine is later removed. */
	magazineName: string;
	color: string;
	savedAt: number;
}

/** A template exported from Obsidian Web Clipper (the same JSON shape). */
export interface ClipTemplate {
	id: string;
	name: string;
	behavior: "create" | "append-specific" | "append-daily" | "prepend-specific" | "prepend-daily" | "overwrite";
	noteNameFormat: string;
	path: string;
	noteContentFormat: string;
	properties: { name: string; value: string; type?: string }[];
	triggers?: string[];
}

export type Language = "en" | "es";

export interface MagazineCache {
	articles: Article[];
	/** When the articles were last fetched successfully. */
	fetchedAt?: number;
	/** Why the latest attempt failed, if it did. */
	error?: string;
}

export interface Settings {
	notePath: string;
	title: string;
	perMagazine: number;
	refreshMinutes: number;
	showSummaries: boolean;
	/** How long articles stay on the page after they leave the feed. */
	historyDays: number;
	unreadOnly: boolean;
	/** The row of magazine chips kept to one line, with a chip that shows the rest. */
	chipsFolded: boolean;
	language: Language;
	/** Switch the note to reading view whenever it is opened. */
	alwaysReading: boolean;
	/** Web Clipper templates, first match wins; the first is the fallback. */
	clipTemplates: ClipTemplate[];
	/** Open the new note after clipping. */
	openAfterClip: boolean;
	magazines: Magazine[];
}

export interface PluginData {
	settings: Settings;
	cache: Record<string, MagazineCache>;
	/** Sharing pictures read from article pages, by article URL; null when the page had none. */
	pageImages: Record<string, string | null>;
	/** How many times an article page gave no picture, so a page that failed once is tried again. */
	pageMisses?: Record<string, number>;
	/** Articles opened or marked read, most recent last. */
	read: string[];
	saved: SavedArticle[];
	/** Articles removed from the page, by URL. */
	removed: string[];
	lastCheck?: number;
}

export const KOFI_URL = "https://ko-fi.com/ducktapekiller";

/** Muted accents that hold up on light and dark themes. */
export const PALETTE = [
	"#b5543a",
	"#2f6f8f",
	"#a23b3b",
	"#5b6470",
	"#9a7b2f",
	"#7a5c99",
	"#3f5f9e",
	"#3d7a5a",
	"#8a4f7d",
	"#4f7f86",
	"#a0612b",
	"#6b7a3a",
];

export const DEFAULT_MAGAZINES: Magazine[] = [
	{
		id: "aeon",
		name: "Aeon",
		homepage: "https://aeon.co",
		feeds: ["https://aeon.co/essays/feed.rss"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[0],
	},
	{
		id: "jstor-daily",
		name: "JSTOR Daily",
		homepage: "https://daily.jstor.org",
		feeds: ["https://daily.jstor.org/feed/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[1],
	},
	{
		id: "the-atlantic",
		name: "The Atlantic",
		homepage: "https://www.theatlantic.com",
		feeds: ["https://www.theatlantic.com/feed/all/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[2],
	},
	{
		id: "nytimes",
		name: "The New York Times",
		homepage: "https://www.nytimes.com",
		feeds: ["https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[3],
	},
	{
		id: "epoche",
		name: "Epoché Magazine",
		homepage: "https://epochemagazine.org",
		feeds: ["https://epochemagazine.org/feed/"],
		showAuthor: false,
		enabled: true,
		leaveOut: [],
		color: PALETTE[4],
	},
	{
		id: "public-domain-review",
		name: "The Public Domain Review",
		homepage: "https://publicdomainreview.org",
		feeds: ["https://publicdomainreview.org/rss.xml"],
		showAuthor: false,
		enabled: true,
		leaveOut: [],
		color: PALETTE[5],
	},
	{
		id: "nybooks",
		name: "The New York Review of Books",
		homepage: "https://www.nybooks.com",
		// The site's main feed is empty; the print issue and the online pieces each have their own.
		feeds: ["https://www.nybooks.com/feed/?post_type=article", "https://www.nybooks.com/feed/?post_type=daily"],
		showAuthor: false,
		enabled: true,
		leaveOut: [],
		color: PALETTE[6],
	},
	{
		id: "guardian",
		name: "The Guardian",
		homepage: "https://www.theguardian.com",
		feeds: ["https://www.theguardian.com/world/rss"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[7],
	},
	{
		id: "le-monde",
		name: "Le Monde",
		homepage: "https://www.lemonde.fr",
		feeds: ["https://www.lemonde.fr/rss/une.xml"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[8],
	},
	{
		id: "el-pais",
		name: "El País",
		homepage: "https://elpais.com",
		feeds: ["https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[9],
	},
	{
		id: "el-espectador",
		name: "El Espectador",
		homepage: "https://www.elespectador.com",
		feeds: ["https://www.elespectador.com/arc/outboundfeeds/discover/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[10],
	},
	{
		id: "la-nacion",
		name: "La Nación",
		homepage: "https://www.lanacion.com.ar",
		feeds: ["https://www.lanacion.com.ar/arc/outboundfeeds/rss/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[11],
	},
	{
		id: "bbc",
		name: "BBC",
		homepage: "https://www.bbc.co.uk/news",
		// The feed's pictures are 240-pixel thumbnails, so the article pages' pictures are used.
		feeds: ["https://feeds.bbci.co.uk/news/rss.xml"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[0],
	},
	{
		id: "epoch-times",
		name: "Epoch Times",
		homepage: "https://www.theepochtimes.com",
		feeds: ["https://feed.theepochtimes.com/us/feed"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[1],
	},
	{
		id: "psyche",
		name: "Psyche",
		homepage: "https://psyche.co",
		feeds: ["https://psyche.co/feed"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[2],
	},
	{
		id: "nature",
		name: "Nature",
		homepage: "https://www.nature.com",
		feeds: ["https://www.nature.com/nature.rss"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[3],
	},
	{
		id: "big-think",
		name: "Big Think",
		homepage: "https://bigthink.com",
		feeds: ["https://bigthink.com/feed/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[4],
	},
	{
		id: "noema",
		name: "Noema",
		homepage: "https://www.noemamag.com",
		feeds: ["https://www.noemamag.com/feed/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[5],
	},
	{
		id: "letras-libres",
		name: "Letras Libres",
		homepage: "https://letraslibres.com",
		feeds: ["https://letraslibres.com/feed/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[6],
	},
	{
		id: "zenda",
		name: "Zenda",
		homepage: "https://www.zendalibros.com",
		feeds: ["https://www.zendalibros.com/feed/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[7],
	},
	{
		id: "el-cultural",
		name: "El Cultural",
		homepage: "https://www.elespanol.com/el-cultural/",
		feeds: ["https://www.elespanol.com/rss/el-cultural/"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[8],
	},
	{
		id: "mcsweeneys",
		name: "McSweeney’s",
		homepage: "https://www.mcsweeneys.net",
		feeds: ["https://feeds.feedburner.com/mcsweeneys"],
		showAuthor: true,
		enabled: true,
		leaveOut: [],
		color: PALETTE[9],
	},
	{
		id: "granta",
		name: "Granta",
		homepage: "https://granta.com",
		// granta.com turns away anything that is not a browser; Granta's own Substack carries its new pieces. Its feed names the magazine, not the writer, as author.
		feeds: ["https://grantamag.substack.com/feed"],
		showAuthor: false,
		enabled: true,
		leaveOut: [],
		color: PALETTE[10],
	},
];

export const DEFAULT_SETTINGS: Settings = {
	notePath: "Reading Room.md",
	title: "The Reading Room",
	perMagazine: 9,
	refreshMinutes: 60,
	showSummaries: true,
	historyDays: 7,
	unreadOnly: false,
	chipsFolded: true,
	language: "en",
	alwaysReading: true,
	clipTemplates: [],
	openAfterClip: false,
	magazines: DEFAULT_MAGAZINES,
};

/** Web Clipper's own default template, used until you import yours. */
export const DEFAULT_CLIP_TEMPLATE: ClipTemplate = {
	id: "web-clipper-default",
	name: "Web Clipper’s default",
	behavior: "create",
	noteNameFormat: "{{title}}",
	path: "Clippings",
	noteContentFormat: "{{content}}",
	properties: [
		{ name: "title", value: "{{title}}" },
		{ name: "source", value: "{{url}}" },
		{ name: "author", value: '{{author|split:", "|wikilink|join}}', type: "multitext" },
		{ name: "published", value: "{{published}}", type: "date" },
		{ name: "created", value: "{{date}}", type: "date" },
		{ name: "description", value: "{{description}}" },
		{ name: "tags", value: "clippings", type: "multitext" },
	],
	triggers: [],
};

/** A fresh copy, so editing the settings never changes the defaults. */
export function copyDefaults(): Settings {
	return {
		...DEFAULT_SETTINGS,
		clipTemplates: [],
		magazines: DEFAULT_MAGAZINES.map((m) => ({ ...m, feeds: [...m.feeds], leaveOut: [...m.leaveOut] })),
	};
}
