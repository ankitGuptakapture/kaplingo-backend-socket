import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import createSocketInit, { getAudio } from "../socket";
import cors from "cors";
import {
  createClient,
  LiveTranscriptionEvents,
  LiveClient,
} from "@deepgram/sdk";
import fetch from "cross-fetch";

dotenv.config();
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cors());

export const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
export interface DeepgramConnection {
  connection: LiveClient;
  keepAlive: NodeJS.Timeout;
  isConnected: boolean;
}
export const setupDeepgram = (
  socketId: string,
  onTranscript?: (data: any) => void
): DeepgramConnection => {
  console.log(`Setting up Deepgram for socket: ${socketId}`);
  console.log(`Deepgram API Key present: ${!!process.env.DEEPGRAM_API_KEY}`);

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error(`No Deepgram API key found for socket ${socketId}`);
    throw new Error("DEEPGRAM_API_KEY is required");
  }

  const deepgram = deepgramClient.listen.live({
    smart_format: true,
    model: "nova-2",
    punctuate: true,
    interim_results: true,
    endpointing: 300,
    vad_events: true,
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    language: "hi",
  });

  const keepAlive = setInterval(() => {
    if (deepgram.getReadyState() === 1) {
      console.log(`deepgram: keepalive for ${socketId}`);
      deepgram.keepAlive();
    } else {
      console.log(`deepgram: connection not ready for keepalive (state: ${deepgram.getReadyState()}) for ${socketId}`);
    }
  }, 8000);

  const connectionObj = {
    connection: deepgram,
    keepAlive,
    isConnected: false,
  };

  deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
    // console.log(`deepgram: connected successfully for socket ${socketId}`);
    connectionObj.isConnected = true;
  });

  deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
    // console.log(`deepgram: transcript received for socket ${socketId}`);

    // Log detailed transcript information
    if (
      data.channel &&
      data.channel.alternatives &&
      data.channel.alternatives.length > 0
    ) {
      const transcript = data.channel.alternatives[0].transcript;
      const confidence = data.channel.alternatives[0].confidence;
      const isFinal = data.is_final;

      // console.log(` "${transcript}" (confidence: ${confidence})`);
      // getAudio(transcript,socket,room)
      // Only forward non-empty final transcripts
      if (isFinal && transcript.trim().length > 0) {
        if (onTranscript) {
          onTranscript(data);
        }
      } else if (!isFinal && transcript.trim().length > 0) {
        // Optionally forward interim results too
        if (onTranscript) {
          onTranscript(data);
        }
      }
    } else {
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

  deepgram.addListener(LiveTranscriptionEvents.Metadata, (data) => {
    console.log(`deepgram: metadata received for socket ${socketId}:`, data);
  });

  // Add connection timeout check
  setTimeout(() => {
    if (!connectionObj.isConnected) {
      console.warn(`deepgram: connection timeout for socket ${socketId} - connection not established within 5 seconds`);
    }
  }, 5000);

  console.log(`deepgram: setup complete for socket ${socketId}, waiting for connection...`);
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
const io = new Server(httpServer, {
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
