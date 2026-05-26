/**
 * SyncContactsDto
 *
 * Données envoyées par le front lors de la synchronisation des contacts.
 * Le front envoie la liste brute des contacts du téléphone.
 * Le service normalise les numéros (E.164) et les emails (lowercase)
 * avant de les stocker en DB et de faire le matching.
 */
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ContactInputDto {
  /** Nom affiché dans le carnet de contacts */
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * Numéros de téléphone bruts (non normalisés).
   * Le service applique E.164 normalization.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phoneNumbers?: string[];

  /**
   * Emails bruts (non normalisés).
   * Le service applique toLowerCase().
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];
}

export class SyncContactsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ContactInputDto)
  contacts: ContactInputDto[];

  /**
   * Code pays ISO 3166-1 alpha-2 (ex: 'FR', 'US') pour la normalisation
   * des numéros locaux (sans indicatif pays).
   * Optionnel — si absent, seuls les numéros avec indicatif (+XX) sont normalisés.
   */
  @IsOptional()
  @IsString()
  countryCode?: string;
}
