import { Socket } from "socket.io";
import type { SocketServer } from "../src/index";
// import { Translate } from '@google-cloud/translate';
import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";

const speechClient = new speech.SpeechClient();
// const translateClient = new Translate();
const ttsClient = new textToSpeech.TextToSpeechClient();
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


        socketInstance.assignRoom(socket);


        socket.on("room:join", (data) => {
            const room = typeof data === 'string' ? data : data.room;
            console.log(`Join room request: ${room} from socket ${socket.id}`);
            socketInstance.joinRoom(room, socket);
        });

        socket.on("room:leave", (room: string) => {
            socketInstance.leaveRoom(room, socket);
        });


        socket.on("disconnect", () => {
            console.log(`Socket ${socket.id} disconnected`);
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
            socket.to(room).emit("audio:stream", { user: socket.id, audioBuffer: audioBuffer });
            // commented out for now
            // Transcribe buffer to text (STT)
            // try {
            //     const [response] = await speechClient.recognize({
            //         config: {
            //             encoding: 'LINEAR16',
            //             sampleRateHertz: 16000,
            //             languageCode: 'auto', // or 'en-US'
            //         },
            //         audio: {
            //             content: buf.toString('base64'),
            //         },
            //     });

            //     const transcription = response.results?.[0]?.alternatives?.[0]?.transcript;
            //     if (!transcription) {
            //         console.log("No transcription found.");
            //         return;
            //     }

            //     console.log("Transcribed:", transcription);

            //     // Translate to Hindi
            //     const [translatedText] = await translateClient.translate(transcription, 'hi');
            //     console.log("Translated to Hindi:", translatedText);

            //     // Convert translated text to speech
            //     const [ttsResponse] = await ttsClient.synthesizeSpeech({
            //         input: { text: translatedText },
            //         voice: { languageCode: 'hi-IN', ssmlGender: 'FEMALE' },
            //         audioConfig: { audioEncoding: 'MP3' },
            //     });

            //     const translatedAudioBuffer = ttsResponse.audioContent;

            //     // Emit translated audio buffer back to client or room
            //     socket.to(room).emit("audio:translated", {
            //         from: socket.id,
            //         audioBuffer: translatedAudioBuffer,
            //     });

            //     // Optional: log room members
            //     const roomMembers = socketInstance.rooms.get(room);
            //     if (roomMembers) {
            //         console.log(`Room ${room} has members:`, Array.from(roomMembers));
            //     } else {
            //         console.log(`Room ${room} not found or empty`);
            //     }

            // } catch (err) {
            //     console.error("Error in translation pipeline:", err);
            // }
        });

        // Handle silence events
        socket.on("audio:silence", ({ room }) => {
            console.log(`Silence event from ${socket.id} in room ${room}`);
            socket.to(room).emit("audio:silence", { user: socket.id });
        });
    };
};

export default createSocketInit;