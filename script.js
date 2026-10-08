const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const TILE = 44.8;
const COLORS = ["#ed684c", "#52b5a8", "#f2c84b", "#8c75c9"];
let socket;
let state;
let myId;
const $ = id => document.getElementById(id);

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}`);
  socket.onopen = () => { $("connectionStatus").textContent = "CONNECTED"; $("statusDot").className = "status-dot online"; };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === "welcome") { myId = message.id; $("roomCode").textContent = message.room; }
    if (message.type === "state") { state = message; render(); }
    if (message.type === "feed") addFeed(message.text);
  };
  socket.onclose = () => { $("connectionStatus").textContent = "RECONNECTING"; $("statusDot").className = "status-dot offline"; setTimeout(connect, 1500); };
}
function send(type, data = {}) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, ...data })); }
function addFeed(text) { const item = document.createElement("div"); item.textContent = `› ${text}`; $("feed").prepend(item); while ($("feed").children.length > 5) $("feed").lastChild.remove(); }
function tile(x, y, fill) { ctx.fillStyle = fill; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.strokeRect(x * TILE + .5, y * TILE + .5, TILE - 1, TILE - 1); }
function drawWall(x, y) { const left = x * TILE, top = y * TILE; ctx.fillStyle = "#425b5f"; ctx.fillRect(left, top, TILE, TILE); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.strokeRect(left + 3, top + 3, TILE - 6, TILE - 6); ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(left + 8, top + 8, 4, 4); ctx.fillRect(left + TILE - 12, top + 8, 4, 4); ctx.fillRect(left + 8, top + TILE - 12, 4, 4); ctx.fillRect(left + TILE - 12, top + TILE - 12, 4, 4); }
function drawPlayer(player) { const cx = (player.x + .5) * TILE, cy = (player.y + .5) * TILE; ctx.globalAlpha = player.alive ? 1 : .25; ctx.fillStyle = COLORS[player.color]; ctx.beginPath(); ctx.arc(cx, cy, TILE * .31, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fff7df"; ctx.beginPath(); ctx.arc(cx - 6, cy - 4, 4, 0, Math.PI * 2); ctx.arc(cx + 6, cy - 4, 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
function render() {
  if (!state) return;
  ctx.fillStyle = "#20343a"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  state.grid.forEach((row, y) => row.forEach((cell, x) => { if (cell === 1) drawWall(x, y); else { tile(x, y, cell === 2 ? "#9d6b4c" : (x + y) % 2 ? "#274047" : "#2a454b"); if (cell === 2) { ctx.fillStyle = "#b97b56"; ctx.fillRect(x * TILE + 7, y * TILE + 7, TILE - 14, TILE - 14); } } }));
  (state.items || []).forEach(item => { ctx.fillStyle = item.type === "bomb" ? "#ed684c" : item.type === "blast" ? "#f2c84b" : "#52b5a8"; ctx.fillRect(item.x * TILE + 13, item.y * TILE + 13, TILE - 26, TILE - 26); });
  (state.bombs || []).forEach(bomb => { const cx = (bomb.x + .5) * TILE, cy = (bomb.y + .5) * TILE; ctx.fillStyle = "#18292d"; ctx.beginPath(); ctx.arc(cx, cy, TILE * .29, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#ed684c"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, TILE * .36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - bomb.remaining / 3000)); ctx.stroke(); ctx.lineWidth = 1; });
  state.players.forEach(drawPlayer); updateUI();
}
function updateUI() { const players = state.players; $("playerCount").textContent = `${players.length}/4`; $("playerList").innerHTML = players.map(p => `<div class="player-row ${p.alive ? "" : "dead"}"><i class="player-color" style="background:${COLORS[p.color]}"></i><span class="name">${p.name}${p.id === myId ? " (YOU)" : ""}</span><span class="state">${p.alive ? "READY" : "OUT"}</span></div>`).join(""); const me = players.find(p => p.id === myId); if (me) { $("bombs").textContent = me.bombCount; $("blast").textContent = me.blastRadius; $("speed").textContent = me.speed; } $("matchState").textContent = state.status; $("timer").textContent = new Date(state.timeRemaining).toISOString().slice(14, 19); if (state.status === "PLAYING") $("overlay").classList.add("hidden"); }
function ready() { $("readyButton").textContent = "READY ✓"; send("ready"); }
function key(event) { const keys = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" }; if (event.code === "Space") { event.preventDefault(); send("bomb"); return; } const direction = keys[event.key] || keys[event.key.toLowerCase()]; if (direction) { event.preventDefault(); send("move", { direction }); } }
function touchAction(event) { event.preventDefault(); const action = event.currentTarget.dataset.action; if (action === "bomb") send("bomb"); else send("move", { direction: action }); }
$("readyButton").onclick = ready;
document.addEventListener("keydown", key);
document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("pointerdown", touchAction));
connect();
