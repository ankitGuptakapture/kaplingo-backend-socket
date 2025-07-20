import { Socket } from "socket.io";
import {
  setupDeepgram,
  cleanupDeepgram,
  type SocketServer,
  type DeepgramConnection,
  deepgramClient,
} from "../src/index";
// import { Translate } from '@google-cloud/translate';
import fs from "fs";

export const getAudio = async (text:string,socket:Socket,room:string) => {
  console.log("firing up the audio")
  const response = await deepgramClient.speak.request(
    { text },
    {
      model: "aura-2-thalia-en",
      encoding: "linear16",
      container: "wav",
    }
  );
  // STEP 3: Get the audio stream and headers from the response
  const stream = await response.getStream();
  const headers = await response.getHeaders();
  if (stream) {
    // STEP 4: Convert the stream to an audio buffer
    const buffer = await getAudioBuffer(stream);
    socket
    .to(room)
    .emit("audio:stream", { user: socket.id, audioBuffer: buffer });

  } else {
    console.error("Error generating audio:", stream);
  }
  if (headers) {
    console.log("Headers:", headers);
  }
};
// helper function to convert stream to audio buffer
const getAudioBuffer = async (response: ReadableStream<Uint8Array>) => {
  const reader = response.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const dataArray = chunks.reduce(
    (acc, chunk) => Uint8Array.from([...acc, ...chunk]),
    new Uint8Array(0)
  );
  return Buffer.from(dataArray.buffer);
};


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

  }

  leaveRoom(room: string, socket: Socket) {
    socket.leave(room);
    this.removeFromRoom(room, socket.id);
    socket.to(room).emit("user:left", { user: socket.id });
   
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
     
      socketInstance.joinRoom(room, socket);
    });

    socket.on("room:leave", (room: string) => {
      socketInstance.leaveRoom(room, socket);
    });

    socket.on("disconnect", () => {

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



    socket.on("audio:send", async ({ room, audioBuffer }) => {
      // Initialize Deepgram connection if not already done
      if (!deepgramConnection) {
        deepgramConnection = setupDeepgram(socket.id, (transcriptData) => {
          // Log transcript forwarding
          if (
            transcriptData.channel &&
            transcriptData.channel.alternatives &&
            transcriptData.channel.alternatives.length > 0
          ) {
            const transcript =
              transcriptData.channel.alternatives[0].transcript;
            const isFinal = transcriptData.is_final;
           console.log(transcript,"here getting the data")
           getAudio(transcript,socket,room)
          }
        });

        // Wait a bit for connection to establish
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      // Send audio to Deepgram if connection is ready
      if (deepgramConnection && deepgramConnection.isConnected) {
        try {
          // Convert audioBuffer to proper format if needed
          const buffer = Buffer.isBuffer(audioBuffer)
            ? audioBuffer
            : Buffer.from(audioBuffer);
          deepgramConnection.connection.send(buffer);
        } catch (error) {
          console.error(
            `Error sending audio to Deepgram for socket ${socket.id}:`,
            error
          );
        }
      } else {
        console.log(
          `[AUDIO SEND - ${socket.id}] Deepgram connection not ready (isConnected: ${deepgramConnection?.isConnected}), skipping audio data`
        );
        
        // Try to reconnect if connection failed
        if (deepgramConnection && !deepgramConnection.isConnected) {
          console.log(`[AUDIO SEND - ${socket.id}] Attempting to reconnect Deepgram`);
          cleanupDeepgram(deepgramConnection, socket.id);
          deepgramConnection = null;
        }
      }

      // Forward audio to other clients in the room
      // socket
      //   .to(room)
      //   .emit("audio:stream", { user: socket.id, audioBuffer: audioBuffer });
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
