// Simple test script to verify Deepgram connection handling
const io = require("socket.io-client");

const socket = io("http://localhost:8080");

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);

  // Join a test room
  socket.emit("room:join", "test-room");
});

socket.on("room:joined", (data) => {
  console.log("Joined room:", data.room);

  // Start audio streaming
  socket.emit("audio:start", { room: "test-room" });

  // Simulate sending audio data after a short delay
  setTimeout(() => {
    console.log("Sending test audio buffer...");
    const testBuffer = Buffer.alloc(1024, 0); // Empty buffer for testing
    socket.emit("audio:send", {
      room: "test-room",
      audioBuffer: testBuffer,
    });
  }, 2000);

  // Stop audio after 10 seconds
  setTimeout(() => {
    console.log("Stopping audio stream...");
    socket.emit("audio:stop", { room: "test-room" });
    socket.disconnect();
  }, 10000);
});

socket.on("transcript:received", (data) => {
  console.log("Transcript received:", data);
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
  process.exit(0);
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error);
  process.exit(1);
});
