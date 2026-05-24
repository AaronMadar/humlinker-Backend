import { PartialType } from '@nestjs/mapped-types';
import { CreateHumlinkerDto } from './create-humlinker.dto';

export class UpdateHumlinkerDto extends PartialType(CreateHumlinkerDto) {}
