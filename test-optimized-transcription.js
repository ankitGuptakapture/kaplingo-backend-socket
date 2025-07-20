const io = require("socket.io-client");

// Test configuration
const SERVER_URL = "http://localhost:8080";
const ROOM_ID = "test-room-optimized";
const TEST_DURATION = 30000; // 30 seconds

class TranscriptionPerformanceTest {
  constructor() {
    this.socket = null;
    this.startTime = null;
    this.transcriptCount = 0;
    this.totalLatency = 0;
    this.audioChunksSent = 0;
    this.isOptimized = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(SERVER_URL);

      this.socket.on("connect", () => {
        console.log("✅ Connected to server");
        console.log(`📡 Socket ID: ${this.socket.id}`);
        resolve();
      });

      this.socket.on("connect_error", (error) => {
        console.error("❌ Connection failed:", error);
        reject(error);
      });

      this.socket.on("disconnect", () => {
        console.log("🔌 Disconnected from server");
      });
    });
  }

  setupEventListeners() {
    // Room events
    this.socket.on("room:assigned", (data) => {
      console.log(`🏠 Room assigned: ${data.room}`);
    });

    this.socket.on("room:joined", (data) => {
      console.log(`🚪 Joined room: ${data.room}`);
    });

    // Transcript events with performance monitoring
    this.socket.on("transcript:received", (data) => {
      this.transcriptCount++;
      const latency = Date.now() - data.timestamp;
      this.totalLatency += latency;

      if (data.optimized) {
        this.isOptimized = true;
      }

      const transcript =
        data.transcript?.channel?.alternatives?.[0]?.transcript || "";
      const isFinal = data.transcript?.is_final || false;
      const avgLatency = this.totalLatency / this.transcriptCount;

      console.log(
        `📝 ${isFinal ? "FINAL" : "INTERIM"} [${
          this.transcriptCount
        }]: "${transcript}"`
      );
      console.log(
        `⚡ Latency: ${latency}ms | Avg: ${avgLatency.toFixed(2)}ms | ${
          data.optimized ? "OPTIMIZED" : "STANDARD"
        }`
      );
    });

    // Stats monitoring
    this.socket.on("deepgram:stats", (stats) => {
      console.log("📊 Deepgram Pool Stats:", stats);
    });
  }

  generateTestAudio() {
    // Generate simulated audio data (16kHz, 16-bit, mono)
    const sampleRate = 16000;
    const duration = 0.1; // 100ms chunks
    const samples = Math.floor(sampleRate * duration);
    const buffer = Buffer.alloc(samples * 2); // 16-bit = 2 bytes per sample

    // Generate sine wave for testing
    for (let i = 0; i < samples; i++) {
      const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.3; // 440Hz tone
      const intSample = Math.floor(sample * 32767);
      buffer.writeInt16LE(intSample, i * 2);
    }

    return buffer;
  }

  async startTest() {
    console.log("\n🚀 Starting Optimized Transcription Performance Test");
    console.log("=".repeat(60));

    this.startTime = Date.now();

    // Join room
    this.socket.emit("room:join", ROOM_ID);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Start audio streaming
    console.log("🎤 Starting audio stream...");
    this.socket.emit("audio:start", { room: ROOM_ID });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send audio chunks
    const audioInterval = setInterval(() => {
      const audioBuffer = this.generateTestAudio();
      this.socket.emit("audio:send", {
        room: ROOM_ID,
        audioBuffer: audioBuffer,
      });
      this.audioChunksSent++;

      if (this.audioChunksSent % 50 === 0) {
        console.log(`📊 Audio chunks sent: ${this.audioChunksSent}`);
        // Request stats every 50 chunks
        this.socket.emit("deepgram:stats");
      }
    }, 100); // Send every 100ms

    // Stop test after duration
    setTimeout(() => {
      clearInterval(audioInterval);
      this.stopTest();
    }, TEST_DURATION);
  }

  stopTest() {
    console.log("\n🛑 Stopping test...");

    // Stop audio streaming
    this.socket.emit("audio:stop", { room: ROOM_ID });

    // Wait a bit for final transcripts
    setTimeout(() => {
      this.showResults();
      this.socket.disconnect();
    }, 2000);
  }

  showResults() {
    const testDuration = Date.now() - this.startTime;
    const avgLatency =
      this.transcriptCount > 0 ? this.totalLatency / this.transcriptCount : 0;
    const transcriptsPerSecond = (this.transcriptCount / testDuration) * 1000;
    const audioChunksPerSecond = (this.audioChunksSent / testDuration) * 1000;

    console.log("\n📈 PERFORMANCE RESULTS");
    console.log("=".repeat(60));
    console.log(`🕐 Test Duration: ${(testDuration / 1000).toFixed(2)}s`);
    console.log(`🎵 Audio Chunks Sent: ${this.audioChunksSent}`);
    console.log(`📝 Transcripts Received: ${this.transcriptCount}`);
    console.log(`⚡ Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`📊 Transcripts/sec: ${transcriptsPerSecond.toFixed(2)}`);
    console.log(`🎤 Audio Chunks/sec: ${audioChunksPerSecond.toFixed(2)}`);
    console.log(`🚀 Mode: ${this.isOptimized ? "OPTIMIZED" : "STANDARD"}`);

    // Performance rating
    let rating = "⭐";
    if (avgLatency < 100) rating = "⭐⭐⭐⭐⭐ EXCELLENT";
    else if (avgLatency < 200) rating = "⭐⭐⭐⭐ VERY GOOD";
    else if (avgLatency < 300) rating = "⭐⭐⭐ GOOD";
    else if (avgLatency < 500) rating = "⭐⭐ FAIR";
    else rating = "⭐ NEEDS IMPROVEMENT";

    console.log(`🏆 Performance Rating: ${rating}`);
    console.log("=".repeat(60));
  }
}

// Run the test
async function runTest() {
  const test = new TranscriptionPerformanceTest();

  try {
    await test.connect();
    test.setupEventListeners();
    await test.startTest();
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Test interrupted by user");
  process.exit(0);
});

console.log("🧪 Transcription Performance Test");
console.log("📋 This test will:");
console.log("   • Connect to the server");
console.log("   • Send simulated audio data");
console.log("   • Measure transcription latency");
console.log("   • Show performance statistics");
console.log("\n⚠️  Make sure your server is running with: npm run dev");
console.log(
  "🔧 To test optimized mode, ensure USE_OPTIMIZED_TRANSCRIPTION=true in .env"
);

runTest();
