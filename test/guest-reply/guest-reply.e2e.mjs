/**
 * Test réel de bout en bout — « répondre sans installer l'appli » (jeton invité).
 *
 * Prérequis : backend lancé (par défaut http://localhost:3001/api/v1), même .env.
 *   node test/guest-reply/guest-reply.e2e.mjs
 *   E2E_API=http://localhost:3000/api/v1 node test/guest-reply/guest-reply.e2e.mjs
 *
 * Aucun vrai email : le premier message est déposé directement dans le humlinker
 * miroir (ce que fait dispatchToTarget) et le jeton invité est signé ici avec le
 * secret du serveur (même charge utile que signGuestToken).
 * Appelle réellement l'IA (1 reformulation). Nettoie tout à la fin, même en cas d'échec.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

// ─── .env ──────────────────────────────────────────────────────────────────
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const API = process.env.E2E_API ?? 'http://localhost:3001/api/v1';
const SECRET = process.env.JWT_SECRET ?? 'humlinker-dev-secret-change-in-production';

const prisma = new PrismaClient();
const stamp = Date.now().toString(36);
const senderEmail = `guest-e2e-sender-${stamp}@humlinker.test`;
const targetEmail = `guest-e2e-target-${stamp}@humlinker.test`;
const created = { users: [], humlinkers: [] };

let passed = 0;
function check(label, cond, detail) {
  if (!cond) {
    throw new Error(`ÉCHEC — ${label}${detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

async function main() {
  console.log(`API : ${API}`);

  // 1. Expéditeur inscrit (créé directement en base, session signée ici)
  const sender = await prisma.user.create({
    data: {
      email: senderEmail,
      firstName: 'Aaron',
      lastName: 'E2E',
      language: 'fr',
      gender: 'male',
      pin: randomBytes(4).toString('hex').toUpperCase(),
      isEmailVerified: true,
    },
  });
  created.users.push(sender.id);
  const senderToken = jwt.sign({ userId: sender.id, role: 'user' }, SECRET, { expiresIn: '1h' });

  // 2. Humlinker vers un destinataire sans compte (placeholder + miroir créés par l'API)
  const hl = await call('POST', '/humlinkers', senderToken, {
    targetContactEmail: targetEmail,
    targetFirstName: 'Lea',
    communicationChannel: 'email',
    relationshipType: 'amie',
    targetLanguage: 'en',
  });
  check('création du humlinker vers un placeholder', hl.status === 201, hl.body);
  const senderHl = hl.body.data;
  created.humlinkers.push(senderHl._id, senderHl.mirrorId);
  created.users.push(senderHl.targetId);
  const placeholder = await prisma.user.findUnique({ where: { id: senderHl.targetId } });
  check('le destinataire est un placeholder', placeholder?.isPlaceholder === true);
  const mirrorId = senderHl.mirrorId;

  // 3. Message reçu (ce que dispatchToTarget dépose dans le miroir) + jeton invité
  const firstMessage = 'Hi Lea, Aaron would like to know if you are free for dinner on Saturday.';
  await prisma.chatMessage.create({
    data: { humhlinkerId: mirrorId, role: 'user', type: 'real_message', content: firstMessage },
  });
  const guestToken = jwt.sign(
    { userId: placeholder.id, scope: 'guest', humlinkerId: mirrorId },
    SECRET,
    { expiresIn: '30d' },
  );

  // 4. Accès autorisés
  const me = await call('GET', '/users/me', guestToken);
  check('GET /users/me avec le jeton invité', me.status === 200 && me.body.data._id === placeholder.id, me.body);

  const mirror = await call('GET', `/humlinkers/${mirrorId}`, guestToken);
  check('GET /humlinkers/:mirrorId', mirror.status === 200, mirror.body);
  check('langue du destinataire dans le miroir = en', mirror.body.data.sender.language === 'en', mirror.body.data.sender);

  const chat = await call('GET', `/humlinkers/${mirrorId}/messages`, guestToken);
  check(
    "l'invité lit le message reçu",
    chat.status === 200 && chat.body.data.messages.some((m) => m.type === 'real_message' && m.content === firstMessage),
    chat.body,
  );

  // 5. Il écrit → l'IA prépare le brouillon (« Voici ce que je vais transmettre »)
  const write = await call('POST', `/humlinkers/${mirrorId}/messages`, guestToken, {
    content: "Yes I'm free on Saturday, 8pm works for me!",
  });
  check("l'invité écrit à l'IA", write.status === 201, write.body);
  const draft = write.body.data.activeDraft;
  check(
    'brouillon reçu avec aperçu + message réel',
    !!draft && draft.realMessage.length > 0 && draft.senderPreview.length > 0,
    write.body.data,
  );
  console.log(`    aperçu (en)  : ${draft.senderPreview}`);
  console.log(`    transmis (fr): ${draft.realMessage}`);

  // Option : laisse le temps d'ouvrir la page invitée dans un navigateur
  const pause = parseInt(process.env.E2E_PAUSE_SEC ?? '0', 10);
  if (pause > 0) {
    const front = process.env.E2E_FRONT ?? 'http://localhost:5176';
    console.log(`    page invitée (${pause} s) : ${front}/reply/${guestToken}`);
    await new Promise((r) => setTimeout(r, pause * 1000));
  }

  // 6. Il envoie → l'expéditeur le reçoit dans l'appli
  const send = await call('POST', `/humlinkers/${mirrorId}/send`, guestToken);
  check("l'invité envoie le brouillon", send.status === 201, send.body);
  const senderChat = await call('GET', `/humlinkers/${senderHl._id}/messages`, senderToken);
  check(
    "l'expéditeur reçoit la réponse dans l'appli",
    senderChat.status === 200 &&
      senderChat.body.data.messages.some((m) => m.type === 'real_message' && m.content === draft.realMessage),
    senderChat.body,
  );

  // 7. Accès refusés
  const usage = await call('GET', '/billing/usage', guestToken);
  check('refusé sur /billing/usage (403)', usage.status === 403, usage);
  const other = await call('GET', `/humlinkers/${senderHl._id}/messages`, guestToken);
  check('refusé sur un autre humlinker (403)', other.status === 403, other);
  const list = await call('GET', '/humlinkers', guestToken);
  check('refusé sur la liste des humlinkers (403)', list.status === 403, list);
  const edit = await call('PATCH', '/users/me', guestToken, { firstName: 'Pirate' });
  check('refusé sur la modification du profil (403)', edit.status === 403, edit);

  // 8. Jeton falsifié / jeton d'un compte devenu réel
  const forged = jwt.sign({ userId: placeholder.id, scope: 'guest', humlinkerId: mirrorId }, 'mauvais-secret');
  const bad = await call('GET', `/humlinkers/${mirrorId}/messages`, forged);
  check('jeton signé avec un autre secret → 401', bad.status === 401, bad);
  await prisma.user.update({ where: { id: placeholder.id }, data: { isPlaceholder: false } });
  const upgraded = await call('GET', `/humlinkers/${mirrorId}/messages`, guestToken);
  check('compte devenu réel : lien invité refusé (401)', upgraded.status === 401, upgraded);
}

async function cleanup() {
  const users = created.users.filter(Boolean);
  const humlinkers = created.humlinkers.filter(Boolean);
  // Les messages et brouillons partent en cascade avec les humlinkers
  await prisma.usageRecord.deleteMany({
    where: { OR: [{ userId: { in: users } }, { humhlinkerId: { in: humlinkers } }] },
  });
  await prisma.humlinker.deleteMany({
    where: { OR: [{ id: { in: humlinkers } }, { senderId: { in: users } }, { targetId: { in: users } }] },
  });
  await prisma.user.deleteMany({
    where: { OR: [{ id: { in: users } }, { email: { in: [senderEmail, targetEmail] } }] },
  });
  const left = await prisma.user.count({ where: { email: { in: [senderEmail, targetEmail] } } });
  console.log(`Nettoyage : ${left === 0 ? 'OK' : left + ' utilisateur(s) restant(s) !'}`);
}

let failed = false;
try {
  await main();
  console.log(`\n${passed} vérifications réussies.`);
} catch (err) {
  failed = true;
  console.error('\n' + (err?.message ?? err));
} finally {
  await cleanup().catch((e) => {
    failed = true;
    console.error('Nettoyage en échec :', e);
  });
  await prisma.$disconnect();
}
process.exit(failed ? 1 : 0);
