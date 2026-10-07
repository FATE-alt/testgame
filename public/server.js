"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 6;
const INPUT_RATE = 12;
const BOARD_SIZE = 15;
const SPAWNS = [
  { x: 1, y: 1 }, { x: 13, y: 1 }, { x: 1, y: 13 },
  { x: 13, y: 13 }, { x: 5, y: 1 }, { x: 9, y: 13 },
];

const players = new Map();
const server = http.createServer(serveStatic);
const wss = new WebSocket.Server({ server });
let refereeId = null;
let gameState = createInitialState();
let nextPlayerNumber = 1;

function serveStatic(request, response) {
  const requested = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.resolve(__dirname, `.${requested}`);
  if (!filePath.startsWith(path.resolve(__dirname))) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    const type = filePath.endsWith(".js") ? "text/javascript" : "text/html";
    response.writeHead(200, { "Content-Type": type });
    response.end(content);
  });
}

function createInitialState() {
  const board = Array.from({ length: BOARD_SIZE }, (_, y) => Array.from({ length: BOARD_SIZE }, (_, x) => {
    if (x % 2 === 0 || y % 2 === 0) return "wall";
    return Math.random() < 0.75 ? "block" : "floor";
  }));
  SPAWNS.forEach(({ x, y }) => {
    for (let row = y - 1; row <= y + 1; row += 1) {
      for (let column = x - 1; column <= x + 1; column += 1) {
        if (board[row]?.[column] === "block") board[row][column] = "floor";
      }
    }
  });
  return { board, players: [], bombs: [], explosions: [], suddenDeath: null, tick: 0 };
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message) {
  const encoded = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(encoded);
  });
}

function currentPlayers() {
  return [...players.values()].map(player => ({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    alive: player.alive,
  }));
}

function assignReferee() {
  if (refereeId && players.has(refereeId)) return;
  const next = players.values().next().value;
  refereeId = next?.id || null;
  if (!next) return;
  next.isReferee = true;
  send(next.socket, { type: "referee-assigned", state: gameState });
  broadcast({ type: "referee-changed", refereeId });
}

function inputAllowed(player) {
  const now = Date.now();
  if (now - player.inputWindowStarted >= 1000) {
    player.inputWindowStarted = now;
    player.inputCount = 0;
  }
  if (player.inputCount >= INPUT_RATE) return false;
  player.inputCount += 1;
  return true;
}

function forwardInput(player, message) {
  if (!inputAllowed(player) || !refereeId) return;
  const referee = players.get(refereeId);
  if (!referee) return;
  send(referee.socket, {
    type: "player-input",
    playerId: player.id,
    input: message.type === "move"
      ? { type: "move", x: Number(message.x), y: Number(message.y), sequence: message.sequence }
      : { type: "bomb", x: Number(message.x), y: Number(message.y), requestId: message.requestId },
  });
}

function acceptRefereeState(player, message) {
  if (player.id !== refereeId || !message.state || typeof message.state !== "object") return;
  const nextState = message.state;
  gameState = {
    board: Array.isArray(nextState.board) ? nextState.board : gameState.board,
    players: Array.isArray(nextState.players) ? nextState.players : currentPlayers(),
    bombs: Array.isArray(nextState.bombs) ? nextState.bombs : [],
    explosions: Array.isArray(nextState.explosions) ? nextState.explosions : [],
    suddenDeath: nextState.suddenDeath ?? null,
    tick: Number.isFinite(nextState.tick) ? nextState.tick : gameState.tick + 1,
  };
  broadcast({ type: "authoritative-state", refereeId, state: gameState });
}

wss.on("connection", socket => {
  if (players.size >= MAX_PLAYERS) {
    send(socket, { type: "room-full", maxPlayers: MAX_PLAYERS });
    socket.close(1013, "Room is full");
    return;
  }

  const id = `p${nextPlayerNumber++}`;
  const spawn = SPAWNS[players.size];
  const player = {
    id,
    name: `PLAYER ${players.size + 1}`,
    x: spawn.x,
    y: spawn.y,
    alive: true,
    isReferee: !refereeId,
    socket,
    inputCount: 0,
    inputWindowStarted: Date.now(),
  };
  players.set(id, player);
  if (!refereeId) refereeId = id;

  send(socket, {
    type: "joined",
    player: { id, name: player.name, x: player.x, y: player.y },
    refereeId,
    isReferee: player.id === refereeId,
    maxPlayers: MAX_PLAYERS,
    state: gameState,
  });
  broadcast({ type: "player-list", players: currentPlayers(), refereeId });
  if (player.id === refereeId) send(socket, { type: "referee-assigned", state: gameState });

  socket.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message.type !== "string") return;

    if (message.type === "move" || message.type === "bomb") {
      forwardInput(player, message);
    } else if (message.type === "authoritative-state") {
      acceptRefereeState(player, message);
    } else if (message.type === "referee-event" && player.id === refereeId) {
      broadcast({ type: "referee-event", event: message.event });
    }
  });

  socket.on("close", () => {
    players.delete(id);
    if (id === refereeId) {
      refereeId = null;
      assignReferee();
    }
    broadcast({ type: "player-list", players: currentPlayers(), refereeId });
  });
});

server.listen(PORT, () => {
  console.log(`Single-referee relay listening on http://localhost:${PORT}`);
});
