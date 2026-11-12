/**
 * Clip an article into the vault with an Obsidian Web Clipper template.
 *
 * It uses the two libraries Web Clipper is built on: Defuddle, to find the
 * article in the page and turn it into Markdown, and Knap, Web Clipper's
 * template language (variables, filters and logic). The page variables,
 * the selector: and schema: lookups, and the frontmatter follow Web Clipper's
 * own rules (github.com/obsidianmd/obsidian-clipper, MIT licence), so an
 * exported template gives the same note here as in the browser.
 */
import Defuddle, { createMarkdownContent } from "defuddle/full";
import { createEngine, standardFilters, type FilterRegistry, type TemplateFilter } from "knap";
import { htmlFilters } from "knap/html";
import { App, TFile, moment, normalizePath, requestUrl } from "obsidian";
import { withTimeout } from "./feeds";
import { DEFAULT_CLIP_TEMPLATE, type ClipTemplate } from "./types";

interface ClipContext {
	currentUrl?: string;
}

export interface ClipOutcome {
	file: TFile;
	words: number;
}

export class ClipError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}

const BEHAVIOURS: ClipTemplate["behavior"][] = [
	"create",
	"append-specific",
	"append-daily",
	"prepend-specific",
	"prepend-daily",
	"overwrite",
];

// ---------- the template engine, set up as Web Clipper sets it up ----------

const markdownFilter: TemplateFilter<ClipContext> = (value, param, filterContext) => {
	try {
		return createMarkdownContent(value, param ?? filterContext?.context?.currentUrl ?? "about:blank");
	} catch {
		return value;
	}
};
markdownFilter.metadata = {};

const fragmentLinkFilter: TemplateFilter<ClipContext> = (value, param, filterContext) => {
	const combined = [param, filterContext?.context?.currentUrl].filter(Boolean).join(":");
	return (standardFilters.fragment_link as TemplateFilter<ClipContext>)(value, combined, filterContext);
};
fragmentLinkFilter.metadata = {};

const filters: FilterRegistry<ClipContext> = {
	...(standardFilters as FilterRegistry<ClipContext>),
	...(htmlFilters as FilterRegistry<ClipContext>),
	markdown: markdownFilter,
	fragment_link: fragmentLinkFilter,
};

const engine = createEngine<ClipContext>({ filters });

/** Interpreter prompts ({{"…"}}) need Web Clipper's AI connection; here they come out empty. */
function withoutPrompts(text: string): string {
	return text.replace(/\{\{-?\s*(?:prompt:\s*)?(["'])(?:\\.|(?!\1)[^\\])*\1\s*(?:\|[^}]*)?-?\}\}/g, "");
}

// ---------- the clip ----------

/**
 * Picks the template whose triggers match, as Web Clipper does. When none match,
 * the first template without triggers is used, or Web Clipper's default: a
 * template with triggers is meant for particular sites, so it is never a fallback.
 */
export function chooseTemplate(templates: ClipTemplate[], url: string, schemaOrgData?: unknown): ClipTemplate {
	if (!templates.length) return DEFAULT_CLIP_TEMPLATE;
	for (const template of templates) {
		for (const trigger of template.triggers ?? []) {
			if (!trigger.startsWith("schema:") && matchUrlTrigger(trigger, url)) return template;
		}
	}
	if (schemaOrgData) {
		for (const template of templates) {
			for (const trigger of template.triggers ?? []) {
				if (trigger.startsWith("schema:") && matchSchemaTrigger(trigger, schemaOrgData)) return template;
			}
		}
	}
	return fallbackTemplate(templates);
}

export function fallbackTemplate(templates: ClipTemplate[]): ClipTemplate {
	return templates.find((t) => !t.triggers?.length) ?? DEFAULT_CLIP_TEMPLATE;
}

export interface RenderedClip {
	template: ClipTemplate;
	noteName: string;
	folder: string;
	properties: { name: string; value: string; type: string }[];
	/** The frontmatter as Web Clipper writes it, or "" when the template has no properties. */
	frontmatter: string;
	body: string;
	words: number;
}

/**
 * Fills in a template from a page's HTML, exactly as Web Clipper would.
 * Without a template, the one whose triggers match the page is used.
 * `now` fixes the clock for {{date}} (used by tests).
 */
export async function renderClip(
	html: string,
	url: string,
	templates: ClipTemplate[],
	chosen?: ClipTemplate,
	now?: Date,
): Promise<RenderedClip> {
	// Defuddle works on its own copy; selectors read an untouched one.
	const parser = new DOMParser();
	const extracted = new Defuddle(parser.parseFromString(html, "text/html"), { url }).parse();
	const selectorDoc = parser.parseFromString(html, "text/html");
	const template = chosen ?? chooseTemplate(templates, url, extracted.schemaOrgData);

	const content = createMarkdownContent(extracted.content, url);
	const variables = buildVariables(extracted, content, url, html, now);
	const render = async (text: string): Promise<string> => {
		const result = await engine.render(withoutPrompts(text ?? ""), {
			variables,
			context: { currentUrl: url },
			resolveVariable: (name) => resolveVariable(name, variables, selectorDoc),
		});
		if (result.errors.length) {
			console.warn("Magazine Rack: template errors", result.errors.map((e) => `line ${e.line}: ${e.message}`));
		}
		return result.output;
	};

	const noteName = sanitizeFileName(await render(template.noteNameFormat)) || "Untitled";
	const folder = (await render(template.path ?? ""))
		.split("/")
		.map((part) => part.trim())
		.filter(Boolean)
		.join("/");

	const properties: { name: string; value: string; type: string }[] = [];
	for (const property of template.properties ?? []) {
		const type = property.type || "text";
		const value = formatPropertyValue(await render(property.value), type, property.value);
		properties.push({ name: property.name, value, type });
	}
	const body = await render(template.noteContentFormat);
	return {
		template,
		noteName,
		folder,
		properties,
		frontmatter: frontmatterFor(properties),
		body,
		words: extracted.wordCount ?? 0,
	};
}

/** Downloads the article, fills in the template and writes the note. */
export async function clipArticle(
	app: App,
	url: string,
	templates: ClipTemplate[],
	chosen?: ClipTemplate,
): Promise<ClipOutcome> {
	const response = await withTimeout(
		requestUrl({ url, method: "GET", headers: { Accept: "text/html,application/xhtml+xml" }, throw: false }),
		30_000,
	);
	if (response.status >= 400) throw new ClipError(`HTTP ${response.status}`, response.status);
	const clip = await renderClip(response.text, url, templates, chosen);
	const file = await writeNote(app, clip.template.behavior, clip.folder, clip.noteName, clip.properties, clip.body);
	return { file, words: clip.words };
}

/** Reads one or more templates from Web Clipper's exported JSON (a template, a list, or a settings export). */
export function parseTemplates(json: string): ClipTemplate[] {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		throw new Error("this is not valid JSON");
	}
	const found: ClipTemplate[] = [];
	const visit = (value: unknown, depth: number) => {
		if (depth > 6 || value === null || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item, depth + 1);
			return;
		}
		const record = value as Record<string, unknown>;
		if (typeof record.noteContentFormat === "string" && typeof record.name === "string") {
			found.push(cleanTemplate(record));
			return;
		}
		for (const item of Object.values(record)) visit(item, depth + 1);
	};
	visit(data, 0);
	if (!found.length) throw new Error("no Web Clipper template found in it");
	return found;
}

function cleanTemplate(record: Record<string, unknown>): ClipTemplate {
	const behavior = BEHAVIOURS.includes(record.behavior as ClipTemplate["behavior"])
		? (record.behavior as ClipTemplate["behavior"])
		: "create";
	const properties = Array.isArray(record.properties)
		? record.properties
				.filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
				.filter((p) => typeof p.name === "string" && p.name.trim())
				.map((p) => ({
					name: String(p.name),
					value: typeof p.value === "string" ? p.value : String(p.value ?? ""),
					...(typeof p.type === "string" && p.type ? { type: p.type } : {}),
				}))
		: [];
	return {
		id: typeof record.id === "string" && record.id ? record.id : `clip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		name: String(record.name).trim() || "Untitled template",
		behavior,
		noteNameFormat: typeof record.noteNameFormat === "string" ? record.noteNameFormat : "{{title}}",
		path: typeof record.path === "string" ? record.path : "",
		noteContentFormat: String(record.noteContentFormat),
		properties,
		triggers: Array.isArray(record.triggers) ? record.triggers.map(String).filter(Boolean) : [],
	};
}

// ---------- variables, as Web Clipper builds them ----------

interface Extracted {
	title?: string;
	author?: string;
	content?: string;
	description?: string;
	favicon?: string;
	image?: string;
	published?: string;
	site?: string;
	language?: string;
	wordCount?: number;
	schemaOrgData?: unknown;
	metaTags?: { name?: string | null; property?: string | null; content: string | null }[];
	variables?: Record<string, string>;
}

function buildVariables(
	page: Extracted,
	markdown: string,
	url: string,
	html: string,
	now?: Date,
): Record<string, string> {
	const currentUrl = url.replace(/#:~:text=[^&]+(&|$)/, "");
	const timestamp = moment(now ?? new Date()).format("YYYY-MM-DDTHH:mm:ssZ");
	const variables: Record<string, string> = {
		"{{author}}": (page.author ?? "").trim(),
		"{{content}}": markdown.trim(),
		"{{contentHtml}}": (page.content ?? "").trim(),
		"{{selection}}": "",
		"{{selectionHtml}}": "",
		"{{date}}": timestamp,
		"{{time}}": timestamp,
		"{{description}}": (page.description ?? "").trim(),
		"{{domain}}": domainOf(currentUrl),
		"{{favicon}}": page.favicon ?? "",
		"{{fullHtml}}": html.trim(),
		"{{highlights}}": "",
		"{{image}}": page.image ?? "",
		"{{noteName}}": sanitizeFileName(page.title ?? "").trim(),
		"{{published}}": (page.published ?? "").split(",")[0].trim(),
		"{{site}}": (page.site ?? "").trim(),
		"{{title}}": (page.title ?? "").trim(),
		"{{url}}": currentUrl.trim(),
		"{{language}}": (page.language ?? "").trim(),
		"{{words}}": String(page.wordCount ?? 0),
	};
	for (const [key, value] of Object.entries(page.variables ?? {})) variables[`{{${key}}}`] = value;
	for (const meta of page.metaTags ?? []) {
		if (meta.name && meta.content) variables[`{{meta:name:${meta.name}}}`] = meta.content;
		if (meta.property && meta.content) variables[`{{meta:property:${meta.property}}}`] = meta.content;
	}
	if (page.schemaOrgData) addSchema(page.schemaOrgData, variables);
	return variables;
}

function addSchema(data: unknown, variables: Record<string, string>, prefix = ""): void {
	if (Array.isArray(data)) {
		data.forEach((item, index) => {
			if (!item || typeof item !== "object") return;
			const type = (item as Record<string, unknown>)["@type"];
			if (type) {
				for (const t of Array.isArray(type) ? type : [type]) addSchema(item, variables, `@${String(t)}:`);
			} else {
				addSchema(item, variables, `[${index}]:`);
			}
		});
		return;
	}
	if (!data || typeof data !== "object") return;
	variables[`{{schema:${prefix.replace(/\.$/, "")}}}`] = JSON.stringify(data);
	for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
		if (key === "@type") continue;
		const name = `{{schema:${prefix}${key}}}`;
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			variables[name] = String(value);
		} else if (Array.isArray(value)) {
			variables[name] = JSON.stringify(value);
			value.forEach((item, index) => addSchema(item, variables, `${prefix}${key}[${index}].`));
		} else if (value && typeof value === "object") {
			addSchema(value, variables, `${prefix}${key}.`);
		}
	}
}

/** Names the engine does not find among the variables: selector:, selectorHtml: and short schema: names. */
function resolveVariable(name: string, variables: Record<string, string>, doc: Document): unknown {
	if (name.startsWith("selector:") || name.startsWith("selectorHtml:")) {
		const html = name.startsWith("selectorHtml:");
		const rest = name.slice(html ? "selectorHtml:".length : "selector:".length);
		const attr = rest.match(/^(.+?)\?(.+)$/);
		const selector = (attr ? attr[1] : rest).replace(/\\"/g, '"');
		try {
			const elements = Array.from(doc.querySelectorAll(selector));
			if (!elements.length) return "";
			return elements.map((el) =>
				attr ? el.getAttribute(attr[2]) ?? "" : html ? el.outerHTML : el.textContent?.trim() ?? "",
			);
		} catch {
			return "";
		}
	}
	if (name.startsWith("schema:")) return resolveSchema(name.slice("schema:".length), variables);
	return undefined;
}

function resolveSchema(key: string, variables: Record<string, string>): unknown {
	const lookup = (k: string): string | undefined => {
		const direct = variables[`{{schema:${k}}}`];
		if (direct !== undefined) return direct;
		if (!k.includes("@")) {
			const match = Object.keys(variables).find((v) => v.includes("@") && v.endsWith(`:${k}}}`));
			if (match) return variables[match];
		}
		return undefined;
	};
	const parse = (value: string): unknown => {
		if (value.startsWith("[") || value.startsWith("{")) {
			try {
				return JSON.parse(value);
			} catch {
				return value;
			}
		}
		return value;
	};
	const array = key.match(/^(.*?)\[(\*|\d+)\](?:\.(.*))?$/);
	if (array) {
		const raw = lookup(array[1]);
		if (raw === undefined) return undefined;
		const list = parse(raw);
		if (!Array.isArray(list)) return undefined;
		const pick = (item: unknown) => (array[3] ? nested(item, array[3]) : item);
		if (array[2] === "*") return list.map(pick).filter((v) => v != null);
		const item = list[Number(array[2])];
		return item === undefined ? undefined : pick(item);
	}
	const raw = lookup(key);
	return raw === undefined ? undefined : parse(raw);
}

function nested(value: unknown, path: string): unknown {
	return path.split(".").reduce<unknown>((current, key) => {
		if (current === null || current === undefined) return undefined;
		const bracket = key.match(/^([^[]*)\[([^\]]+)\]/);
		if (bracket) {
			const base = bracket[1] ? (current as Record<string, unknown>)[bracket[1]] : current;
			if (Array.isArray(base)) return base[Number(bracket[2])];
			if (base && typeof base === "object") return (base as Record<string, unknown>)[bracket[2].replace(/^["']|["']$/g, "")];
			return undefined;
		}
		return (current as Record<string, unknown>)[key];
	}, value);
}

// ---------- properties and frontmatter, as Web Clipper writes them ----------

function formatPropertyValue(value: string, type: string, templateValue: string): string {
	switch (type) {
		case "number": {
			const numeric = value.replace(/[^\d.-]/g, "");
			return numeric ? String(parseFloat(numeric)) : value;
		}
		case "checkbox":
			return String(value.toLowerCase() === "true" || value === "1");
		case "date":
		case "datetime": {
			if (!templateValue.includes("|date:") && value.trim()) {
				const parsed = moment(value.trim(), [moment.ISO_8601, moment.RFC_2822]);
				if (parsed.isValid()) return parsed.format(type === "date" ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ssZ");
			}
			return value;
		}
		default:
			return value;
	}
}

function multitextItems(value: string): string[] {
	const trimmed = value.trim();
	let items: string[];
	if (trimmed.startsWith('["') && trimmed.endsWith('"]')) {
		try {
			items = (JSON.parse(trimmed) as unknown[]).map(String);
		} catch {
			items = value.split(",");
		}
	} else {
		items = value.split(/,(?![^[]*\]\])/);
	}
	return items.map((item) => item.trim()).filter(Boolean);
}

function frontmatterFor(properties: { name: string; value: string; type: string }[]): string {
	if (!properties.length) return "";
	const escape = (s: string) => s.replace(/"/g, '\\"');
	let yaml = "---\n";
	for (const property of properties) {
		const name = property.name.trim();
		const quote =
			/[:\s{}[\],&*#?|<>=!%@\\-]/.test(name) || /^\d/.test(name) || /^(true|false|null|yes|no|on|off)$/i.test(name);
		yaml += `${quote ? (property.name.includes('"') ? `'${property.name.replace(/'/g, "''")}'` : `"${property.name}"`) : property.name}:`;
		switch (property.type) {
			case "multitext": {
				const items = multitextItems(property.value);
				yaml += "\n";
				for (const item of items) yaml += `  - "${escape(item)}"\n`;
				break;
			}
			case "number": {
				const numeric = property.value.replace(/[^\d.-]/g, "");
				yaml += numeric ? ` ${parseFloat(numeric)}\n` : "\n";
				break;
			}
			case "checkbox":
				yaml += ` ${property.value === "true"}\n`;
				break;
			case "date":
			case "datetime":
				yaml += property.value.trim() ? ` ${property.value}\n` : "\n";
				break;
			default:
				yaml += property.value.trim() ? ` "${escape(property.value)}"\n` : "\n";
		}
	}
	return `${yaml}---\n`;
}

/** The same values as YAML would give, for merging into a note that already has frontmatter. */
function propertyValue(property: { value: string; type: string }): unknown {
	switch (property.type) {
		case "multitext":
			return multitextItems(property.value);
		case "number": {
			const numeric = property.value.replace(/[^\d.-]/g, "");
			return numeric ? parseFloat(numeric) : null;
		}
		case "checkbox":
			return property.value === "true";
		default:
			return property.value.trim() ? property.value : null;
	}
}

// ---------- writing the note ----------

async function writeNote(
	app: App,
	behavior: ClipTemplate["behavior"],
	folder: string,
	noteName: string,
	properties: { name: string; value: string; type: string }[],
	body: string,
): Promise<TFile> {
	const vault = app.vault;
	const full = `${frontmatterFor(properties)}${body}`;

	if (behavior === "append-daily" || behavior === "prepend-daily") {
		const daily = await dailyNote(app);
		await addToNote(app, daily, behavior.startsWith("append"), properties, body);
		return daily;
	}

	const path = normalizePath(`${folder ? `${folder}/` : ""}${noteName}.md`);
	await ensureFolder(app, folder);
	const existing = vault.getAbstractFileByPath(path);

	if (behavior === "create") {
		let target = path;
		for (let n = 1; vault.getAbstractFileByPath(target); n++) {
			target = normalizePath(`${folder ? `${folder}/` : ""}${noteName} ${n}.md`);
		}
		return vault.create(target, full);
	}
	if (behavior === "overwrite") {
		if (existing instanceof TFile) {
			await vault.modify(existing, full);
			return existing;
		}
		return vault.create(path, full);
	}
	// append-specific, prepend-specific
	if (existing instanceof TFile) {
		await addToNote(app, existing, behavior.startsWith("append"), properties, body);
		return existing;
	}
	return vault.create(path, full);
}

/** Adds to a note that exists: properties merge into its frontmatter, the text goes at the end or the top. */
async function addToNote(
	app: App,
	file: TFile,
	atEnd: boolean,
	properties: { name: string; value: string; type: string }[],
	body: string,
): Promise<void> {
	if (properties.length) {
		await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			for (const property of properties) frontmatter[property.name] = propertyValue(property);
		});
	}
	await app.vault.process(file, (text) => {
		if (atEnd) return `${text.replace(/\s+$/, "")}${text.trim() ? "\n\n" : ""}${body}\n`;
		const fm = text.match(/^---\n[\s\S]*?\n---\n?/);
		const head = fm ? fm[0] : "";
		const rest = text.slice(head.length).replace(/^\s+/, "");
		return `${head}${head && !head.endsWith("\n") ? "\n" : ""}${body}\n${rest ? `\n${rest}` : ""}`;
	});
}

/** Today's daily note, made with the Daily notes settings (folder, format, template) if it does not exist. */
async function dailyNote(app: App): Promise<TFile> {
	const options =
		(
			app as unknown as {
				internalPlugins?: { getPluginById?: (id: string) => { instance?: { options?: Record<string, string> } } };
			}
		).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options ?? {};
	const format = options.format || "YYYY-MM-DD";
	const folder = (options.folder ?? "").replace(/^\/+|\/+$/g, "");
	const name = moment().format(format);
	const path = normalizePath(`${folder ? `${folder}/` : ""}${name}.md`);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;

	let text = "";
	const templatePath = options.template ? normalizePath(options.template.endsWith(".md") ? options.template : `${options.template}.md`) : "";
	const templateFile = templatePath ? app.vault.getAbstractFileByPath(templatePath) : null;
	if (templateFile instanceof TFile) {
		text = (await app.vault.read(templateFile))
			.replace(/{{\s*date\s*:(.*?)}}/gi, (_, f: string) => moment().format(f.trim()))
			.replace(/{{\s*time\s*:(.*?)}}/gi, (_, f: string) => moment().format(f.trim()))
			.replace(/{{\s*date\s*}}/gi, moment().format(format))
			.replace(/{{\s*time\s*}}/gi, moment().format("HH:mm"))
			.replace(/{{\s*title\s*}}/gi, name);
	}
	await ensureFolder(app, path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
	return app.vault.create(path, text);
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) return;
	let current = "";
	for (const part of folder.split("/")) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
	}
}

// ---------- small helpers ----------

function matchUrlTrigger(pattern: string, url: string): boolean {
	if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
		try {
			return new RegExp(pattern.slice(1, -1)).test(url);
		} catch {
			return false;
		}
	}
	return url.startsWith(pattern);
}

function matchSchemaTrigger(pattern: string, data: unknown): boolean {
	const match = pattern.match(/^schema:(@\w+)?(?:\.(.+?))?(?:=(.+))?$/);
	if (!match || (!match[1] && !match[2])) return false;
	const [, type, key, expected] = match;
	const list = (Array.isArray(data) ? data : [data]).flatMap((d) => (Array.isArray(d) ? d : [d]));
	for (const schema of list) {
		if (!schema || typeof schema !== "object") continue;
		const record = schema as Record<string, unknown>;
		if (type) {
			const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
			if (!types.includes(type.slice(1))) continue;
		}
		if (!key) return true;
		const value = nested(record, key);
		if (expected) {
			if (Array.isArray(value) ? value.includes(expected) : value === expected) return true;
		} else if (value !== undefined) {
			return true;
		}
	}
	return false;
}

function domainOf(url: string): string {
	try {
		const host = new URL(url).hostname;
		if (/^(localhost|(\d{1,3}\.){3}\d{1,3})$/.test(host)) return host;
		const parts = host.split(".");
		// co.uk, com.au and the like keep three parts.
		if (parts.length > 2 && /^(co|com|org|net|edu|gov|mil)\.[a-z]{2}$/.test(parts.slice(-2).join("."))) {
			return parts.slice(-3).join(".");
		}
		return parts.slice(-2).join(".");
	} catch {
		return "";
	}
}

/** Web Clipper's file-name rules: no Obsidian link characters, nothing the file system refuses. */
export function sanitizeFileName(name: string): string {
	const platform = navigator.platform || "";
	let clean = name.replace(/[#|^[\]]/g, "");
	if (/win/i.test(platform)) {
		clean = clean
			.replace(/[<>:"/\\?*\x00-\x1F]/g, "")
			.replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, "_$1$2")
			.replace(/[\s.]+$/, "");
	} else if (/mac/i.test(platform)) {
		clean = clean.replace(/[/:\x00-\x1F]/g, "").replace(/^\./, "_");
	} else {
		clean = clean.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/^\./, "_");
	}
	return clean.replace(/^\.+/, "").trim().slice(0, 245);
}
