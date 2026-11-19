/**
 * Suppression de compte (droit à l'effacement, RGPD art. 17).
 *
 * Ce qui est fait :
 *  - abonnement Stripe résilié immédiatement (plus aucun prélèvement) ;
 *  - conversations de l'utilisateur (son côté : messages, brouillons) supprimées ;
 *  - côté des autres participants : la conversation reste lisible pour eux, mais
 *    le participant supprimé est anonymisé et la conversation est bloquée
 *    (on ne peut plus lui écrire) ;
 *  - le compte est anonymisé : nom, email, téléphone, mot de passe, photo, jeton
 *    de notification effacés, PIN remplacé, date de suppression posée. Plus
 *    aucune connexion possible (les jetons existants deviennent invalides) ;
 *  - toutes ses sessions sont révoquées (SessionService.revokeAll).
 *
 * Ce qui est conservé : l'identifiant technique (anonyme) pour la cohérence des
 * données comptables (usage_records, factures Stripe — obligation légale de
 * conservation des factures).
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../database';
import { RedisService } from '../../redis/redis.service';
import { StripeService } from '../billing/stripe.service';
import { USERS_REPOSITORY, type UsersRepository } from './repositories';
import { SessionService } from '../auth/sessions/session.service';

/** Ce que voient les autres participants à la place du compte supprimé */
export const DELETED_PARTICIPANT = {
  firstName: null,
  lastName: null,
  email: null,
  gender: null,
  profilePicture: null,
  isPlaceholder: false,
  deleted: true,
};

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly stripe: StripeService,
    private readonly sessions: SessionService,
  ) {}

  async deleteAccount(userId: string, password?: string): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new UnauthorizedException('Compte introuvable.');

    // Compte avec mot de passe : confirmation obligatoire (évite une suppression
    // depuis une session volée ou un appareil laissé ouvert)
    if (user.passwordHash) {
      if (!password) {
        throw new BadRequestException(
          'Mot de passe requis pour supprimer le compte.',
        );
      }
      if (!(await bcrypt.compare(password, user.passwordHash))) {
        throw new UnauthorizedException('Mot de passe incorrect.');
      }
    }

    // 1. Plus aucun prélèvement
    if (user.stripeSubscriptionId) {
      await this.stripe.cancelSubscriptionNow(user.stripeSubscriptionId);
    }

    const own = await this.prisma.humlinker.findMany({
      where: { senderId: userId },
      select: { id: true },
    });
    const ownIds = own.map((h) => h.id);

    await this.prisma.$transaction([
      // 2. Côté des autres : conversation conservée, participant anonymisé, bloquée
      this.prisma.humlinker.updateMany({
        where: { targetId: userId },
        data: {
          status: 'blocked',
          blockedBy: userId,
          mirrorId: null,
          targetSnapshot: { userId, language: user.language, ...DELETED_PARTICIPANT },
        },
      }),
      // 3. Son propre côté : supprimé (messages et brouillons en cascade)
      this.prisma.humlinker.deleteMany({ where: { senderId: userId } }),
      // 4. Compte anonymisé
      this.prisma.user.update({
        where: { id: userId },
        data: {
          firstName: null,
          lastName: null,
          email: null,
          phoneNumber: null,
          passwordHash: null,
          profilePicture: null,
          gender: null,
          fcmToken: null,
          authProviders: [],
          pin: `X${randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`,
          plan: 'free',
          planExpiresAt: null,
          deletedAt: new Date(),
        },
      }),
    ]);

    // 5. Toutes ses sessions fermées (jetons de rafraîchissement + jetons d'accès)
    await this.sessions.revokeAll(userId).catch((err: unknown) =>
      this.logger.warn(`Révocation des sessions de ${userId} échouée : ${String(err)}`),
    );

    // 6. Caches liés à ses conversations
    await Promise.all(
      ownIds.map((id) => this.redis.del(`draft-versions:${id}`).catch(() => {})),
    );
    this.logger.log(`Compte ${userId} supprimé (${ownIds.length} conversation(s))`);
  }
}
