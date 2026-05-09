import {
  IsEmail,
  IsEnum,
  IsString,
  IsStrongPassword,
  Length,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum OtpType {
  VERIFY = 'verify',
  LOGIN  = 'login',
  RESET  = 'reset', 
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'admin@fraudguard.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class ResendOtpDto {
  @ApiProperty({ example: 'admin@fraudguard.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: OtpType, example: OtpType.VERIFY })
  @IsEnum(OtpType)
  type: OtpType;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@fraudguard.com' })
  @IsEmail()
  email: string;
}

export class VerifyResetOtpDto {
  @ApiProperty({ example: 'admin@fraudguard.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'a3f1c9e2...' })
  @IsString()
  resetToken: string;

  @ApiProperty({ example: 'NewPassword@123' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
