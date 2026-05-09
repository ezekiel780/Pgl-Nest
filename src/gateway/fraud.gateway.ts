import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',')
      : '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class FraudGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(FraudGateway.name);

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Emit fraud alert to ALL connected frontend clients instantly.
   * Frontend listens for 'fraud.detected' event.
   */
  emitFraudAlert(payload: {
    transactionId: string;
    userId: string;
    amount: number;
    merchant: string;
    location: string;
    reasons: string[];
    riskScore: number;
    metadata: Record<string, any>;
    timestamp: string;
  }): void {
    this.server.emit('fraud.detected', payload);
    this.logger.warn(
      `Emitted fraud.detected → user=${payload.userId} risk=${payload.riskScore}`,
    );
  }
}
