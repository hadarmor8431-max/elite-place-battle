# Elite Place Battle

A private 3D multiplayer battle royale. Three.js client, Node.js + WebSocket server. **Only people with your invite link can join** — perfect for sharing in a Discord channel.

## Controls

- **WASD** — move
- **Mouse** — look (click the screen first to capture the cursor)
- **Left click** — shoot
- **Space** — jump
- **Shift** — sprint
- **Esc** — release mouse

The blue circle is the safe zone. It shrinks every 30 seconds. Stay inside or take damage. Last player alive wins.

## How the invite link works

The server has a secret `ROOM_CODE`. The only way to load the game is to visit:

```
https://<your-server>/?key=<ROOM_CODE>
```

- Without the right key, the page shows "This match is private."
- The WebSocket connection is also gated — you can't bypass it with browser tricks.
- You set `ROOM_CODE` once when deploying. Share the full link in your Discord channel.

## Run locally

```bash
npm install
npm start
```

The server prints the local invite link in the console, e.g.:

```
Elite Place Battle listening on port 3000
Room code: a1b2c3d4e5f6
Local invite link: http://localhost:3000/?key=a1b2c3d4e5f6
```

If you don't set `ROOM_CODE`, a random one is generated on each start. To use a fixed code locally:

```bash
# PowerShell
$env:ROOM_CODE="my-secret"; npm start
# bash
ROOM_CODE=my-secret npm start
```

## Deploy so your Discord friends can join

The simplest free option is **Render**.

### Steps

1. **Push this folder to GitHub.**
   - Create a new empty repo on github.com (e.g. `elite-place-battle`).
   - In this folder, run:
     ```bash
     git init
     git add .
     git commit -m "init"
     git branch -M main
     git remote add origin <your-repo-url>
     git push -u origin main
     ```

2. **Create the Render service.**
   - Sign up at https://render.com (free).
   - **New +** → **Web Service** → connect your GitHub repo.
   - Settings:
     - **Environment**: `Node`
     - **Build command**: `npm install`
     - **Start command**: `npm start`
     - **Instance type**: `Free`

3. **Set your room code as an environment variable.**
   - In the service settings, **Environment** tab → **Add Environment Variable**.
   - Key: `ROOM_CODE`
   - Value: pick something hard to guess, e.g. `wolves-23-tactical-7x` or run `openssl rand -hex 8`.
   - Save. Render redeploys.

4. **Get your link.**
   - Render gives you a URL like `https://elite-place-battle.onrender.com`.
   - Your invite link is:
     ```
     https://elite-place-battle.onrender.com/?key=YOUR_ROOM_CODE
     ```

5. **Post it in your Discord channel.** That's it — anyone who clicks joins your match. Anyone who lands on the bare URL without the key is blocked.

### Rotating the code

If the link leaks, change `ROOM_CODE` in Render's Environment tab and post the new link in Discord. Old links stop working immediately after the redeploy.

### Notes about the free tier

- The free instance sleeps after 15 minutes of no traffic. The first visit after a nap takes ~30 seconds to wake up — tell your Discord friends "click and wait."
- Free instances have low RAM. Fine for a few players; don't expect dozens.

### Alternative: Railway

Same idea — push to GitHub, create a Railway project from the repo, set `ROOM_CODE` in **Variables**, share `https://<your-app>/?key=<code>`.

## How the multiplayer works

- The server keeps the authoritative state: HP, alive/dead, zone, hit detection.
- Clients send their position 20 times per second; the server broadcasts everyone's positions at 20 Hz.
- Shots are raycasts evaluated on the server against player capsules and obstacles. You can't lie about hitting someone.
- A round starts as soon as a player joins. When ≥2 players are alive, the last one standing wins; a new round starts 8 seconds later.

## Files

- `server.js` — game server + room-code gate (Express static + WebSocket)
- `public/index.html` — lobby + HUD
- `public/game.js` — Three.js client, input, networking
- `public/style.css` — UI styling

## Limits of this prototype

- No persistent accounts, no skins, no mobile support.
- No anti-cheat beyond server-side hit validation.
- Single global match per server — no separate rooms or matchmaking.
- Player movement is client-authoritative (position can be spoofed); only damage is server-authoritative.
- The room code is a shared secret — anyone you give it to can re-share it. If you need per-person invites, that's a bigger build.
