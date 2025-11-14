import { WebSocket, WebSocketServer } from 'ws';

// Define the expected structure of messages
interface SignalingMessage {
  infohash: string;
  peerId: string;
  offer?: unknown;     // RTCSessionDescriptionInit
  answer?: unknown;    // RTCSessionDescriptionInit
  candidate?: unknown; // RTCIceCandidateInit
}

const PORT = parseInt(process.env.PORT || '8080', 10);

const wss = new WebSocketServer({ port: PORT });

// Map to track which clients are subscribed to which infohash
// Key: infohash, Value: Set of connected WebSocket clients
const swarms = new Map<string, Set<WebSocket>>();

// Map to track which infohashes a specific socket has joined (for cleanup)
// Key: WebSocket client, Value: Set of infohashes joined by that client
const socketSwarmMap = new Map<WebSocket, Set<string>>();

console.log(`Signaling server running on port ${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  // Initialize tracking for this socket
  socketSwarmMap.set(ws, new Set<string>());

  ws.on('message', (rawMessage: Buffer) => {
    let data: SignalingMessage;

    try {
      data = JSON.parse(rawMessage.toString()) as SignalingMessage;
    } catch (e) {
      console.error('Received non-JSON message or parsing error');
      return;
    }

    // Destructure for validation
    const { infohash, peerId } = data;

    // Validate required fields; silently ignore invalid messages (security)
    if (!infohash || !peerId || typeof infohash !== 'string') {
      return;
    }

    // 1. Ensure the swarm group exists
    if (!swarms.has(infohash)) {
      swarms.set(infohash, new Set<WebSocket>());
    }

    // 2. Add client to the swarm
    // The ! assertion is safe here because we just set it above if missing
    const swarm = swarms.get(infohash)!;
    swarm.add(ws);

    // 3. Track that this socket is part of this swarm
    const clientSwarms = socketSwarmMap.get(ws);
    if (clientSwarms) {
      clientSwarms.add(infohash);
    }

    // 4. Broadcast to OTHERS in the same swarm
    swarm.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  ws.on('close', () => {
    removeClient(ws);
  });

  ws.on('error', (err) => {
    console.error('Socket error:', err);
    removeClient(ws);
  });
});

/**
 * Removes a client from all swarms and cleans up empty maps.
 */
function removeClient(ws: WebSocket): void {
  const joinedInfohashes = socketSwarmMap.get(ws);

  if (joinedInfohashes) {
    joinedInfohashes.forEach((infohash) => {
      const swarm = swarms.get(infohash);
      if (swarm) {
        swarm.delete(ws);
        // Memory optimization: delete the swarm if empty
        if (swarm.size === 0) {
          swarms.delete(infohash);
        }
      }
    });
  }

  // Remove the client tracking entry
  socketSwarmMap.delete(ws);
}