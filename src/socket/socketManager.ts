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
    socket.on('leave_room', (data) => this.roomHandlers.handleLeaveRoom(socket, data?.isIntendedLeave || false));

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

    // WebRTC Voice events
    socket.on('voice_offer', (data) => this.roomHandlers.handleVoiceOffer(socket, data));
    socket.on('voice_answer', (data) => this.roomHandlers.handleVoiceAnswer(socket, data));
    socket.on('voice_ice_candidate', (data) => this.roomHandlers.handleVoiceIceCandidate(socket, data));
    socket.on('join_voice', (data) => this.roomHandlers.handleJoinVoice(socket, data));
    socket.on('leave_voice', (data) => this.roomHandlers.handleLeaveVoice(socket, data));
    socket.on('voice_mute_changed', (data) => this.roomHandlers.handleVoiceMuteChanged(socket, data));
    socket.on('request_voice_participants', (data) => this.roomHandlers.handleRequestVoiceParticipants(socket, data));

    // Disconnect event
    socket.on('disconnect', () => this.roomHandlers.handleDisconnect(socket));
  }
} 