// esbuild で src/ → public/app.js にバンドルする。
// ビルド済み app.js はコミットされるため、利用者はビルド不要（npm install --omit=dev のみ）。
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.jsx'],
  bundle: true,
  outfile: 'public/app.js',
  format: 'iife',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['es2020'],
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching src/ …');
} else {
  await esbuild.build(options);
}
