import { Socket } from "socket.io";
import {
  setupDeepgram,
  cleanupDeepgram,
  type SocketServer,
  type DeepgramConnection,
} from "../src/index";
import translateText from "../service/translate";
// import { Translate } from '@google-cloud/translate';

class SocketRooms {
  io: SocketServer;
  rooms: Map<string, Set<string>>;
  constructor(io: SocketServer) {
    this.io = io;
    this.rooms = new Map();
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
}

const createSocketInit = (io: SocketServer) => {
  return (socket: Socket) => {
    const socketInstance = new SocketRooms(io);
    let deepgramConnection: DeepgramConnection | null = null;

    socketInstance.assignRoom(socket);

    socket.on("room:join", (data) => {
      const room = typeof data === "string" ? data : data.room;
      console.log(`Join room request: ${room} from socket ${socket.id}`);
      socketInstance.joinRoom(room, socket);
    });

    socket.on("room:leave", (room: string) => {
      socketInstance.leaveRoom(room, socket);
    });

    socket.on("disconnect", () => {
      console.log(`Socket ${socket.id} disconnected`);

      // Clean up Deepgram connection
      if (deepgramConnection) {
        cleanupDeepgram(deepgramConnection, socket.id);
        deepgramConnection = null;
      }

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

    // Initialize Deepgram connection when audio streaming starts
    socket.on("audio:start", ({ room }) => {
      console.log(
        `Starting audio stream for socket ${socket.id} in room ${room}`
      );

      if (!deepgramConnection) {
        deepgramConnection = setupDeepgram(socket.id, async(transcriptData) => {
          // Log transcript forwarding
          if (
            transcriptData.channel &&
            transcriptData.channel.alternatives &&
            transcriptData.channel.alternatives.length > 0
          ) {
            const transcript =
              transcriptData.channel.alternatives[0].transcript;
            console.log({transcript});
            const isFinal = transcriptData.is_final;
            console.log(
              `[SOCKET FORWARD - ${socket.id}] Sending ${
                isFinal ? "FINAL" : "INTERIM"
              } transcript to room ${room}: "${transcript}"`
            );
          }

          console.log({transcriptData});

          // Send transcript to the room
          socket.to(room).emit("transcript:received", {
            user: socket.id,
            transcript: transcriptData,
            room: room,
            timestamp: new Date().toISOString(),
          });
        });
      }
    });

    socket.on("audio:send", async ({ room, audioBuffer }) => {
      // Initialize Deepgram connection if not already done
      if (!deepgramConnection) {
        deepgramConnection = setupDeepgram(socket.id, async(transcriptData) => {
          // Log transcript forwarding
          if (
            transcriptData.channel &&
            transcriptData.channel.alternatives &&
            transcriptData.channel.alternatives.length > 0
          ) {
            const transcript =
              transcriptData.channel.alternatives[0].transcript;

              const translatedTranscript = await translateText(transcript);
              console.log({transcript,translatedTranscript},"line 175");

            const isFinal = transcriptData.is_final;
            console.log(
              `[SOCKET FORWARD - ${socket.id}] Sending ${
                isFinal ? "FINAL" : "INTERIM"
              } transcript to room ${room}: "${transcript}"`
            );
          }


          socket.to(room).emit("transcript:received", {
            user: socket.id,
            transcript: transcriptData,
            room: room,
            timestamp: new Date().toISOString(),
          });
        });
      }

      // Send audio to Deepgram if connection is ready
      if (deepgramConnection && deepgramConnection.isConnected) {
        try {
          // Convert audioBuffer to proper format if needed
          const buffer = Buffer.isBuffer(audioBuffer)
            ? audioBuffer
            : Buffer.from(audioBuffer);
          console.log(
            `[AUDIO SEND - ${socket.id}] Sending ${buffer.length} bytes to Deepgram`
          );
          deepgramConnection.connection.send(buffer);
        } catch (error) {
          console.error(
            `Error sending audio to Deepgram for socket ${socket.id}:`,
            error
          );
        }
      } else {
        console.log(
          `[AUDIO SEND - ${socket.id}] Deepgram connection not ready, skipping audio data`
        );
      }

      // Forward audio to other clients in the room
      socket
        .to(room)
        .emit("audio:stream", { user: socket.id, audioBuffer: audioBuffer });
    });

    // Handle silence events
    socket.on("audio:silence", ({ room }) => {
      console.log(`Silence event from ${socket.id} in room ${room}`);
      socket.to(room).emit("audio:silence", { user: socket.id });
    });

    // Handle audio stop
    socket.on("audio:stop", ({ room }) => {
      console.log(
        `Stopping audio stream for socket ${socket.id} in room ${room}`
      );

      if (deepgramConnection) {
        cleanupDeepgram(deepgramConnection, socket.id);
        deepgramConnection = null;
      }
    });
  };
};

export default createSocketInit;
