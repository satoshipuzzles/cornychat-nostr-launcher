// Loads the built bundle in a DOM and asserts the app boots clean:
// no uncaught errors, and the logged-out UI wired up as expected.
import {JSDOM, VirtualConsole} from 'jsdom';
import {readFileSync} from 'node:fs';

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => errors.push(e.message));
virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

const dom = new JSDOM(readFileSync('dist/index.html', 'utf8'), {
  runScripts: 'outside-only',
  url: 'https://example.github.io/cornychat-nostr-launcher/',
  virtualConsole,
});

const {window} = dom;
window.crypto ??= (await import('node:crypto')).webcrypto;

// The bundle is ESM; evaluate it as a classic script in the jsdom window.
window.eval(readFileSync('dist/app.js', 'utf8').replace(/^export\s*\{.*?\};?\s*$/gm, ''));
await new Promise(r => setTimeout(r, 250));

const $ = id => window.document.getElementById(id);
const check = [];
const assert = (name, cond) => check.push([name, !!cond]);

assert('no uncaught errors', errors.length === 0);
assert('login panel visible', !$('login').classList.contains('hidden'));
assert('account panel hidden', $('account').classList.contains('hidden'));
assert('rooms panel hidden', $('rooms').classList.contains('hidden'));
assert('nip07 disabled without extension', $('btn-nip07').disabled === true);
assert('nip07 hint set', /No signer extension/.test($('nip07-hint').textContent));
assert('instance default', $('instance-input').value === 'https://cornychat.com');
assert('relays prefilled', $('relays-input').value.split('\n').length === 4);
assert(
  'room preview',
  $('room-preview').textContent === 'https://cornychat.com/my-room'
);

// room name sanitizing runs through the live input handler
$('room-input').value = '  My Cool Room!! ';
$('room-input').dispatchEvent(new window.Event('input'));
assert(
  'room name sanitized',
  $('room-preview').textContent === 'https://cornychat.com/my-cool-room'
);

let failed = 0;
for (const [name, ok] of check) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (errors.length) console.log('\nerrors:\n' + errors.join('\n'));
console.log(`\n${check.length - failed}/${check.length} passed`);
process.exit(failed ? 1 : 0);
