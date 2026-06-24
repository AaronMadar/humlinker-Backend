import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import type { ApiResponse as AppApiResponse } from '../../common';
import { CurrentUser } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import type { Humlinker } from './entities';
import { CreateHumlinkerDto } from './dto';
import { HumlinkerService } from './humlinker.service';

@ApiTags('Humlinkers')
@ApiBearerAuth()
@Controller('humlinkers')
export class HumlinkerController {
  constructor(
    private readonly humlinkerService: HumlinkerService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Créer un humlinker',
    description:
      "Crée un humlinker entre l'utilisateur connecté (sender) et un target. Crée automatiquement le humlinker miroir côté destinataire. Si le target n'est pas inscrit, un compte placeholder est créé.",
  })
  @ApiResponse({ status: 201, description: 'Humlinker créé (+ mirror côté target).' })
  @ApiResponse({ status: 400, description: 'Aucun identifiant target fourni, ou numéro de téléphone invalide.' })
  @ApiResponse({ status: 409, description: 'Un humlinker existe déjà avec ce contact.' })
  async createHumlinker(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHumlinkerDto,
  ): Promise<AppApiResponse<Humlinker>> {
    const data = await this.humlinkerService.createHumlinker(user.userId, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get()
  @ApiOperation({
    summary: 'Mes humlinkers',
    description: "Retourne tous les humlinkers où l'utilisateur est sender ou target, triés par `lastActivityAt` DESC (style liste de conversations WhatsApp).",
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Nombre de résultats par page (défaut 30).', example: 30 })
  @ApiQuery({ name: 'offset', required: false, description: 'Offset pour la pagination (défaut 0).', example: 0 })
  @ApiResponse({ status: 200, description: 'Liste des humlinkers.' })
  async getMyHumlinkers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AppApiResponse<Humlinker[]>> {
    const data = await this.humlinkerService.getMyHumlinkers(user.userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détail d\'un humlinker',
    description: "Retourne le détail d'un humlinker (snapshots sender/target, canal, statut). Les messages du chat sont chargés séparément via `GET /humlinkers/:id/messages`.",
  })
  @ApiParam({ name: 'id', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 200, description: 'Humlinker retourné.' })
  @ApiResponse({ status: 403, description: "L'utilisateur n'est pas participant de ce humlinker." })
  @ApiResponse({ status: 404, description: 'Humlinker introuvable.' })
  async getHumlinkerById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppApiResponse<Humlinker>> {
    const data = await this.humlinkerService.getHumlinkerById(id, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id/archive')
  @ApiOperation({
    summary: 'Archiver un humlinker',
    description: "Masque le humlinker de la liste principale. Accessible via la liste archivée. Le mirror côté target n'est pas affecté.",
  })
  @ApiParam({ name: 'id', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 200, description: 'Humlinker archivé.' })
  @ApiResponse({ status: 400, description: 'Humlinker déjà archivé ou bloqué.' })
  async archiveHumlinker(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppApiResponse<Humlinker>> {
    const data = await this.humlinkerService.archiveHumlinker(id, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id/unarchive')
  @ApiOperation({
    summary: 'Désarchiver un humlinker',
    description: "Remet le humlinker dans la liste principale active.",
  })
  @ApiParam({ name: 'id', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 200, description: 'Humlinker désarchivé.' })
  @ApiResponse({ status: 400, description: "Le humlinker n'est pas archivé." })
  async unarchiveHumlinker(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppApiResponse<Humlinker>> {
    const data = await this.humlinkerService.unarchiveHumlinker(id, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Patch(':id/accept')
  @ApiOperation({
    summary: 'Accepter une invitation',
    description: "Le destinataire d'une invitation (statut pending) l'accepte : les deux côtés passent en statut `active`.",
  })
  @ApiParam({ name: 'id', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 200, description: 'Invitation acceptée.' })
  @ApiResponse({ status: 400, description: 'Humlinker non pending ou déjà actif.' })
  @ApiResponse({ status: 403, description: "Seul le destinataire peut accepter l'invitation." })
  async acceptInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppApiResponse<Humlinker>> {
    const data = await this.humlinkerService.acceptInvitation(id, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
  @Patch(':id/decline')
  @ApiOperation({
    summary: 'Refuser une invitation',
    description: "Le destinataire d'une invitation (statut pending) la refuse : les deux côtés passent en statut `archived`.",
  })
  @ApiParam({ name: 'id', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 200, description: 'Invitation refusée.' })
  @ApiResponse({ status: 403, description: "Seul le destinataire peut refuser l'invitation." })
  async declineInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppApiResponse<null>> {
    await this.humlinkerService.declineInvitation(id, user.userId);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: "Annuler une invitation envoyée",
    description: "L'initiateur d'une invitation (statut pending) l'annule : les deux côtés passent en statut `archived`.",
  })
  @ApiParam({ name: 'id', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 200, description: 'Invitation annulée.' })
  @ApiResponse({ status: 403, description: "Seul l'expéditeur peut annuler l'invitation." })
  async cancelInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppApiResponse<null>> {
    await this.humlinkerService.cancelInvitation(id, user.userId);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }

  @Patch(':id/block')
  @ApiOperation({
    summary: 'Bloquer un humlinker',
    description: "Bloque le humlinker et son miroir. Les deux côtés ne peuvent plus envoyer de messages.",
  })
  @ApiParam({ name: 'id', description: 'UUID du humlinker.', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @ApiResponse({ status: 200, description: 'Humlinker bloqué.' })
  @ApiResponse({ status: 400, description: 'Déjà bloqué.' })
  async blockHumlinker(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppApiResponse<null>> {
    await this.humlinkerService.blockHumlinker(id, user.userId);
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
