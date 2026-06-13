import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetDraftObjectiveDto {
  @ApiProperty({
    example: 'Je veux remercier Philippe pour son aide.',
    description: "Objectif sélectionné par l'utilisateur (version précédente du draft). L'IA régénère le realMessage correspondant.",
    maxLength: 4000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  objectiveMessage: string;
}
