import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContactInputDto {
  @ApiProperty({ example: 'Jean Dupont', description: 'Nom affiché dans le carnet de contacts.' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    example: ['+33612345678', '0612345678'],
    description: 'Numéros de téléphone bruts. Le serveur normalise en E.164.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phoneNumbers?: string[];

  @ApiPropertyOptional({
    example: ['jean@example.com'],
    description: 'Emails bruts. Le serveur applique toLowerCase().',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];
}

export class SyncContactsDto {
  @ApiProperty({
    type: [ContactInputDto],
    description: 'Liste brute des contacts du téléphone à synchroniser.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ContactInputDto)
  contacts: ContactInputDto[];

  @ApiPropertyOptional({
    example: 'FR',
    description: "Code pays ISO 3166-1 alpha-2 pour normaliser les numéros locaux (sans indicatif). Ex: 'FR', 'US', 'IL'.",
  })
  @IsOptional()
  @IsString()
  countryCode?: string;
}
