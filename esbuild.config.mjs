import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

esbuild
	.build({
		entryPoints: ["src/main.ts"],
		bundle: true,
		external: ["obsidian", "electron", ...builtinModules],
		format: "cjs",
		target: "es2018",
		logLevel: "info",
		sourcemap: prod ? false : "inline",
		minify: prod,
		treeShaking: true,
		outfile: "main.js",
		banner: {
			js: "/* Magazine Rack. Includes Defuddle, Knap, Day.js, Turndown and mathml-to-latex, all MIT: see THIRD_PARTY_NOTICES.md */",
		},
	})
	.catch(() => process.exit(1));
