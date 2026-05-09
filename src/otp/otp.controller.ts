import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { Public } from '../auth/decorators/public.decorator';
import { ResendOtpDto, VerifyOtpDto } from './dto/otp.dto';

@ApiTags('auth')
@Controller('otp')
export class OtpController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('verify-registration')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify registration OTP and activate account' })
  async verifyRegistration(@Body() dto: VerifyOtpDto) {
    await this.authService.verifyRegistrationOtp(dto.email, dto.code);
    return { message: 'Account verified successfully' };
  }

  @Public()
  @Post('verify-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify login OTP and set HttpOnly JWT cookies' })
  async verifyLogin(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.verifyLoginOtp(dto.email, dto.code, res);
    return { message: 'Login successful' };
  }

  @Public()
  @Post('resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend registration or login OTP' })
  async resendOtp(@Body() dto: ResendOtpDto) {
    await this.authService.resendOtp(dto.email, dto.type);
    return { message: 'OTP resent' };
  }
}
