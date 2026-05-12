import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './entities/user.entity';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async findAll(): Promise<Omit<User, 'password' | 'refreshToken'>[]> {
    const users = await this.repo.find({
      order: { createdAt: 'DESC' },
    });
    return users.map(({ password, refreshToken, ...safe }) => safe);
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }

  async updateRole(
    targetId: string,
    dto: UpdateRoleDto,
    requestingUserId: string,
  ): Promise<Omit<User, 'password' | 'refreshToken'>> {
    if (targetId === requestingUserId) {
      throw new ForbiddenException('You cannot change your own role');
    }
    const user = await this.findById(targetId);
    user.role  = dto.role;
    await this.repo.save(user);
    const { password, refreshToken, ...safe } = user;
    return safe;
  }

  async updateStatus(
    targetId: string,
    dto: UpdateStatusDto,
    requestingUserId: string,
  ): Promise<Omit<User, 'password' | 'refreshToken'>> {
    if (targetId === requestingUserId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    const user    = await this.findById(targetId);
    user.isActive = dto.isActive;
    await this.repo.save(user);
    const { password, refreshToken, ...safe } = user;
    return safe;
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  async save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  async count(): Promise<number> {
    return this.repo.count();
  }

  async activate(userId: string): Promise<void> {
    const user = await this.findById(userId);
    await this.repo.update(user.id, { isActive: true });
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    const user = await this.findById(userId);
    await this.repo.update(user.id, { password: hashedPassword });
  }

  async updateRefreshToken(
    userId: string,
    refreshToken: string | null,
  ): Promise<void> {
    const hashed = refreshToken
      ? await bcrypt.hash(refreshToken, 12)
      : null;
    await this.repo.update(userId, { refreshToken: hashed });
  }

  async validateRefreshToken(
    userId: string,
    refreshToken: string,
  ): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user || !user.refreshToken) return false;
    return bcrypt.compare(refreshToken, user.refreshToken);
  }

  async updateName(
    id: string,
    name: string,
  ): Promise<Omit<User, 'password' | 'refreshToken'>> {
    const user = await this.findById(id);
    user.name  = name;
    await this.repo.save(user);
    const { password, refreshToken, ...safe } = user;
    return safe;
  }

  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user    = await this.findById(id);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) throw new ForbiddenException('Current password is incorrect');
    user.password = await bcrypt.hash(newPassword, 12);
    await this.repo.save(user);
  }
}
