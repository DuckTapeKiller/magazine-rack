import { App, Modal, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import { fallbackTemplate, parseTemplates } from "./clip";
import { discoverFeeds, fetchFeed } from "./feeds";
import type MagazineRack from "./main";
import { formatStamp } from "./view";
import { DEFAULT_CLIP_TEMPLATE, KOFI_URL, PALETTE, copyDefaults, type ClipTemplate, type Magazine } from "./types";

const INTERVALS: Record<string, string> = {
	"15": "Every 15 minutes",
	"30": "Every 30 minutes",
	"60": "Every hour",
	"120": "Every 2 hours",
	"360": "Every 6 hours",
	"720": "Every 12 hours",
};

export class MagazineRackSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: MagazineRack,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Note")
			.setDesc(
				"Where the reading room lives. The note is made the first time you open it. In a note you already have, the page is added at the end and the rest is left alone. You can also put a magazine-rack code block in any note.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Reading Room.md")
					.setValue(settings.notePath)
					.onChange(async (value) => {
						settings.notePath = value;
						await this.plugin.savePluginData();
					}),
			);

		new Setting(containerEl)
			.setName("Page title")
			.setDesc("The name across the top of the page.")
			.addText((text) =>
				text
					.setPlaceholder("The Reading Room")
					.setValue(settings.title)
					.onChange(async (value) => {
						settings.title = value;
						await this.plugin.savePluginData();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName("Articles per magazine")
			.addSlider((slider) =>
				slider
					.setLimits(3, 30, 1)
					.setValue(settings.perMagazine)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.perMagazine = value;
						await this.plugin.savePluginData();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName("Check for new articles")
			.setDesc("Only while Obsidian is open. It also checks when Obsidian starts, if the last check is older than this.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(INTERVALS)
					.setValue(String(settings.refreshMinutes))
					.onChange(async (value) => {
						settings.refreshMinutes = Number(value);
						await this.plugin.savePluginData();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName("Show standfirsts")
			.setDesc("The short introduction under each headline, where the feed gives one.")
			.addToggle((toggle) =>
				toggle.setValue(settings.showSummaries).onChange(async (value) => {
					settings.showSummaries = value;
					await this.plugin.savePluginData();
					this.plugin.refreshViews();
				}),
			);

		new Setting(containerEl)
			.setName("Keep articles for")
			.setDesc("Feeds only hold their newest pieces, so an article can vanish within hours. This keeps it on the page for a while after it leaves the feed.")
			.addDropdown((dropdown) =>
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
			);

		new Setting(containerEl)
			.setName("Language of the page")
			.setDesc("For the dates, labels and menus on the page. These settings stay in English.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ en: "English", es: "Español" })
					.setValue(settings.language)
					.onChange(async (value) => {
						settings.language = value === "es" ? "es" : "en";
						await this.plugin.savePluginData();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName("Always open in reading view")
			.setDesc("Switches the note to reading view each time you open it. If you switch to editing on purpose, it stays that way until you open the note again.")
			.addToggle((toggle) =>
				toggle.setValue(settings.alwaysReading).onChange(async (value) => {
					settings.alwaysReading = value;
					await this.plugin.savePluginData();
				}),
			);

		new Setting(containerEl)
			.setName("Check now")
			.setDesc(
				this.plugin.lastCheck
					? `Last checked ${formatStamp(this.plugin.lastCheck)}.`
					: "Not checked yet.",
			)
			.addButton((button) =>
				button
					.setButtonText("Check now")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true).setButtonText("Checking…");
						await this.plugin.checkNow(true);
						this.display();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Open the note").onClick(async () => {
					await this.plugin.openNote();
				}),
			);

		new Setting(containerEl).setName("Magazines").setHeading();
		this.guide(containerEl);

		settings.magazines.forEach((magazine, index) => {
			const row = new Setting(containerEl).setName(magazine.name).setDesc(this.describe(magazine));
			row.descEl.addClass("magazine-rack-desc");
			const dot = createSpan({ cls: "magazine-rack-swatch" });
			dot.style.setProperty("--mr-accent", magazine.color);
			row.nameEl.prepend(dot);
			row.addToggle((toggle) =>
				toggle
					.setTooltip("Show in the note")
					.setValue(magazine.enabled)
					.onChange(async (value) => {
						magazine.enabled = value;
						await this.plugin.savePluginData();
						if (value && !this.plugin.cache[magazine.id]) await this.plugin.checkNow(false);
						else this.plugin.refreshViews();
						this.display();
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
								await this.plugin.savePluginData();
								if (feedsChanged) await this.plugin.checkNow(false);
								else this.plugin.refreshViews();
								this.display();
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
								await this.plugin.savePluginData();
								this.plugin.refreshViews();
								this.display();
							}).open();
						}),
				);
		});

		const actions = new Setting(containerEl).addButton((button) =>
			button.setButtonText("Add a magazine").onClick(() => {
				new MagazineModal(
					this.app,
					null,
					async (added) => {
						settings.magazines.push(added);
						await this.plugin.savePluginData();
						await this.plugin.checkNow(false);
						this.display();
					},
					PALETTE[settings.magazines.length % PALETTE.length],
				).open();
			}),
		);
		const ids = new Set(settings.magazines.map((m) => m.id));
		const missing = copyDefaults().magazines.filter((m) => !ids.has(m.id));
		if (missing.length) {
			actions.addButton((button) =>
				button.setButtonText(`Add back the original ${missing.length === 1 ? "magazine" : "magazines"}`).onClick(async () => {
					settings.magazines.push(...missing);
					await this.plugin.savePluginData();
					await this.plugin.checkNow(false);
					this.display();
				}),
			);
		}

		this.clipSection(containerEl);
		this.supportSection(containerEl);
	}

	/** Support, laid out as in DuckTapeKiller's other plugins. */
	private supportSection(containerEl: HTMLElement): void {
		const name = this.plugin.manifest.name;
		new Setting(containerEl).setName("Support").setHeading();
		const el = containerEl.createDiv({ cls: "setting-item magazine-rack-support" });
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
	}

	/** Clipping articles with Web Clipper templates. */
	private clipSection(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("Clip to vault").setHeading();

		const box = containerEl.createDiv({ cls: "magazine-rack-guide" });
		box.createEl("p", {
			text: "The scissors on each article (or Clip to vault in its menu) save the article as a note, using your Obsidian Web Clipper templates: the same folder, note name, properties and content as in your browser.",
		});
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

		const templates = settings.clipTemplates;
		const fallback = fallbackTemplate(templates);
		if (fallback === DEFAULT_CLIP_TEMPLATE) {
			new Setting(containerEl)
				.setName(`${DEFAULT_CLIP_TEMPLATE.name} (used when no trigger matches)`)
				.setDesc(
					`Folder: ${DEFAULT_CLIP_TEMPLATE.path}. Title, source, author, published, created, description and tags. Import a template without triggers to use your own instead.`,
				);
		}
		templates.forEach((template, index) => {
			const where =
				template.behavior === "append-daily" || template.behavior === "prepend-daily"
					? "Adds to today's daily note"
					: `Folder: ${template.path || "the vault's top level"}`;
			const triggers = template.triggers?.length ? ` · Triggers: ${template.triggers.join(", ")}` : "";
			new Setting(containerEl)
				.setName(template === fallback ? `${template.name} (used when no trigger matches)` : template.name)
				.setDesc(`${where}${triggers}`)
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
								this.display();
							}).open();
						}),
				);
		});

		new Setting(containerEl)
			.addButton((button) =>
				button
					.setButtonText("Import templates…")
					.setCta()
					.onClick(() => {
						const input = createEl("input", { attr: { type: "file", accept: ".json,application/json", multiple: "" } });
						input.addEventListener("change", async () => {
							const files = Array.from(input.files ?? []);
							const texts = await Promise.all(files.map((file) => file.text()));
							await this.importTemplates(texts);
						});
						input.click();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Paste a template").onClick(() => {
					new PasteModal(this.app, async (text) => this.importTemplates([text])).open();
				}),
			);

		new Setting(containerEl)
			.setName("Open the note after clipping")
			.setDesc("Opens the new note in a new tab. Otherwise a message says where it went, with a link to open it.")
			.addToggle((toggle) =>
				toggle.setValue(settings.openAfterClip).onChange(async (value) => {
					settings.openAfterClip = value;
					await this.plugin.savePluginData();
				}),
			);
	}

	private async importTemplates(texts: string[]): Promise<void> {
		const added: ClipTemplate[] = [];
		for (const text of texts) {
			try {
				added.push(...parseTemplates(text));
			} catch (error) {
				new Notice(`Could not import: ${error instanceof Error ? error.message : String(error)}.`);
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
		this.display();
	}

	private async moveTemplate(index: number, step: number): Promise<void> {
		const list = this.plugin.settings.clipTemplates;
		const [item] = list.splice(index, 1);
		list.splice(index + step, 0, item);
		await this.plugin.savePluginData();
		this.display();
	}

	/** A short how-to for adding a magazine, shown above the list. */
	private guide(containerEl: HTMLElement): void {
		const box = containerEl.createDiv({ cls: "magazine-rack-guide" });
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
		box.createEl("p", {
			cls: "magazine-rack-guide-note",
			text: "If every article shows the same name as author, the feed is naming its editor: switch off Show authors. Paywalled magazines work too; the page links to the article and you read it with your own subscription.",
		});
	}

	private describe(magazine: Magazine): DocumentFragment {
		const fragment = document.createDocumentFragment();
		fragment.createDiv({ text: magazine.feeds.join("\n") || "No feed address", cls: "magazine-rack-feeds" });
		const entry = this.plugin.cache[magazine.id];
		let status = "Not checked yet.";
		if (entry?.error) status = `Last check failed: ${entry.error}.`;
		else if (entry) status = `${entry.articles.length} ${entry.articles.length === 1 ? "article" : "articles"} from the last check.`;
		if (!magazine.showAuthor) status += " Authors hidden.";
		fragment.createDiv({ text: status, cls: entry?.error ? "magazine-rack-error" : "" });
		return fragment;
	}

	private async move(index: number, step: number): Promise<void> {
		const list = this.plugin.settings.magazines;
		const [item] = list.splice(index, 1);
		list.splice(index + step, 0, item);
		await this.plugin.savePluginData();
		this.plugin.refreshViews();
		this.display();
	}
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

		contentEl.createEl("p", {
			cls: "magazine-rack-modal-intro",
			text: "Type the website and press Find the feed, or paste the feed address yourself. Then press Test the feeds before saving.",
		});

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
							const reason = error instanceof Error ? error.message : String(error);
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
			.addButton((button) =>
				button
					.setButtonText(this.action)
					.setWarning()
					.onClick(async () => {
						this.close();
						await this.onConfirm();
					}),
			);
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
		contentEl.createEl("p", {
			cls: "magazine-rack-modal-intro",
			text: "In Web Clipper's settings, open the template, then More → Copy to clipboard, and paste it here.",
		});
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
