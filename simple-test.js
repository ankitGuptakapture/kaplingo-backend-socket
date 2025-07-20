const io = require("socket.io-client");

console.log("🔗 Connecting to server...");
const socket = io("http://localhost:8080");

socket.on("connect", () => {
  console.log("✅ Connected! Socket ID:", socket.id);

  // Test room join
  socket.emit("room:join", "test-room");

  // Test audio start
  setTimeout(() => {
    console.log("🎤 Starting audio stream...");
    socket.emit("audio:start", { room: "test-room" });

    // Send a few audio chunks
    setTimeout(() => {
      const testBuffer = Buffer.alloc(1600, 0); // Small test buffer
      console.log("📡 Sending test audio chunk...");
      socket.emit("audio:send", { room: "test-room", audioBuffer: testBuffer });

      // Request stats
      setTimeout(() => {
        console.log("📊 Requesting Deepgram stats...");
        socket.emit("deepgram:stats");
      }, 1000);

      // Stop and disconnect
      setTimeout(() => {
        console.log("🛑 Stopping audio and disconnecting...");
        socket.emit("audio:stop", { room: "test-room" });
        socket.disconnect();
      }, 3000);
    }, 1000);
  }, 1000);
});

socket.on("room:joined", (data) => {
  console.log("🚪 Joined room:", data.room);
});

socket.on("transcript:received", (data) => {
  console.log("📝 Transcript received:", {
    optimized: data.optimized,
    transcript:
      data.transcript?.channel?.alternatives?.[0]?.transcript ||
      "No transcript",
    isFinal: data.transcript?.is_final,
  });
});

socket.on("deepgram:stats", (stats) => {
  console.log("📊 Deepgram Stats:", stats);
});

socket.on("connect_error", (error) => {
  console.error("❌ Connection error:", error.message);
});

socket.on("disconnect", () => {
  console.log("👋 Disconnected");
  process.exit(0);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log("⏰ Test timeout");
  process.exit(0);
}, 10000);
