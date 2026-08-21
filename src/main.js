import {SimplePool} from 'nostr-tools/pool';
import {generateSecretKey, getPublicKey, verifyEvent} from 'nostr-tools/pure';
import {npubEncode} from 'nostr-tools/nip19';
import {
  BunkerSigner,
  parseBunkerInput,
  createNostrConnectURI,
} from 'nostr-tools/nip46';
import qrcode from 'qrcode-generator';

// ── config ────────────────────────────────────────────────────────────────
const DEFAULT_INSTANCE = 'https://cornychat.com';
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
];
const KEY = {
  session: 'ccl.session',
  instance: 'ccl.instance',
  relays: 'ccl.relays',
};

const $ = id => document.getElementById(id);
const pool = new SimplePool();

// ── tiny helpers ──────────────────────────────────────────────────────────
const toHex = bytes =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

const fromHex = hex =>
  Uint8Array.from(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));

const randomHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));

// Matches the room ids Corny Chat itself hands out from `/new`.
const randomRoom = () => Math.random().toString(36).slice(2, 8);

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

// ── settings ──────────────────────────────────────────────────────────────
let instance = load(KEY.instance, DEFAULT_INSTANCE);
let relays = load(KEY.relays, DEFAULT_RELAYS);

function normalizeInstance(url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_INSTANCE;
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeRelays(text) {
  const list = String(text || '')
    .split(/[\s,]+/)
    .map(r => r.trim())
    .filter(r => /^wss?:\/\//.test(r));
  return list.length ? list : DEFAULT_RELAYS;
}

function renderSettings() {
  $('instance-input').value = instance;
  $('relays-input').value = relays.join('\n');
  renderRoomPreview();
}

// ── session state ─────────────────────────────────────────────────────────
// signer: {method: 'nip07'|'bunker', pubkey, signEvent(t), close()}
let signer = null;
let bunkerAbort = null;

function setLoginError(message) {
  const el = $('login-error');
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function showLoggedIn() {
  $('login').classList.add('hidden');
  $('account').classList.remove('hidden');
  $('rooms').classList.remove('hidden');
}

function showLoggedOut() {
  $('login').classList.remove('hidden');
  $('account').classList.add('hidden');
  $('rooms').classList.add('hidden');
  $('verify-out').classList.add('hidden');
  $('avatar').removeAttribute('src');
}

async function activate(next) {
  signer = next;
  $('npub').textContent = npubEncode(next.pubkey);
  $('display-name').textContent = 'anon';
  $('method-badge').textContent =
    next.method === 'nip07' ? 'NIP-07 extension' : 'NIP-46 bunker';
  setLoginError('');
  showLoggedIn();
  loadProfile(next.pubkey);
}

async function loadProfile(pubkey) {
  try {
    const event = await pool.get(relays, {kinds: [0], authors: [pubkey]});
    if (!event) return;
    const meta = JSON.parse(event.content);
    const name = meta.display_name || meta.name;
    if (name) $('display-name').textContent = name;
    if (meta.picture) $('avatar').src = meta.picture;
  } catch {
    // A missing or malformed profile is not a login failure — stay signed in.
  }
}

// ── NIP-07 ────────────────────────────────────────────────────────────────
async function loginNip07() {
  setLoginError('');
  try {
    const pubkey = await window.nostr.getPublicKey();
    await activate({
      method: 'nip07',
      pubkey,
      signEvent: t => window.nostr.signEvent(t),
      close: async () => {},
    });
    save(KEY.session, {method: 'nip07', pubkey});
  } catch (err) {
    setLoginError(`Extension sign-in failed: ${err.message || err}`);
  }
}

// ── NIP-46 ────────────────────────────────────────────────────────────────
function wrapBunker(bunker, pubkey) {
  return {
    method: 'bunker',
    pubkey,
    signEvent: t => bunker.signEvent(t),
    close: () => bunker.close().catch(() => {}),
  };
}

const bunkerParams = () => ({
  pool,
  onauth: url => window.open(url, '_blank', 'noopener'),
});

async function loginBunker() {
  const input = $('bunker-input').value.trim();
  if (!input) return setLoginError('Paste a bunker:// URI or a NIP-05 address.');

  const button = $('btn-bunker');
  button.disabled = true;
  button.textContent = 'Connecting…';
  setLoginError('');

  try {
    const pointer = await parseBunkerInput(input);
    if (!pointer) throw new Error('could not parse that bunker URI or NIP-05 address');

    const clientSecret = generateSecretKey();
    const bunker = BunkerSigner.fromBunker(clientSecret, pointer, bunkerParams());
    await bunker.connect();
    const pubkey = await bunker.getPublicKey();

    await activate(wrapBunker(bunker, pubkey));
    save(KEY.session, {
      method: 'bunker',
      pubkey,
      pointer,
      clientSecret: toHex(clientSecret),
    });
  } catch (err) {
    setLoginError(`Bunker connection failed: ${err.message || err}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Connect bunker';
  }
}

async function startNostrConnect() {
  setLoginError('');
  $('btn-nc').classList.add('hidden');
  $('nc-panel').classList.remove('hidden');
  $('nc-status').textContent = 'Waiting for your signer to approve…';

  const clientSecret = generateSecretKey();
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientSecret),
    relays,
    secret: randomHex(16),
    perms: ['sign_event:1', 'sign_event:27235', 'nip44_encrypt', 'nip44_decrypt'],
    name: 'Corny Chat Nostr Launcher',
    url: location.origin,
  });

  $('nc-uri').value = uri;
  const qr = qrcode(0, 'L');
  qr.addData(uri);
  qr.make();
  $('nc-qr').innerHTML = qr.createSvgTag(4, 0);

  bunkerAbort = new AbortController();
  try {
    const bunker = await BunkerSigner.fromURI(
      clientSecret,
      uri,
      bunkerParams(),
      bunkerAbort.signal
    );
    const pubkey = await bunker.getPublicKey();
    resetNostrConnect();
    await activate(wrapBunker(bunker, pubkey));
    save(KEY.session, {
      method: 'bunker',
      pubkey,
      pointer: bunker.bp,
      clientSecret: toHex(clientSecret),
    });
  } catch (err) {
    if (bunkerAbort?.signal.aborted) return;
    $('nc-status').textContent = `Connect failed: ${err.message || err}`;
  }
}

function resetNostrConnect() {
  bunkerAbort?.abort();
  bunkerAbort = null;
  $('nc-panel').classList.add('hidden');
  $('btn-nc').classList.remove('hidden');
  $('nc-qr').innerHTML = '';
  $('nc-uri').value = '';
}

// Re-attach to a bunker we were already authorized with, using the same
// client key so the remote signer recognizes the session.
async function restoreBunker(session) {
  try {
    const bunker = BunkerSigner.fromBunker(
      fromHex(session.clientSecret),
      session.pointer,
      bunkerParams()
    );
    await bunker.connect();
    await activate(wrapBunker(bunker, session.pubkey));
  } catch {
    localStorage.removeItem(KEY.session);
    showLoggedOut();
  }
}

// ── signing check ─────────────────────────────────────────────────────────
// Signs a NIP-98 style auth event and verifies it locally. Nothing is
// published, so this proves the signer works without touching a relay.
async function verifySigner() {
  const out = $('verify-out');
  const button = $('btn-verify');
  button.disabled = true;
  out.classList.remove('hidden');
  out.textContent = 'Requesting a signature…';

  try {
    const signed = await signer.signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', location.href],
        ['method', 'GET'],
      ],
      content: '',
    });
    if (signed.pubkey !== signer.pubkey) {
      throw new Error('signer returned a different pubkey');
    }
    out.textContent = verifyEvent(signed)
      ? `✓ valid signature — ${signed.sig.slice(0, 24)}…`
      : '✗ signature did not verify';
  } catch (err) {
    out.textContent = `✗ signing failed: ${err.message || err}`;
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  await signer?.close();
  signer = null;
  localStorage.removeItem(KEY.session);
  showLoggedOut();
}

// ── rooms ─────────────────────────────────────────────────────────────────
function cleanRoom(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

function roomURL(room) {
  return `${instance}/${room}`;
}

function renderRoomPreview() {
  const room = cleanRoom($('room-input').value);
  $('room-preview').textContent = roomURL(room || 'my-room');
}

function openRoom(room) {
  const name = cleanRoom(room);
  if (!name) {
    $('room-input').focus();
    return;
  }
  window.open(roomURL(name), '_blank', 'noopener');
}

// ── wiring ────────────────────────────────────────────────────────────────
function wire() {
  const hasExtension = typeof window.nostr !== 'undefined';
  $('btn-nip07').disabled = !hasExtension;
  $('nip07-hint').textContent = hasExtension
    ? 'Signer extension detected.'
    : 'No signer extension found — use a remote bunker below.';

  $('btn-nip07').onclick = loginNip07;
  $('btn-bunker').onclick = loginBunker;
  $('bunker-input').onkeydown = e => e.key === 'Enter' && loginBunker();
  $('btn-nc').onclick = startNostrConnect;
  $('btn-nc-cancel').onclick = resetNostrConnect;
  $('btn-nc-copy').onclick = () => {
    navigator.clipboard.writeText($('nc-uri').value);
    $('btn-nc-copy').textContent = 'Copied';
    setTimeout(() => ($('btn-nc-copy').textContent = 'Copy URI'), 1200);
  };

  $('btn-verify').onclick = verifySigner;
  $('btn-logout').onclick = logout;

  $('room-input').oninput = renderRoomPreview;
  $('room-input').onkeydown = e =>
    e.key === 'Enter' && openRoom($('room-input').value);
  $('btn-join').onclick = () => openRoom($('room-input').value);
  $('btn-random').onclick = () => {
    const room = randomRoom();
    $('room-input').value = room;
    renderRoomPreview();
    openRoom(room);
  };

  $('btn-save-settings').onclick = () => {
    instance = normalizeInstance($('instance-input').value);
    relays = normalizeRelays($('relays-input').value);
    save(KEY.instance, instance);
    save(KEY.relays, relays);
    renderSettings();
    const out = $('settings-out');
    out.textContent = `Saved — ${instance}, ${relays.length} relay(s).`;
    out.classList.remove('hidden');
  };
  $('btn-reset-settings').onclick = () => {
    instance = DEFAULT_INSTANCE;
    relays = DEFAULT_RELAYS;
    localStorage.removeItem(KEY.instance);
    localStorage.removeItem(KEY.relays);
    renderSettings();
    $('settings-out').classList.add('hidden');
  };
}

async function boot() {
  wire();
  renderSettings();

  const session = load(KEY.session, null);
  if (!session) return;

  if (session.method === 'nip07' && typeof window.nostr !== 'undefined') {
    await loginNip07();
  } else if (session.method === 'bunker' && session.clientSecret) {
    await restoreBunker(session);
  } else {
    localStorage.removeItem(KEY.session);
  }
}

boot();
