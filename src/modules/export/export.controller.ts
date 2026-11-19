import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { ApiResponse as AppApiResponse } from '../../common';
import { HOUR, RateLimit } from '../../common/rate-limit';
import { CurrentUser } from '../../decorators';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ExportService, type HistoryExport } from './export.service';

@ApiTags('Humlinkers')
@ApiBearerAuth()
@Controller('humlinkers')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get(':id/export')
  @RateLimit({ name: 'export-hour', by: 'user', limit: 10, windowSec: HOUR })
  @ApiOperation({
    summary: "Exporter l'historique d'une conversation",
    description:
      "Historique daté des messages réellement échangés (envoyés et reçus), y compris ceux effacés à l'écran. " +
      "Les échanges privés avec l'IA sont exclus. Renvoie une empreinte SHA-256 de la sérialisation JSON canonique " +
      "du contenu et un identifiant d'export. Réservé au propriétaire de ce côté de la conversation.",
  })
  @ApiParam({ name: 'id', description: 'UUID du humlinker (votre côté).' })
  @ApiResponse({ status: 200, description: 'Export renvoyé.' })
  @ApiResponse({ status: 403, description: "Ce humlinker n'est pas le vôtre." })
  @ApiResponse({ status: 404, description: 'Humlinker introuvable.' })
  @ApiResponse({ status: 429, description: "Trop d'exports (10 par heure)." })
  async exportHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppApiResponse<HistoryExport>> {
    const data = await this.exportService.exportHistory(id, user.userId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
