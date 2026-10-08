const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const SIZE = 15;
const SPAWN = [{ x: 1, y: 1 }, { x: 13, y: 1 }, { x: 1, y: 13 }, { x: 13, y: 13 }];
const server = http.createServer((request, response) => {
  const file = request.url === "/" ? "index.html" : request.url.slice(1);
  const safe = path.join(__dirname, file);
  if (!safe.startsWith(__dirname)) return response.writeHead(403).end();
  fs.readFile(safe, (error, data) => {
    if (error) return response.writeHead(404).end();
    const type = safe.endsWith(".js") ? "text/javascript" : safe.endsWith(".css") ? "text/css" : "text/html";
    response.writeHead(200, { "Content-Type": type });
    response.end(data);
  });
});
const wss = new WebSocket.Server({ server });
const players = new Map();
let grid;
let bombs = [];
let items = [];
let status = "WAITING FOR PLAYERS";
let startedAt = 0;

function createGrid() {
  grid = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (
    x % 2 === 0 || y % 2 === 0 ? 1 : Math.random() < 0.78 ? 2 : 0
  )));
  SPAWN.forEach(({ x, y }) => {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (x + dx > 0 && x + dx < SIZE - 1 && y + dy > 0 && y + dy < SIZE - 1) grid[y + dy][x + dx] = 0;
    }
  });
}

function broadcast(message) {
  const text = JSON.stringify(message);
  wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(text); });
}

function feed(text) { broadcast({ type: "feed", text }); }

function snapshot() {
  return {
    type: "state",
    grid,
    players: [...players.values()].map(({ id, name, color, x, y, alive, bombCount, blastRadius, speed }) => ({ id, name, color, x, y, alive, bombCount, blastRadius, speed })),
    bombs: bombs.map(bomb => ({ x: bomb.x, y: bomb.y, remaining: Math.max(0, bomb.expires - Date.now()) })),
    items,
    status,
    timeRemaining: status === "PLAYING" ? Math.max(0, 180000 - (Date.now() - startedAt)) : 180000,
  };
}

function startMatch() {
  if (status === "PLAYING" || players.size < 2) return;
  createGrid();
  bombs = [];
  items = [];
  [...players.values()].forEach((player, index) => Object.assign(player, { ...SPAWN[index], alive: true, bombCount: 1, activeBombs: 0, blastRadius: 2, speed: 1 }));
  status = "PLAYING";
  startedAt = Date.now();
  feed("Match started. Make it count.");
}

function occupied(x, y, except) {
  return [...players.values()].some(player => player.id !== except && player.alive && player.x === x && player.y === y)
    || bombs.some(bomb => bomb.x === x && bomb.y === y);
}

function move(player, direction) {
  if (status !== "PLAYING" || !player.alive) return;
  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
  if (!delta) return;
  const x = player.x + delta[0];
  const y = player.y + delta[1];
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE || grid[y][x] || occupied(x, y, player.id)) return;
  player.x = x;
  player.y = y;
  const itemIndex = items.findIndex(item => item.x === x && item.y === y);
  if (itemIndex >= 0) {
    const item = items.splice(itemIndex, 1)[0];
    if (item.type === "bomb") player.bombCount += 1;
    if (item.type === "blast") player.blastRadius += 1;
    if (item.type === "speed") player.speed += 1;
    feed(`${player.name} found ${item.type.toUpperCase()} +`);
  }
}

function dropBomb(player) {
  if (status !== "PLAYING" || !player.alive || player.activeBombs >= player.bombCount || bombs.some(bomb => bomb.x === player.x && bomb.y === player.y)) return;
  player.activeBombs += 1;
  bombs.push({ x: player.x, y: player.y, owner: player.id, radius: player.blastRadius, expires: Date.now() + 3000 });
}

function explode(bomb) {
  bombs = bombs.filter(current => current !== bomb);
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let distance = 1; distance <= bomb.radius; distance += 1) {
      const x = bomb.x + dx * distance;
      const y = bomb.y + dy * distance;
      if (x < 0 || x >= SIZE || y < 0 || y >= SIZE || grid[y][x] === 2) break;
      cells.push({ x, y });
      if (grid[y][x] === 1) {
        grid[y][x] = 0;
        if (Math.random() < 0.32) items.push({ x, y, type: ["bomb", "blast", "speed"][Math.floor(Math.random() * 3)] });
        break;
      }
    }
  }
  cells.forEach(cell => {
    const victim = [...players.values()].find(player => player.alive && player.x === cell.x && player.y === cell.y);
    if (victim) { victim.alive = false; feed(`${victim.name} was blown up`); }
    const chained = bombs.find(current => current.x === cell.x && current.y === cell.y);
    if (chained) chained.expires = Date.now();
  });
  const owner = players.get(bomb.owner);
  if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);
}

wss.on("connection", socket => {
  if (players.size >= 4) return socket.close(1013, "Arena full");
  const id = Math.random().toString(36).slice(2, 8);
  const slot = players.size;
  const player = { id, name: `PLAYER ${slot + 1}`, color: slot, ...SPAWN[slot], alive: true, bombCount: 1, activeBombs: 0, blastRadius: 2, speed: 1 };
  players.set(id, player);
  socket.send(JSON.stringify({ type: "welcome", id, room: "FUSE-01" }));
  feed(`${player.name} entered the arena`);
  socket.on("message", raw => {
    try {
      const message = JSON.parse(raw);
      if (message.type === "ready") startMatch();
      if (message.type === "move") move(player, message.direction);
      if (message.type === "bomb") dropBomb(player);
    } catch {}
  });
  socket.on("close", () => {
    players.delete(id);
    feed(`${player.name} left the arena`);
    if (players.size < 2 && status === "PLAYING") status = "WAITING FOR PLAYERS";
  });
});

setInterval(() => {
  bombs.filter(bomb => bomb.expires <= Date.now()).forEach(explode);
  if (status === "PLAYING") {
    const alive = [...players.values()].filter(player => player.alive);
    if (alive.length <= 1 && players.size >= 2) status = alive.length ? `${alive[0].name} WINS` : "EVERYONE OUT";
    else if (Date.now() - startedAt >= 180000) status = "TIME UP";
  }
  broadcast(snapshot());
}, 100);

server.listen(PORT, "0.0.0.0", () => console.log(`FUSE arena listening on http://localhost:${PORT}`));
