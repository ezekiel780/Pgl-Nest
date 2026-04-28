import {
  Controller, Get, Post, Body, Query,
  ParseIntPipe, DefaultValuePipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBody } from '@nestjs/swagger';
import { FraudService } from './fraud.service';
import { FraudReason } from './entities/flagged-transaction.entity';
import { AnalyseFraudDto } from './dto/analyse-fraud.dto';

@ApiTags('fraud')
@Controller('fraud')
export class FraudController {
  constructor(private readonly fraudService: FraudService) {}

  /** GET /api/v1/fraud/check?userId=user_001 */
  @Get('check')
  @ApiOperation({ summary: 'Get all flagged transactions for a user' })
  @ApiQuery({ name: 'userId', required: true })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  async fraudCheck(
    @Query('userId') userId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.fraudService.getFlaggedByUser(userId, page, Math.min(limit, 200));
  }

  /** POST /api/v1/fraud/analyse */
  @Post('analyse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Real-time fraud check on a single transaction' })
  @ApiBody({ type: AnalyseFraudDto })
  analyse(@Body() dto: AnalyseFraudDto) {
    return this.fraudService.analyse(dto);
  }

  /** GET /api/v1/fraud/all */
  @Get('all')
  @ApiOperation({ summary: 'List all flagged transactions (all users)' })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  @ApiQuery({ name: 'reason', required: false, enum: FraudReason })
  async getAll(
    @Query('page',  new DefaultValuePipe(1),   ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('reason') reason?: FraudReason,
  ) {
    return this.fraudService.getAllFlagged(page, Math.min(limit, 500), reason);
  }

  /** GET /api/v1/fraud/heatmap */
  @Get('heatmap')
  @ApiOperation({ summary: 'Geo-coordinates of flagged transactions for map' })
  async heatmap() {
    return this.fraudService.getHeatmapData();
  }

  /** GET /api/v1/fraud/stats */
  @Get('stats')
  @ApiOperation({ summary: 'System-wide fraud statistics' })
  async stats() {
    return this.fraudService.getStats();
  }
}
