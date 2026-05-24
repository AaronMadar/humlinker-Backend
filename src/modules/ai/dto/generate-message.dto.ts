import {  IsNotEmpty, IsString } from 'class-validator';


export class GenerateMessageDto {
 
  @IsString()
  @IsNotEmpty()
  message: string;

  }
