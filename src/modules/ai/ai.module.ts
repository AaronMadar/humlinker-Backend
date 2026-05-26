/**
 * AiModule
 *
 * Fournit AiService (Gemini) à tous les modules qui en ont besoin.
 * @Global() pour éviter de l'importer partout — MessagesModule l'utilise principalement.
 */
import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';

@Global()
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
