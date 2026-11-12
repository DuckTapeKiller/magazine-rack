import {
	App,
	Modal,
	Notice,
	PluginSettingTab,
	Setting,
	requireApiVersion,
	setIcon,
	type SettingDefinitionItem,
} from "obsidian";
import { fallbackTemplate, parseTemplates } from "./clip";
import { discoverFeeds, fetchFeed } from "./feeds";
import type MagazineRack from "./main";
import { formatStamp } from "./view";
import { DEFAULT_CLIP_TEMPLATE, DEFAULT_SETTINGS, KOFI_URL, PALETTE, copyDefaults, type ClipTemplate, type Magazine } from "./types";

const INTERVALS: Record<string, string> = {
	"15": "Every 15 minutes",
	"30": "Every 30 minutes",
	"60": "Every hour",
	"120": "Every 2 hours",
	"360": "Every 6 hours",
	"720": "Every 12 hours",
};

/** One row of the settings, drawn the same way by both ways of showing them. */
interface Row {
	name: string;
	/** Plain text: shown under the name, and searched in Obsidian 1.13 and later. */
	desc?: string;
	searchable?: boolean;
	render: (setting: Setting) => void;
}

/** Rows under one heading. */
interface Section {
	heading?: string;
	rows: Row[];
}

export class MagazineRackSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: MagazineRack,
	) {
		super(app, plugin);
	}

	// ---------- Obsidian 1.13 and later: Obsidian draws the rows, and can search them ----------

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.sections().map((section) => ({
			type: "group",
			heading: section.heading,
			items: section.rows.map((row) => ({
				name: row.name,
				desc: row.desc,
				searchable: row.searchable,
				render: (setting: Setting) => this.draw(setting, row),
			})),
		}));
	}

	/** Draws the settings again after a change to what they show. */
	refresh(): void {
		if (requireApiVersion("1.13.0")) {
			this.update();
		} else if (this.containerEl.isShown()) {
			this.drawAll();
		}
	}

	// ---------- before Obsidian 1.13, which calls display() ----------

	display(): void {
		this.drawAll();
	}

	private drawAll(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const section of this.sections()) {
			if (section.heading) new Setting(containerEl).setName(section.heading).setHeading();
			for (const row of section.rows) this.draw(new Setting(containerEl), row);
		}
	}

	private draw(setting: Setting, row: Row): void {
		if (row.name) setting.setName(row.name);
		if (row.desc) setting.setDesc(row.desc);
		row.render(setting);
	}

	// ---------- the rows ----------

	private sections(): Section[] {
		return [
			{ rows: this.generalRows() },
			{ heading: "Magazines", rows: this.magazineRows() },
			{ heading: "Clip to vault", rows: this.clipRows() },
			{ heading: "Support", rows: [this.supportRow()] },
		];
	}

	private generalRows(): Row[] {
		const settings = this.plugin.settings;
		return [
			{
				name: "Note",
				desc: "Where the reading room lives. The note is made the first time you open it. In a note you already have, the page is added at the end and the rest is left alone. You can also put a magazine-rack code block in any note.",
				render: (setting) =>
					setting.addText((text) =>
						text
							.setPlaceholder(DEFAULT_SETTINGS.notePath)
							.setValue(settings.notePath)
							.onChange(async (value) => {
								settings.notePath = value;
								await this.plugin.savePluginData();
							}),
					),
			},
			{
				name: "Page title",
				desc: "The name across the top of the page.",
				render: (setting) =>
					setting.addText((text) =>
						text
							.setPlaceholder(DEFAULT_SETTINGS.title)
							.setValue(settings.title)
							.onChange(async (value) => {
								settings.title = value;
								await this.plugin.savePluginData();
								this.plugin.refreshViews();
							}),
					),
			},
			{
				name: "Articles per magazine",
				render: (setting) => {
					// Obsidian 1.13 and later show a slider's value beside it; before that, the description does.
					const showValue = (value: number) => {
						if (!requireApiVersion("1.13.0")) setting.setDesc(String(value));
					};
					showValue(settings.perMagazine);
					setting.addSlider((slider) =>
						slider
							.setLimits(3, 30, 1)
							.setValue(settings.perMagazine)
							.onChange(async (value) => {
								settings.perMagazine = value;
								showValue(value);
								await this.plugin.savePluginData();
								this.plugin.refreshViews();
							}),
					);
				},
			},
			{
				name: "Check for new articles",
				desc: "Only while Obsidian is open. It also checks when Obsidian starts, if the last check is older than this.",
				render: (setting) =>
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions(INTERVALS)
							.setValue(String(settings.refreshMinutes))
							.onChange(async (value) => {
								settings.refreshMinutes = Number(value);
								await this.plugin.savePluginData();
								this.plugin.refreshViews();
							}),
					),
			},
			{
				name: "Show standfirsts",
				desc: "The short introduction under each headline, where the feed gives one.",
				render: (setting) =>
					setting.addToggle((toggle) =>
						toggle.setValue(settings.showSummaries).onChange(async (value) => {
							settings.showSummaries = value;
							await this.plugin.savePluginData();
							this.plugin.refreshViews();
						}),
					),
			},
			{
				name: "Keep articles for",
				desc: "Feeds only hold their newest pieces, so an article can vanish within hours. This keeps it on the page for a while after it leaves the feed.",
				render: (setting) =>
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions({
								"0": "Only while it is in the feed",
								"1": "1 day",
								"3": "3 days",
								"7": "A week",
								"14": "Two weeks",
								"30": "A month",
							})
							.setValue(String(settings.historyDays))
							.onChange(async (value) => {
								settings.historyDays = Number(value);
								await this.plugin.savePluginData();
							}),
					),
			},
			{
				name: "Language of the page",
				desc: "For the dates, labels and menus on the page. These settings stay in English.",
				render: (setting) =>
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions({ en: "English", es: "Español" })
							.setValue(settings.language)
							.onChange(async (value) => {
								settings.language = value === "es" ? "es" : "en";
								await this.plugin.savePluginData();
								this.plugin.refreshViews();
							}),
					),
			},
			{
				name: "Always open in reading view",
				desc: "Switches the note to reading view each time you open it. If you switch to editing on purpose, it stays that way until you open the note again.",
				render: (setting) =>
					setting.addToggle((toggle) =>
						toggle.setValue(settings.alwaysReading).onChange(async (value) => {
							settings.alwaysReading = value;
							await this.plugin.savePluginData();
						}),
					),
			},
			{
				name: "Check now",
				desc: this.plugin.lastCheck ? `Last checked ${formatStamp(this.plugin.lastCheck)}.` : "Not checked yet.",
				render: (setting) =>
					setting
						.addButton((button) =>
							button
								.setButtonText("Check now")
								.setCta()
								.onClick(async () => {
									button.setDisabled(true).setButtonText("Checking…");
									await this.plugin.checkNow(true);
									this.refresh();
								}),
						)
						.addButton((button) =>
							button.setButtonText("Open the note").onClick(async () => {
								await this.plugin.openNote();
							}),
						),
			},
		];
	}

	private magazineRows(): Row[] {
		const settings = this.plugin.settings;
		const rows: Row[] = [this.magazineGuide()];

		settings.magazines.forEach((magazine, index) => {
			rows.push({
				name: magazine.name,
				desc: this.status(magazine),
				render: (setting) => {
					setting.setDesc(this.describe(magazine));
					setting.descEl.addClass("magazine-rack-desc");
					const dot = createSpan({ cls: "magazine-rack-swatch" });
					dot.style.setProperty("--mr-accent", magazine.color);
					setting.nameEl.prepend(dot);
					setting
						.addToggle((toggle) =>
							toggle
								.setTooltip("Show in the note")
								.setValue(magazine.enabled)
								.onChange(async (value) => {
									magazine.enabled = value;
									await this.afterChange(value && !this.plugin.cache[magazine.id]);
								}),
						)
						.addExtraButton((button) =>
							button
								.setIcon("arrow-up")
								.setTooltip("Move up")
								.setDisabled(index === 0)
								.onClick(() => void this.move(index, -1)),
						)
						.addExtraButton((button) =>
							button
								.setIcon("arrow-down")
								.setTooltip("Move down")
								.setDisabled(index === settings.magazines.length - 1)
								.onClick(() => void this.move(index, 1)),
						)
						.addExtraButton((button) =>
							button
								.setIcon("pencil")
								.setTooltip("Edit")
								.onClick(() => {
									new MagazineModal(this.app, magazine, async (edited) => {
										const feedsChanged = edited.feeds.join("\n") !== magazine.feeds.join("\n");
										Object.assign(magazine, edited);
										if (feedsChanged) delete this.plugin.cache[magazine.id];
										await this.afterChange(feedsChanged);
									}).open();
								}),
						)
						.addExtraButton((button) =>
							button
								.setIcon("trash")
								.setTooltip("Remove")
								.onClick(() => {
									new ConfirmModal(this.app, `Remove ${magazine.name} from the list?`, "Remove", async () => {
										settings.magazines.splice(settings.magazines.indexOf(magazine), 1);
										delete this.plugin.cache[magazine.id];
										await this.afterChange(false);
									}).open();
								}),
						);
				},
			});
		});

		const ids = new Set(settings.magazines.map((m) => m.id));
		const missing = copyDefaults().magazines.filter((m) => !ids.has(m.id));
		rows.push({
			name: "",
			searchable: false,
			render: (setting) => {
				setting.addButton((button) =>
					button.setButtonText("Add a magazine").onClick(() => {
						new MagazineModal(
							this.app,
							null,
							async (added) => {
								settings.magazines.push(added);
								await this.afterChange(true);
							},
							PALETTE[settings.magazines.length % PALETTE.length],
						).open();
					}),
				);
				if (missing.length) {
					setting.addButton((button) =>
						button
							.setButtonText(`Add back the original ${missing.length === 1 ? "magazine" : "magazines"}`)
							.onClick(async () => {
								settings.magazines.push(...missing);
								await this.afterChange(true);
							}),
					);
				}
			},
		});
		return rows;
	}

	/** A short how-to for adding a magazine, shown above the list. */
	private magazineGuide(): Row {
		return {
			name: "Adding a magazine or any other source",
			render: (setting) => {
				const box = blockRow(setting);
				box.createDiv({ cls: "magazine-rack-guide-title", text: "Adding a magazine or any other source" });
				box.createEl("p", {
					text: "The page reads RSS or Atom feeds, which almost every magazine, newspaper, journal and blog publishes, even when it does not advertise one.",
				});
				const steps = box.createEl("ol");
				const step = (strong: string, rest: string) => {
					const li = steps.createEl("li");
					li.createEl("strong", { text: strong });
					li.appendText(` ${rest}`);
				};
				step("Add a magazine,", "then type its name and its website address, for example https://www.lrb.co.uk.");
				step("Find the feed.", "The button looks for the feed the site announces and for the usual addresses.");
				step(
					"If nothing is found,",
					"search the web for the magazine’s name followed by “RSS feed”, or try the website address followed by /feed, /rss or /rss.xml. Paste what you find into Feeds. A section of a site often has its own feed; put several on separate lines and they are merged.",
				);
				step(
					"Test the feeds.",
					"Each address should report how many articles it holds and its newest headline. “Sent a web page” means that address is not a feed; try another.",
				);
				step("Save.", "The magazine appears on the page a few seconds later, with its own colour.");
				const note = box.createEl("p", {
					cls: "magazine-rack-guide-note",
					text: "If every article shows the same name as author, the feed is naming its editor: switch off ",
				});
				note.createEl("em", { text: "Show authors" });
				note.appendText(". Paywalled magazines work too; the page links to the article and you read it with your own subscription.");
			},
		};
	}

	/** Clipping articles with Web Clipper templates. */
	private clipRows(): Row[] {
		const settings = this.plugin.settings;
		const templates = settings.clipTemplates;
		const fallback = fallbackTemplate(templates);
		const rows: Row[] = [
			{
				name: "Clipping with your Web Clipper templates",
				render: (setting) => {
					const box = blockRow(setting);
					const intro = box.createEl("p", { text: "The scissors on each article (or " });
					intro.createEl("em", { text: "Clip to vault" });
					intro.appendText(
						" in its menu) save the article as a note, using your Obsidian Web Clipper templates: the same folder, note name, properties and content as in your browser.",
					);
					const steps = box.createEl("ol");
					const step = (strong: string, rest: string) => {
						const li = steps.createEl("li");
						li.createEl("strong", { text: strong });
						li.appendText(` ${rest}`);
					};
					step("Export a template from Web Clipper:", "open its settings, choose the template, then Export (or More → Copy to clipboard).");
					step(
						"Import it here",
						"with the button below, or paste it. You can import several: each one’s triggers choose it by web address, as in Web Clipper. When none match, the first template without triggers is used, or Web Clipper’s default.",
					);
					box.createEl("p", {
						cls: "magazine-rack-guide-note",
						text: "The article is read without your browser’s sign-in, so paywalled magazines may give only the first paragraphs; for those, open the article and use Web Clipper in your browser. Interpreter prompts are left empty, and anything a page draws with scripts after it loads (some prices, for example) may be missing.",
					});
				},
			},
		];

		if (fallback === DEFAULT_CLIP_TEMPLATE) {
			rows.push({
				name: `${DEFAULT_CLIP_TEMPLATE.name} (used when no trigger matches)`,
				desc: `Folder: ${DEFAULT_CLIP_TEMPLATE.path}. Title, source, author, published, created, description and tags. Import a template without triggers to use your own instead.`,
				render: () => undefined,
			});
		}
		templates.forEach((template, index) => {
			const where =
				template.behavior === "append-daily" || template.behavior === "prepend-daily"
					? "Adds to today's daily note"
					: `Folder: ${template.path || "the vault's top level"}`;
			const triggers = template.triggers?.length ? ` · Triggers: ${template.triggers.join(", ")}` : "";
			rows.push({
				name: template === fallback ? `${template.name} (used when no trigger matches)` : template.name,
				desc: `${where}${triggers}`,
				render: (setting) =>
					setting
						.addExtraButton((button) =>
							button
								.setIcon("arrow-up")
								.setTooltip("Move up")
								.setDisabled(index === 0)
								.onClick(() => void this.moveTemplate(index, -1)),
						)
						.addExtraButton((button) =>
							button
								.setIcon("arrow-down")
								.setTooltip("Move down")
								.setDisabled(index === templates.length - 1)
								.onClick(() => void this.moveTemplate(index, 1)),
						)
						.addExtraButton((button) =>
							button
								.setIcon("trash")
								.setTooltip("Remove")
								.onClick(() => {
									new ConfirmModal(this.app, `Remove the template “${template.name}”?`, "Remove", async () => {
										templates.splice(templates.indexOf(template), 1);
										await this.plugin.savePluginData();
										this.refresh();
									}).open();
								}),
						),
			});
		});

		rows.push(
			{
				name: "",
				searchable: false,
				render: (setting) =>
					setting
						.addButton((button) =>
							button
								.setButtonText("Import templates…")
								.setCta()
								.onClick(() => {
									const input = createEl("input", {
										attr: { type: "file", accept: ".json,application/json", multiple: "" },
									});
									input.addEventListener("change", () => void this.importFiles(input));
									input.click();
								}),
						)
						.addButton((button) =>
							button.setButtonText("Paste a template").onClick(() => {
								new PasteModal(this.app, async (text) => this.importTemplates([text])).open();
							}),
						),
			},
			{
				name: "Open the note after clipping",
				desc: "Opens the new note in a new tab. Otherwise a message says where it went, with a link to open it.",
				render: (setting) =>
					setting.addToggle((toggle) =>
						toggle.setValue(settings.openAfterClip).onChange(async (value) => {
							settings.openAfterClip = value;
							await this.plugin.savePluginData();
						}),
					),
			},
		);
		return rows;
	}

	/** Support, laid out as in DuckTapeKiller's other plugins. */
	private supportRow(): Row {
		const name = this.plugin.manifest.name;
		return {
			name: `Enjoying ${name}?`,
			desc: "Support its development on Ko-fi.",
			render: (setting) => {
				const el = setting.settingEl;
				el.empty();
				el.addClass("magazine-rack-support");
				setIcon(el.createDiv({ cls: "magazine-rack-support-icon" }), "heart");
				const text = el.createDiv({ cls: "magazine-rack-support-text" });
				text.createDiv({ cls: "magazine-rack-support-title", text: `Enjoying ${name}?` });
				const about = text.createEl("p", {
					text: `${name} is free and open source, made and maintained by DuckTapeKiller. If it is useful to you, you can support its development on `,
				});
				// The name stays on one line, so a narrow screen never breaks it at its hyphen.
				about.createSpan({ cls: "magazine-rack-support-nowrap", text: "Ko-fi" });
				about.appendText(".");
				const kofi = el.createEl("a", {
					cls: "magazine-rack-support-button",
					href: KOFI_URL,
					attr: { "aria-label": "Support DuckTapeKiller on Ko-fi" },
				});
				setIcon(kofi.createSpan({ cls: "magazine-rack-support-button-icon" }), "coffee");
				kofi.createSpan({ text: "Support on Ko-fi" });
			},
		};
	}

	// ---------- what the rows do ----------

	/**
	 * Saves a change to the list of magazines and shows it. With `check`, the
	 * feeds are read again: for a magazine added, switched on or given new feeds.
	 */
	private async afterChange(check: boolean): Promise<void> {
		await this.plugin.savePluginData();
		this.plugin.refreshViews();
		this.refresh();
		if (!check) return;
		await this.plugin.recheck();
		this.refresh();
	}

	private async importFiles(input: HTMLInputElement): Promise<void> {
		const files = Array.from(input.files ?? []);
		const texts = await Promise.all(files.map((file) => file.text()));
		await this.importTemplates(texts);
	}

	private async importTemplates(texts: string[]): Promise<void> {
		const added: ClipTemplate[] = [];
		for (const text of texts) {
			try {
				added.push(...parseTemplates(text));
			} catch (error) {
				new Notice(`Could not import: ${error instanceof Error ? error.message : "the file could not be read"}.`);
			}
		}
		if (!added.length) return;
		const list = this.plugin.settings.clipTemplates;
		for (const template of added) {
			// Importing the same template again replaces it.
			const same = list.findIndex((t) => t.id === template.id || t.name === template.name);
			if (same === -1) list.push(template);
			else list[same] = template;
		}
		await this.plugin.savePluginData();
		new Notice(`Imported ${added.length} ${added.length === 1 ? "template" : "templates"}: ${added.map((t) => t.name).join(", ")}.`);
		this.refresh();
	}

	private async moveTemplate(index: number, step: number): Promise<void> {
		const list = this.plugin.settings.clipTemplates;
		const [item] = list.splice(index, 1);
		list.splice(index + step, 0, item);
		await this.plugin.savePluginData();
		this.refresh();
	}

	private async move(index: number, step: number): Promise<void> {
		const list = this.plugin.settings.magazines;
		const [item] = list.splice(index, 1);
		list.splice(index + step, 0, item);
		await this.afterChange(false);
	}

	/** The feeds and how the last check went, one line each. */
	private describe(magazine: Magazine): DocumentFragment {
		const fragment = createFragment();
		fragment.createDiv({ text: magazine.feeds.join("\n") || "No feed address", cls: "magazine-rack-feeds" });
		const error = this.plugin.cache[magazine.id]?.error;
		fragment.createDiv({ text: this.status(magazine), cls: error ? "magazine-rack-error" : "" });
		return fragment;
	}

	private status(magazine: Magazine): string {
		const entry = this.plugin.cache[magazine.id];
		let status = "Not checked yet.";
		if (entry?.error) status = `Last check failed: ${entry.error}.`;
		else if (entry) status = `${entry.articles.length} ${entry.articles.length === 1 ? "article" : "articles"} from the last check.`;
		if (!magazine.showAuthor) status += " Authors hidden.";
		return status;
	}
}

/** Turns a settings row into a box of its own: a guide or note rather than a name and a control. */
function blockRow(setting: Setting): HTMLElement {
	const el = setting.settingEl;
	el.empty();
	el.addClass("magazine-rack-block-row");
	return el.createDiv({ cls: "magazine-rack-guide" });
}

class MagazineModal extends Modal {
	private draft: Magazine;

	constructor(
		app: App,
		existing: Magazine | null,
		private readonly onSave: (magazine: Magazine) => Promise<void>,
		color: string = PALETTE[0],
	) {
		super(app);
		this.draft = existing
			? { ...existing, feeds: [...existing.feeds], leaveOut: [...(existing.leaveOut ?? [])] }
			: {
					id: `magazine-${Date.now().toString(36)}`,
					name: "",
					homepage: "",
					feeds: [],
					showAuthor: true,
					enabled: true,
					color,
					leaveOut: [],
				};
		this.titleEl.setText(existing ? `Edit ${existing.name}` : "Add a magazine");
	}

	onOpen(): void {
		const { contentEl } = this;
		const draft = this.draft;

		const intro = contentEl.createEl("p", { cls: "magazine-rack-modal-intro", text: "Type the website and press " });
		intro.createEl("em", { text: "Find the feed" });
		intro.appendText(", or paste the feed address yourself. Then press ");
		intro.createEl("em", { text: "Test the feeds" });
		intro.appendText(" before saving.");

		new Setting(contentEl).setName("Name").addText((text) =>
			text.setValue(draft.name).onChange((value) => {
				draft.name = value;
			}),
		);

		let feedsArea: HTMLTextAreaElement | null = null;
		new Setting(contentEl)
			.setName("Website")
			.setDesc("Used for the heading link, and to find the feed.")
			.addText((text) =>
				text
					.setPlaceholder("https://")
					.setValue(draft.homepage)
					.onChange((value) => {
						draft.homepage = value.trim();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Find the feed").onClick(async () => {
					if (!draft.homepage) {
						new Notice("Type the website's address first.");
						return;
					}
					button.setDisabled(true).setButtonText("Looking…");
					try {
						const found = await discoverFeeds(draft.homepage);
						if (found.length) {
							draft.feeds = found;
							if (feedsArea) feedsArea.value = found.join("\n");
						} else {
							new Notice("No feed found on that site. If you know its address, type it below.");
						}
					} catch {
						new Notice("That website address could not be read.");
					}
					button.setDisabled(false).setButtonText("Find the feed");
				}),
			);

		const feeds = new Setting(contentEl)
			.setName("Feeds")
			.setDesc("One address per line. Several feeds are merged and sorted by date.")
			.addTextArea((area) => {
				feedsArea = area.inputEl;
				area.inputEl.rows = 4;
				area.setValue(draft.feeds.join("\n")).onChange((value) => {
					draft.feeds = value
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean);
				});
			});
		feeds.settingEl.addClass("magazine-rack-feeds-setting");

		let results: HTMLElement | null = null;
		new Setting(contentEl)
			.setName("Test the feeds")
			.setDesc("Reads each address now and shows what it found.")
			.addButton((button) =>
				button.setButtonText("Test the feeds").onClick(async () => {
					if (!results) return;
					results.empty();
					if (!draft.feeds.length) {
						results.createDiv({ cls: "magazine-rack-test is-bad", text: "Add a feed address first." });
						return;
					}
					button.setDisabled(true).setButtonText("Testing…");
					for (const url of draft.feeds) {
						const row = results.createDiv({ cls: "magazine-rack-test" });
						row.createDiv({ cls: "magazine-rack-test-url", text: url });
						const verdict = row.createDiv({ text: "Reading…" });
						try {
							const articles = await fetchFeed(url);
							if (!articles.length) {
								row.addClass("is-bad");
								verdict.setText("✗ This is a feed, but it has no articles at the moment.");
								continue;
							}
							row.addClass("is-good");
							const newest = [...articles].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))[0];
							const pictures = articles.filter((a) => a.image).length;
							verdict.setText(
								`✓ ${articles.length} ${articles.length === 1 ? "article" : "articles"}. Newest: “${newest.title}”. ${
									pictures
										? `${pictures} with a picture in the feed.`
										: "No pictures in the feed; they will be taken from the article pages."
								}`,
							);
						} catch (error) {
							row.addClass("is-bad");
							const reason = error instanceof Error ? error.message : "the feed could not be read";
							verdict.setText(`✗ ${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`);
						}
					}
					button.setDisabled(false).setButtonText("Test the feeds");
				}),
			);
		results = contentEl.createDiv({ cls: "magazine-rack-test-results" });

		const leaveOut = new Setting(contentEl)
			.setName("Leave out")
			.setDesc("One per line. A word or phrase leaves out articles with it in the headline; anything with a “/” is matched against the web address, such as /podcasts/ or /press-releases/.")
			.addTextArea((area) => {
				area.inputEl.rows = 3;
				area.setPlaceholder("/podcasts/\nnewsletter");
				area.setValue(draft.leaveOut.join("\n")).onChange((value) => {
					draft.leaveOut = value
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean);
				});
			});
		leaveOut.settingEl.addClass("magazine-rack-feeds-setting");

		new Setting(contentEl)
			.setName("Show authors")
			.setDesc("Turn off for feeds that name the editor who posted the piece rather than its writer.")
			.addToggle((toggle) =>
				toggle.setValue(draft.showAuthor).onChange((value) => {
					draft.showAuthor = value;
				}),
			);

		new Setting(contentEl)
			.setName("Colour")
			.setDesc("Used for the magazine's section and labels.")
			.addColorPicker((picker) =>
				picker.setValue(draft.color).onChange((value) => {
					draft.color = value;
				}),
			);

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						draft.name = draft.name.trim();
						if (!draft.name) {
							new Notice("Give the magazine a name.");
							return;
						}
						const bad = draft.feeds.find((f) => !/^https?:\/\/\S+$/i.test(f));
						if (!draft.feeds.length || bad) {
							new Notice(bad ? `This is not a web address: ${bad}` : "Add at least one feed address.");
							return;
						}
						if (draft.homepage && !/^https?:\/\//i.test(draft.homepage)) draft.homepage = `https://${draft.homepage}`;
						this.close();
						await this.onSave(draft);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly question: string,
		private readonly action: string,
		private readonly onConfirm: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("p", { text: this.question });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => {
				// Obsidian's red button for an action that removes something, on every version.
				button.buttonEl.addClass("mod-warning");
				button.setButtonText(this.action).onClick(async () => {
					this.close();
					await this.onConfirm();
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class PasteModal extends Modal {
	constructor(
		app: App,
		private readonly onImport: (text: string) => Promise<void>,
	) {
		super(app);
		this.titleEl.setText("Paste a Web Clipper template");
	}

	onOpen(): void {
		const { contentEl } = this;
		const intro = contentEl.createEl("p", {
			cls: "magazine-rack-modal-intro",
			text: "In Web Clipper's settings, open the template, then ",
		});
		intro.createEl("em", { text: "More" });
		intro.appendText(" → ");
		intro.createEl("em", { text: "Copy to clipboard" });
		intro.appendText(", and paste it here.");
		const area = contentEl.createEl("textarea", { cls: "magazine-rack-paste", attr: { rows: "10", spellcheck: "false" } });
		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Import")
					.setCta()
					.onClick(async () => {
						this.close();
						await this.onImport(area.value);
					}),
			);
		window.setTimeout(() => area.focus(), 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
