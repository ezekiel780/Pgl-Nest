import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomInt } from 'crypto'; 
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { OtpType } from '../otp/dto/otp.dto';
import { Resend } from 'resend';
import { RedisService } from '../common/redis/redis.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly resend: Resend;
  private readonly maxOtpAttempts = 3;
  private readonly otpLockTtlSec = 15 * 60;
  private readonly resendLimit = 3;
  private readonly resendWindowSec = 60 * 60;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) return null;

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return null;

    return user;
  }

  async register(
    dto: RegisterDto,
  ): Promise<Omit<User, 'password' | 'refreshToken'> & { requiresOtp: boolean }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const user = await this.usersService.create(dto);
    await this.generateAndSendOtp(user, OtpType.VERIFY);

    const { password, refreshToken, ...safe } = user;
    return { ...safe, requiresOtp: true };
  }

  async login(user: User, res: Response): Promise<void> {
    await this.issueTokenCookies(user, res);
  }

  async verifyRegistrationOtp(email: string, code: string): Promise<void> {
    const user = await this.getUserForOtp(email, OtpType.VERIFY);
    await this.verifyOtp(user.id, OtpType.VERIFY, code);
    await this.usersService.activate(user.id);
    await this.sendWelcomeEmail(user.email, user.name).catch((err) =>
      this.logger.warn(`Welcome email failed: ${err.message}`),
    );
  }

  async verifyLoginOtp(
    email: string,
    code: string,
    res: Response,
  ): Promise<void> {
    const user = await this.getUserForOtp(email, OtpType.LOGIN);
    await this.verifyOtp(user.id, OtpType.LOGIN, code);
    await this.issueTokenCookies(user, res);
  }

  async resendOtp(email: string, type: OtpType): Promise<void> {
    const user = await this.getUserForOtp(email, type);
    const resendCount = await this.redis.incrementWithTtl(
      this.otpResendKey(user.id),
      this.resendWindowSec,
    );

    if (resendCount > this.resendLimit) {
      throw new HttpException(
        'Too many OTP resend requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.redis.del(this.otpAttemptsKey(user.id));
    await this.generateAndSendOtp(user, type);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    // Silently return if user not found — prevents email enumeration
    if (!user || !user.isActive) return;
    await this.generateAndSendOtp(user, OtpType.RESET);
  }

  async verifyResetOtp(
    email: string,
    code: string,
  ): Promise<{ resetToken: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) throw new BadRequestException('Invalid request');

    await this.verifyOtp(user.id, OtpType.RESET, code);

    const resetToken = randomBytes(32).toString('hex');
    await this.redis.set(`reset:token:${resetToken}`, user.id, 10 * 60);

    return { resetToken };
  }

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    const userId = await this.redis.get(`reset:token:${resetToken}`);
    if (!userId) throw new BadRequestException('Reset token expired or invalid');

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.usersService.updatePassword(userId, hashed);
    await this.redis.del(`reset:token:${resetToken}`);

    await this.usersService.updateRefreshToken(userId, null);
  }

  private async issueTokenCookies(user: User, res: Response): Promise<void> {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = this.jwtService.sign(payload, {
      secret:    this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret:    this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    await this.usersService.updateRefreshToken(user.id, refreshToken);

    const isProd = this.config.get('NODE_ENV') === 'production';
    const refreshPath = `/${this.config.getOrThrow<string>('API_PREFIX')}/auth/refresh`;

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'strict',
      maxAge:   15 * 60 * 1000,
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000,
      path:     refreshPath,
    });
  }

  async refresh(user: User, res: Response): Promise<void> {
    await this.issueTokenCookies(user, res);
  }

  async logout(userId: string, res: Response): Promise<void> {
    await this.usersService.updateRefreshToken(userId, null);
    const isProd = this.config.get('NODE_ENV') === 'production';
    const refreshPath = `/${this.config.getOrThrow<string>('API_PREFIX')}/auth/refresh`;

    res.clearCookie('access_token', {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
    });
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: refreshPath,
    });
  }

  private async getUserForOtp(email: string, type: OtpType): Promise<User> {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new BadRequestException('Invalid OTP request');

    if (type === OtpType.LOGIN && !user.isActive) {
      throw new UnauthorizedException('Account is not verified');
    }

    if (type === OtpType.VERIFY && user.isActive) {
      throw new BadRequestException('Account is already verified');
    }

    return user;
  }

  private async generateAndSendOtp(user: User, type: OtpType): Promise<void> {
    const code = randomInt(100000, 1000000).toString();
    const hash = await bcrypt.hash(code, 12);

    await this.redis.del(this.otpKey(type, user.id));
    await this.redis.set(this.otpKey(type, user.id), hash, this.otpTtlSec(type));

    await this.sendOtpEmail(user.email, user.name, code, type);
  }

  private async verifyOtp(
    userId: string,
    type: OtpType,
    code: string,
  ): Promise<void> {
    const attemptsKey = this.otpAttemptsKey(userId);
    const existingAttempts = Number((await this.redis.get(attemptsKey)) ?? 0);

    if (existingAttempts >= this.maxOtpAttempts) {
      throw new HttpException(
        'Too many wrong OTP attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const key = this.otpKey(type, userId);
    const hash = await this.redis.get(key);
    if (!hash) {
      throw new BadRequestException('OTP expired or not found');
    }

    const isMatch = await bcrypt.compare(code, hash);
    if (!isMatch) {
      const attempts = await this.redis.incrementWithTtl(
        attemptsKey,
        this.otpLockTtlSec,
      );

      if (attempts >= this.maxOtpAttempts) {
        throw new HttpException(
          'Too many wrong OTP attempts. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new BadRequestException('Invalid OTP');
    }

    await this.redis.del(key, attemptsKey);
  }

  private async sendOtpEmail(
    email: string,
    name: string,
    code: string,
    type: OtpType,
  ): Promise<void> {
    const expiresIn = type === OtpType.VERIFY ? '10 minutes' : '5 minutes';
    const purpose =
      type === OtpType.VERIFY
        ? 'verify your FraudGuard account'
        : type === OtpType.RESET
          ? 'reset your FraudGuard password' 
          : 'complete your FraudGuard login';

    await this.resend.emails.send({
      from: this.config.getOrThrow<string>('RESEND_FROM_EMAIL'),
      to: email,
      subject: `Your FraudGuard OTP code`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#00E5A0">FraudGuard OTP</h2>
          <p>Hello ${name},</p>
          <p>Use this code to ${purpose}:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
          <p>This code expires in ${expiresIn}.</p>
          <p>If you did not request this code, you can ignore this email.</p>
        </div>
      `,
    });
  }

  private otpTtlSec(type: OtpType): number {
    return type === OtpType.VERIFY ? 10 * 60 : 5 * 60;
  }

  private otpKey(type: OtpType, userId: string): string {
    return `otp:${type}:${userId}`;
  }

  private otpAttemptsKey(userId: string): string {
    return `otp:attempts:${userId}`;
  }

  private otpResendKey(userId: string): string {
    return `otp:resends:${userId}`;
  }

  private async sendWelcomeEmail(email: string, name: string): Promise<void> {
    await this.resend.emails.send({
      from:    this.config.getOrThrow<string>('RESEND_FROM_EMAIL'),
      to:      email,
      subject: 'Welcome to FraudGuard',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#00E5A0">Welcome to FraudGuard, ${name}!</h2>
          <p>Your account has been created successfully.</p>
          <p>You can now log in and start monitoring fraud detection in real time.</p>
          <hr style="border-color:#1E2830"/>
          <p style="color:#5A7080;font-size:12px">
            If you did not create this account, please ignore this email.
          </p>
        </div>
      `,
    });
    this.logger.log(`Welcome email sent to ${email}`);
  }
}
