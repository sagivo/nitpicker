import { build } from "esbuild";

await build({
  entryPoints: ["src/lambda.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/lambda/index.js",
  format: "cjs",
  sourcemap: true,
  minify: false,
});

console.log("Lambda bundle built → dist/lambda/index.js");
