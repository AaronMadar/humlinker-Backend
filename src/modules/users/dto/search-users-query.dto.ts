import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchUsersQueryDto {
  @ApiProperty({ example: 'A1B2C3D4', description: 'PIN exact de 8 caractères (insensible à la casse).' })
  @IsString()
  @IsNotEmpty()
  q!: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
