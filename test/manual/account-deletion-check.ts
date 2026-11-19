/**
 * Vérification réelle de la suppression de compte (base locale, aucun service externe).
 * Crée 2 comptes temporaires @humlinker.test + une conversation, supprime l'un,
 * contrôle le résultat, puis nettoie tout.
 *   npx ts-node -r tsconfig-paths/register --transpile-only test/manual/account-deletion-check.ts
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database';
import { AccountDeletionService } from '../../src/modules/users/account-deletion.service';
import { USERS_REPOSITORY } from '../../src/modules/users/repositories';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const deletion = app.get(AccountDeletionService);
  const usersRepo = app.get(USERS_REPOSITORY);
  const tag = Date.now().toString(36).toUpperCase().slice(-6);
  const snap = (u: { id: string; firstName: string | null; email: string | null }) => ({
    userId: u.id, firstName: u.firstName, lastName: null, email: u.email,
    language: 'fr', gender: null, profilePicture: null, isPlaceholder: false,
  });
  const failures: string[] = [];
  const check = (ok: boolean, label: string) => { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failures.push(label); };

  const a = await prisma.user.create({ data: { pin: `T${tag}A`.slice(0, 8), email: `del-a-${tag.toLowerCase()}@humlinker.test`, firstName: 'Alice', language: 'fr' } });
  const b = await prisma.user.create({ data: { pin: `T${tag}B`.slice(0, 8), email: `del-b-${tag.toLowerCase()}@humlinker.test`, firstName: 'Bob', language: 'fr' } });
  try {
    const base = { communicationChannel: 'app' as const, targetContactName: 'x', relationshipType: 'other', title: 't' };
    const ha = await prisma.humlinker.create({ data: { ...base, senderId: a.id, targetId: b.id, senderSnapshot: snap(a), targetSnapshot: snap(b) } });
    const hb = await prisma.humlinker.create({ data: { ...base, senderId: b.id, targetId: a.id, mirrorId: ha.id, isInitiator: false, senderSnapshot: snap(b), targetSnapshot: snap(a) } });
    await prisma.humlinker.update({ where: { id: ha.id }, data: { mirrorId: hb.id } });
    await prisma.chatMessage.create({ data: { humhlinkerId: ha.id, role: 'user', content: 'message privé d’Alice' } });

    await deletion.deleteAccount(a.id);

    const ua = await prisma.user.findUnique({ where: { id: a.id } });
    check(!!ua?.deletedAt && ua.email === null && ua.firstName === null, 'compte anonymisé (email, nom effacés, deletedAt posé)');
    check((await usersRepo.findById(a.id)) === null, 'compte introuvable pour l’application (connexion impossible)');
    check((await prisma.humlinker.findUnique({ where: { id: ha.id } })) === null, 'conversation d’Alice supprimée');
    check((await prisma.chatMessage.count({ where: { humhlinkerId: ha.id } })) === 0, 'messages d’Alice supprimés');
    const hbAfter = await prisma.humlinker.findUnique({ where: { id: hb.id } });
    const t = hbAfter?.targetSnapshot as { deleted?: boolean; email?: string | null; firstName?: string | null };
    check(hbAfter?.status === 'blocked' && hbAfter.mirrorId === null, 'conversation de Bob conservée et bloquée');
    check(t?.deleted === true && t.email === null && t.firstName === null, 'Alice anonymisée chez Bob');
  } finally {
    await prisma.humlinker.deleteMany({ where: { OR: [{ senderId: { in: [a.id, b.id] } }, { targetId: { in: [a.id, b.id] } }] } });
    await prisma.usageRecord.deleteMany({ where: { userId: { in: [a.id, b.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    await app.close();
  }
  console.log(failures.length ? `\n${failures.length} échec(s)` : '\nSuppression de compte : tout est conforme.');
  process.exit(failures.length ? 1 : 0);
}
void main();
