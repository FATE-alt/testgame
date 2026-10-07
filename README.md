# FUSE // Multiplayer Bomberman

An HTML5 Canvas Bomberman arena with an authoritative Node.js WebSocket referee.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in up to four browser tabs. A match starts when at least two players press **JOIN THE FIGHT**.

## Controls

- `WASD` or arrow keys: move
- `Space`: drop a bomb

The server owns the checkerboard, collisions, three-second bombs, cross-shaped blasts, block destruction, random pickups, eliminations, and state broadcasts.
