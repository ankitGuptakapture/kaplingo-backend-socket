import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import createSocketInit from "../socket";
import cors from "cors";

dotenv.config();
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
    }
});

export type SocketServer = typeof io;
const socketInit = createSocketInit(io);

io.on("connection", socketInit);

// Endpoint to create a room and handle audio buffer streaming
app.post("/api/room/audio", (req, res) => {
    const { room, audioBuffer, socketId } = req.body;
    if (!room || !audioBuffer) {
        return res.status(400).json({ error: "room and audioBuffer are required" });
    }
    // Broadcast audio buffer to all clients in the room except the sender
    if (socketId) {
        io.to(room).except(socketId).emit("audio:stream", { user: socketId, audioBuffer });
    } else {
        io.to(room).emit("audio:stream", { user: "unknown", audioBuffer });
    }
    res.status(200).json({ message: "Audio buffer broadcasted to room", room });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});