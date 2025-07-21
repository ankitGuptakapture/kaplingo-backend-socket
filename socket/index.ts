import { Socket } from "socket.io";
import {
  setupDeepgram,
  cleanupDeepgram,
  type SocketServer,
  type DeepgramConnection,
  deepgramClient,
  io,
} from "../src/index";
import translateText from "../service/translate";
type UserLang = {
  user?: string,
}
export let userRooms: Record<string, UserLang> = {}

export const clearData = () =>{
  userRooms = {}
}
const saveLang = ({ room, user, lang }: { room: string, user: string, lang: string }) => {
  if (!userRooms[room]) {
    userRooms[room] = {}
  }
  if (userRooms[room]) {
    userRooms[room] = {  ...userRooms[room], [user]: lang }
  }
}

const getLang = ({ room, user }: { room: string, user: string }) => {
  if (userRooms[room]) {
    const ids = Object.keys(userRooms[room])
    let lang = "English"
    ids.forEach((id) => {
      if (id !== user) {
        lang = (userRooms[room] as any)[id]
      }
    })
    return lang
  } else {
    return "English"
  }
}

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
      io.to(room).except(socket.id).emit("audio:stream:start", { user: socket.id });
      const reader = stream.getReader();
      let leftover: Buffer | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          io.to(room).except(room).emit("audio:stream:stop", { user: socket.id });
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
          io
            .to(room)
            .except(socket.id)
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
    let currentUser: string | null = null;

    let audioQueue: Buffer[] = [];
    let isConnecting = false;
    let speechTimeout: NodeJS.Timeout | null = null;
    const SPEECH_TIMEOUT_MS = 100;

    let responseQueue: string[] = [];
    let isSpeaking = false;
    let transcriptStartTime: number | null = null;


    let transcriptQueue = "";
    let translateTimeout: NodeJS.Timeout | null = null;

    const flushTranscriptQueue = async () => {
      if (transcriptQueue.trim().length > 0) {
        const toTranslate = transcriptQueue.trim();
        transcriptQueue = "";

        try {
          let targetLanguage = "English";
          if (currentRoom && currentUser) {
            targetLanguage = getLang({ room: currentRoom, user: currentUser });
          }
          console.log({ targetLanguage }, "targetLanguage")
          const translated = await translateText(toTranslate, targetLanguage);
          responseQueue.push(translated);
          processResponseQueue();
        } catch (err) {
          console.error("Translation error:", err);
        }
      }
    };

    const queueTranscript = (text: string) => {
      transcriptQueue += " " + text;

      // If sentence ends, flush immediately
      if (/[.?!।]$/.test(text.trim())) {
        if (translateTimeout) clearTimeout(translateTimeout);
        flushTranscriptQueue();
      } else {
        // Else flush after 1 second pause
        if (translateTimeout) clearTimeout(translateTimeout);
        translateTimeout = setTimeout(() => flushTranscriptQueue(), 1000);
      }
    };

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
      if (deepgramConnection?.isConnected && audioQueue.length > 0) {
        const batch = Buffer.concat(audioQueue);
        deepgramConnection.connection.send(batch);
        audioQueue = [];
      }
    };

    const handleTranscript = async (transcriptData: any) => {
      const transcript = transcriptData.channel.alternatives[0].transcript;
      console.log({ transcript }, "transcript")
      if (transcript) {
        queueTranscript(transcript);
      }
    };

    socketInstance.assignRoom(socket);

    socket.on("room:join", (data) => {
      const room = typeof data === "string" ? data : data.room;
      currentRoom = room;
      saveLang({ room, user: data.user, lang: data.lang })
      socketInstance.joinRoom(room, socket);
      console.log(userRooms,"user rooms")
      if (!deepgramConnection) {
        deepgramConnection = setupDeepgram(
          socket.id,
          handleTranscript,
          socket,
          () => {
            isConnecting = false;
            console.log(`Deepgram connected early for room ${room}`);
          }
        );
        isConnecting = true;
      }
    });

    socket.on("room:leave", (room: string) => {
      socketInstance.leaveRoom(room, socket);
      if (currentRoom === room) {
        currentRoom = null;
      }
    });

    socket.on("remove:user",()=>{
      console.log("removing user")
    })

    socket.on("disconnect", () => {
      console.log("Disconnected from socket");
      sendAudioBatchToDeepgram();
      if (deepgramConnection) {
        cleanupDeepgram(deepgramConnection, socket.id);
        deepgramConnection = null;
      }
      responseQueue = [];
      isSpeaking = false;

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

    socket.on("audio:send", async ({ room, audioBuffer,user }) => {
      console.log({ audioBuffer }, "audioBuffer")
      const buffer = Buffer.from(audioBuffer);
      audioQueue.push(buffer);
      // Mark the time when the first buffer of a new utterance is received
      if (!transcriptStartTime) {
        transcriptStartTime = Date.now();
        console.log(`[Timing] First audio buffer received at ${transcriptStartTime}`);
      }
      sendAudioBatchToDeepgram();
      if (!isConnecting && !deepgramConnection) {
        isConnecting = true;
        currentRoom = room;
        currentUser = user;

        const language = getLang({ room, user })
        const onOpen = () => {
          isConnecting = false;
        };

        deepgramConnection = setupDeepgram(
          socket.id,
          handleTranscript,
          socket,
          onOpen,
          language
        );
      }
    });


    socket.on("audio:silence", ({ room }) => {
      console.log(`Silence event from ${socket.id} in room ${room}`);
      // socket.to(room).emit("audio:silence", { user: socket.id });
      // sendAudioBatchToDeepgram();
    });

    // Handle audio stop - process immediately
    socket.on("audio:stop", ({ room }) => {
      console.log(
        `Stopping audio stream for socket ${socket.id} in room ${room}`);
      sendAudioBatchToDeepgram();
      if (deepgramConnection) {
        // Don't clean up here, let disconnect handle it
      }
    });
  };
};

export default createSocketInit;
