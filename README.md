# 🎵 YouTube Music REST API Server
<p align="center">
  <strong>A high-performance, developer-friendly REST API for YouTube Music built with native Node.js.</strong><br>
  Reverse-engineered using Google's internal YouTubei (Innertube) protocol with an integrated HTTP 206 Partial Content audio streaming proxy.
</p>

<p align="center">
  <a href="https://github.com/Argha2004/YT-Music-API/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-red.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg" alt="Node.js Version"></a>
  <a href="https://github.com/Argha2004/YT-Music-API"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://github.com/Argha2004/YT-Music-API"><img src="https://img.shields.io/badge/API-REST%20JSON-blue.svg" alt="REST API"></a>
  <a href="https://github.com/Argha2004/YT-Music-API"><img src="https://img.shields.io/badge/Streaming-HTTP%20206%20Range-orange.svg" alt="Streaming Support"></a>
</p>

---

## 🌟 Highlights

- **⚡ Zero Quota Restrictions**: Bypasses the official YouTube Data API v3 quota limits (no 10,000 units/day ceiling, no API key required).
- **🎧 Byte-Range Audio Streaming (`HTTP 206`)**: Native proxy supporting seekable audio ranges directly consumable by HTML5 `<audio>`, VLC, Flutter, React Native, and Discord bots.
- **🛡️ Google CDN 403 Bypassed**: Employs an Android client Innertube signature extraction pipeline with process fallback to prevent GoogleVideo CDN bot-blocking errors.
- **📻 Algorithmic Radio & Queues**: Automatically generates contextual radio queues from any seed video ID.
- **📚 Built-In Web Suite**:
  - **Interactive Playground (`/`)**: Instant test runner with formatted JSON viewer and one-click JSON copy.
  - **Full Documentation (`/docs`)**: Interactive docs with parameter schemas, code snippets (cURL, JS, Flutter, Python), and HTTP status codes.
  - **About Page (`/about`)**: Architectural breakdown, project mission, and author profile.
- **🚀 Native & Ultra-Lightweight**: Built with native Node.js HTTP servers and ES Modules. Microscopic RAM footprint and sub-millisecond dispatching.
- **🌐 Universal CORS**: Pre-configured with permissive CORS (`*`) for frictionless browser and mobile app integration.

---

## 🌐 Live Web Suite

When the server runs locally or deployed, visit:

| Route | Purpose | Description |
| :--- | :--- | :--- |
| **[`/`](http://localhost:3000/)** | **API Playground** | Test endpoints interactively with real-time formatted JSON output. |
| **[`/docs`](http://localhost:3000/docs)** | **Documentation** | Detailed endpoint specifications, parameter tables, and multi-language snippets. |
| **[`/about`](http://localhost:3000/about)** | **About Project** | Architectural highlights, vision story, and creator profile. |
| **[`/health`](http://localhost:3000/health)** | **Health Check** | Server uptime, system status, and ISO timestamps. |

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: `v18.0.0` or higher ([Download](https://nodejs.org/))
- **yt-dlp**: Must be installed and available in system `PATH` ([Installation Guide](https://github.com/yt-dlp/yt-dlp#installation))

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/Argha2004/YT-Music-API.git

# Navigate into the project directory
cd YT-Music-API

# Install dependencies
npm install
```

### 3. Running the Server
```bash
# Start in production mode (default port: 3000)
npm start

# Or start in development mode with live file watching
npm run dev
```

The console will display:
```
=================================================
  🎵 YouTube Music REST API Server Running
  🔗 Local:   http://localhost:3000
  📖 Docs:    http://localhost:3000/docs
  💡 About:   http://localhost:3000/about
  💓 Health:  http://localhost:3000/health
=================================================
```

---

## 📡 API Endpoints Reference

### Public Endpoints

| Method | Endpoint | Description | Query / Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/search` | Search songs, albums, artists, or playlists | `q` (required), `filter` (songs, albums, artists, playlists), `limit` |
| `GET` | `/api/stream/:videoId` | Stream audio proxy with HTTP 206 Range seeking | `videoId` (11-char ID) |
| `GET` | `/api/radio/:videoId` | Generate automated radio queue from seed track | `videoId`, `limit` |
| `GET` | `/api/playlists/:playlistId` | Retrieve playlist metadata and song list | `playlistId`, `limit` |
| `GET` | `/api/albums/:albumId` | Retrieve album metadata, year, and tracklist | `albumId` |
| `GET` | `/api/artists/:artistId` | Retrieve artist profile, top songs, and albums | `artistId` |
| `GET` | `/health` | Server health and uptime status | None |

### Authenticated User Endpoints

Send your YouTube Music session cookie via the `x-yt-cookie` header to interact with your personal account:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/account/liked` | Fetch user's Liked Music playlist (`VLLM`) |
| `GET` | `/api/account/history` | Fetch user's watch and playback history |
| `POST` | `/api/account/like/:videoId` | Add track to Liked Songs |
| `DELETE` | `/api/account/like/:videoId` | Remove track from Liked Songs |

---

## 💻 Code Examples

### 1. HTML5 Audio Streaming
```html
<!-- Seamless seekable audio playback directly in any browser -->
<audio controls preload="metadata">
  <source src="http://localhost:3000/api/stream/3_g2un5M350" type="audio/mp4">
  Your browser does not support the audio element.
</audio>
```

### 2. JavaScript / Fetch (Search & Play)
```javascript
// Search for a song
const res = await fetch('http://localhost:3000/api/search?q=Starboy&filter=songs&limit=1');
const { results } = await res.json();

if (results.length > 0) {
  const song = results[0];
  console.log(`Now playing: ${song.title} by ${song.artists?.map(a => a.name).join(', ')}`);
  
  // Stream audio URL
  const audio = new Audio(song.streamUrl);
  audio.play();
}
```

### 3. Flutter (`just_audio`)
```dart
import 'package:just_audio/just_audio.dart';

final player = AudioPlayer();
await player.setUrl('http://localhost:3000/api/stream/3_g2un5M350');
player.play();
```

### 4. Python (`requests`)
```python
import requests

# Search
response = requests.get('http://localhost:3000/api/search', params={
    'q': 'Blinding Lights',
    'filter': 'songs',
    'limit': 5
})
data = response.json()
print("Found tracks:", len(data.get('results', [])))
```

---

## 🛠️ Configuration

Configuration is located in [`src/config.js`](file:///d:/PROJECTS/REA/ytmusic-api/src/config.js). You can override settings using environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP server |
| `HOST` | `0.0.0.0` | Bind host IP address |
| `YTMUSIC_COOKIE` | `""` | Default fallback YouTube session cookie |

---

## 🏗️ Project Architecture

```
ytmusic-api/
├── .gitignore          # Git exclusion rules
├── LICENSE             # MIT Open-Source License
├── package.json        # Project metadata and dependencies
├── README.md           # Documentation and guides
├── test-api.mjs        # Automated API test suite
└── src/
    ├── server.js       # HTTP server initialization and port management
    ├── config.js       # Environment configuration and constants
    ├── routes.js       # REST request router and page dispatching
    ├── innertube.js    # YouTubei / Innertube API engine
    ├── stream.js       # HTTP 206 Range audio streaming proxy
    ├── index.html      # Interactive API Playground UI
    ├── docs.html       # Dedicated detailed Documentation UI
    └── about.html      # Architecture, mission & creator About UI
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the Project: `https://github.com/Argha2004/YT-Music-API`
2. Create your Feature Branch: `git checkout -b feature/AmazingFeature`
3. Commit your Changes: `git commit -m 'Add some AmazingFeature'`
4. Push to the Branch: `git push origin feature/AmazingFeature`
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](file:///d:/PROJECTS/REA/ytmusic-api/LICENSE) for more information.

```
Copyright (c) 2026 Arghadeep Pakhira
```

---

## 👤 Author & Maintainer

**Arghadeep Pakhira**
- **GitHub**: [@Argha2004](https://github.com/Argha2004)
- **Repository**: [https://github.com/Argha2004/YT-Music-API](https://github.com/Argha2004/YT-Music-API)

---

<p align="center">
  <sub><strong>Disclaimer:</strong> This project is an independent open-source developer research tool created for personal, educational, and research purposes. It is not affiliated with, maintained by, or endorsed by Google LLC, YouTube, or YouTube Music. All audio, album artwork, track titles, and artist trademarks are the exclusive property of their respective copyright owners and labels.</sub>
</p>
