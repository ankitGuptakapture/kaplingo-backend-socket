import {
  createClient,
  LiveTranscriptionEvents,
  LiveClient,
} from "@deepgram/sdk";

let deepgramClient: any = null;

const getDeepgramClient = () => {
  if (!deepgramClient) {
    if (!process.env.DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY environment variable is required");
    }
    deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
  }
  return deepgramClient;
};

export interface OptimizedDeepgramConnection {
  connection: LiveClient;
  keepAlive: NodeJS.Timeout;
  isConnected: boolean;
  lastActivity: number;
  socketId: string;
}

// Connection pool for reusing connections
class DeepgramConnectionPool {
  private pool: Map<string, OptimizedDeepgramConnection> = new Map();
  private maxPoolSize = 10;
  private connectionTimeout = 30000; // 30 seconds

  getConnection(
    socketId: string,
    onTranscript?: (data: any) => void
  ): OptimizedDeepgramConnection {
    // Try to reuse existing connection if available
    const existingConnection = this.pool.get(socketId);
    if (existingConnection && existingConnection.isConnected) {
      existingConnection.lastActivity = Date.now();
      return existingConnection;
    }

    // Create new optimized connection
    return this.createOptimizedConnection(socketId, onTranscript);
  }

  private createOptimizedConnection(
    socketId: string,
    onTranscript?: (data: any) => void
  ): OptimizedDeepgramConnection {
    console.log(
      `Creating optimized Deepgram connection for socket: ${socketId}`
    );

    // Optimized configuration for speed (conservative approach)
    const deepgram = getDeepgramClient().listen.live({
      // Use proven model
      model: "nova-2", // Stick with working model
      language: "en-us",

      // Keep essential features, optimize others
      smart_format: true, // Keep for compatibility
      punctuate: true, // Keep for compatibility
      interim_results: true,

      // Moderate latency optimization
      endpointing: 200, // Moderate reduction from 300ms
      vad_events: true, // Keep for better audio detection

      // Audio format optimizations
      encoding: "linear16",
      sample_rate: 16000,
      channels: 1,

      // Conservative optimizations
      alternatives: 1, // Reduce alternatives for speed
    });

    // Optimized keepalive with shorter interval
    const keepAlive = setInterval(() => {
      if (deepgram.getReadyState() === 1) {
        deepgram.keepAlive();
      }
    }, 5000); // Reduced from 8000ms

    const connectionObj: OptimizedDeepgramConnection = {
      connection: deepgram,
      keepAlive,
      isConnected: false,
      lastActivity: Date.now(),
      socketId,
    };

    // Event listeners with optimizations
    deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
      console.log(`Optimized Deepgram connected for socket ${socketId}`);
      connectionObj.isConnected = true;
      connectionObj.lastActivity = Date.now();
    });

    deepgram.addListener(LiveTranscriptionEvents.Transcript, (data: any) => {
      connectionObj.lastActivity = Date.now();

      // Fast transcript processing
      if (data.channel?.alternatives?.[0]) {
        const transcript = data.channel.alternatives[0].transcript;
        const isFinal = data.is_final;

        // Only process non-empty transcripts
        if (transcript.trim().length > 0) {
          // Immediate forwarding for speed
          if (onTranscript) {
            onTranscript(data);
          }
        }
      }
    });

    deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
      console.log(`Optimized Deepgram disconnected for socket ${socketId}`);
      connectionObj.isConnected = false;
      this.removeConnection(socketId);
    });

    deepgram.addListener(LiveTranscriptionEvents.Error, async (error: any) => {
      console.error(`Optimized Deepgram error for socket ${socketId}:`, error);
      connectionObj.isConnected = false;
      this.removeConnection(socketId);
    });

    // Add to pool
    this.pool.set(socketId, connectionObj);

    // Clean up old connections
    this.cleanupOldConnections();

    return connectionObj;
  }

  private cleanupOldConnections() {
    const now = Date.now();
    for (const [socketId, connection] of this.pool.entries()) {
      if (now - connection.lastActivity > this.connectionTimeout) {
        this.removeConnection(socketId);
      }
    }
  }

  removeConnection(socketId: string) {
    const connection = this.pool.get(socketId);
    if (connection) {
      if (connection.keepAlive) {
        clearInterval(connection.keepAlive);
      }
      if (
        connection.connection &&
        connection.connection.getReadyState() === 1
      ) {
        connection.connection.finish();
      }
      this.pool.delete(socketId);
      console.log(`Removed connection for socket ${socketId} from pool`);
    }
  }

  getPoolStats() {
    return {
      activeConnections: this.pool.size,
      connections: Array.from(this.pool.entries()).map(([socketId, conn]) => ({
        socketId,
        isConnected: conn.isConnected,
        lastActivity: new Date(conn.lastActivity).toISOString(),
      })),
    };
  }
}

// Audio buffer optimization
export class AudioBufferOptimizer {
  private bufferQueue: Buffer[] = [];
  private readonly optimalChunkSize = 4096; // Optimal chunk size for Deepgram
  private readonly maxQueueSize = 10;

  optimizeBuffer(audioBuffer: Buffer): Buffer[] {
    // Add to queue
    this.bufferQueue.push(audioBuffer);

    // Keep queue size manageable
    if (this.bufferQueue.length > this.maxQueueSize) {
      this.bufferQueue.shift();
    }

    // Combine small buffers for efficiency
    const totalSize = this.bufferQueue.reduce(
      (sum, buf) => sum + buf.length,
      0
    );

    if (totalSize >= this.optimalChunkSize) {
      const combinedBuffer = Buffer.concat(this.bufferQueue);
      this.bufferQueue = [];

      // Split into optimal chunks
      const chunks: Buffer[] = [];
      for (let i = 0; i < combinedBuffer.length; i += this.optimalChunkSize) {
        chunks.push(combinedBuffer.slice(i, i + this.optimalChunkSize));
      }

      return chunks;
    }

    return [];
  }

  flush(): Buffer[] {
    if (this.bufferQueue.length > 0) {
      const combinedBuffer = Buffer.concat(this.bufferQueue);
      this.bufferQueue = [];
      return [combinedBuffer];
    }
    return [];
  }
}

// Singleton instances
export const connectionPool = new DeepgramConnectionPool();

export const setupOptimizedDeepgram = (
  socketId: string,
  onTranscript?: (data: any) => void
): OptimizedDeepgramConnection => {
  return connectionPool.getConnection(socketId, onTranscript);
};

export const cleanupOptimizedDeepgram = (socketId: string) => {
  connectionPool.removeConnection(socketId);
};

export const getDeepgramStats = () => {
  return connectionPool.getPoolStats();
};
