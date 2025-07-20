# UI Integration Guide for Live Audio Transcripts

## Server Status

✅ Server is running on `http://localhost:8080`
✅ Comprehensive transcript logging is enabled
✅ All test audio scripts are disabled

## How to Connect Your UI

### 1. Socket Connection

```javascript
const socket = io("http://localhost:8080");
```

### 2. Join a Room

```javascript
socket.emit("room:join", "your-room-id");
```

### 3. Start Audio Streaming

```javascript
// Initialize Deepgram connection
socket.emit("audio:start", { room: "your-room-id" });
```

### 4. Send Audio Data

```javascript
// Send audio buffer from microphone
socket.emit("audio:send", {
  room: "your-room-id",
  audioBuffer: audioBuffer,
});
```

### 5. Listen for Transcripts

```javascript
socket.on("transcript:received", (data) => {
  console.log("Transcript:", data.transcript);
  console.log("User:", data.user);
  console.log("Room:", data.room);
  console.log("Timestamp:", data.timestamp);

  // Extract the actual text
  if (data.transcript.channel && data.transcript.channel.alternatives) {
    const text = data.transcript.channel.alternatives[0].transcript;
    const confidence = data.transcript.channel.alternatives[0].confidence;
    const isFinal = data.transcript.is_final;

    console.log(
      `Text: "${text}" (confidence: ${confidence}, final: ${isFinal})`
    );
  }
});
```

### 6. Stop Audio Streaming

```javascript
// Clean up Deepgram connection
socket.emit("audio:stop", { room: "your-room-id" });
```

## Audio Format Requirements

- **Encoding**: linear16
- **Sample Rate**: 16000 Hz
- **Channels**: 1 (mono)
- **Format**: Raw PCM audio buffer

## What You'll See in Server Logs

When you send real audio from your UI, you'll see detailed logs like:

```
Setting up Deepgram for socket: [socketId]
deepgram: connected for socket [socketId]
[AUDIO SEND - socketId] Sending [bytes] bytes to Deepgram
deepgram: transcript received for socket [socketId]
[TRANSCRIPT - socketId] INTERIM: "Hello" (confidence: 0.8)
[TRANSCRIPT - socketId] FINAL: "Hello world" (confidence: 0.95)
[FORWARDING TRANSCRIPT - socketId]: "Hello world"
[SOCKET FORWARD - socketId] Sending FINAL transcript to room [room]: "Hello world"
```

## Testing Steps

1. ✅ Server is running on port 8080
2. 🔄 Connect your UI to the server
3. 🔄 Join a room using `room:join`
4. 🔄 Start audio with `audio:start`
5. 🔄 Send real microphone audio using `audio:send`
6. 🔄 Listen for `transcript:received` events
7. 🔄 Check server terminal for detailed transcript logs

## Expected Behavior

- **Empty/Silent Audio**: Will show empty transcripts `""` with confidence 0
- **Real Speech**: Will show actual transcribed text with confidence scores
- **Interim Results**: Will show partial transcripts as you speak
- **Final Results**: Will show complete transcripts when you finish speaking

Your server is ready to receive live audio data from your UI! 🎤✨
