import { MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import { fetchFeed, fetchPageImage } from "./feeds";
import { MagazineRackSettingTab } from "./settings";
import {
	DEFAULT_SETTINGS,
	PALETTE,
	copyDefaults,
	type Article,
	type Magazine,
	type MagazineCache,
	type PluginData,
	type Settings,
} from "./types";
import { FrontPage, parseOptions } from "./view";

/** How many articles to keep per magazine, so raising the count in settings needs no new download. */
const KEEP = 30;
/** How often to see whether a check is due; the check itself follows the setting. */
const TICK_MS = 60_000;
/** Article pages read at once when looking for pictures. */
const PAGE_CONCURRENCY = 4;
const MAX_READ = 2000;
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
	lastCheck: number | undefined;
	readonly views = new Set<FrontPage>();
	private read = new Set<string>();
	private running: Promise<CheckResult> | null = null;

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

		this.app.workspace.onLayoutReady(() => {
			void this.checkIfDue();
			// A one-minute tick survives the computer sleeping and picks up a changed interval at once.
			this.registerInterval(window.setInterval(() => void this.checkIfDue(), TICK_MS));
		});
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadPluginData();
		this.refreshViews();
	}

	notePath(): string {
		let path = this.settings.notePath.trim() || DEFAULT_SETTINGS.notePath;
		if (!path.toLowerCase().endsWith(".md")) path += ".md";
		return normalizePath(path);
	}

	isChecking(): boolean {
		return this.running !== null;
	}

	isRead(url: string): boolean {
		return this.read.has(url);
	}

	markRead(url: string): void {
		if (this.read.has(url)) return;
		this.read.add(url);
		void this.savePluginData();
	}

	/** Redraws every open front page from the saved articles. */
	refreshViews(): void {
		for (const view of this.views) view.render();
	}

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
		const progress = manual ? new Notice("Checking your magazines for new articles…", 0) : null;
		const magazines = this.settings.magazines.filter((m) => m.enabled);
		const now = Date.now();
		const outcomes = await Promise.all(magazines.map((m) => this.fetchMagazine(m)));

		const result: CheckResult = { checked: magazines.length, failed: [], fresh: 0 };
		magazines.forEach((magazine, i) => {
			const outcome = outcomes[i];
			const previous = this.cache[magazine.id];
			if (outcome.articles) {
				if (previous?.articles.length) {
					const known = new Set(previous.articles.map((a) => a.url));
					result.fresh += outcome.articles
						.slice(0, this.settings.perMagazine)
						.filter((a) => !known.has(a.url)).length;
				}
				this.cache[magazine.id] = { articles: outcome.articles.slice(0, KEEP), fetchedAt: now };
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
			const parts = [result.fresh === 1 ? "1 new article" : `${result.fresh || "No"} new articles`];
			if (result.failed.length) parts.push(`could not reach ${result.failed.join(", ")}`);
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
	 * Some feeds carry no pictures. For the articles on show that lack one, read the
	 * picture the article page offers for sharing, once per article.
	 */
	private async fetchMissingPictures(): Promise<void> {
		const wanted: string[] = [];
		const onShow = new Set<string>();
		for (const magazine of this.settings.magazines) {
			for (const article of this.cache[magazine.id]?.articles ?? []) {
				onShow.add(article.url);
				if (!article.image && !(article.url in this.pageImages)) wanted.push(article.url);
			}
		}
		// Forget pictures of articles that have left the feeds.
		for (const url of Object.keys(this.pageImages)) if (!onShow.has(url)) delete this.pageImages[url];
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

	async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginData> | null | undefined;
		const saved: Partial<Settings> = raw?.settings ?? {};
		this.settings = {
			...copyDefaults(),
			...saved,
			magazines: Array.isArray(saved.magazines) ? saved.magazines.map(cleanMagazine) : copyDefaults().magazines,
		};
		this.cache = raw?.cache && typeof raw.cache === "object" ? raw.cache : {};
		this.pageImages = raw?.pageImages && typeof raw.pageImages === "object" ? raw.pageImages : {};
		const read = raw?.read;
		this.read = new Set(Array.isArray(read) ? read.map(String) : []);
		this.lastCheck = typeof raw?.lastCheck === "number" ? raw.lastCheck : undefined;
	}

	async savePluginData(): Promise<void> {
		const read = Array.from(this.read).slice(-MAX_READ);
		const data: PluginData = {
			settings: this.settings,
			cache: this.cache,
			pageImages: this.pageImages,
			read,
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
