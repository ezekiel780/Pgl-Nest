import { IsString, IsNumber, IsDateString } from 'class-validator';

export class AnalyseFraudDto {
  @IsString()
  transactionId: string;

  @IsString()
  userId: string;

  @IsNumber()
  amount: number;

  @IsDateString()
  timestamp: string;

  @IsString()
  merchant: string;

  @IsString()
  location: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;
}
