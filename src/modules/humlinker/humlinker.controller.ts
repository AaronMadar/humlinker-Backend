/**
 * HumlinkerController
 *
 * Expose les routes de gestion des humlinkers.
 * Toutes ces routes nécessitent un JWT valide.
 *
 * ─── Routes ────────────────────────────────────────────────────────────────
 *
 *  POST   /api/v1/humlinkers                → Créer un humlinker
 *  GET    /api/v1/humlinkers                → Liste de mes humlinkers (lazy load)
 *  GET    /api/v1/humlinkers/:id            → Détail d'un humlinker
 *  PATCH  /api/v1/humlinkers/:id/archive    → Archiver
 *  PATCH  /api/v1/humlinkers/:id/unarchive  → Désarchiver
 *  PATCH  /api/v1/humlinkers/:id/block      → Bloquer (les deux côtés)
 *  POST   /api/v1/humlinkers/sync-contacts  → Synchroniser les contacts téléphone
 *  GET    /api/v1/humlinkers/contacts       → Récupérer les contacts (déjà syncés)
 *
 * ───────────────────────────────────────────────────────────────────────────
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { ApiResponse } from '../../common';
import { CurrentUser } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import type { Humlinker } from './entities';
import type { Contact } from './entities';
import { CreateHumlinkerDto, SyncContactsDto } from './dto';
import { HumlinkerService } from './humlinker.service';
import { ContactsService, type SyncContactsResult } from './services/contacts.service';

@Controller('humlinkers')
export class HumlinkerController {
  constructor(
    private readonly humlinkerService: HumlinkerService,
    private readonly contactsService: ContactsService,
  ) {}

  // ─── Humlinkers ───────────────────────────────────────────────────────────

  /**
   * Crée un humlinker entre l'utilisateur connecté et un target.
   * Crée également le humlinker miroir côté destinataire.
   */
  @Post()
  async createHumlinker(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHumlinkerDto,
  ): Promise<ApiResponse<Humlinker>> {
    const data = await this.humlinkerService.createHumlinker(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Retourne tous les humlinkers de l'utilisateur (sender OU target),
   * triés par lastActivityAt DESC (style WhatsApp).
   *
   * Query params :
   *  - limit  : nombre de résultats par page (défaut 30)
   *  - offset : pagination offset (défaut 0)
   */
  @Get()
  async getMyHumlinkers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse<Humlinker[]>> {
    const data = await this.humlinkerService.getMyHumlinkers(user.userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Retourne les contacts déjà synchronisés (sans refaire la sync complète).
   * Utile pour recharger l'écran sans ré-envoyer tous les contacts.
   *
   * IMPORTANT : cette route doit être AVANT /:id pour éviter que 'contacts'
   * soit capté comme un UUID par ParseUUIDPipe.
   */
  @Get('contacts')
  async getContacts(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiResponse<SyncContactsResult>> {
    const data = await this.contactsService.getContacts(user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Retourne le détail d'un humlinker.
   * Les messages du chat sont chargés séparément via GET /humlinkers/:id/messages.
   */
  @Get(':id')
  async getHumlinkerById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Humlinker>> {
    const data = await this.humlinkerService.getHumlinkerById(id, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Archive un humlinker (le masque de la liste principale).
   * Accessible via la liste archivée. Le mirror n'est pas affecté.
   */
  @Patch(':id/archive')
  async archiveHumlinker(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Humlinker>> {
    const data = await this.humlinkerService.archiveHumlinker(id, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Désarchive un humlinker (le remet dans la liste principale).
   */
  @Patch(':id/unarchive')
  async unarchiveHumlinker(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Humlinker>> {
    const data = await this.humlinkerService.unarchiveHumlinker(id, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Bloque un humlinker ET son mirror.
   * Les deux côtés sont figés — status 'blocked', plus aucun message possible.
   */
  @Patch(':id/block')
  async blockHumlinker(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.humlinkerService.blockHumlinker(id, user.userId);
    return {
      success: true,
      data: null,
      message: 'Humlinker bloqué.',
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Contacts ─────────────────────────────────────────────────────────────

  /**
   * Synchronise les contacts téléphone de l'utilisateur.
   * Le front envoie la liste brute des contacts → normalisation E.164 + matching.
   *
   * Retourne :
   *  - matched   : contacts déjà inscrits sur Humlinker (en haut de liste)
   *  - unmatched : contacts non inscrits (avec option "Inviter" côté front)
   */
  @Post('sync-contacts')
  async syncContacts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SyncContactsDto,
  ): Promise<ApiResponse<SyncContactsResult>> {
    const data = await this.contactsService.syncContacts(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

}
