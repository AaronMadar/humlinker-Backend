/**
 * ExportModule — export daté et vérifiable de l'historique d'une conversation.
 * Lecture seule : s'appuie directement sur PrismaService (DatabaseModule global).
 */
import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
