import { build } from "esbuild";

await build({
  entryPoints: ["client/app.js"],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: ["es2022"],
  outfile: "public/app.js"
});
