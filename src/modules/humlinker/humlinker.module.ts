import { Module } from '@nestjs/common';
import { HumlinkerController } from './humlinker.controller';
import { HumlinkerService } from './humlinker.service';

@Module({
  controllers: [HumlinkerController],
  providers: [HumlinkerService],
})
export class HumlinkerModule {}
