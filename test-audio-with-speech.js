// Enhanced test script to verify Deepgram transcript logging
const io = require("socket.io-client");

const socket = io("http://localhost:8080");

// Generate a simple sine wave audio buffer for testing
function generateTestAudio(frequency = 440, duration = 1, sampleRate = 16000) {
  const samples = duration * sampleRate;
  const buffer = Buffer.alloc(samples * 2); // 16-bit audio = 2 bytes per sample

  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.3;
    const intSample = Math.round(sample * 32767);
    buffer.writeInt16LE(intSample, i * 2);
  }

  return buffer;
}

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);

  // Join a test room
  socket.emit("room:join", "test-room");
});

socket.on("room:joined", (data) => {
  console.log("Joined room:", data.room);

  // Start audio streaming
  socket.emit("audio:start", { room: "test-room" });

  // Send multiple audio chunks to simulate real audio streaming
  let chunkCount = 0;
  const maxChunks = 10;

  const sendAudioChunk = () => {
    if (chunkCount < maxChunks) {
      console.log(`Sending audio chunk ${chunkCount + 1}/${maxChunks}...`);

      // Generate different frequency for each chunk to create variation
      const frequency = 440 + chunkCount * 50;
      const testBuffer = generateTestAudio(frequency, 0.5, 16000);

      socket.emit("audio:send", {
        room: "test-room",
        audioBuffer: testBuffer,
      });

      chunkCount++;
      setTimeout(sendAudioChunk, 500); // Send chunk every 500ms
    } else {
      // Stop audio after sending all chunks
      setTimeout(() => {
        console.log("Stopping audio stream...");
        socket.emit("audio:stop", { room: "test-room" });

        setTimeout(() => {
          socket.disconnect();
        }, 2000);
      }, 1000);
    }
  };

  // Start sending audio chunks after a short delay
  setTimeout(sendAudioChunk, 2000);
});

socket.on("transcript:received", (data) => {
  console.log("=== TRANSCRIPT RECEIVED ===");
  console.log("User:", data.user);
  console.log("Room:", data.room);
  console.log("Timestamp:", data.timestamp);
  console.log("Transcript Data:", data.transcript);

  if (data.transcript.channel && data.transcript.channel.alternatives) {
    const alternative = data.transcript.channel.alternatives[0];
    console.log("Text:", alternative.transcript);
    console.log("Confidence:", alternative.confidence);
    console.log("Is Final:", data.transcript.is_final);
  }
  console.log("========================");
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
  process.exit(0);
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error);
  process.exit(1);
});

// Handle process termination
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT, disconnecting...");
  socket.disconnect();
  process.exit(0);
});
