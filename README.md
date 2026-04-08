# 📞 Gleap Analytics — Call Request Dashboard

A beautiful, professional analytics dashboard for tracking and managing Gleap "Request a Call" submissions. Built with Node.js + Express backend and a stunning purple/white UI.

![Dashboard Preview](https://via.placeholder.com/1200x600/581c87/ffffff?text=Gleap+Analytics+Dashboard)

## ✨ Features

- **Live Data** — pulls directly from the Gleap API in real-time
- **Smart Discovery** — auto-detects your call request ticket type
- **Full KPI Dashboard** — total requests, open/closed, SLA breaches, assign/close times
- **Agent Performance** — leaderboard with response times and workload
- **Open Request Feed** — urgency-sorted, shows unassigned and unreplied tickets
- **Trends & Volume** — daily/weekly/hourly heatmaps
- **Company Breakdown** — top requesters, prioritised for follow-up
- **AI Team Report** — Claude Sonnet 4.6 writes a direct, data-driven team lead report
- **Date Range Picker** — analyse any custom date window

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/gleap-analytics.git
cd gleap-analytics
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
GLEAP_API_KEY=your_gleap_service_account_key
PROJECT_ID=your_gleap_project_id
OPENROUTER_KEY=your_openrouter_key
AI_MODEL=anthropic/claude-sonnet-4-6
PORT=3000
```

#### Getting your Gleap API key:
1. Go to **Gleap Dashboard → Settings → API Keys**
2. Create a **Service Account** key
3. Copy the JWT token

#### Getting your OpenRouter key:
1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Go to **API Keys** and create one
3. The AI report uses `anthropic/claude-sonnet-4-6` by default

### 3. Run

```bash
npm start
```

Open **http://localhost:3000** in your browser.

---

## 📁 Project Structure

```
gleap-analytics/
├── server.js          # Express backend — Gleap API + AI report endpoint
├── public/
│   └── index.html     # Full dashboard UI (single-file SPA)
├── package.json
├── .env.example
└── README.md
```

---

## 🌐 Deploy to GitHub Pages / Vercel / Railway

### Option A: Railway (Recommended — full backend)
1. Push to GitHub
2. Create a new Railway project → "Deploy from GitHub repo"
3. Add your environment variables in Railway settings
4. Done — Railway auto-detects Node.js and runs `npm start`

### Option B: Render
1. Push to GitHub
2. New Web Service → connect your repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add environment variables

### Option C: Demo-only (GitHub Pages)
The dashboard has a built-in **demo mode** — if no backend is detected, it loads realistic sample data automatically. Perfect for showcasing the UI.

To host just the frontend on GitHub Pages:
1. Copy `public/index.html` to your `gh-pages` branch root
2. Enable GitHub Pages in repo settings

---

## 🔧 Configuration

### Custom Date Ranges
Use the date pickers in the top-right to fetch any time window. Default is the current month (1st → today).

### Call Request Detection
The script auto-discovers call request tickets by:
1. Scanning recent tickets to find all ticket types
2. Matching type names against keywords: `call`, `phone`, `schedule`, `callback`, `book`, `demo`
3. Falling back to title/summary keyword matching

If your Gleap setup uses a custom type name, the auto-detection will still find it via keyword matching in ticket titles.

### Benchmark Customisation
Edit `server.js` to adjust SLA benchmarks:
- **Assign time:** < 15 minutes (industry standard)
- **Close time:** < 4 hours (industry standard)

---

## 📊 Pages

| Page | What it shows |
|------|--------------|
| **Overview** | KPI cards, timing summary, top agents, recent open requests |
| **Agent Performance** | Full leaderboard table with all timing metrics |
| **Open Requests** | Every unresolved ticket, urgency-flagged, with contact details |
| **Trends & Volume** | Daily chart, day-of-week chart, hourly heatmap |
| **Companies** | Top companies by request volume |
| **AI Team Report** | Claude-generated report with action plan |

---

## 🤖 AI Report

The AI report uses Claude Sonnet 4.6 to analyse your data and produce:

1. **Health score** (X/10)
2. **Critical open requests** — which to handle first
3. **Response speed analysis** vs benchmarks
4. **Unassigned ticket action plan**
5. **5-point action plan** for the team lead this week

Generate from the **AI Team Report** page. Requires `OPENROUTER_KEY` in `.env`.

---

## 📄 License

MIT — use freely, modify as needed.
