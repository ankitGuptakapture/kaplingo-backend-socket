import { Socket } from "socket.io";
import {
  setupOptimizedDeepgram,
  cleanupOptimizedDeepgram,
  getDeepgramStats,
  AudioBufferOptimizer,
  type OptimizedDeepgramConnection,
} from "../src/optimized-deepgram";
import { type SocketServer } from "../src/index";

class OptimizedSocketRooms {
  io: SocketServer;
  rooms: Map<string, Set<string>>;
  audioOptimizers: Map<string, AudioBufferOptimizer>;

  constructor(io: SocketServer) {
    this.io = io;
    this.rooms = new Map();
    this.audioOptimizers = new Map();
  }

  assignRoom(socket: Socket) {
    socket.join(socket.id);
    this.addToRoom(socket.id, socket.id);
    socket.emit("room:assigned", { room: socket.id });
  }

  joinRoom(room: string, socket: Socket) {
    socket.join(room);
    this.addToRoom(room, socket.id);
    socket.emit("room:joined", { room });
    socket.to(room).emit("user:joined", { user: socket.id });
    console.log(`Socket ${socket.id} joined room ${room}`);
  }

  leaveRoom(room: string, socket: Socket) {
    socket.leave(room);
    this.removeFromRoom(room, socket.id);
    socket.to(room).emit("user:left", { user: socket.id });
    console.log(`Socket ${socket.id} left room ${room}`);
  }

  addToRoom(room: string, socketId: string) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(socketId);
  }

  removeFromRoom(room: string, socketId: string) {
    if (this.rooms.has(room)) {
      this.rooms.get(room)!.delete(socketId);
      if (this.rooms.get(room)!.size === 0) {
        this.rooms.delete(room);
      }
    }
  }

  getRooms() {
    const result: Record<string, string[]> = {};
    for (const [room, members] of this.rooms.entries()) {
      result[room] = Array.from(members);
    }
    return result;
  }

  async userOnline(useremail: string, socket: Socket) {
    socket.join(useremail);
    socket.broadcast.emit("user:active", useremail);
  }

  sendMessage(message: string) {
    this.io.to(message).emit("incoming:message", message);
  }

  async userDisconnect(useremail: string, socket: Socket) {
    socket.broadcast.emit("user:deactive", useremail);
  }

  getAudioOptimizer(socketId: string): AudioBufferOptimizer {
    if (!this.audioOptimizers.has(socketId)) {
      this.audioOptimizers.set(socketId, new AudioBufferOptimizer());
    }
    return this.audioOptimizers.get(socketId)!;
  }

  cleanupAudioOptimizer(socketId: string) {
    this.audioOptimizers.delete(socketId);
  }
}

const createOptimizedSocketInit = (io: SocketServer) => {
  return (socket: Socket) => {
    const socketInstance = new OptimizedSocketRooms(io);
    let deepgramConnection: OptimizedDeepgramConnection | null = null;
    let currentRoom: string | null = null;

    socketInstance.assignRoom(socket);

    socket.on("room:join", (data) => {
      const room = typeof data === "string" ? data : data.room;
      console.log(`Join room request: ${room} from socket ${socket.id}`);
      currentRoom = room;
      socketInstance.joinRoom(room, socket);
    });

    socket.on("room:leave", (room: string) => {
      socketInstance.leaveRoom(room, socket);
      if (currentRoom === room) {
        currentRoom = null;
      }
    });

    socket.on("disconnect", () => {
      console.log(`Socket ${socket.id} disconnected`);

      // Clean up optimized Deepgram connection
      if (deepgramConnection) {
        cleanupOptimizedDeepgram(socket.id);
        deepgramConnection = null;
      }

      // Clean up audio optimizer
      socketInstance.cleanupAudioOptimizer(socket.id);

      // Clean up rooms
      for (const [room, members] of socketInstance.rooms.entries()) {
        if (members.has(socket.id)) {
          socketInstance.leaveRoom(room, socket);
        }
      }
    });

    socket.on("user:online", (email: string) =>
      socketInstance.userOnline(email, socket)
    );

    socket.on("user:disconnect", (email: string) =>
      socketInstance.userDisconnect(email, socket)
    );

    socket.on("message:send", (message) => {
      socketInstance.sendMessage(message);
    });

    // Optimized audio start handler
    socket.on("audio:start", ({ room }) => {
      console.log(
        `Starting optimized audio stream for socket ${socket.id} in room ${room}`
      );
      currentRoom = room;

      if (!deepgramConnection) {
        deepgramConnection = setupOptimizedDeepgram(
          socket.id,
          (transcriptData) => {
            // Fast transcript forwarding
            if (transcriptData.channel?.alternatives?.[0]?.transcript?.trim()) {
              const transcript =
                transcriptData.channel.alternatives[0].transcript;
              const isFinal = transcriptData.is_final;

              console.log(
                `[OPTIMIZED TRANSCRIPT - ${socket.id}] ${
                  isFinal ? "FINAL" : "INTERIM"
                }: "${transcript}"`
              );

              // Immediate forwarding to room
              socket.to(room).emit("transcript:received", {
                user: socket.id,
                transcript: transcriptData,
                room: room,
                timestamp: Date.now(), // Use timestamp for speed
                optimized: true,
              });
            }
          }
        );
      }
    });

    // Optimized audio send handler with buffer optimization
    socket.on("audio:send", async ({ room, audioBuffer }) => {
      if (!currentRoom) currentRoom = room;

      // Initialize optimized connection if needed
      if (!deepgramConnection) {
        deepgramConnection = setupOptimizedDeepgram(
          socket.id,
          (transcriptData) => {
            if (transcriptData.channel?.alternatives?.[0]?.transcript?.trim()) {
              const transcript =
                transcriptData.channel.alternatives[0].transcript;
              const isFinal = transcriptData.is_final;

              // Immediate forwarding
              socket.to(room).emit("transcript:received", {
                user: socket.id,
                transcript: transcriptData,
                room: room,
                timestamp: Date.now(),
                optimized: true,
              });
            }
          }
        );
      }

      // Optimized audio processing
      if (deepgramConnection?.isConnected) {
        try {
          const buffer = Buffer.isBuffer(audioBuffer)
            ? audioBuffer
            : Buffer.from(audioBuffer);

          // Use audio optimizer for better performance
          const audioOptimizer = socketInstance.getAudioOptimizer(socket.id);
          const optimizedChunks = audioOptimizer.optimizeBuffer(buffer);

          // Send optimized chunks
          for (const chunk of optimizedChunks) {
            deepgramConnection.connection.send(chunk);
          }

          if (optimizedChunks.length > 0) {
            console.log(
              `[OPTIMIZED AUDIO - ${socket.id}] Sent ${optimizedChunks.length} optimized chunks`
            );
          }
        } catch (error) {
          console.error(
            `Error in optimized audio processing for socket ${socket.id}:`,
            error
          );
        }
      }

      // Forward audio to room (unchanged)
      socket
        .to(room)
        .emit("audio:stream", { user: socket.id, audioBuffer: audioBuffer });
    });

    // Handle silence with buffer flush
    socket.on("audio:silence", ({ room }) => {
      console.log(`Silence event from ${socket.id} in room ${room}`);

      // Flush any remaining audio buffers
      if (deepgramConnection?.isConnected) {
        const audioOptimizer = socketInstance.getAudioOptimizer(socket.id);
        const remainingChunks = audioOptimizer.flush();

        for (const chunk of remainingChunks) {
          deepgramConnection.connection.send(chunk);
        }

        if (remainingChunks.length > 0) {
          console.log(
            `[OPTIMIZED FLUSH - ${socket.id}] Flushed ${remainingChunks.length} remaining chunks`
          );
        }
      }

      socket.to(room).emit("audio:silence", { user: socket.id });
    });

    // Optimized audio stop handler
    socket.on("audio:stop", ({ room }) => {
      console.log(
        `Stopping optimized audio stream for socket ${socket.id} in room ${room}`
      );

      // Flush remaining buffers before cleanup
      if (deepgramConnection?.isConnected) {
        const audioOptimizer = socketInstance.getAudioOptimizer(socket.id);
        const remainingChunks = audioOptimizer.flush();

        for (const chunk of remainingChunks) {
          deepgramConnection.connection.send(chunk);
        }
      }

      // Cleanup
      if (deepgramConnection) {
        cleanupOptimizedDeepgram(socket.id);
        deepgramConnection = null;
      }

      socketInstance.cleanupAudioOptimizer(socket.id);
      currentRoom = null;
    });

    // Add stats endpoint for monitoring
    socket.on("deepgram:stats", () => {
      const stats = getDeepgramStats();
      socket.emit("deepgram:stats", stats);
    });
  };
};

export default createOptimizedSocketInit;
