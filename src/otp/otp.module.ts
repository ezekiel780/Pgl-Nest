import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OtpController } from './otp.controller';

@Module({
  imports: [AuthModule],
  controllers: [OtpController],
})
export class OtpModule {}
