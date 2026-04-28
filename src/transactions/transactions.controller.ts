import {
  Controller, Get, Query, Param,
  DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly svc: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get raw transactions for a user' })
  @ApiQuery({ name: 'userId', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findByUser(
    @Query('userId') userId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.svc.findByUser(userId, Math.min(limit, 1000));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single transaction by ID' })
  async findOne(@Param('id') id: string) {
    return this.svc.findById(id);
  }
}
