// Simple client to connect and listen for transcripts from live audio
const io = require("socket.io-client");

const socket = io("http://localhost:8080");

socket.on("connect", () => {
  console.log("🎤 Connected to server:", socket.id);
  console.log("📡 Ready to receive live audio transcripts!");
  console.log("💡 Use your frontend application to send real audio data");
  console.log("=".repeat(50));

  // Join a test room
  socket.emit("room:join", "live-audio-room");
});

socket.on("room:joined", (data) => {
  console.log("🏠 Joined room:", data.room);
  console.log("🎧 Listening for live audio transcripts...");
  console.log("📝 Server logs will show detailed transcript processing");
  console.log("=".repeat(50));
});

socket.on("transcript:received", (data) => {
  console.log("\n🎯 === LIVE TRANSCRIPT RECEIVED ===");
  console.log("👤 User:", data.user);
  console.log("🏠 Room:", data.room);
  console.log("⏰ Timestamp:", data.timestamp);

  if (data.transcript.channel && data.transcript.channel.alternatives) {
    const alternative = data.transcript.channel.alternatives[0];
    const transcript = alternative.transcript;
    const confidence = alternative.confidence;
    const isFinal = data.transcript.is_final;

    console.log(`📝 Text: "${transcript}"`);
    console.log(`📊 Confidence: ${confidence}`);
    console.log(`✅ Final: ${isFinal}`);

    if (isFinal && transcript.trim().length > 0) {
      console.log("🎉 FINAL TRANSCRIPT:", `"${transcript}"`);
    }
  }
  console.log("=".repeat(40));
});

socket.on("audio:stream", (data) => {
  console.log(
    `🔊 Audio received from user ${data.user} (${data.audioBuffer.length} bytes)`
  );
});

socket.on("user:joined", (data) => {
  console.log(`👋 User ${data.user} joined the room`);
});

socket.on("user:left", (data) => {
  console.log(`👋 User ${data.user} left the room`);
});

socket.on("disconnect", () => {
  console.log("❌ Disconnected from server");
});

socket.on("connect_error", (error) => {
  console.error("🚨 Connection error:", error);
});

// Keep the client running
console.log("🚀 Starting live audio transcript listener...");
console.log("📱 Connect your frontend app to room: 'live-audio-room'");
console.log("🎤 Start speaking and watch the transcripts appear!");
console.log("🛑 Press Ctrl+C to stop");

// Handle process termination
process.on("SIGINT", () => {
  console.log("\n🛑 Stopping live audio client...");
  socket.disconnect();
  process.exit(0);
});

// Keep process alive
setInterval(() => {
  // Just keep the process running
}, 1000);
