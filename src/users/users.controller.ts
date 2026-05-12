import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from './entities/user.entity';
import { AuditService } from '../audit/audit.service';         
import { AuditAction } from '../audit/entities/audit-log.entity'; 

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,             
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all users — admin only' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  async getMe(@Request() req) {
    const user = await this.usersService.findById(req.user.id)
    const { password, refreshToken, ...safe } = user as any
    return safe
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own name' })
  async updateMe(
    @Request() req,
    @Body() body: { name: string },
  ) {
    const result = await this.usersService.updateName(req.user.id, body.name)

    await this.auditService.log(
      AuditAction.PROFILE_UPDATED,
      req.user.id,
      req.user.email,
      { name: body.name },
    ).catch(() => {})

    return result
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Change own password' })
  async changePassword(
    @Request() req,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    await this.usersService.changePassword(
      req.user.id,
      body.currentPassword,
      body.newPassword,
    )

    await this.auditService.log(
      AuditAction.PASSWORD_CHANGED,
      req.user.id,
      req.user.email,
    ).catch(() => {})

    return { message: 'Password changed successfully' }
  }

  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Change user role — admin only' })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @Request() req,
  ) {
    const result = await this.usersService.updateRole(id, dto, req.user.id)

    await this.auditService.log(
      AuditAction.ROLE_CHANGED,
      req.user.id,
      req.user.email,
      { targetUserId: id, newRole: dto.role },
    ).catch(() => {})

    return result
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Toggle user active status — admin only' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @Request() req,
  ) {
    const result = await this.usersService.updateStatus(id, dto, req.user.id)

    await this.auditService.log(
      AuditAction.STATUS_CHANGED,
      req.user.id,
      req.user.email,
      { targetUserId: id, isActive: dto.isActive },
    ).catch(() => {})

    return result
  }
}
