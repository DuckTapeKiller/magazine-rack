import { MarkdownRenderChild, setIcon } from "obsidian";
import type MagazineRack from "./main";
import type { Article, Magazine } from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** How many of the newest pieces across all magazines open the page. */
const JUST_IN = 5;

interface Entry {
	article: Article;
	magazine: Magazine;
}

type Variant = "hero" | "feature" | "card" | "compact";

const shownPictures = new Set<string>();

/** Options a ```magazine-rack block can carry, one per line, e.g. "magazines: Aeon, JSTOR Daily". */
export interface BlockOptions {
	magazines?: string[];
	articles?: number;
}

export function parseOptions(source: string): BlockOptions {
	const options: BlockOptions = {};
	for (const line of source.split("\n")) {
		const match = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
		if (!match) continue;
		const [, key, value] = match;
		if (key.toLowerCase() === "magazines") {
			options.magazines = value
				.split(",")
				.map((name) => name.trim().toLowerCase())
				.filter(Boolean);
		} else if (key.toLowerCase() === "articles") {
			const count = Number(value);
			if (Number.isInteger(count) && count > 0) options.articles = Math.min(count, 30);
		}
	}
	return options;
}

/** The front page drawn wherever a ```magazine-rack block appears. */
export class FrontPage extends MarkdownRenderChild {
	/** The magazine the reader is focused on, or null for the whole page. */
	private focus: string | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: MagazineRack,
		private readonly options: BlockOptions,
	) {
		super(containerEl);
	}

	onload(): void {
		this.plugin.views.add(this);
		this.render();
	}

	onunload(): void {
		this.plugin.views.delete(this);
	}

	render(): void {
		const root = this.containerEl;
		root.empty();
		root.addClass("mr-page");

		const magazines = this.magazines();
		if (this.focus && !magazines.some((m) => m.id === this.focus)) this.focus = null;
		const now = Date.now();

		this.masthead(root, magazines, now);
		if (magazines.length > 1) this.chips(root, magazines, now);

		const shown = this.focus ? magazines.filter((m) => m.id === this.focus) : magazines;
		const anything = shown.some((m) => this.articles(m).length);
		if (!anything) {
			this.emptyState(root);
			return;
		}
		if (!this.focus && magazines.length > 1) this.justIn(root, magazines, now);
		for (const magazine of shown) this.section(root, magazine, now);
	}

	// ---- parts of the page ----

	private masthead(root: HTMLElement, magazines: Magazine[], now: number): void {
		const head = root.createDiv({ cls: "mr-masthead" });
		head.createDiv({
			cls: "mr-dateline",
			text: [
				new Date(now).toLocaleDateString("en-GB", { weekday: "long" }),
				new Date(now).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
			].join(" "),
		});
		head.createDiv({ cls: "mr-title", text: this.plugin.settings.title || "The Reading Room", attr: { role: "heading", "aria-level": "1" } });

		const status = head.createDiv({ cls: "mr-status" });
		const fresh = magazines.flatMap((m) => this.articles(m)).filter((a) => this.isNew(a, now)).length;
		const bits = [
			`${magazines.length} ${magazines.length === 1 ? "magazine" : "magazines"}`,
			fresh ? `${fresh} new today` : "nothing new today",
		];
		if (this.plugin.lastCheck) bits.push(`updated ${clock(this.plugin.lastCheck, now)}`);
		status.createSpan({ text: bits.join(" · ") });

		const button = status.createEl("button", { cls: "mr-refresh clickable-icon", attr: { "aria-label": "Check for new articles" } });
		setIcon(button, "refresh-cw");
		if (this.plugin.isChecking()) button.addClass("is-spinning");
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			button.addClass("is-spinning");
			void this.plugin.checkNow(false);
		});
	}

	private chips(root: HTMLElement, magazines: Magazine[], now: number): void {
		const nav = root.createDiv({ cls: "mr-chips", attr: { role: "tablist" } });
		const chip = (label: string, id: string | null, magazine?: Magazine) => {
			const el = nav.createEl("button", { cls: "mr-chip", attr: { role: "tab" } });
			if (this.focus === id) el.addClass("is-active");
			el.setAttr("aria-selected", String(this.focus === id));
			if (magazine) {
				el.style.setProperty("--mr-accent", magazine.color);
				el.createSpan({ cls: "mr-chip-dot" });
			}
			el.createSpan({ text: label });
			if (magazine) {
				const fresh = this.articles(magazine).filter((a) => this.isNew(a, now)).length;
				if (fresh) el.createSpan({ cls: "mr-chip-count", text: String(fresh) });
			}
			el.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.focus = this.focus === id ? null : id;
				this.render();
			});
		};
		chip("Everything", null);
		for (const magazine of magazines) chip(shortName(magazine.name), magazine.id, magazine);
		// On a phone the row scrolls sideways: bring the chosen chip into view.
		window.requestAnimationFrame(() => {
			const active = nav.querySelector<HTMLElement>(".mr-chip.is-active");
			if (active && nav.scrollWidth > nav.clientWidth) {
				nav.scrollLeft = active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
			}
		});
	}

	private justIn(root: HTMLElement, magazines: Magazine[], now: number): void {
		const entries = magazines
			.flatMap((magazine) => this.articles(magazine).map((article) => ({ article, magazine })))
			.filter((e) => e.article.date !== undefined && e.article.date <= now + HOUR)
			.sort((a, b) => (b.article.date ?? 0) - (a.article.date ?? 0))
			.slice(0, JUST_IN);
		if (!entries.length) return;

		const section = root.createDiv({ cls: "mr-justin" });
		section.createDiv({ cls: "mr-label", text: "Just in" });
		const layout = section.createDiv({ cls: "mr-justin-layout" });
		this.card(layout, entries[0], "hero", now);
		const side = layout.createDiv({ cls: "mr-justin-side" });
		for (const entry of entries.slice(1)) this.card(side, entry, "compact", now);
	}

	private section(root: HTMLElement, magazine: Magazine, now: number): void {
		const section = root.createDiv({ cls: "mr-section" });
		section.style.setProperty("--mr-accent", magazine.color);

		const head = section.createDiv({ cls: "mr-section-head" });
		head.createDiv({ cls: "mr-section-name", text: magazine.name, attr: { role: "heading", "aria-level": "2" } });
		if (magazine.homepage) {
			const link = head.createEl("a", {
				cls: "mr-section-link",
				href: magazine.homepage,
				text: `${hostName(magazine.homepage)} ↗`,
			});
			this.openOnClick(link, magazine.homepage);
		}

		const cache = this.plugin.cache[magazine.id];
		const limit = this.focus ? 30 : this.options.articles ?? this.plugin.settings.perMagazine;
		const articles = this.articles(magazine).slice(0, limit);
		if (cache?.error) {
			section.createDiv({
				cls: "mr-warning",
				text: articles.length
					? `The last check could not reach this magazine (${cache.error}), so these are from ${clock(cache.fetchedAt ?? now, now)}.`
					: `This magazine's feed could not be read (${cache.error}).`,
			});
		} else if (!articles.length) {
			section.createDiv({ cls: "mr-warning", text: cache ? "The feed has no articles at the moment." : "Not checked yet." });
		}
		if (!articles.length) return;

		const grid = section.createDiv({ cls: "mr-grid" });
		articles.forEach((article, i) => this.card(grid, { article, magazine }, i === 0 ? "feature" : "card", now));
	}

	private emptyState(root: HTMLElement): void {
		const box = root.createDiv({ cls: "mr-empty" });
		if (this.plugin.isChecking()) {
			box.setText("Fetching the latest articles…");
		} else if (!this.magazines().length) {
			box.setText("No magazines are switched on. Choose them in the plugin's settings.");
		} else {
			box.setText("Nothing here yet. Press the refresh button above to fetch the latest articles.");
		}
	}

	// ---- one article ----

	private card(parent: HTMLElement, entry: Entry, variant: Variant, now: number): void {
		const { article, magazine } = entry;
		const card = parent.createEl("a", { cls: `mr-card mr-${variant}`, href: article.url });
		card.style.setProperty("--mr-accent", magazine.color);
		const read = this.plugin.isRead(article.url);
		if (read) card.addClass("is-read");
		this.openOnClick(card, article.url, () => {
			this.plugin.markRead(article.url);
			card.addClass("is-read");
			card.querySelector(".mr-new")?.remove();
		});

		const media = card.createDiv({ cls: "mr-media" });
		const image = article.image ?? this.plugin.pageImages[article.url] ?? undefined;
		if (image) {
			const img = media.createEl("img", {
				attr: { src: image, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" },
			});
			// A picture already shown once appears at once on a redraw, without fading in again.
			if (shownPictures.has(image)) media.addClass("is-loaded", "no-fade");
			img.addEventListener("load", () => {
				shownPictures.add(image);
				media.addClass("is-loaded");
			});
			img.addEventListener("error", () => {
				img.remove();
				this.monogram(media, magazine);
			});
		} else {
			this.monogram(media, magazine);
		}
		// Every card with a full-size picture names its magazine on the picture.
		const tagged = variant !== "compact";
		if (tagged) media.createDiv({ cls: "mr-tag", text: shortName(magazine.name) });

		const body = card.createDiv({ cls: "mr-body" });
		const when = article.date !== undefined ? relativeTime(article.date, now) : "";
		const kicker = body.createDiv({ cls: "mr-kicker" });
		// Where the picture carries the tag, the label line gives the time; the name stays for narrow rows.
		kicker.createSpan({ cls: tagged ? "mr-kicker-name is-tagged" : "mr-kicker-name", text: shortName(magazine.name) });
		if (tagged && when) kicker.createSpan({ cls: "mr-kicker-time", text: when });
		if (!read && this.isNew(article, now)) kicker.createSpan({ cls: "mr-new", text: "New" });

		body.createDiv({ cls: "mr-headline", text: article.title });
		if (this.plugin.settings.showSummaries && article.summary && variant !== "compact") {
			body.createDiv({ cls: "mr-standfirst", text: article.summary });
		}

		const meta: string[] = [];
		if (magazine.showAuthor && article.author) meta.push(shortByline(article.author));
		if (when && !tagged) meta.push(when);
		const metaEl = body.createDiv({ cls: "mr-meta" });
		for (const item of meta) metaEl.createSpan({ cls: "mr-meta-item", text: item });
		metaEl.createSpan({ cls: "mr-read-mark", text: "Read" });
	}

	private monogram(media: HTMLElement, magazine: Magazine): void {
		media.addClass("is-monogram");
		media.createDiv({ cls: "mr-monogram", text: initials(magazine.name) });
	}

	/** Opens in the browser, and stops the click from putting the editor's cursor into the block. */
	private openOnClick(el: HTMLElement, url: string, after?: () => void): void {
		el.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			window.open(url);
			after?.();
		});
	}

	// ---- helpers ----

	private magazines(): Magazine[] {
		const wanted = this.options.magazines;
		return this.plugin.settings.magazines.filter(
			(m) =>
				m.enabled &&
				(!wanted ||
					wanted.some((name) => m.name.toLowerCase() === name || shortName(m.name).toLowerCase() === name)),
		);
	}

	private articles(magazine: Magazine): Article[] {
		return this.plugin.cache[magazine.id]?.articles ?? [];
	}

	private isNew(article: Article, now: number): boolean {
		return article.date !== undefined && now - article.date < DAY && !this.plugin.isRead(article.url);
	}
}

function shortName(name: string): string {
	return name.replace(/^The\s+/i, "").replace(/\s+Magazine$/i, "");
}

/** "A, B, C and D" becomes "A and others", so a long byline stays on one line. */
function shortByline(author: string): string {
	const people = author.split(/\s*,\s*|\s+and\s+|\s*&\s*/).filter(Boolean);
	return people.length > 2 ? `${people[0]} and others` : author;
}

function initials(name: string): string {
	const words = shortName(name).split(/\s+/).filter(Boolean);
	if (words.length === 1) return words[0].charAt(0).toUpperCase();
	return words
		.filter((w) => !/^(of|and|the|a|an)$/i.test(w))
		.map((w) => w.charAt(0).toUpperCase())
		.join("")
		.slice(0, 4);
}

function hostName(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function clock(time: number, now: number): string {
	const date = new Date(time);
	const hm = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	if (new Date(now).toDateString() === date.toDateString()) return `at ${hm}`;
	return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${hm}`;
}

export function relativeTime(time: number, now: number): string {
	const diff = now - time;
	if (diff < 0) return "just now";
	if (diff < HOUR) {
		const minutes = Math.max(1, Math.round(diff / 60000));
		return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
	}
	if (diff < DAY) {
		const hours = Math.round(diff / HOUR);
		return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
	}
	const date = new Date(time);
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const days = Math.ceil((today.getTime() - date.getTime()) / DAY);
	if (days <= 1) return "yesterday";
	if (days < 7) return date.toLocaleDateString("en-GB", { weekday: "long" });
	const sameYear = date.getFullYear() === today.getFullYear();
	return date.toLocaleDateString(
		"en-GB",
		sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" },
	);
}

export function formatStamp(time: number): string {
	const date = new Date(time);
	const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
	const hm = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	return `${day} at ${hm}`;
}
