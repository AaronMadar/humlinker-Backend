/**
 * CreateHumlinkerDto
 *
 * Données envoyées par le front lors de la création d'un humlinker.
 *
 * Deux cas :
 *  A) targetUserId fourni  → target déjà inscrit sur Humlinker (depuis la liste de contacts)
 *  B) targetUserId absent  → target non inscrit, on a besoin d'au moins un point de contact
 *                            (email ou téléphone) pour lui envoyer les messages
 */
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import type { HumlinkerChannel } from '../entities';

const CHANNELS: HumlinkerChannel[] = ['app', 'sms', 'whatsapp', 'email'];

export class CreateHumlinkerDto {
  /** Nom du contact tel que saisi par le créateur */
  @IsString()
  @IsNotEmpty()
  targetContactName: string;

  /**
   * Email du contact.
   * Optionnel si targetUserId fourni ou si targetContactPhone présent.
   * Normalisé en minuscules côté service.
   */
  @IsOptional()
  @IsEmail()
  targetContactEmail?: string | null;

  /**
   * Numéro de téléphone du contact.
   * Optionnel si targetUserId fourni ou si targetContactEmail présent.
   * Normalisé en E.164 côté service.
   */
  @IsOptional()
  @IsString()
  targetContactPhone?: string | null;

  /**
   * userId d'un utilisateur Humlinker déjà inscrit.
   * Si fourni, les champs email/phone du contact sont ignorés pour le matching.
   */
  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  /** Type de relation décrit par le créateur (ex: "collègue", "ami", "client") */
  @IsString()
  @IsNotEmpty()
  relationshipType: string;

  /** Canal de communication préféré pour le target */
  @IsEnum(CHANNELS)
  communicationChannel: HumlinkerChannel;

  /** Titre du humlinker (ex: "Remercier Philippe pour le projet Flexy") */
  @IsString()
  @IsNotEmpty()
  title: string;

  /**
   * Langue du créateur — utilisée pour la génération AI des messages.
   * La langue du target est récupérée depuis son profil s'il est inscrit.
   */
  @IsString()
  @IsNotEmpty()
  creatorLanguage: string;

  /**
   * Langue estimée du target non inscrit (facultatif — fallback 'fr').
   */
  @IsOptional()
  @IsString()
  targetLanguage?: string;
}
