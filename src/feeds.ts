import { requestUrl } from "obsidian";
import type { Article } from "./types";

const TIMEOUT_MS = 30_000;
const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);

/** Downloads one feed and returns its articles, newest first where dates allow. */
export async function fetchFeed(url: string): Promise<Article[]> {
	const response = await withTimeout(
		requestUrl({
			url,
			method: "GET",
			headers: {
				Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
			},
			throw: false,
		}),
		TIMEOUT_MS,
	);
	if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
	return parseFeed(response.text, url);
}

/** Reads RSS 2.0, RSS 1.0 (RDF) and Atom. Throws when the text is not a feed. */
export function parseFeed(text: string, feedUrl: string): Article[] {
	const doc = parseXml(text);
	const root = doc?.documentElement;
	const rootName = root?.localName.toLowerCase();
	if (!doc || !root || !["rss", "feed", "rdf"].includes(rootName ?? "")) {
		if (/<html[\s>]/i.test(text.slice(0, 2000))) {
			throw new Error("the site sent a web page instead of the feed");
		}
		throw new Error("the feed could not be read");
	}

	const entries = Array.from(doc.getElementsByTagName("*")).filter(
		(el) => el.localName === "item" || el.localName === "entry",
	);

	const articles: Article[] = [];
	for (const entry of entries) {
		const url = entryLink(entry, feedUrl);
		const title = cleanText(childText(entry, "title"));
		if (!url || !title) continue;
		const article: Article = { title, url };
		const author = entryAuthor(entry);
		if (author) article.author = author;
		const date = entryDate(entry);
		if (date !== undefined) article.date = date;
		const summary = summarise(childText(entry, "description", "summary", "content", "encoded"));
		if (summary) article.summary = summary;
		const image = entryImage(entry, url);
		if (image) article.image = image;
		articles.push(article);
	}
	return articles;
}

function parseXml(text: string): Document | null {
	const attempt = (source: string): Document | null => {
		const doc = new DOMParser().parseFromString(source, "application/xml");
		return doc.getElementsByTagName("parsererror").length ? null : doc;
	};
	// Blank lines or a byte-order mark before "<?xml" (the LRB feed has them) make strict XML fail.
	const trimmed = text.replace(/^[\s\uFEFF]+/, "");
	// Many feeds break XML rules with bare ampersands or HTML entities such as &nbsp;.
	return attempt(trimmed) ?? attempt(repairXml(trimmed));
}

function repairXml(text: string): string {
	return text.replace(/&(#\d+;|#x[0-9a-f]+;|[a-z][a-z0-9]*;)?/gi, (match, entity: string | undefined) => {
		if (!entity) return "&amp;";
		if (entity.startsWith("#")) return match;
		const name = entity.slice(0, -1);
		if (XML_ENTITIES.has(name)) return match;
		const decoded = new DOMParser().parseFromString(`<p>&${entity}</p>`, "text/html").body.textContent ?? "";
		if (!decoded || decoded === `&${entity}`) return `&amp;${entity}`;
		return Array.from(decoded)
			.map((ch) => `&#${ch.codePointAt(0)};`)
			.join("");
	});
}

function children(el: Element, ...names: string[]): Element[] {
	return Array.from(el.children).filter((child) => names.includes(child.localName));
}

function childText(el: Element, ...names: string[]): string {
	for (const name of names) {
		const child = children(el, name)[0];
		const text = child?.textContent?.trim();
		if (text) return text;
	}
	return "";
}

function entryLink(entry: Element, feedUrl: string): string | null {
	let href = "";
	const links = children(entry, "link");
	// Atom: <link rel="alternate" href="..."/>, where a missing rel means alternate.
	const alternate = links.find((l) => l.getAttribute("href") && (l.getAttribute("rel") ?? "alternate") === "alternate");
	if (alternate) href = alternate.getAttribute("href") ?? "";
	// RSS: <link>https://...</link>
	if (!href) href = links.map((l) => l.textContent?.trim() ?? "").find(Boolean) ?? "";
	if (!href) {
		const guid = children(entry, "guid")[0];
		if (guid && guid.getAttribute("isPermaLink") !== "false") href = guid.textContent?.trim() ?? "";
	}
	if (!href) href = entry.getAttribute("rdf:about") ?? "";
	if (!href) return null;
	try {
		const url = new URL(href, feedUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		for (const key of Array.from(url.searchParams.keys())) {
			if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
		}
		return url.toString();
	} catch {
		return null;
	}
}

const MRSS = "search.yahoo.com/mrss";
const NOT_PICTURES = /feedburner|gravatar|\/emoji\/|smilies|\/pixel\.|1x1|spacer\.|blank\.gif|\.svg(\?|$)/i;

/** The article's picture as the feed gives it: Media RSS, an image enclosure, or the first real <img>. */
function entryImage(entry: Element, articleUrl: string): string | undefined {
	const media = Array.from(entry.getElementsByTagName("*")).filter((el) =>
		(el.namespaceURI ?? "").includes(MRSS),
	);
	const contents = media
		.filter((el) => el.localName === "content" && el.getAttribute("url"))
		.filter((el) => {
			const medium = el.getAttribute("medium");
			const type = el.getAttribute("type");
			if (medium && medium !== "image") return false;
			if (type && !type.startsWith("image/")) return false;
			return true;
		})
		.sort((a, b) => Number(b.getAttribute("width") ?? 0) - Number(a.getAttribute("width") ?? 0));
	const thumbnail = media.find((el) => el.localName === "thumbnail" && el.getAttribute("url"));
	const enclosure = children(entry, "enclosure").find((el) => (el.getAttribute("type") ?? "").startsWith("image/"));

	const fromFeed = contents[0]?.getAttribute("url") ?? thumbnail?.getAttribute("url") ?? enclosure?.getAttribute("url");
	if (fromFeed) return absoluteImage(fromFeed, articleUrl);

	for (const html of [childText(entry, "description", "summary"), childText(entry, "encoded", "content")]) {
		if (!html || !/<img/i.test(html)) continue;
		const doc = new DOMParser().parseFromString(html, "text/html");
		for (const img of Array.from(doc.images)) {
			const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
			const tiny = Number(img.getAttribute("width") || 99) <= 2 || Number(img.getAttribute("height") || 99) <= 2;
			if (!src || tiny || NOT_PICTURES.test(src)) continue;
			const url = absoluteImage(src, articleUrl);
			if (url) return url;
		}
	}
	return undefined;
}

function absoluteImage(src: string, base: string): string | undefined {
	try {
		const url = new URL(src.trim(), base);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** Reads the picture an article page offers for sharing (og:image or twitter:image). */
export async function fetchPageImage(articleUrl: string): Promise<string | null> {
	const response = await withTimeout(
		requestUrl({ url: articleUrl, method: "GET", headers: { Accept: "text/html" }, throw: false }),
		TIMEOUT_MS,
	);
	if (response.status >= 400) return null;
	const doc = new DOMParser().parseFromString(response.text, "text/html");
	const selectors = [
		'meta[property="og:image"]',
		'meta[name="og:image"]',
		'meta[property="og:image:url"]',
		'meta[name="twitter:image"]',
		'meta[property="twitter:image"]',
	];
	for (const selector of selectors) {
		const content = doc.querySelector(selector)?.getAttribute("content");
		const url = content && !NOT_PICTURES.test(content) ? absoluteImage(content, articleUrl) : undefined;
		if (url) return url;
	}
	const linked = doc.querySelector('link[rel="image_src"]')?.getAttribute("href");
	return (linked && absoluteImage(linked, articleUrl)) || null;
}

function entryAuthor(entry: Element): string | undefined {
	const atomAuthor = children(entry, "author")[0];
	const atomName = atomAuthor ? childText(atomAuthor, "name") : "";
	let author = atomName || childText(entry, "creator") || childText(entry, "author");
	// RSS <author> is often "someone@example.com (Name)".
	const inBrackets = author.match(/^\S+@\S+\s*\((.+)\)$/);
	if (inBrackets) author = inBrackets[1];
	if (/^\S+@\S+$/.test(author)) return undefined;
	author = cleanText(author).replace(/^by\s+/i, "");
	return author || undefined;
}

function entryDate(entry: Element): number | undefined {
	for (const name of ["pubDate", "published", "date", "updated", "issued", "modified"]) {
		const text = childText(entry, name);
		if (!text) continue;
		const time = Date.parse(text);
		if (!Number.isNaN(time)) return time;
	}
	return undefined;
}

/** Turns feed text that may hold HTML or entities into plain text on one line. */
export function cleanText(text: string): string {
	if (!text) return "";
	// A space after each paragraph or line break, so "Brenner</p><p>Read" does not run together.
	const spaced = text.replace(/<\/(p|div|li|h[1-6]|blockquote|figcaption)>|<br\s*\/?>/gi, "$& ");
	const plain = /[<&]/.test(spaced)
		? new DOMParser().parseFromString(`<body>${spaced}</body>`, "text/html").body.textContent ?? ""
		: spaced;
	return plain.replace(/\s+/g, " ").trim();
}

function summarise(html: string): string | undefined {
	// Some feeds (the Public Domain Review) mark titles of works as *Leaves of Grass* or _Leaves of Grass_.
	let text = cleanText(html).replace(/(^|[\s(“"‘'])([*_])(\S(?:[^*_]*\S)?)\2(?=$|[\s).,;:!?”"’'])/g, "$1$3");
	// Boilerplate feeds add at the end: "The post X appeared first on Y.", "– by Name", "Read on Aeon".
	const trailers = [
		/\s*The post .{1,300}? appeared first on .{1,120}?\.\s*$/,
		/\s*(Read on|Continue reading|Read more)\b[^.?!]{0,60}[.…]?\s*$/i,
		/\s*[-–—]\s*by\s+[^.?!]{1,80}$/i,
	];
	let before;
	do {
		before = text;
		for (const trailer of trailers) text = text.replace(trailer, "").trim();
	} while (text !== before);
	if (!text) return undefined;
	if (text.length <= 220) return text;
	const cut = text.slice(0, 220);
	const space = cut.lastIndexOf(" ");
	return `${(space > 150 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error("no answer after 30 seconds")), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/**
 * Finds the feeds a website offers: first the ones its home page announces,
 * then the usual addresses. Returns only addresses that really answer with a feed.
 */
export async function discoverFeeds(website: string): Promise<string[]> {
	const base = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
	const candidates: string[] = [];
	try {
		const page = await withTimeout(requestUrl({ url: base.toString(), throw: false }), TIMEOUT_MS);
		if (page.status < 400) {
			const doc = new DOMParser().parseFromString(page.text, "text/html");
			for (const link of Array.from(doc.querySelectorAll("link[rel~='alternate'][href]"))) {
				const type = (link.getAttribute("type") ?? "").toLowerCase();
				if (!/rss|atom|xml/.test(type)) continue;
				const href = new URL(link.getAttribute("href") ?? "", base).toString();
				// Comment feeds are rarely what anyone wants.
				if (!/comments/i.test(href)) candidates.push(href);
			}
		}
	} catch {
		// Fall through to the usual addresses.
	}
	const announced = await workingFeeds(Array.from(new Set(candidates)), 1);
	if (announced.length) return announced;
	const usual = ["/feed/", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/rss/", "/feed.rss"];
	return workingFeeds(
		usual.map((path) => new URL(path, base).toString()),
		1,
	);
}

async function workingFeeds(urls: string[], limit: number): Promise<string[]> {
	const working: string[] = [];
	for (const url of urls) {
		try {
			if ((await fetchFeed(url)).length) working.push(url);
		} catch {
			// Not a feed.
		}
		if (working.length >= limit) break;
	}
	return working;
}
