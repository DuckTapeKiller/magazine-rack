import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
	{
		// Build output and dependencies are not source. main.js is made by esbuild.
		ignores: ["main.js", "node_modules/**"],
	},
	// ESLint's own recommended rules, for code only: Obsidian's config below also
	// lints package.json, manifest.json and the licence, where these cannot run.
	{ files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"], ...eslint.configs.recommended },
	// Obsidian's official guideline rules, as the community-plugin review runs them.
	// The recommended config carries its own file globs, so it is applied without narrowing.
	...obsidianmd.configs.recommended,
	{
		// The type-aware rules need the TypeScript program.
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		// The build and lint configs are plain ESM outside the TypeScript program.
		files: ["**/*.{js,cjs,mjs}"],
		...tseslint.configs.disableTypeChecked,
	},
	{
		// esbuild.config.mjs runs under Node at build time, never inside Obsidian.
		files: ["esbuild.config.mjs"],
		languageOptions: {
			globals: { process: "readonly" },
		},
	},
	{
		// Sentence case is Obsidian's convention; this declares the plugin's own
		// vocabulary so names and acronyms keep their capitals.
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: [
						"Magazine Rack",
						"Obsidian",
						"Obsidian Web Clipper",
						"Web Clipper",
						"DuckTapeKiller",
						"Ko-fi",
						"Español",
						"English",
						"Atom",
						"Defuddle",
						"Knap",
					],
					acronyms: ["RSS", "URL", "JSON", "HTTP", "HTML"],
				},
			],
		},
	},
);
