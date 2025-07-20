// Test script to simulate transcript reception and verify logging
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

  console.log("=== TESTING TRANSCRIPT LOGGING ===");
  console.log("The server logs should show:");
  console.log("1. Audio connection setup");
  console.log("2. Audio data being sent to Deepgram");
  console.log("3. Transcript reception (even if empty due to test audio)");
  console.log("4. Detailed transcript metadata");
  console.log("=====================================");

  // Send a few audio chunks
  let chunkCount = 0;
  const maxChunks = 3;

  const sendAudioChunk = () => {
    if (chunkCount < maxChunks) {
      console.log(`Sending test audio chunk ${chunkCount + 1}/${maxChunks}...`);

      // Create a simple test buffer
      const testBuffer = Buffer.alloc(8000, 0); // Smaller buffer for quicker processing

      socket.emit("audio:send", {
        room: "test-room",
        audioBuffer: testBuffer,
      });

      chunkCount++;
      setTimeout(sendAudioChunk, 1000); // Send chunk every 1 second
    } else {
      // Stop audio after sending all chunks
      setTimeout(() => {
        console.log("Stopping audio stream...");
        socket.emit("audio:stop", { room: "test-room" });

        setTimeout(() => {
          console.log("=== TEST COMPLETE ===");
          console.log(
            "Check the server terminal for detailed transcript logs!"
          );
          socket.disconnect();
        }, 2000);
      }, 2000);
    }
  };

  // Start sending audio chunks after a short delay
  setTimeout(sendAudioChunk, 1000);
});

socket.on("transcript:received", (data) => {
  console.log("=== CLIENT RECEIVED TRANSCRIPT ===");
  console.log("User:", data.user);
  console.log("Room:", data.room);
  console.log("Timestamp:", data.timestamp);

  if (data.transcript.channel && data.transcript.channel.alternatives) {
    const alternative = data.transcript.channel.alternatives[0];
    console.log("Transcribed Text:", `"${alternative.transcript}"`);
    console.log("Confidence:", alternative.confidence);
    console.log("Is Final:", data.transcript.is_final);
  }
  console.log("=================================");
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
