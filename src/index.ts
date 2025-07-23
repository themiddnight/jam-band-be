import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL || "http://localhost:5173"
      : "*", // Allow all origins in development
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL || "http://localhost:5173"
    : "*", // Allow all origins in development
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Types
interface User {
  id: string;
  username: string;
  role: 'room_owner' | 'band_member' | 'audience';
  currentInstrument?: string;
  currentCategory?: string;
  isReady: boolean;
}

interface Room {
  id: string;
  name: string;
  owner: string;
  users: Map<string, User>;
  pendingMembers: Map<string, User>;
  mixerMode: 'original' | 'custom';
  mixerSettings: Record<string, number>; // user id -> gain
  createdAt: Date;
}

// In-memory storage (in production, use Redis or database)
const rooms = new Map<string, Room>();
const userSessions = new Map<string, { roomId: string; userId: string }>();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get room list
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    userCount: room.users.size,
    owner: room.owner,
    createdAt: room.createdAt
  }));
  res.json(roomList);
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Check if this socket already has a session
  const existingSession = userSessions.get(socket.id);
  if (existingSession) {
    console.log(`Socket ${socket.id} already has session, cleaning up`);
    userSessions.delete(socket.id);
  }
  
  // Debug: Log all current sessions
  console.log('Current sessions:', Array.from(userSessions.entries()).map(([socketId, session]) => ({
    socketId,
    roomId: session.roomId,
    userId: session.userId
  })));

  // Join room
  socket.on('join_room', async (data: { roomId: string; username: string; role: 'band_member' | 'audience' }) => {
    const { roomId, username, role } = data;
    
    console.log('Join room request:', { roomId, username, role });
    
    if (!rooms.has(roomId)) {
      console.log('Room not found:', roomId);
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const room = rooms.get(roomId)!;
    console.log('Room found:', { roomId: room.id, owner: room.owner, userCount: room.users.size });
    
    // Check if user already exists in the room (any role)
    const existingUser = Array.from(room.users.values()).find(u => u.username === username);
    let userId: string;
    let user: User;
    
    if (existingUser) {
      // User already exists in room, use existing user data (preserve their role)
      userId = existingUser.id;
      user = existingUser;
      console.log('User already exists in room, using existing user:', { userId, username, role: user.role });
    } else {
      // Create new user only if they don't exist
      userId = uuidv4();
      user = {
        id: userId,
        username,
        role: role || 'audience', // Default to audience if role is undefined
        isReady: (role || 'audience') === 'audience'
      };
      console.log('Created new user:', { userId, username, role: user.role });
    }
    
    console.log('Final user ID for join:', userId);
    console.log('Room owner ID:', room.owner);
    console.log('Are they the same?', userId === room.owner);
    
    // If this is the room owner joining, update their session
    if (userId === room.owner) {
      console.log('Room owner joining, updating session');
      socket.data = { roomId, userId };
      userSessions.set(socket.id, { roomId, userId });
      
      // Also remove any old sessions for this user to prevent conflicts
      Array.from(userSessions.entries()).forEach(([socketId, sessionData]) => {
        if (sessionData.userId === userId && socketId !== socket.id) {
          console.log(`Removing old session for user ${userId} on socket ${socketId}`);
          userSessions.delete(socketId);
        }
      });
    }

    // If user already exists and is rejoining, update their session
    if (existingUser) {
      socket.data = { roomId, userId };
      userSessions.set(socket.id, { roomId, userId });
      
      // Remove any old sessions for this user to prevent conflicts
      Array.from(userSessions.entries()).forEach(([socketId, sessionData]) => {
        if (sessionData.userId === userId && socketId !== socket.id) {
          console.log(`Removing old session for user ${userId} on socket ${socketId}`);
          userSessions.delete(socketId);
        }
      });
    }

    if (existingUser) {
      // User already exists in room, join them directly
      socket.join(roomId);
      
      console.log('Existing user rejoined room. Socket data:', socket.data);
      console.log('User session stored:', userSessions.get(socket.id));
      
      // Notify others in room about the rejoin
      socket.to(roomId).emit('user_joined', { user });
      socket.emit('room_joined', { 
        room, 
        users: Array.from(room.users.values()),
        pendingMembers: Array.from(room.pendingMembers.values()),
        mixerMode: room.mixerMode,
        mixerSettings: room.mixerSettings
      });
    } else if (role === 'band_member') {
      // New user requesting to join as band member - needs approval
      room.pendingMembers.set(userId, user);
      console.log('Added user to pending members:', { userId, username });
      
      // Set socket data for the pending user so they can be found later
      socket.data = { roomId, userId };
      userSessions.set(socket.id, { roomId, userId });
      console.log('Set socket data for pending user:', { socketId: socket.id, userId });
      
      socket.emit('pending_approval', { message: 'Waiting for room owner approval' });
      
      // Notify room owner
      const ownerSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.data?.userId === room.owner);
      console.log('Looking for owner socket. Room owner:', room.owner);
      console.log('Available sockets:', Array.from(io.sockets.sockets.values()).map(s => ({ socketId: s.id, userId: s.data?.userId })));
      
      if (ownerSocket) {
        console.log('Found owner socket, sending member request');
        ownerSocket.emit('member_request', { user });
      } else {
        console.log('Owner socket not found');
      }
    } else {
      // New audience member or undefined role - join directly as audience
      room.users.set(userId, user);
      console.log('Added user to room users:', { userId, username });
      
      socket.join(roomId);
      socket.data = { roomId, userId };
      userSessions.set(socket.id, { roomId, userId });
      
      console.log('User joined room. Socket data:', socket.data);
      console.log('User session stored:', userSessions.get(socket.id));
      
      // Notify others in room
      socket.to(roomId).emit('user_joined', { user });
      socket.emit('room_joined', { 
        room, 
        users: Array.from(room.users.values()),
        pendingMembers: Array.from(room.pendingMembers.values()),
        mixerMode: room.mixerMode,
        mixerSettings: room.mixerSettings
      });
    }
  });

  // Approve band member
  socket.on('approve_member', (data: { userId: string }) => {
    console.log('Approve member event received:', data);
    console.log('Socket ID:', socket.id);
    console.log('All current sessions before approval:');
    Array.from(userSessions.entries()).forEach(([socketId, sessionData]) => {
      console.log(`Socket ${socketId}: roomId=${sessionData.roomId}, userId=${sessionData.userId}`);
    });
    const session = userSessions.get(socket.id);
    if (!session) {
      console.log('No session found for socket:', socket.id);
      return;
    }
    
    const room = rooms.get(session.roomId);
    if (!room) {
      console.log('Room not found:', session.roomId);
      return;
    }
    
    console.log('Session userId:', session.userId);
    console.log('Room owner:', room.owner);
    console.log('Are they equal?', session.userId === room.owner);
    console.log('All room users:', Array.from(room.users.values()).map(u => ({ id: u.id, username: u.username, role: u.role })));
    console.log('All pending members:', Array.from(room.pendingMembers.values()).map(u => ({ id: u.id, username: u.username, role: u.role })));
    
    if (room.owner !== session.userId) {
      console.log('Room not found or user is not owner. Room:', room?.id, 'Owner:', room?.owner, 'Session user:', session.userId);
      console.log('All sessions for debugging:');
      Array.from(userSessions.entries()).forEach(([socketId, sessionData]) => {
        console.log(`Socket ${socketId}: roomId=${sessionData.roomId}, userId=${sessionData.userId}`);
      });
      
      // Try to find the room owner's session and update this socket's session
      const ownerSession = Array.from(userSessions.entries()).find(([socketId, sessionData]) => 
        sessionData.userId === room.owner && sessionData.roomId === session.roomId
      );
      
      if (ownerSession) {
        console.log(`Found room owner session on socket ${ownerSession[0]}, updating current socket session`);
        const [ownerSocketId, ownerSessionData] = ownerSession;
        userSessions.set(socket.id, ownerSessionData);
        socket.data = ownerSessionData;
        
        // Remove the old owner session
        userSessions.delete(ownerSocketId);
        
        console.log('Session updated, proceeding with approval');
      } else {
        console.log('No room owner session found, cannot approve');
        return;
      }
    }

    const pendingUser = room.pendingMembers.get(data.userId);
    if (!pendingUser) {
      console.log('Pending user not found:', data.userId);
      return;
    }

    console.log('Approving user:', pendingUser.username);

    // Move from pending to active
    room.pendingMembers.delete(data.userId);
    room.users.set(data.userId, pendingUser);

    // Notify the approved user
    const approvedSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.data?.userId === data.userId);
    console.log('Looking for approved user socket. User ID:', data.userId);
    console.log('Available sockets for approved user:', Array.from(io.sockets.sockets.values()).map(s => ({ socketId: s.id, userId: s.data?.userId })));
    
    if (approvedSocket) {
      console.log('Found approved user socket, sending approval');
      approvedSocket.emit('member_approved', { 
        room: {
          ...room,
          users: Array.from(room.users.values()),
          pendingMembers: Array.from(room.pendingMembers.values())
        }
      });
      approvedSocket.join(session.roomId);
      // Don't update socket data again since it's already set when they joined as pending
    } else {
      console.log('Approved user socket not found');
    }

    // Notify all users in room about the new member
    socket.to(session.roomId).emit('member_approved', { user: pendingUser });
  });

  // Reject band member
  socket.on('reject_member', (data: { userId: string }) => {
    console.log('Reject member event received:', data);
    const session = userSessions.get(socket.id);
    if (!session) {
      console.log('No session found for socket:', socket.id);
      return;
    }
    
    const room = rooms.get(session.roomId);
    if (!room) {
      console.log('Room not found:', session.roomId);
      return;
    }
    
    console.log('Session userId:', session.userId);
    console.log('Room owner:', room.owner);
    console.log('Are they equal?', session.userId === room.owner);
    
    if (room.owner !== session.userId) {
      console.log('Room not found or user is not owner. Room:', room?.id, 'Owner:', room?.owner, 'Session user:', session.userId);
      return;
    }

    const pendingUser = room.pendingMembers.get(data.userId);
    if (!pendingUser) {
      console.log('Pending user not found:', data.userId);
      return;
    }

    console.log('Rejecting user:', pendingUser.username);

    room.pendingMembers.delete(data.userId);

    // Notify the rejected user
    const rejectedSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.data?.userId === data.userId);
    if (rejectedSocket) {
      rejectedSocket.emit('member_rejected', { message: 'Your request was rejected' });
    }
  });

  // Play note
  socket.on('play_note', (data: { 
    notes: string[], 
    velocity: number, 
    instrument: string, 
    category: string,
    eventType: 'note_on' | 'note_off' | 'sustain_on' | 'sustain_off',
    isKeyHeld?: boolean
  }) => {
    const session = userSessions.get(socket.id);
    if (!session) return;

    const room = rooms.get(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Update user's current instrument
    user.currentInstrument = data.instrument;
    user.currentCategory = data.category;

    // Broadcast to all users in room (except sender)
    socket.to(session.roomId).emit('note_played', {
      userId: session.userId,
      username: user.username,
      notes: data.notes,
      velocity: data.velocity,
      instrument: data.instrument,
      category: data.category,
      eventType: data.eventType,
      isKeyHeld: data.isKeyHeld
    });
  });

  // Change instrument
  socket.on('change_instrument', (data: { instrument: string; category: string }) => {
    const session = userSessions.get(socket.id);
    if (!session) return;

    const room = rooms.get(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    user.currentInstrument = data.instrument;
    user.currentCategory = data.category;

    // Notify others in room
    socket.to(session.roomId).emit('instrument_changed', {
      userId: session.userId,
      username: user.username,
      instrument: data.instrument,
      category: data.category
    });
  });

  // Update mixer settings
  socket.on('update_mixer', (data: { mode: 'original' | 'custom'; settings?: Record<string, number> }) => {
    const session = userSessions.get(socket.id);
    if (!session) return;

    const room = rooms.get(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    if (data.mode === 'original' && user.role === 'room_owner') {
      room.mixerMode = data.mode;
      if (data.settings) {
        room.mixerSettings = data.settings;
      }
      io.to(session.roomId).emit('mixer_updated', {
        mode: room.mixerMode,
        settings: room.mixerSettings
      });
    } else if (data.mode === 'custom') {
      // Custom mode is local to each user
      socket.emit('mixer_updated', {
        mode: data.mode,
        settings: data.settings || {}
      });
    }
  });

  // Transfer ownership
  socket.on('transfer_ownership', (data: { newOwnerId: string }) => {
    const session = userSessions.get(socket.id);
    if (!session) return;

    const room = rooms.get(session.roomId);
    if (!room || room.owner !== session.userId) return;

    const newOwner = room.users.get(data.newOwnerId);
    if (!newOwner || newOwner.role !== 'band_member') return;

    // Update roles
    room.owner = data.newOwnerId;
    newOwner.role = 'room_owner';
    const oldOwner = room.users.get(session.userId);
    if (oldOwner) {
      oldOwner.role = 'band_member';
    }

    // Notify all users in room
    io.to(session.roomId).emit('ownership_transferred', {
      newOwner: newOwner,
      oldOwner: oldOwner
    });
  });

  // Leave room
  socket.on('leave_room', () => {
    const session = userSessions.get(socket.id);
    if (!session) return;

    const room = rooms.get(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Remove user from room
    room.users.delete(session.userId);
    room.pendingMembers.delete(session.userId);

    // If room owner leaves, transfer ownership or close room
    if (user.role === 'room_owner') {
      const bandMembers = Array.from(room.users.values())
        .filter(u => u.role === 'band_member');
      
      if (bandMembers.length > 0) {
        // Transfer to first band member
        const newOwner = bandMembers[0];
        if (newOwner) {
          room.owner = newOwner.id;
          newOwner.role = 'room_owner';
          
          io.to(session.roomId).emit('ownership_transferred', {
            newOwner: newOwner,
            oldOwner: user
          });
        }
      } else {
        // Close room if no members left
        io.to(session.roomId).emit('room_closed', { message: 'Room owner left and no members remain' });
        rooms.delete(session.roomId);
        
        // Broadcast to all clients that the room was closed
        socket.broadcast.emit('room_closed_broadcast', { roomId: session.roomId });
      }
    }

    // Notify others
    socket.to(session.roomId).emit('user_left', { user });
    socket.leave(session.roomId);
    userSessions.delete(socket.id);
  });

  // Create room
  socket.on('create_room', (data: { name: string; username: string }) => {
    // Check if socket already has a session (prevent multiple room creation)
    if (socket.data?.roomId) {
      console.log('Socket already has room session, ignoring create_room request');
      return;
    }
    
    const roomId = uuidv4();
    const userId = uuidv4();
    
    console.log('Creating room:', roomId, 'with owner:', userId);
    
    const room: Room = {
      id: roomId,
      name: data.name,
      owner: userId,
      users: new Map(),
      pendingMembers: new Map(),
      mixerMode: 'original',
      mixerSettings: {},
      createdAt: new Date()
    };

    const owner: User = {
      id: userId,
      username: data.username,
      role: 'room_owner',
      isReady: true
    };

    room.users.set(userId, owner);
    rooms.set(roomId, room);

    socket.join(roomId);
    socket.data = { roomId, userId };
    userSessions.set(socket.id, { roomId, userId });

    console.log('Room created. Socket data:', socket.data);
    console.log('User session stored:', userSessions.get(socket.id));

    socket.emit('room_created', { 
      room: {
        ...room,
        users: Array.from(room.users.values()),
        pendingMembers: Array.from(room.pendingMembers.values())
      }, 
      user: owner 
    });

    // Broadcast to all clients that a new room was created (only once)
    console.log('Broadcasting room created to all clients');
    socket.broadcast.emit('room_created_broadcast', {
      id: room.id,
      name: room.name,
      userCount: room.users.size,
      owner: room.owner,
      createdAt: room.createdAt.toISOString()
    });
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    const session = userSessions.get(socket.id);
    if (session) {
      const room = rooms.get(session.roomId);
      if (room) {
        const user = room.users.get(session.userId);
        if (user) {
          room.users.delete(session.userId);
          room.pendingMembers.delete(session.userId);

          // Handle room owner disconnection
          if (user.role === 'room_owner') {
            const bandMembers = Array.from(room.users.values())
              .filter(u => u.role === 'band_member');
            
            if (bandMembers.length > 0) {
              const newOwner = bandMembers[0];
              if (newOwner) {
                room.owner = newOwner.id;
                newOwner.role = 'room_owner';
                
                io.to(session.roomId).emit('ownership_transferred', {
                  newOwner: newOwner,
                  oldOwner: user
                });
              }
            } else {
              io.to(session.roomId).emit('room_closed', { message: 'Room owner disconnected and no members remain' });
              rooms.delete(session.roomId);
              
              // Broadcast to all clients that the room was closed
              socket.broadcast.emit('room_closed_broadcast', { roomId: session.roomId });
            }
          }

          socket.to(session.roomId).emit('user_left', { user });
        }
      }
      userSessions.delete(socket.id);
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Start server
server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

export default app; 