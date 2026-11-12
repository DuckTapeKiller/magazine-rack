import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { ClipError, clipArticle, parseTemplates, renderClip } from "./clip";
import { fetchFeed, fetchPageImage } from "./feeds";
import { strings, type Strings } from "./i18n";
import { MagazineRackSettingTab } from "./settings";
import {
	DEFAULT_SETTINGS,
	PALETTE,
	copyDefaults,
	type Article,
	type ClipTemplate,
	type Magazine,
	type MagazineCache,
	type PluginData,
	type SavedArticle,
	type Settings,
} from "./types";
import { FrontPage, parseOptions } from "./view";

/** Newest articles kept from each feed at every check. */
const FROM_FEED = 30;
/** Most articles kept per magazine, history included. */
const KEEP_MAX = 150;
const DAY = 24 * 60 * 60 * 1000;
/** How often to see whether a check is due; the check itself follows the setting. */
const TICK_MS = 60_000;
/** Article pages read at once when looking for pictures. */
const PAGE_CONCURRENCY = 4;
const MAX_LIST = 3000;
export const PAGE_CLASS = "magazine-rack-page";
const BLOCK = "```magazine-rack\n```";

interface CheckResult {
	checked: number;
	failed: string[];
	fresh: number;
}

export default class MagazineRack extends Plugin {
	settings: Settings = copyDefaults();
	cache: Record<string, MagazineCache> = {};
	pageImages: Record<string, string | null> = {};
	saved: SavedArticle[] = [];
	lastCheck: number | undefined;
	readonly views = new Set<FrontPage>();
	/** For checking the clipper against Web Clipper's own test pages. */
	readonly clipper = { renderClip, parseTemplates };
	private read = new Set<string>();
	private removed = new Set<string>();
	private running: Promise<CheckResult> | null = null;
	/** Which note each tab was last switched to reading view for, so a deliberate switch to editing is left alone. */
	private forcedReading = new WeakMap<WorkspaceLeaf, string>();

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.addSettingTab(new MagazineRackSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor("magazine-rack", (source, el, ctx) => {
			ctx.addChild(new FrontPage(el, this, parseOptions(source)));
		});

		this.addRibbonIcon("newspaper", "Open the reading room", () => void this.openNote());
		this.addCommand({
			id: "check-now",
			name: "Check for new articles now",
			callback: () => void this.checkNow(true),
		});
		this.addCommand({
			id: "open-note",
			name: "Open the reading room",
			callback: () => void this.openNote(),
		});

		this.registerEvent(
			this.app.workspace.on("file-open", () => window.setTimeout(() => this.enforceReading(), 0)),
		);
		this.app.workspace.onLayoutReady(() => {
			this.enforceReading();
			void this.checkIfDue();
			// A one-minute tick survives the computer sleeping and picks up a changed interval at once.
			this.registerInterval(window.setInterval(() => void this.checkIfDue(), TICK_MS));
		});
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadPluginData();
		this.refreshViews();
	}

	t(): Strings {
		return strings(this.settings.language);
	}

	notePath(): string {
		let path = this.settings.notePath.trim() || DEFAULT_SETTINGS.notePath;
		if (!path.toLowerCase().endsWith(".md")) path += ".md";
		return normalizePath(path);
	}

	isChecking(): boolean {
		return this.running !== null;
	}

	/** Redraws every open front page from the saved articles. */
	refreshViews(): void {
		for (const view of this.views) view.render();
	}

	// ---------- read, saved and removed ----------

	isRead(url: string): boolean {
		return this.read.has(url);
	}

	setRead(url: string, read: boolean): void {
		if (read === this.read.has(url)) return;
		if (read) this.read.add(url);
		else this.read.delete(url);
		void this.savePluginData();
	}

	/** Marks many as read; returns the ones that were unread, for Undo. */
	markAllRead(urls: string[]): string[] {
		const changed = urls.filter((url) => !this.read.has(url));
		for (const url of changed) this.read.add(url);
		if (changed.length) void this.savePluginData();
		return changed;
	}

	unmarkRead(urls: string[]): void {
		for (const url of urls) this.read.delete(url);
		void this.savePluginData();
	}

	isSaved(url: string): boolean {
		return this.saved.some((s) => s.article.url === url);
	}

	save(article: Article, magazine: { id: string; name: string; color: string }): void {
		if (this.isSaved(article.url)) return;
		this.saved.unshift({
			article: { ...article },
			magazineId: magazine.id,
			magazineName: magazine.name,
			color: magazine.color,
			savedAt: Date.now(),
		});
		void this.savePluginData();
	}

	/** Takes an article off the saved list; returns it, for Undo. */
	unsave(url: string): SavedArticle | undefined {
		const index = this.saved.findIndex((s) => s.article.url === url);
		if (index === -1) return undefined;
		const [entry] = this.saved.splice(index, 1);
		void this.savePluginData();
		return entry;
	}

	restoreSaved(entry: SavedArticle): void {
		if (this.isSaved(entry.article.url)) return;
		this.saved.push(entry);
		this.saved.sort((a, b) => b.savedAt - a.savedAt);
		void this.savePluginData();
	}

	isRemoved(url: string): boolean {
		return this.removed.has(url);
	}

	setRemoved(url: string, removed: boolean): void {
		if (removed) this.removed.add(url);
		else this.removed.delete(url);
		void this.savePluginData();
	}

	/** A short message with an Undo link. */
	notifyWithUndo(text: string, undo: () => void): void {
		const fragment = document.createDocumentFragment();
		fragment.appendText(`${text} `);
		const link = fragment.createEl("a", { text: this.t().undo, href: "#", cls: "mr-undo" });
		const notice = new Notice(fragment, 7000);
		link.addEventListener("click", (event) => {
			event.preventDefault();
			undo();
			notice.hide();
			this.refreshViews();
		});
	}

	// ---------- clipping ----------

	async clip(article: Article, template?: ClipTemplate): Promise<void> {
		const t = this.t();
		const progress = new Notice(t.clipping, 0);
		try {
			const outcome = await clipArticle(this.app, article.url, this.settings.clipTemplates, template);
			progress.hide();
			const fragment = document.createDocumentFragment();
			fragment.appendText(`${t.clipped(outcome.file.path)} `);
			const link = fragment.createEl("a", { text: t.open, href: "#", cls: "mr-undo" });
			const done = new Notice(fragment, 8000);
			link.addEventListener("click", (event) => {
				event.preventDefault();
				done.hide();
				void this.app.workspace.getLeaf("tab").openFile(outcome.file);
			});
			if (outcome.words < 150) new Notice(t.clipShort(outcome.words), 12000);
			if (this.settings.openAfterClip) await this.app.workspace.getLeaf("tab").openFile(outcome.file);
		} catch (error) {
			progress.hide();
			console.error("Magazine Rack: clip failed", error);
			if (error instanceof ClipError && error.status) new Notice(t.clipRefused(error.status), 12000);
			else new Notice(t.clipFailed(message(error)), 12000);
		}
	}

	// ---------- checking the feeds ----------

	private async checkIfDue(): Promise<void> {
		const due = !this.lastCheck || Date.now() - this.lastCheck >= this.settings.refreshMinutes * 60_000;
		if (due) await this.checkNow(false);
	}

	/** Downloads every switched-on magazine's feeds, then any missing pictures. */
	async checkNow(manual: boolean): Promise<CheckResult> {
		if (this.running) return this.running;
		this.running = this.runCheck(manual).finally(() => {
			this.running = null;
			this.refreshViews();
		});
		this.refreshViews();
		return this.running;
	}

	private async runCheck(manual: boolean): Promise<CheckResult> {
		const t = this.t();
		const progress = manual ? new Notice(t.checking, 0) : null;
		const magazines = this.settings.magazines.filter((m) => m.enabled);
		const now = Date.now();
		const cutoff = now - this.settings.historyDays * DAY;
		const outcomes = await Promise.all(magazines.map((m) => this.fetchMagazine(m)));

		const result: CheckResult = { checked: magazines.length, failed: [], fresh: 0 };
		magazines.forEach((magazine, i) => {
			const outcome = outcomes[i];
			const previous = this.cache[magazine.id];
			if (outcome.articles) {
				const known = new Map((previous?.articles ?? []).map((a) => [a.url, a]));
				if (previous?.articles.length) {
					result.fresh += outcome.articles
						.slice(0, this.settings.perMagazine)
						.filter((a) => !known.has(a.url)).length;
				}
				const fromFeed = outcome.articles
					.slice(0, FROM_FEED)
					.map((a) => ({ ...a, firstSeen: known.get(a.url)?.firstSeen ?? now }));
				// Articles that have left the feed stay for the chosen number of days.
				const inFeed = new Set(fromFeed.map((a) => a.url));
				const history = (previous?.articles ?? []).filter(
					(a) => !inFeed.has(a.url) && (a.date ?? a.firstSeen ?? 0) >= cutoff,
				);
				this.cache[magazine.id] = {
					articles: sortArticles([...fromFeed, ...history], true).slice(0, KEEP_MAX),
					fetchedAt: now,
				};
			} else {
				result.failed.push(magazine.name);
				this.cache[magazine.id] = {
					articles: previous?.articles ?? [],
					fetchedAt: previous?.fetchedAt,
					error: outcome.error,
				};
			}
		});
		// Forget articles for magazines that were removed.
		const ids = new Set(this.settings.magazines.map((m) => m.id));
		for (const id of Object.keys(this.cache)) if (!ids.has(id)) delete this.cache[id];

		this.lastCheck = now;
		await this.savePluginData();
		progress?.hide();
		if (manual) {
			const parts = [t.newArticles(result.fresh)];
			if (result.failed.length) parts.push(t.couldNotReach(result.failed.join(", ")));
			new Notice(`${parts.join("; ")}.`);
		}

		// Show the new headlines at once; pictures from article pages follow.
		this.refreshViews();
		await this.fetchMissingPictures();
		return result;
	}

	/** One magazine may have several feeds; a feed that fails keeps the articles it gave last time. */
	private async fetchMagazine(magazine: Magazine): Promise<{ articles?: Article[]; error?: string }> {
		const feeds = magazine.feeds.filter((f) => f.trim());
		if (!feeds.length) return { error: "no feed address" };
		const settled = await Promise.allSettled(feeds.map((url) => fetchFeed(url)));
		const previous = this.cache[magazine.id]?.articles ?? [];

		const merged: Article[] = [];
		const errors: string[] = [];
		settled.forEach((outcome, i) => {
			if (outcome.status === "fulfilled") {
				merged.push(...outcome.value.map((a) => ({ ...a, feed: feeds[i] })));
			} else {
				errors.push(message(outcome.reason));
				console.warn(`Magazine Rack: ${magazine.name}: ${feeds[i]}:`, outcome.reason);
				merged.push(...previous.filter((a) => a.feed === feeds[i]));
			}
		});
		if (errors.length === feeds.length) return { error: errors[0] };
		return { articles: sortArticles(dedupe(merged), feeds.length > 1) };
	}

	/**
	 * Some feeds carry no pictures. For the articles kept that lack one, read the
	 * picture the article page offers for sharing, once per article.
	 */
	private async fetchMissingPictures(): Promise<void> {
		const wanted: string[] = [];
		const kept = new Set<string>();
		const consider = (article: Article) => {
			kept.add(article.url);
			if (!article.image && !(article.url in this.pageImages)) wanted.push(article.url);
		};
		for (const magazine of this.settings.magazines) {
			for (const article of this.cache[magazine.id]?.articles ?? []) consider(article);
		}
		for (const entry of this.saved) consider(entry.article);
		// Forget pictures of articles that are no longer kept anywhere.
		for (const url of Object.keys(this.pageImages)) if (!kept.has(url)) delete this.pageImages[url];
		if (!wanted.length) return;

		let found = 0;
		let next = 0;
		const worker = async () => {
			while (next < wanted.length) {
				const url = wanted[next++];
				try {
					this.pageImages[url] = await fetchPageImage(url);
					// Redraw every few pictures so they appear while the rest load.
					if (this.pageImages[url] && ++found % 6 === 0) this.refreshViews();
				} catch {
					this.pageImages[url] = null;
				}
			}
		};
		await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, worker));
		await this.savePluginData();
	}

	// ---------- the note ----------

	isReadingRoom(file: TFile): boolean {
		if (file.path === this.notePath()) return true;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const classes: unknown = frontmatter?.cssclasses ?? frontmatter?.cssclass;
		return (Array.isArray(classes) ? classes : [classes]).includes(PAGE_CLASS);
	}

	/**
	 * Switches tabs showing the reading room to reading view, once each time the
	 * note is opened in them, so choosing editing view on purpose is respected.
	 */
	private enforceReading(): void {
		if (!this.settings.alwaysReading) return;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) continue;
			if (!this.isReadingRoom(view.file)) {
				this.forcedReading.delete(leaf);
				continue;
			}
			if (this.forcedReading.get(leaf) === view.file.path) continue;
			this.forcedReading.set(leaf, view.file.path);
			if (view.getMode() !== "preview") {
				const state = leaf.getViewState();
				void leaf.setViewState({ ...state, state: { ...state.state, mode: "preview" } });
			}
		}
	}

	/**
	 * Makes the note if it does not exist. In an existing note without the page,
	 * the page is added at the end and nothing else is touched.
	 */
	async ensureNote(): Promise<TFile> {
		const path = this.notePath();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
			return this.app.vault.create(path, `---\ncssclasses:\n  - ${PAGE_CLASS}\n---\n\n${BLOCK}\n`);
		}
		if (!(existing instanceof TFile)) throw new Error("that path is a folder");
		const text = await this.app.vault.read(existing);
		if (!/^```magazine-rack\s*$/m.test(text)) {
			await this.app.vault.process(existing, (data) => `${data.replace(/\s+$/, "")}\n\n${BLOCK}\n`);
			await this.app.fileManager.processFrontMatter(existing, (frontmatter: Record<string, unknown>) => {
				const raw = frontmatter.cssclasses;
				const classes = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
				if (!classes.includes(PAGE_CLASS)) frontmatter.cssclasses = [...classes, PAGE_CLASS];
			});
		}
		return existing;
	}

	/** Opens the note in reading view, where the page is meant to be read. */
	async openNote(): Promise<void> {
		let file: TFile;
		try {
			file = await this.ensureNote();
		} catch (error) {
			new Notice(`Magazine Rack could not open ${this.notePath()}: ${message(error)}`);
			return;
		}
		const open = this.app.workspace
			.getLeavesOfType("markdown")
			.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
		const leaf = open ?? this.app.workspace.getLeaf(false);
		if (!open) await leaf.openFile(file, { state: { mode: "preview" } });
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		void this.checkIfDue();
	}

	// ---------- saved data ----------

	async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginData> | null | undefined;
		const saved: Partial<Settings> = raw?.settings ?? {};
		const defaults = copyDefaults();
		this.settings = {
			...defaults,
			...saved,
			language: saved.language === "es" ? "es" : "en",
			historyDays: Number.isFinite(saved.historyDays) ? Math.max(0, Number(saved.historyDays)) : defaults.historyDays,
			clipTemplates: Array.isArray(saved.clipTemplates) ? saved.clipTemplates : [],
			magazines: Array.isArray(saved.magazines) ? saved.magazines.map(cleanMagazine) : defaults.magazines,
		};
		this.cache = raw?.cache && typeof raw.cache === "object" ? raw.cache : {};
		this.pageImages = raw?.pageImages && typeof raw.pageImages === "object" ? raw.pageImages : {};
		const read = raw?.read;
		this.read = new Set(Array.isArray(read) ? read.map(String) : []);
		const removed = raw?.removed;
		this.removed = new Set(Array.isArray(removed) ? removed.map(String) : []);
		const savedList = raw?.saved;
		this.saved = Array.isArray(savedList)
			? savedList.filter((s) => s && typeof s === "object" && s.article && typeof s.article.url === "string")
			: [];
		this.lastCheck = typeof raw?.lastCheck === "number" ? raw.lastCheck : undefined;
	}

	async savePluginData(): Promise<void> {
		const data: PluginData = {
			settings: this.settings,
			cache: this.cache,
			pageImages: this.pageImages,
			read: Array.from(this.read).slice(-MAX_LIST),
			saved: this.saved,
			removed: Array.from(this.removed).slice(-MAX_LIST),
			lastCheck: this.lastCheck,
		};
		await this.saveData(data);
	}
}

function cleanMagazine(m: Partial<Magazine>, index: number): Magazine {
	return {
		id: String(m.id || `magazine-${Math.random().toString(36).slice(2, 10)}`),
		name: String(m.name || "Untitled magazine"),
		homepage: String(m.homepage || ""),
		feeds: Array.isArray(m.feeds) ? m.feeds.map(String) : [],
		showAuthor: m.showAuthor !== false,
		enabled: m.enabled !== false,
		color: /^#[0-9a-f]{6}$/i.test(String(m.color)) ? String(m.color) : PALETTE[index % PALETTE.length],
		leaveOut: Array.isArray(m.leaveOut) ? m.leaveOut.map(String).filter((s) => s.trim()) : [],
	};
}

function dedupe(articles: Article[]): Article[] {
	const seen = new Set<string>();
	return articles.filter((a) => {
		if (seen.has(a.url)) return false;
		seen.add(a.url);
		return true;
	});
}

/** Newest first. A single feed without dates keeps its own order. */
function sortArticles(articles: Article[], merged: boolean): Article[] {
	const dated = articles.filter((a) => a.date !== undefined);
	if (!merged && dated.length < articles.length) return articles;
	const undated = articles.filter((a) => a.date === undefined);
	return [...dated.sort((a, b) => (b.date ?? 0) - (a.date ?? 0)), ...undated];
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
