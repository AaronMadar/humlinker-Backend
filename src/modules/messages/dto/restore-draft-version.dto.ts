import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RestoreDraftVersionDto {
  @ApiProperty({ example: 0, description: 'Index (0-based) de la version a restaurer.' })
  @IsInt()
  @Min(0)
  versionIndex: number;
}
