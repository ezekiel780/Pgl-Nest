import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@fraudguard.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Amaze@809', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
