import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

// Namespace opcional recomendado si la app crece: @WebSocketGateway({ namespace: 'raffles', cors: { origin: '*' } })
@WebSocketGateway({ cors: { origin: '*' } })
export class RifaGateway {
  @WebSocketServer() server: Server;

  /**
   * Evento 1: Bloquear ticket (Reserva temporal)
   * Se dispara cuando un usuario empieza el flujo de compra en el front.
   */
  @SubscribeMessage('lock_ticket')
  handleLock(
    @MessageBody()
    data: {
      raffleId: string;
      number: string;
      buyerName: string;
    },
  ) {
    // 1. Notificar cambio de estado a 'pending' para actualizar la grilla
    this.server.emit(`raffle-${data.raffleId}-update`, {
      number: data.number,
      status: 'pending',
    });

    // 2. Enviar mensaje de FOMO (Fear Of Missing Out)
    this.server.emit(`raffle-${data.raffleId}-fomo`, {
      message: `🛒 ${data.buyerName} está reservando el número ${data.number}...`,
    });
  }

  /**
   * Evento 2: Desbloquear ticket (Expiración de reserva)
   * Se dispara desde el backend cuando expira el tiempo de bloqueo en la BD.
   * Esto actualizará el front automáticamente sin recargar.
   */
  @SubscribeMessage('unlock_ticket')
  handleUnlock(
    @MessageBody()
    data: {
      raffleId: string;
      number: string;
    },
  ) {
    // Notificar cambio de estado a 'available' (vuelve a verde)
    this.server.emit(`raffle-${data.raffleId}-update`, {
      number: data.number,
      status: 'available',
    });
  }
}