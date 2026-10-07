"use strict";

// Tuneable game rules.
const DEFAULT_SPEED = 4.5;
const BOMB_TIMER = 3000;
const INITIAL_BLAST_RADIUS = 2;
const ITEM_DROP_RATE = 0.30;

const GAME_DURATION = 2 * 60 * 1000;
const SUDDEN_DEATH_AT = 60 * 1000;
const SUDDEN_DEATH_STEP = 180;
const ITEM_TYPES = ["bomb", "blast", "speed"];

function createGame(board, players = []) {
  const game = {
    board,
    players,
    bombs: [],
    items: [],
    explosions: [],
    elapsed: 0,
    lastNow: null,
    nextWallDropAt: null,
    suddenDeathIndex: 0,
    suddenDeathOrder: createClockwiseCollapseOrder(board.length, board[0].length),
    status: "playing",
  };
  players.forEach(player => {
    player.speed ??= DEFAULT_SPEED;
    player.bombCount ??= 1;
    player.blastRadius ??= INITIAL_BLAST_RADIUS;
    player.activeBombs ??= 0;
    player.alive ??= true;
  });
  return game;
}

function createClockwiseCollapseOrder(height, width) {
  const order = [];
  const rings = Math.ceil(Math.min(width, height) / 2);
  for (let ring = 0; ring < rings; ring += 1) {
    const left = ring;
    const right = width - 1 - ring;
    const top = ring;
    const bottom = height - 1 - ring;
    if (left > right || top > bottom) break;

    for (let x = left; x <= right; x += 1) order.push({ x, y: top });
    for (let y = top + 1; y <= bottom; y += 1) order.push({ x: right, y });
    if (bottom > top) {
      for (let x = right - 1; x >= left; x -= 1) order.push({ x, y: bottom });
    }
    if (right > left) {
      for (let y = bottom - 1; y > top; y -= 1) order.push({ x: left, y });
    }
  }
  return order;
}

function stepGame(game, now = Date.now()) {
  if (game.status !== "playing") return [];
  if (game.lastNow === null) game.lastNow = now;
  const delta = Math.max(0, now - game.lastNow);
  game.lastNow = now;
  game.elapsed = Math.min(GAME_DURATION, game.elapsed + delta);
  const events = [];

  for (const bomb of [...game.bombs]) {
    if (now - bomb.placedAt >= BOMB_TIMER) events.push(...explodeBomb(game, bomb, now));
  }

  if (game.elapsed >= SUDDEN_DEATH_AT && game.nextWallDropAt === null) {
    game.nextWallDropAt = now;
    events.push({ type: "sudden-death-start", elapsed: game.elapsed });
  }
  while (game.nextWallDropAt !== null && now >= game.nextWallDropAt) {
    const event = dropNextSuddenDeathWall(game);
    if (event) events.push(...event);
    game.nextWallDropAt += SUDDEN_DEATH_STEP;
  }

  game.explosions = game.explosions.filter(explosion => now - explosion.createdAt < 250);
  if (game.elapsed >= GAME_DURATION) {
    game.status = "finished";
    events.push({ type: "time-up" });
  }
  return events;
}

function placeBomb(game, player, x = player.x, y = player.y, now = Date.now()) {
  if (game.status !== "playing" || !player.alive) return null;
  if (player.activeBombs >= player.bombCount || game.bombs.some(bomb => bomb.x === x && bomb.y === y)) return null;
  const bomb = { x, y, ownerId: player.id, radius: player.blastRadius, placedAt: now };
  game.bombs.push(bomb);
  player.activeBombs += 1;
  return bomb;
}

function explodeBomb(game, bomb, now) {
  const index = game.bombs.indexOf(bomb);
  if (index === -1) return [];
  game.bombs.splice(index, 1);
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    for (let distance = 1; distance <= bomb.radius; distance += 1) {
      const cell = { x: bomb.x + dx * distance, y: bomb.y + dy * distance };
      if (!isInside(game.board, cell.x, cell.y)) break;
      const tile = game.board[cell.y][cell.x];
      if (tile === "wall") break;
      cells.push(cell);
      if (tile === "block") {
        game.board[cell.y][cell.x] = "floor";
        if (Math.random() < ITEM_DROP_RATE) {
          game.items.push({ x: cell.x, y: cell.y, type: ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)] });
        }
        break;
      }
    }
  }
  const events = [{ type: "explosion", cells, createdAt: now }];
  game.explosions.push(events[0]);
  for (const player of game.players) {
    if (player.alive && cells.some(cell => cell.x === player.x && cell.y === player.y)) {
      player.alive = false;
      events.push({ type: "eliminated", playerId: player.id, cause: "bomb" });
    }
  }
  const owner = game.players.find(player => player.id === bomb.ownerId);
  if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);
  for (const chained of game.bombs.filter(other => cells.some(cell => cell.x === other.x && cell.y === other.y))) {
    events.push(...explodeBomb(game, chained, now));
  }
  return events;
}

function dropNextSuddenDeathWall(game) {
  while (game.suddenDeathIndex < game.suddenDeathOrder.length) {
    const cell = game.suddenDeathOrder[game.suddenDeathIndex++];
    if (!isInside(game.board, cell.x, cell.y) || game.board[cell.y][cell.x] === "wall") continue;
    game.board[cell.y][cell.x] = "wall";
    const events = [{ type: "wall-collapse", x: cell.x, y: cell.y }];
    for (const player of game.players) {
      if (player.alive && player.x === cell.x && player.y === cell.y) {
        player.alive = false;
        events.push({ type: "eliminated", playerId: player.id, cause: "sudden-death" });
      }
    }
    return events;
  }
  return null;
}

function isInside(board, x, y) {
  return y >= 0 && y < board.length && x >= 0 && x < board[y].length;
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_SPEED,
    BOMB_TIMER,
    INITIAL_BLAST_RADIUS,
    ITEM_DROP_RATE,
    GAME_DURATION,
    SUDDEN_DEATH_AT,
    createGame,
    createClockwiseCollapseOrder,
    stepGame,
    placeBomb,
    explodeBomb,
  };
}
