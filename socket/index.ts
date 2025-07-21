import { Socket } from "socket.io";
import {
  setupDeepgram,
  cleanupDeepgram,
  type SocketServer,
  type DeepgramConnection,
  deepgramClient,
} from "../src/index";
import translateText from "../service/translate";
import fs from "fs";

export const getAudio = async (
  text: string,
  socket: Socket,
  room: string,
  onStreamEnd: () => void
) => {
  try {
    const response = await deepgramClient.speak.request(
      { text },
      {
        model: "aura-2-thalia-en",
        encoding: "linear16",
        sample_rate: 16000,
        container: "none",
      }
    );

    const stream = await response.getStream();
    if (stream) {
      socket.to(room).emit("audio:stream:start", { user: socket.id });
      const reader = stream.getReader();
      let leftover: Buffer | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          socket.to(room).emit("audio:stream:stop", { user: socket.id });
          onStreamEnd();
          break;
        }

        let currentChunk = Buffer.from(value);
        if (leftover) {
          currentChunk = Buffer.concat([leftover, currentChunk]);
          leftover = null;
        }

        const sendableLength = currentChunk.length - (currentChunk.length % 2);
        if (sendableLength > 0) {
          const chunkToSend = currentChunk.subarray(0, sendableLength);
          console.log("Sending audio chunk:", chunkToSend);
          socket
            .to(room)
            .emit("audio:stream", { user: socket.id, audioBuffer: chunkToSend });
        }
        if (sendableLength < currentChunk.length) {
          leftover = currentChunk.subarray(sendableLength);
        }
      }
    } else {
      console.error("Error generating audio: Stream is null");
      onStreamEnd();
    }
  } catch (error) {
    console.error("Error in getAudio:", error);
    onStreamEnd();
  }
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
    let currentRoom: string | null = null;

    let audioQueue: Buffer[] = []; // Unified queue for all audio data
    let isConnecting = false;
    let speechTimeout: NodeJS.Timeout | null = null;
    let isProcessingAudio = false; // Prevent multiple audio processing
    
    let responseQueue: string[] = [];
    let isSpeaking = false;

    const processResponseQueue = async () => {
      if (isSpeaking || responseQueue.length === 0) {
        return;
      }

      isSpeaking = true;
      const textToSpeak = responseQueue.shift();

      if (textToSpeak && currentRoom) {
        getAudio(textToSpeak, socket, currentRoom, () => {
          isSpeaking = false;
          processResponseQueue(); 
        });
      } else {
        isSpeaking = false;
      }
    };
    
    const sendAudioBatchToDeepgram = () => {
      if (speechTimeout) clearTimeout(speechTimeout);
      // Use the unified processAudioQueue function
      processAudioQueue();
    };

    const handleTranscript = async (transcriptData: any) => {
      if (
        transcriptData.channel &&
        transcriptData.channel.alternatives &&
        transcriptData.channel.alternatives.length > 0
      ) {
        const transcript = transcriptData.channel.alternatives[0].transcript;
        const isFinal = transcriptData.is_final;

        console.log("transcript got from deepgram:", transcript);
        if (isFinal && transcript.trim().length > 0) {
          const agentResponse = await translateText(transcript);
          responseQueue.push(agentResponse);
          processResponseQueue();
        }
      }
    };

    // Process audio queue - unified function for handling all audio data
    const processAudioQueue = () => {
      if (isProcessingAudio || !deepgramConnection?.isConnected || audioQueue.length === 0) {
        return;
      }

      isProcessingAudio = true;
      
      try {
        // Send all queued audio data
        const batch = Buffer.concat(audioQueue);
        deepgramConnection.connection.send(batch);
        console.log(`Sent ${audioQueue.length} audio buffers to Deepgram`);
        audioQueue = [];
      } catch (error) {
        console.error('Error sending audio batch to Deepgram:', error);
      } finally {
        isProcessingAudio = false;
      }
    };

    // Initialize Deepgram connection immediately when socket connects
    const initializeDeepgram = () => {
      if (!deepgramConnection && !isConnecting) {
        isConnecting = true;
        console.log(`Initializing Deepgram connection for socket ${socket.id}`);

        const onOpen = () => {
          isConnecting = false;
          console.log(`Deepgram connection ready for socket ${socket.id}`);
          
          // Process any queued audio data
          processAudioQueue();
        };

        try {
          deepgramConnection = setupDeepgram(
            socket.id,
            handleTranscript,
            socket,
            onOpen
          );
        } catch (error) {
          console.error(`Failed to initialize Deepgram for socket ${socket.id}:`, error);
          isConnecting = false;
        }
      }
    };

    socketInstance.assignRoom(socket);
    
    // Initialize Deepgram connection immediately
    initializeDeepgram();

    socket.on("room:join", (data) => {
      const room = typeof data === "string" ? data : data.room;
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
      sendAudioBatchToDeepgram();
      if (deepgramConnection) {
        cleanupDeepgram(deepgramConnection, socket.id);
        deepgramConnection = null;
      }
      responseQueue = [];
      isSpeaking = false;
      audioQueue = []; // Clear audio queue
      isConnecting = false;
      isProcessingAudio = false;

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
      const buffer = Buffer.from(audioBuffer);
      currentRoom = room;
      
      // Add to unified audio queue
      audioQueue.push(buffer);
      
      // Process queue if connection is ready, otherwise ensure initialization
      if (deepgramConnection && deepgramConnection.isConnected && !isProcessingAudio) {
        processAudioQueue();
      } else {
        console.log(`Queuing audio data, total queued: ${audioQueue.length}`);
        
        // Ensure Deepgram is being initialized
        if (!deepgramConnection && !isConnecting) {
          initializeDeepgram();
        }
      }
    });


    socket.on("audio:silence", ({ room }) => {
      console.log(`Silence event from ${socket.id} in room ${room}`);
      // socket.to(room).emit("audio:silence", { user: socket.id });
      sendAudioBatchToDeepgram();
    });

    // Handle audio stop - process immediately
    socket.on("audio:stop", ({ room }) => {
      console.log(
        `Stopping audio stream for socket ${socket.id} in room ${room}`      );
      sendAudioBatchToDeepgram();
      if (deepgramConnection) {
        // Don't clean up here, let disconnect handle it
      }
    });
  };
};

export default createSocketInit;
