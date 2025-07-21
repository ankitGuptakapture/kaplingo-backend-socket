import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import createSocketInit from "../socket";
import cors from "cors";
import {
  createClient,
  LiveTranscriptionEvents,
  LiveClient,
} from "@deepgram/sdk";
import { Socket } from "socket.io";


dotenv.config();
const app = express();
app.use(express.json({ limit: "50mb" }));


app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cors({ origin: "*" }));

export const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
export interface DeepgramConnection {
  connection: LiveClient;
  keepAlive: NodeJS.Timeout;
  isConnected: boolean;
}

export const setupDeepgram = (
  socketId: string,
  onTranscript?: (data: any) => void,
  socket?: Socket,
  onOpen?: () => void,
  language?: string
): DeepgramConnection => {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error(`No Deepgram API key found for socket ${socketId}`);
    throw new Error("DEEPGRAM_API_KEY is required");
  }

  const deepgram = deepgramClient.listen.live({
    smart_format: true,
    model: "nova-2",
    punctuate: true,
    interim_results: false,
    endpointing: 100,
    vad_events: false,
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    language: "multi",
  });

  const keepAlive = setInterval(() => {
    if (deepgram.getReadyState() === 1) {
      deepgram.keepAlive();
    } else {
      console.log(`deepgram: connection not ready for keepalive (state: ${deepgram.getReadyState()})`);
    }
  }, 8000);

  const connectionObj = {
    connection: deepgram,
    keepAlive,
    isConnected: false,
  };

  deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
    console.log(`deepgram: connected successfully for socket `);
    connectionObj.isConnected = true;
    if (onOpen) onOpen();
  });

  deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
    if (data.channel?.alternatives?.length) {
      const transcript = data.channel.alternatives[0].transcript;
      if (data.is_final && transcript.trim().length > 0 && onTranscript) {
        onTranscript(data);
      }
    }
  });

  deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
    console.log(`deepgram: disconnected for socket ${socketId}`);
    connectionObj.isConnected = false;
    clearInterval(keepAlive);
  });

  deepgram.addListener(LiveTranscriptionEvents.Error, async (error) => {
    console.log(`deepgram: error received for socket ${socketId}`);
    console.error("Deepgram error details:", error);
    connectionObj.isConnected = false;
  });

  return connectionObj;
};

export const cleanupDeepgram = (
  deepgramConnection: DeepgramConnection,
  socketId: string
) => {
  console.log(`Cleaning up Deepgram for socket: ${socketId}`);

  if (deepgramConnection.keepAlive) {
    clearInterval(deepgramConnection.keepAlive);
  }

  if (
    deepgramConnection.connection &&
    deepgramConnection.connection.getReadyState() === 1
  ) {
    deepgramConnection.connection.finish();
  }

  deepgramConnection.isConnected = false;
};

const httpServer = createServer(app);
export const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

export type SocketServer = typeof io;
const socketInit = createSocketInit(io);
io.on("connection", socketInit);

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
