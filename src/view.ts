import { MarkdownRenderChild, Menu, Notice, setIcon } from "obsidian";
import type { Strings } from "./i18n";
import type MagazineRack from "./main";
import { KOFI_URL, type Article, type Magazine } from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** How many of the newest pieces across all magazines open the page. */
const JUST_IN = 5;
/** The reading list, a page of its own opened from the masthead. */
const SAVED = "__saved__";

/** What a card needs to know about where its article comes from. */
interface Source {
	id: string;
	name: string;
	color: string;
	showAuthor: boolean;
}

interface Entry {
	article: Article;
	source: Source;
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
	/** The magazine the reader is focused on, SAVED for the reading list, or null for the whole page. */
	private focus: string | null = null;
	private t!: Strings;
	private now = 0;
	private leaveOutRules = new Map<string, ((article: Article) => boolean)[]>();
	/** Folds the chips again when the page changes width. */
	private chipsResize: ResizeObserver | null = null;

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
		this.chipsResize?.disconnect();
	}

	render(): void {
		const root = this.containerEl;
		this.chipsResize?.disconnect();
		this.chipsResize = null;
		root.empty();
		root.addClass("mr-page");
		this.t = this.plugin.t();
		this.now = Date.now();
		this.leaveOutRules.clear();

		const magazines = this.magazines();
		if (this.focus && this.focus !== SAVED && !magazines.some((m) => m.id === this.focus)) this.focus = null;

		this.masthead(root, magazines);
		// The reading list is a page of its own: the front page carries only the magazines.
		if (this.focus === SAVED) {
			this.readingList(root);
			return;
		}
		if (magazines.length > 1) this.chips(root, magazines);

		const shown = this.focus ? magazines.filter((m) => m.id === this.focus) : magazines;
		const anything = shown.some((m) => this.allArticles(m).length);
		if (!anything) {
			// Feeds that could not be read say why in their sections, rather than "Nothing here yet".
			const failed = shown.filter((m) => this.plugin.cache[m.id]?.error);
			if (failed.length && !this.plugin.isChecking()) {
				for (const magazine of failed) this.section(root, magazine);
			} else {
				this.emptyState(root);
			}
			return;
		}
		if (!this.focus && magazines.length > 1) this.justIn(root, magazines);
		for (const magazine of shown) this.section(root, magazine);
	}

	// ---------- parts of the page ----------

	private masthead(root: HTMLElement, magazines: Magazine[]): void {
		const t = this.t;
		const head = root.createDiv({ cls: "mr-masthead" });
		head.createDiv({ cls: "mr-dateline", text: t.dateline(this.now) });
		head.createDiv({
			cls: "mr-title",
			text: this.plugin.settings.title || "The Reading Room",
			attr: { role: "heading", "aria-level": "1" },
		});

		const status = head.createDiv({ cls: "mr-status" });
		const fresh = magazines.flatMap((m) => this.visible(m)).filter((a) => this.isNew(a)).length;
		const bits = [t.magazines(magazines.length), t.newToday(fresh)];
		if (this.plugin.lastCheck) bits.push(t.updated(t.clock(this.plugin.lastCheck, this.now)));
		status.createSpan({ text: bits.join(" · ") });

		const tools = head.createDiv({ cls: "mr-tools" });
		const refresh = this.toolButton(tools, "refresh-cw", t.checkForNew);
		if (this.plugin.isChecking()) refresh.addClass("is-spinning");
		this.onPress(refresh, () => {
			refresh.addClass("is-spinning");
			void this.plugin.checkNow(false);
		});

		const unread = this.toolButton(tools, this.plugin.settings.unreadOnly ? "eye-off" : "eye", t.unreadOnly, true);
		unread.toggleClass("is-active", this.plugin.settings.unreadOnly);
		unread.setAttr("aria-pressed", String(this.plugin.settings.unreadOnly));
		this.onPress(unread, () => {
			this.plugin.settings.unreadOnly = !this.plugin.settings.unreadOnly;
			void this.plugin.savePluginData();
			this.plugin.refreshViews();
		});

		const allRead = this.toolButton(tools, "check-check", t.markAllRead, true);
		this.onPress(allRead, () => this.markAllRead(this.scopeForMarkAll(magazines)));

		// The reading list: pressed again, or "Front page" on the list, goes back.
		const inList = this.focus === SAVED;
		const later = this.toolButton(tools, "bookmark", t.readLater, true);
		const count = this.savedEntries().length;
		if (count) later.createSpan({ cls: "mr-tool-count", text: String(count) });
		later.toggleClass("is-active", inList);
		later.setAttr("aria-pressed", String(inList));
		this.onPress(later, () => {
			this.focus = inList ? null : SAVED;
			this.render();
		});

		// A quiet way to support the plugin, tucked into the masthead's corner.
		const heart = head.createEl("a", { cls: "mr-support", href: KOFI_URL, attr: { "aria-label": t.support } });
		setIcon(heart, "heart");
		this.openOnClick(heart, KOFI_URL);
	}

	private chips(root: HTMLElement, magazines: Magazine[]): void {
		const nav = root.createDiv({ cls: "mr-chips", attr: { role: "tablist" } });
		const chip = (label: string, id: string | null, options: { color?: string; count?: number } = {}) => {
			const el = nav.createEl("button", { cls: "mr-chip", attr: { role: "tab" } });
			el.toggleClass("is-active", this.focus === id);
			el.setAttr("aria-selected", String(this.focus === id));
			if (options.color) {
				el.style.setProperty("--mr-accent", options.color);
				el.createSpan({ cls: "mr-chip-dot" });
			}
			el.createSpan({ text: label });
			if (options.count) el.createSpan({ cls: "mr-chip-count", text: String(options.count) });
			this.onPress(el, () => {
				this.focus = this.focus === id ? null : id;
				this.render();
			});
		};
		chip(this.t.everything, null);
		for (const magazine of magazines) {
			chip(shortName(magazine.name), magazine.id, {
				color: magazine.color,
				count: this.visible(magazine).filter((a) => this.isNew(a)).length,
			});
		}

		// Many magazines fill several lines: folded, the row keeps to one, and a chip shows the rest.
		const folded = this.plugin.settings.chipsFolded;
		const toggle = nav.createEl("button", { cls: "mr-chip mr-chip-toggle", attr: { "aria-expanded": String(!folded) } });
		const toggleText = toggle.createSpan();
		setIcon(toggle.createSpan({ cls: "mr-chip-toggle-icon" }), folded ? "chevron-down" : "chevron-up");
		this.onPress(toggle, () => {
			this.plugin.settings.chipsFolded = !folded;
			void this.plugin.savePluginData();
			this.plugin.refreshViews();
		});
		if (folded) {
			nav.addClass("is-folded");
			// Folded again when the row's width changes, or when it turns into the one-line row of a narrow pane.
			let layout = "";
			const fold = () => {
				const now = `${nav.clientWidth} ${getComputedStyle(nav).flexWrap}`;
				if (now === layout) return;
				layout = now;
				this.foldChips(nav, toggle, toggleText);
			};
			this.chipsResize = new ResizeObserver(fold);
			this.chipsResize.observe(nav);
		} else {
			toggleText.setText(this.t.showFewer);
			toggle.setAttr("aria-label", this.t.showFewer);
		}

		// On a phone the row scrolls sideways: bring the chosen chip into view.
		window.requestAnimationFrame(() => {
			const active = nav.querySelector<HTMLElement>(".mr-chip.is-active");
			if (active && nav.scrollWidth > nav.clientWidth) {
				nav.scrollLeft = active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
			}
		});
	}

	/**
	 * Keeps the folded row to its first line: chips that do not fit are hidden from the end,
	 * apart from the chosen one, and the last chip says how many are hidden. When all fit,
	 * as on a phone, where the row scrolls sideways instead, nothing is hidden.
	 */
	private foldChips(nav: HTMLElement, toggle: HTMLElement, toggleText: HTMLElement): void {
		const chips = Array.from(nav.querySelectorAll<HTMLElement>(".mr-chip:not(.mr-chip-toggle)"));
		for (const chip of chips) chip.removeClass("is-hidden");
		toggle.addClass("is-hidden");
		// A narrow pane's row is one line that scrolls sideways: every chip stays.
		if (!chips.length || nav.clientWidth === 0 || getComputedStyle(nav).flexWrap === "nowrap") return;
		const top = chips[0].offsetTop;
		const fits = () => chips.every((chip) => chip.hasClass("is-hidden") || chip.offsetTop === top);
		if (fits()) return;

		toggle.removeClass("is-hidden");
		const hideable = chips.slice(1).filter((chip) => !chip.hasClass("is-active")).reverse();
		let hidden = 0;
		const label = () => {
			toggleText.setText(`+${hidden}`);
			toggle.setAttr("aria-label", this.t.moreMagazines(hidden));
		};
		label();
		for (const chip of hideable) {
			if (fits() && toggle.offsetTop === top) break;
			chip.addClass("is-hidden");
			hidden++;
			label();
		}
	}

	private justIn(root: HTMLElement, magazines: Magazine[]): void {
		const entries = magazines
			.flatMap((magazine) => this.visible(magazine).map((article) => ({ article, source: sourceOf(magazine) })))
			.filter((e) => e.article.date !== undefined && e.article.date <= this.now + HOUR)
			.sort((a, b) => (b.article.date ?? 0) - (a.article.date ?? 0))
			.slice(0, JUST_IN);
		if (!entries.length) return;

		const section = root.createDiv({ cls: "mr-justin" });
		section.createDiv({ cls: "mr-label", text: this.t.justIn });
		const layout = section.createDiv({ cls: "mr-justin-layout" });
		this.card(layout, entries[0], "hero", false);
		const side = layout.createDiv({ cls: "mr-justin-side" });
		for (const entry of entries.slice(1)) this.card(side, entry, "compact", false);
	}

	/** The articles saved to read later, on a page of their own. */
	private readingList(root: HTMLElement): void {
		const t = this.t;
		const entries = this.savedEntries();
		const section = root.createDiv({ cls: "mr-section mr-reading-list" });
		section.style.setProperty("--mr-accent", "var(--interactive-accent)");

		const back = section.createEl("a", { cls: "mr-back", href: "#", text: `← ${t.frontPage}` });
		this.onPress(back, () => {
			this.focus = null;
			this.render();
		});

		const head = section.createDiv({ cls: "mr-section-head" });
		const name = head.createDiv({ cls: "mr-section-name", attr: { role: "heading", "aria-level": "2" } });
		setIcon(name.createSpan({ cls: "mr-section-icon" }), "bookmark");
		name.appendText(t.readLater);
		const links = head.createDiv({ cls: "mr-section-links" });
		if (entries.some((e) => !this.plugin.isRead(e.article.url))) {
			const mark = links.createEl("a", { cls: "mr-section-link", href: "#", text: t.markAllRead });
			this.onPress(mark, () => this.markAllRead(entries.map((e) => e.article.url)));
		}

		if (!entries.length) {
			section.createDiv({ cls: "mr-quiet", text: this.plugin.saved.length ? t.allCaughtUp : t.nothingSaved });
			return;
		}
		const grid = section.createDiv({ cls: "mr-grid" });
		for (const entry of entries) this.card(grid, entry, "card", true);
	}

	private section(root: HTMLElement, magazine: Magazine): void {
		const t = this.t;
		const section = root.createDiv({ cls: "mr-section" });
		section.style.setProperty("--mr-accent", magazine.color);

		const head = section.createDiv({ cls: "mr-section-head" });
		head.createDiv({ cls: "mr-section-name", text: magazine.name, attr: { role: "heading", "aria-level": "2" } });
		const links = head.createDiv({ cls: "mr-section-links" });

		const cache = this.plugin.cache[magazine.id];
		const limit = this.focus ? Infinity : this.options.articles ?? this.plugin.settings.perMagazine;
		const articles = this.visible(magazine).slice(0, limit);
		if (articles.some((a) => !this.plugin.isRead(a.url))) {
			const mark = links.createEl("a", { cls: "mr-section-link", href: "#", text: t.markAllRead });
			this.onPress(mark, () => this.markAllRead(this.visible(magazine).map((a) => a.url)));
		}
		if (magazine.homepage) {
			const link = links.createEl("a", {
				cls: "mr-section-link",
				href: magazine.homepage,
				text: `${hostName(magazine.homepage)} ↗`,
			});
			this.openOnClick(link, magazine.homepage);
		}

		if (cache?.error) {
			const kept = this.allArticles(magazine).length;
			section.createDiv({
				cls: "mr-warning",
				text: kept
					? t.lastCheckFailed(cache.error, cache.fetchedAt ?? this.now, this.now)
					: t.feedUnreadable(cache.error),
			});
		} else if (!cache) {
			section.createDiv({ cls: "mr-quiet", text: t.notChecked });
		} else if (!this.allArticles(magazine).length) {
			section.createDiv({ cls: "mr-quiet", text: t.feedEmpty });
		}
		if (!articles.length) {
			if (this.allArticles(magazine).length) section.createDiv({ cls: "mr-quiet", text: t.allCaughtUp });
			return;
		}

		const grid = section.createDiv({ cls: "mr-grid" });
		const source = sourceOf(magazine);
		articles.forEach((article, i) => this.card(grid, { article, source }, i === 0 ? "feature" : "card", false));
	}

	private emptyState(root: HTMLElement): void {
		const box = root.createDiv({ cls: "mr-empty" });
		if (this.plugin.isChecking()) box.setText(this.t.fetching);
		else if (!this.magazines().length) box.setText(this.t.noMagazines);
		else if (this.plugin.settings.unreadOnly) box.setText(this.t.allCaughtUp);
		else box.setText(this.t.nothingYet);
	}

	// ---------- one article ----------

	private card(parent: HTMLElement, entry: Entry, variant: Variant, inSaved: boolean): void {
		const { article, source } = entry;
		const t = this.t;
		const card = parent.createEl("a", { cls: `mr-card mr-${variant}`, href: article.url });
		card.style.setProperty("--mr-accent", source.color);
		const read = this.plugin.isRead(article.url);
		const saved = this.plugin.isSaved(article.url);
		card.toggleClass("is-read", read);
		card.toggleClass("is-saved", saved);
		this.openOnClick(card, article.url, () => {
			this.plugin.setRead(article.url, true);
			card.addClass("is-read");
			card.querySelector(".mr-new")?.remove();
		});
		card.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.menu(entry, inSaved).showAtMouseEvent(event);
		});

		const media = card.createDiv({ cls: "mr-media" });
		// A feed's small thumbnail is the last resort, after the picture the article page offers.
		const image = article.image ?? this.plugin.pageImages[article.url] ?? article.thumbnail;
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
				this.monogram(media, source);
			});
		} else {
			this.monogram(media, source);
		}

		// Every card with a full-size picture names its magazine on the picture.
		const tagged = variant !== "compact";
		if (tagged) media.createDiv({ cls: "mr-tag", text: shortName(source.name) });
		if (tagged) this.actions(media, entry, inSaved);

		const body = card.createDiv({ cls: "mr-body" });
		const when = article.date !== undefined ? t.relative(article.date, this.now) : "";
		const kicker = body.createDiv({ cls: "mr-kicker" });
		// Where the picture carries the tag, the label line gives the time; the name stays for narrow rows.
		kicker.createSpan({ cls: tagged ? "mr-kicker-name is-tagged" : "mr-kicker-name", text: shortName(source.name) });
		if (tagged && when) kicker.createSpan({ cls: "mr-kicker-time", text: when });
		if (!read && this.isNew(article)) kicker.createSpan({ cls: "mr-new", text: t.newBadge });
		if (saved) {
			const mark = kicker.createSpan({ cls: "mr-kicker-saved", attr: { "aria-label": t.savedMark } });
			setIcon(mark, "bookmark");
		}
		const more = kicker.createEl("button", { cls: "mr-more clickable-icon", attr: { "aria-label": t.moreActions } });
		setIcon(more, "more-horizontal");
		this.onPress(more, (event) => this.menu(entry, inSaved).showAtMouseEvent(event));

		body.createDiv({ cls: "mr-headline", text: article.title });
		if (this.plugin.settings.showSummaries && article.summary && variant !== "compact") {
			body.createDiv({ cls: "mr-standfirst", text: article.summary });
		}

		const meta: string[] = [];
		if (source.showAuthor && article.author) meta.push(shortByline(article.author, t));
		if (when && !tagged) meta.push(when);
		const metaEl = body.createDiv({ cls: "mr-meta" });
		for (const item of meta) metaEl.createSpan({ cls: "mr-meta-item", text: item });
		metaEl.createSpan({ cls: "mr-read-mark", text: t.readMark });
	}

	/** Buttons on the picture: on hover with a mouse, the menu button alone on a touch screen. */
	private actions(media: HTMLElement, entry: Entry, inSaved: boolean): void {
		const t = this.t;
		const url = entry.article.url;
		const bar = media.createDiv({ cls: "mr-actions" });
		const saved = this.plugin.isSaved(url);
		const read = this.plugin.isRead(url);

		const save = this.actionButton(bar, saved ? "bookmark-check" : "bookmark", saved ? t.unsave : t.saveForLater);
		save.toggleClass("is-active", saved);
		this.onPress(save, () => this.toggleSaved(entry));

		const readButton = this.actionButton(bar, "check", read ? t.markUnread : t.markRead);
		readButton.toggleClass("is-active", read);
		this.onPress(readButton, () => {
			this.plugin.setRead(url, !read);
			this.plugin.refreshViews();
		});

		const clip = this.actionButton(bar, "scissors", t.clipToVault);
		this.onPress(clip, () => void this.plugin.clip(entry.article));

		const remove = this.actionButton(bar, "x", inSaved ? t.removeFromSaved : t.removeFromPage);
		this.onPress(remove, () => (inSaved ? this.toggleSaved(entry) : this.remove(entry)));

		const more = this.actionButton(bar, "more-horizontal", t.moreActions);
		more.addClass("mr-action-more");
		this.onPress(more, (event) => this.menu(entry, inSaved).showAtMouseEvent(event));
	}

	private menu(entry: Entry, inSaved: boolean): Menu {
		const t = this.t;
		const url = entry.article.url;
		const saved = this.plugin.isSaved(url);
		const read = this.plugin.isRead(url);
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(saved ? t.unsave : t.saveForLater)
				.setIcon(saved ? "bookmark-minus" : "bookmark")
				.onClick(() => this.toggleSaved(entry)),
		);
		menu.addItem((item) =>
			item
				.setTitle(read ? t.markUnread : t.markRead)
				.setIcon(read ? "circle" : "check")
				.onClick(() => {
					this.plugin.setRead(url, !read);
					this.plugin.refreshViews();
				}),
		);
		if (!inSaved) {
			menu.addItem((item) => item.setTitle(t.removeFromPage).setIcon("x").onClick(() => this.remove(entry)));
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t.clipToVault)
				.setIcon("scissors")
				.onClick(() => void this.plugin.clip(entry.article)),
		);
		const templates = this.plugin.settings.clipTemplates;
		if (templates.length > 1) {
			for (const template of templates) {
				menu.addItem((item) =>
					item
						.setTitle(t.clipWith(template.name))
						.setIcon("file-plus")
						.onClick(() => void this.plugin.clip(entry.article, template)),
				);
			}
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t.copyLink)
				.setIcon("link")
				.onClick(() => {
					void navigator.clipboard.writeText(url).then(() => new Notice(t.linkCopied));
				}),
		);
		return menu;
	}

	// ---------- what the actions do ----------

	private toggleSaved(entry: Entry): void {
		const t = this.t;
		const url = entry.article.url;
		if (this.plugin.isSaved(url)) {
			const removed = this.plugin.unsave(url);
			this.plugin.refreshViews();
			if (removed) this.plugin.notifyWithUndo(t.unsavedNotice, () => this.plugin.restoreSaved(removed));
			return;
		}
		this.plugin.save(entry.article, entry.source);
		this.plugin.refreshViews();
		this.plugin.notifyWithUndo(t.savedNotice, () => void this.plugin.unsave(url));
	}

	private remove(entry: Entry): void {
		const url = entry.article.url;
		this.plugin.setRemoved(url, true);
		this.plugin.refreshViews();
		this.plugin.notifyWithUndo(this.t.removedNotice, () => this.plugin.setRemoved(url, false));
	}

	private markAllRead(urls: string[]): void {
		const changed = this.plugin.markAllRead(urls);
		this.plugin.refreshViews();
		if (changed.length) this.plugin.notifyWithUndo(this.t.markedAllRead(changed.length), () => this.plugin.unmarkRead(changed));
	}

	/** What "Mark all as read" in the masthead covers: what the page is showing. */
	private scopeForMarkAll(magazines: Magazine[]): string[] {
		if (this.focus === SAVED) return this.savedEntries().map((e) => e.article.url);
		const shown = this.focus ? magazines.filter((m) => m.id === this.focus) : magazines;
		return shown.flatMap((m) => this.visible(m).map((a) => a.url));
	}

	// ---------- small pieces ----------

	private monogram(media: HTMLElement, source: Source): void {
		media.addClass("is-monogram");
		media.createDiv({ cls: "mr-monogram", text: initials(source.name) });
	}

	private toolButton(parent: HTMLElement, icon: string, label: string, withText = false): HTMLElement {
		const button = parent.createEl("button", { cls: "mr-tool", attr: { "aria-label": label } });
		setIcon(button.createSpan({ cls: "mr-tool-icon" }), icon);
		if (withText) button.createSpan({ cls: "mr-tool-text", text: label });
		return button;
	}

	private actionButton(parent: HTMLElement, icon: string, label: string): HTMLElement {
		const button = parent.createEl("button", { cls: "mr-action", attr: { "aria-label": label } });
		setIcon(button, icon);
		return button;
	}

	/** A click that does its job and nothing else: no link opened, no cursor put into the editor. */
	private onPress(el: HTMLElement, action: (event: MouseEvent) => void): void {
		el.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			action(event);
		});
	}

	/** Opens in the browser, and stops the click from putting the editor's cursor into the block. */
	private openOnClick(el: HTMLElement, url: string, after?: () => void): void {
		this.onPress(el, () => {
			window.open(url);
			after?.();
		});
	}

	private magazines(): Magazine[] {
		const wanted = this.options.magazines;
		return this.plugin.settings.magazines.filter(
			(m) =>
				m.enabled &&
				(!wanted ||
					wanted.some((name) => m.name.toLowerCase() === name || shortName(m.name).toLowerCase() === name)),
		);
	}

	/** Everything kept for a magazine, apart from what was removed or left out. */
	private allArticles(magazine: Magazine): Article[] {
		const rules = this.rulesFor(magazine);
		return (this.plugin.cache[magazine.id]?.articles ?? []).filter(
			(a) => !this.plugin.isRemoved(a.url) && !rules.some((rule) => rule(a)),
		);
	}

	/** What the page shows for a magazine: as above, and only unread pieces when that is switched on. */
	private visible(magazine: Magazine): Article[] {
		const all = this.allArticles(magazine);
		return this.plugin.settings.unreadOnly ? all.filter((a) => !this.plugin.isRead(a.url)) : all;
	}

	private savedEntries(): Entry[] {
		return this.plugin.saved
			.filter((s) => !this.plugin.settings.unreadOnly || !this.plugin.isRead(s.article.url))
			.map((s) => {
				const magazine = this.plugin.settings.magazines.find((m) => m.id === s.magazineId);
				return {
					article: s.article,
					source: magazine ? sourceOf(magazine) : { id: s.magazineId, name: s.magazineName, color: s.color, showAuthor: true },
				};
			});
	}

	private rulesFor(magazine: Magazine): ((article: Article) => boolean)[] {
		let rules = this.leaveOutRules.get(magazine.id);
		if (!rules) {
			rules = (magazine.leaveOut ?? []).map(leaveOutRule).filter((r): r is (a: Article) => boolean => !!r);
			this.leaveOutRules.set(magazine.id, rules);
		}
		return rules;
	}

	private isNew(article: Article): boolean {
		return article.date !== undefined && this.now - article.date < DAY && !this.plugin.isRead(article.url);
	}
}

/** "/podcasts/" matches the web address; anything else matches whole words in the headline. */
export function leaveOutRule(rule: string): ((article: Article) => boolean) | null {
	const text = rule.trim().toLowerCase();
	if (!text) return null;
	if (text.includes("/")) return (article) => article.url.toLowerCase().includes(text);
	const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
	return (article) => pattern.test(article.title);
}

function sourceOf(magazine: Magazine): Source {
	return { id: magazine.id, name: magazine.name, color: magazine.color, showAuthor: magazine.showAuthor };
}

function shortName(name: string): string {
	return name.replace(/^The\s+/i, "").replace(/\s+Magazine$/i, "");
}

/** "A, B, C and D" becomes "A and others", so a long byline stays on one line. */
function shortByline(author: string, t: Strings): string {
	const people = author.split(/\s*[,;]\s*|\s+and\s+|\s+y\s+|\s*&\s*/).filter(Boolean);
	return people.length > 2 ? t.andOthers(people[0]) : author;
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

export function formatStamp(time: number): string {
	const date = new Date(time);
	const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
	const hm = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	return `${day} at ${hm}`;
}
