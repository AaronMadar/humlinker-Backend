/**
 * Test réel de bout en bout — sessions de connexion (refresh, rotation, réutilisation,
 * logout, logout-all, changement de mot de passe, suppression de compte, jeton invité,
 * WebSocket).
 *
 * Prérequis : backend lancé (par défaut http://localhost:3002/api/v1), même .env.
 *   node test/session-security/session-security.e2e.mjs
 *   E2E_API=http://localhost:3000/api/v1 node test/session-security/session-security.e2e.mjs
 *   E2E_SOCKET_CLIENT=<chemin de socket.io-client> (facultatif — sinon test WebSocket ignoré)
 *
 * Comptes temporaires `sess-e2e-…@humlinker.test` créés directement en base (pas
 * d'OTP, aucun email, aucun appel IA). Tout est supprimé à la fin, même en cas d'échec.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// ─── .env ──────────────────────────────────────────────────────────────────
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const API = process.env.E2E_API ?? 'http://localhost:3002/api/v1';
const SECRET = process.env.JWT_SECRET ?? 'humlinker-dev-secret-change-in-production';
const PASSWORD = 'Sess-e2e-Passw0rd!';
const NEW_PASSWORD = 'Sess-e2e-Passw0rd-2!';

const prisma = new PrismaClient();
const stamp = Date.now().toString(36);
const createdUserIds = [];

let passed = 0;
function check(label, cond, detail) {
  if (!cond) {
    throw new Error(`ÉCHEC — ${label}${detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function createUser(label, extra = {}) {
  const pin = `T${randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`;
  const user = await prisma.user.create({
    data: {
      pin,
      email: `sess-e2e-${label}-${stamp}@humlinker.test`,
      language: 'fr',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      authProviders: ['local'],
      isEmailVerified: true,
      ...extra,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function login(email, password = PASSWORD) {
  const r = await call('POST', '/auth/login', { body: { identifier: email, password } });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.data.token, refreshToken: r.json.data.refreshToken };
}

const me = (token) => call('GET', '/users/me', { token });
const refresh = (refreshToken) => call('POST', '/auth/refresh', { body: { refreshToken } });

async function main() {
  console.log(`API : ${API}`);
  const a = await createUser('a');

  console.log('\n1. Connexion : jeton court + jeton de rafraîchissement');
  const d1 = await login(a.email);
  const p1 = jwt.decode(d1.token);
  check('la connexion renvoie un refreshToken', typeof d1.refreshToken === 'string' && d1.refreshToken.startsWith(`${p1.sid}.`));
  check('jeton d’accès de 15 min', p1.exp - p1.iat === 15 * 60, p1);
  check('GET /users/me avec le jeton d’accès', (await me(d1.token)).status === 200);

  console.log('\n2. Rotation et détection de réutilisation');
  const r2 = await refresh(d1.refreshToken);
  check('refresh → nouvelle paire', r2.status === 200 && r2.json.data.refreshToken !== d1.refreshToken, r2.json);
  const t2 = r2.json.data;
  check('le nouveau jeton d’accès fonctionne', (await me(t2.token)).status === 200);
  const race = await refresh(d1.refreshToken);
  check('ancien jeton juste après rotation → refresh_race (pas de révocation)', race.status === 401 && race.json.code === 'refresh_race', race.json);
  const r3 = await refresh(t2.refreshToken);
  check('la session continue après la course', r3.status === 200, r3.json);
  const t3 = r3.json.data;
  const reused = await refresh(d1.refreshToken);
  check('jeton consommé depuis longtemps → refresh_reused', reused.status === 401 && reused.json.code === 'refresh_reused', reused.json);
  check('…toute la famille est révoquée (dernier refresh refusé)', (await refresh(t3.refreshToken)).status === 401);
  check('…et son jeton d’accès est refusé immédiatement', (await me(t3.token)).status === 401);

  console.log('\n3. Déconnexion de cet appareil');
  const d2 = await login(a.email);
  const d3 = await login(a.email);
  const out = await call('POST', '/auth/logout', { body: { refreshToken: d2.refreshToken } });
  check('POST /auth/logout → 200', out.status === 200, out.json);
  check('jeton d’accès de la session fermée refusé', (await me(d2.token)).status === 401);
  check('refresh de la session fermée refusé', (await refresh(d2.refreshToken)).status === 401);
  check('l’autre appareil reste connecté', (await me(d3.token)).status === 200);
  check('logout idempotent', (await call('POST', '/auth/logout', { body: { refreshToken: d2.refreshToken } })).status === 200);

  console.log('\n4. Changement de mot de passe → autres sessions révoquées');
  const d4 = await login(a.email);
  const pwd = await call('PATCH', '/users/me/password', {
    token: d3.token,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  check('PATCH /users/me/password → nouveau jeton pour cet appareil', pwd.status === 200 && typeof pwd.json.data.token === 'string', pwd.json);
  check('le nouveau jeton fonctionne', (await me(pwd.json.data.token)).status === 200);
  check('l’ancien jeton de cet appareil est refusé (version changée)', (await me(d3.token)).status === 401);
  check('cet appareil peut toujours se rafraîchir', (await refresh(d3.refreshToken)).status === 200);
  check('l’autre appareil est déconnecté (accès)', (await me(d4.token)).status === 401);
  check('l’autre appareil est déconnecté (refresh)', (await refresh(d4.refreshToken)).status === 401);

  console.log('\n5. Déconnecter tous mes appareils');
  const d5 = await login(a.email, NEW_PASSWORD);
  const d6 = await login(a.email, NEW_PASSWORD);
  const legacy = jwt.sign({ userId: a.id, role: 'user', tv: 1 }, SECRET, { expiresIn: '1h' });
  check('jeton « ancien format » (sans session) accepté avant', (await me(legacy)).status === 200);

  let socketResult = 'ignoré';
  let socket;
  const socketClientPath = process.env.E2E_SOCKET_CLIENT;
  if (socketClientPath) {
    const { io } = createRequire(import.meta.url)(socketClientPath);
    socket = io(`${API.replace(/\/api\/v1$/, '')}/humlinker`, {
      auth: { token: d6.token },
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    // Le serveur rejoint la room après la connexion : petite marge
    await new Promise((r) => setTimeout(r, 300));
    socketResult = new Promise((resolve) => {
      const timer = setTimeout(() => resolve('pas coupé'), 5000);
      socket.on('disconnect', (reason) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });
  }

  const all = await call('POST', '/auth/logout-all', { token: d5.token });
  check('POST /auth/logout-all → 200', all.status === 200, all.json);
  for (const [name, d] of [['appareil courant', d5], ['autre appareil', d6]]) {
    check(`${name} : accès refusé`, (await me(d.token)).status === 401);
    check(`${name} : refresh refusé`, (await refresh(d.refreshToken)).status === 401);
  }
  check('jeton « ancien format » refusé après logout-all', (await me(legacy)).status === 401);
  if (socket) {
    const reason = await socketResult;
    check('WebSocket coupé par le serveur', reason === 'io server disconnect', reason);
    socket.close();
  } else {
    console.log('  – WebSocket : ignoré (E2E_SOCKET_CLIENT non défini)');
  }

  console.log('\n6. Jeton invité (lien « Répondre ») intact');
  const placeholder = await createUser('guest', { isPlaceholder: true, passwordHash: null, tokenVersion: 3 });
  const guest = jwt.sign(
    { userId: placeholder.id, scope: 'guest', humlinkerId: 'not-a-real-humlinker' },
    SECRET,
    { expiresIn: '30d' },
  );
  check('jeton invité accepté sur GET /users/me', (await me(guest)).status === 200);
  check('jeton invité toujours bloqué ailleurs', (await call('POST', '/auth/logout-all', { token: guest })).status === 403);

  console.log('\n7. Suppression de compte → toutes les sessions révoquées');
  const b = await createUser('b');
  const e1 = await login(b.email);
  const e2 = await login(b.email);
  const del = await call('DELETE', '/users/me', { token: e1.token, body: { password: PASSWORD } });
  check('DELETE /users/me → 200', del.status === 200, del.json);
  check('autre appareil : accès refusé', (await me(e2.token)).status === 401);
  check('autre appareil : refresh refusé', (await refresh(e2.refreshToken)).status === 401);
}

async function cleanup() {
  if (createdUserIds.length) {
    const { count } = await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    console.log(`\nNettoyage : ${count} compte(s) temporaire(s) supprimé(s).`);
  }
  await prisma.$disconnect();
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${passed} vérifications OK.`);
  })
  .catch(async (err) => {
    console.error(`\n${err.message}`);
    await cleanup().catch((e) => console.error('Nettoyage échoué :', e));
    process.exit(1);
  });
