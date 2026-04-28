import {
  Controller,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IngestionService, IngestionResult } from './ingestion.service';

import { IsArray, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionDto } from '../fraud/fraud.service'; // keep for now, but better move to dto file later

// ✅ FIXED DTO
class BatchDto {
  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => TransactionDto) // 🔥 FIX: was Object, now correct class
  transactions: TransactionDto[];
}

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly svc: IngestionService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ingest up to 10,000 transactions directly' })
  async ingestBatch(@Body() dto: BatchDto): Promise<IngestionResult> {
    return this.svc.ingestBatch(dto.transactions);
  }

  @Post('file')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stream-process a large JSON file from /data/' })
  @ApiQuery({ name: 'path', example: 'transactions.json' })
  async processFile(
    @Query('path') filePath: string,
  ): Promise<IngestionResult> {
    if (!filePath || filePath.includes('..')) {
      throw new BadRequestException('Invalid file path');
    }

    return this.svc.processJsonFile(`/app/data/${filePath}`);
  }

  @Post('generate-sample')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate sample JSON data for testing' })
  @ApiQuery({ name: 'count', type: Number, example: 10000 })
  @ApiQuery({ name: 'filename', type: String, example: 'sample.json' })
  async generateSample(
    @Query('count') count = 10000,
    @Query('filename') filename = 'sample.json',
  ): Promise<{ message: string }> {
    await this.svc.generateSampleData(+count, `/app/data/${filename}`);
    return { message: `Generated ${count} transactions at /data/${filename}` };
  }
}
