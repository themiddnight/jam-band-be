import { Server, Socket } from 'socket.io';
import { RoomHandlers } from '../handlers/RoomHandlers';

export class SocketManager {
  constructor(private io: Server, private roomHandlers: RoomHandlers) {}

  initialize(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`User connected: ${socket.id}`);
      
      // Check if this socket already has a session
      const existingSession = this.roomHandlers['roomService'].getUserSession(socket.id);
      if (existingSession) {
        console.log(`Socket ${socket.id} already has session, cleaning up`);
        this.roomHandlers['roomService'].removeUserSession(socket.id);
      }
      
      // Debug: Log all current sessions
      console.log('Current sessions:', Array.from(this.roomHandlers['roomService']['userSessions'].entries()).map(([socketId, session]) => ({
        socketId,
        roomId: session.roomId,
        userId: session.userId
      })));

      // Bind socket events
      this.bindSocketEvents(socket);
    });
  }

  private bindSocketEvents(socket: Socket): void {
    // Room management events
    socket.on('create_room', (data) => this.roomHandlers.handleCreateRoom(socket, data));
    socket.on('join_room', (data) => this.roomHandlers.handleJoinRoom(socket, data));
    socket.on('leave_room', () => this.roomHandlers.handleLeaveRoom(socket));

    // Member management events
    socket.on('approve_member', (data) => this.roomHandlers.handleApproveMember(socket, data));
    socket.on('reject_member', (data) => this.roomHandlers.handleRejectMember(socket, data));

    // Music events
    socket.on('play_note', (data) => this.roomHandlers.handlePlayNote(socket, data));
    socket.on('change_instrument', (data) => this.roomHandlers.handleChangeInstrument(socket, data));
    socket.on('update_synth_params', (data) => this.roomHandlers.handleUpdateSynthParams(socket, data));
    socket.on('request_synth_params', () => this.roomHandlers.handleRequestSynthParams(socket));



    // Ownership events
    socket.on('transfer_ownership', (data) => this.roomHandlers.handleTransferOwnership(socket, data));

    // Disconnect event
    socket.on('disconnect', () => this.roomHandlers.handleDisconnect(socket));
  }
} 