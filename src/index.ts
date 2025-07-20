import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import createSocketInit from "../socket";
import cors from "cors";
import { createClient, AgentEvents, LiveTranscriptionEvents } from "@deepgram/sdk"
import fetch from "cross-fetch";

dotenv.config();
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
let keepAlive:NodeJS.Timeout;

export const setupDeepgram = () => {
  const deepgram = deepgramClient.listen.live({
    smart_format: true,
    model: "nova-3",
  });

  if (keepAlive) clearInterval(keepAlive);
  keepAlive = setInterval(() => {
    console.log("deepgram: keepalive");
    deepgram.keepAlive();
  }, 10 * 1000);

  deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
    console.log("deepgram: connected");

    deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
      console.log("deepgram: transcript received");
      console.log("ws: transcript sent to client");
    console.log(data,"data recived")
    });

    deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
      console.log("deepgram: disconnected");
      clearInterval(keepAlive);
      deepgram.finish();
    });

    deepgram.addListener(LiveTranscriptionEvents.Error, async (error) => {
      console.log("deepgram: error received");
      console.error(error);
    });


    deepgram.addListener(LiveTranscriptionEvents.Metadata, (data) => {
      console.log("deepgram: metadata received");
      console.log("ws: metadata sent to client");

    });
  });

  return deepgram;
};
  

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
    }
});

export type SocketServer = typeof io;
const socketInit = createSocketInit(io);

io.on("connection",socketInit);



const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
