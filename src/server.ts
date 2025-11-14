import { WebSocket, WebSocketServer } from "ws";

// Define the expected structure of messages
interface SignalingMessage {
  infohash: string;
  peerId: string;
  toPeerId?: string; // Target peer ID for unicast messages
  // Optional signaling payload fields
  offer?: unknown;
  answer?: unknown;
  candidate?: unknown;
}

const PORT = parseInt(process.env.PORT || "8080", 10);
const wss = new WebSocketServer({ port: PORT });

// State Maps:
// 1. Swarms: Key: infohash, Value: Set of connected WebSocket clients (for broadcast)
const swarms = new Map<string, Set<WebSocket>>();
// 2. PeerID to Socket: Key: peerId, Value: WebSocket client (for unicast lookup)
const peerIdToSocket = new Map<string, WebSocket>();
// 3. Socket to Swarm: Key: WebSocket client, Value: Set of infohashes (for cleanup)
const socketSwarmMap = new Map<WebSocket, Set<string>>();

console.log(`Signaling server running on port ${PORT}`);

wss.on("connection", (ws: WebSocket) => {
  socketSwarmMap.set(ws, new Set<string>());

  ws.on("message", (rawMessage: Buffer) => {
    let data: SignalingMessage;

    try {
      data = JSON.parse(rawMessage.toString()) as SignalingMessage;
    } catch (e) {
      console.error("Received non-JSON message or parsing error");
      return;
    }

    const { infohash, peerId, toPeerId } = data;

    // Validate required fields
    if (
      !infohash ||
      !peerId ||
      typeof infohash !== "string" ||
      typeof peerId !== "string"
    ) {
      return;
    }

    // Track/Update PeerID -> Socket mapping (needed for cleanup and unicast)
    peerIdToSocket.set(peerId, ws);

    // 1. Ensure the swarm group exists and add client to it
    if (!swarms.has(infohash)) {
      swarms.set(infohash, new Set<WebSocket>());
    }
    const swarm = swarms.get(infohash)!;
    swarm.add(ws);

    // 2. Track that this socket is part of this swarm (for disconnect cleanup)
    socketSwarmMap.get(ws)?.add(infohash);

    // 3. Routing Logic: Unicast vs. Broadcast

    if (toPeerId && peerIdToSocket.has(toPeerId)) {
      // UNICAST: Send message only to the targeted peer
      const targetSocket = peerIdToSocket.get(toPeerId)!;
      if (targetSocket.readyState === WebSocket.OPEN) {
        targetSocket.send(JSON.stringify(data));
        // console.log(`[UNICAST] ${peerId} -> ${toPeerId}`);
      }
    } else {
      // MULTICAST/BROADCAST: Send to all OTHERS in the same swarm
      // This is used for initial Offers intended for discovery
      swarm.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
          // console.log(`[BROADCAST] ${peerId} -> SWARM`);
        }
      });
    }
  });

  ws.on("close", () => {
    removeClient(ws);
  });

  ws.on("error", (err) => {
    console.error("Socket error:", err);
    removeClient(ws);
  });
});

/**
 * Removes a client from all tracking maps.
 */
function removeClient(ws: WebSocket): void {
  // 1. Cleanup Swarms
  const joinedInfohashes = socketSwarmMap.get(ws);
  if (joinedInfohashes) {
    joinedInfohashes.forEach((infohash) => {
      const swarm = swarms.get(infohash);
      if (swarm) {
        swarm.delete(ws);
        if (swarm.size === 0) {
          swarms.delete(infohash);
        }
      }
    });
  }
  socketSwarmMap.delete(ws);

  // 2. Cleanup PeerIDToSocket (Find and delete the peerId corresponding to this socket)
  let disconnectedPeerId: string | undefined;
  peerIdToSocket.forEach((socket, peerId) => {
    if (socket === ws) {
      disconnectedPeerId = peerId;
    }
  });

  if (disconnectedPeerId) {
    peerIdToSocket.delete(disconnectedPeerId);
    console.log(`Peer ${disconnectedPeerId.substring(0, 8)} disconnected.`);
  }
}
