import {build} from 'esbuild';
import {cp, mkdir, rm, writeFile} from 'node:fs/promises';

await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});

await build({
  entryPoints: ['src/main.js'],
  outfile: 'dist/app.js',
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  define: {'process.env.NODE_ENV': '"production"'},
});

await cp('index.html', 'dist/index.html');
await cp('styles.css', 'dist/styles.css');
// GitHub Pages: skip Jekyll processing, and serve index.html for unknown paths.
await writeFile('dist/.nojekyll', '');
await cp('index.html', 'dist/404.html');

console.log('built -> dist/');
