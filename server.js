require('dotenv').config();
const express = require('express');
const path    = require('path');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ──────────────────────────────────────────────────
const GLEAP_API_KEY  = process.env.GLEAP_API_KEY;
const PROJECT_ID     = process.env.PROJECT_ID;
const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const AI_MODEL       = process.env.AI_MODEL || 'anthropic/claude-sonnet-4-6';

const GLEAP_HEADERS = {
  'Authorization': `Bearer ${GLEAP_API_KEY}`,
  'Project':       PROJECT_ID,
  'Content-Type':  'application/json'
};

const CALL_KEYWORDS   = ['call', 'phone', 'schedule', 'callback', 'book', 'demo', 'request a call'];
const CLOSED_STATUSES = new Set(['CLOSED','DONE','RESOLVED','COMPLETED']);
const OPEN_STATUSES   = new Set(['OPEN','IN_PROGRESS','PENDING','ACTIVE','INPROGRESS']);

// ── Helpers ─────────────────────────────────────────────────
function parseDt(s) {
  if (!s) return null;
  try { return new Date(s.replace('Z','+00:00')); } catch { return null; }
}

function minsBetween(a, b) {
  const ta = parseDt(a), tb = parseDt(b);
  if (ta && tb) return Math.abs((tb - ta) / 60000);
  return null;
}

function fmtMins(m) {
  if (m === null || m === undefined) return 'N/A';
  if (m < 1)    return '<1 min';
  if (m < 60)   return `${Math.round(m)} min`;
  if (m < 1440) return `${(m/60).toFixed(1)} hrs`;
  return `${(m/1440).toFixed(1)} days`;
}

function getAgent(t) {
  for (const field of ['processingUser','assignedTo','assignedAgent','handledBy','agent']) {
    const v = t[field];
    if (v && typeof v === 'object') {
      const name = v.name || v.firstName || v.email;
      if (name) return String(name).trim();
    } else if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return 'Unassigned';
}

function getContact(t) {
  for (const field of ['contact','reporter','user','customer','session']) {
    const v = t[field];
    if (v && typeof v === 'object') {
      const name = v.name || `${v.firstName||''} ${v.lastName||''}`.trim() || v.email;
      if (name && name.trim()) return name.trim().slice(0,50);
    }
  }
  return t.guestEmail || t.email || 'Guest';
}

function getCompany(t) {
  const cd = t.customData || {};
  if (typeof cd === 'object') {
    return cd['Company Name'] || cd.company || cd.organization || cd.companyName || '';
  }
  return '';
}

function getPhone(t) {
  const cd = t.customData || {};
  if (typeof cd === 'object') {
    const p = cd.phone || cd.Phone || cd.phoneNumber || cd.mobile || cd.Mobile || '';
    if (p) return String(p).trim();
  }
  for (const field of ['contact','reporter','user','customer']) {
    const v = t[field];
    if (v && typeof v === 'object') {
      const p = v.phone || v.phoneNumber || v.mobile || '';
      if (p) return String(p).trim();
    }
  }
  return '';
}

function isCallRequest(t, callTypes) {
  const tt = String(t.type || t.ticketType || '').toUpperCase();
  if (callTypes.size > 0 && callTypes.has(tt)) return true;
  const combined = `${t.title||''} ${t.aiSummary||''} ${t.plainContent||''}`.toLowerCase();
  return CALL_KEYWORDS.some(kw => combined.includes(kw));
}

async function gleapFetch(url, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const full = qs ? `${url}?${qs}` : url;
  const res = await fetch(full, { headers: GLEAP_HEADERS });
  if (!res.ok) throw new Error(`Gleap API ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.data || data.tickets || data.items || []);
}

// ── Core data fetching ───────────────────────────────────────
async function fetchAllCallRequests(startDate, endDate) {
  // 1. Find last skip
  let trueLastSkip = 21000;
  for (let probe = 21500; probe > 19900; probe -= 100) {
    try {
      const items = await gleapFetch('https://api.gleap.io/v3/tickets', { limit: 50, skip: probe });
      if (items.length > 0) { trueLastSkip = probe; break; }
    } catch {}
  }

  // 2. Discover ticket types
  const typeCounts = {}, titleSamples = {};
  let sampleSkip = trueLastSkip;
  for (let i = 0; i < 4; i++) {
    try {
      const items = await gleapFetch('https://api.gleap.io/v3/tickets', { limit: 50, skip: sampleSkip });
      for (const t of items) {
        const tt = String(t.type || t.ticketType || 'UNKNOWN').toUpperCase();
        typeCounts[tt] = (typeCounts[tt] || 0) + 1;
        if (!titleSamples[tt]) titleSamples[tt] = [];
        if (titleSamples[tt].length < 3) titleSamples[tt].push(String(t.title || '').toLowerCase().slice(0, 60));
      }
    } catch {}
    sampleSkip -= 50;
  }

  const callTypes = new Set();
  for (const [tt, titles] of Object.entries(titleSamples)) {
    if (CALL_KEYWORDS.some(kw => tt.toLowerCase().includes(kw))) callTypes.add(tt);
    if (titles.some(title => CALL_KEYWORDS.some(kw => title.includes(kw)))) callTypes.add(tt);
  }

  // 3. Collect call tickets in date range
  const allCallTickets = [], seenIds = new Set();
  let currentSkip = trueLastSkip, stopScan = false, pages = 0;
  const rangeStart = new Date(startDate), rangeEnd = new Date(endDate);

  while (!stopScan && pages < 150) {
    if (currentSkip < 0) { stopScan = true; break; }
    let items;
    try { items = await gleapFetch('https://api.gleap.io/v3/tickets', { limit: 50, skip: currentSkip }); }
    catch { break; }

    if (!items.length) { currentSkip -= 50; pages++; continue; }

    let pageOld = 0, pageCall = 0;
    for (const t of items) {
      const tid = t._id || t.id || '';
      if (seenIds.has(tid)) continue;
      seenIds.add(tid);
      const createdDt = parseDt(t.createdAt || t.createdDate);
      if (!createdDt || createdDt > rangeEnd) continue;
      if (createdDt < rangeStart) { pageOld++; continue; }
      if (isCallRequest(t, callTypes)) { allCallTickets.push(t); pageCall++; }
    }

    if (pageOld === items.length) stopScan = true;
    currentSkip -= 50; pages++;
  }

  return { tickets: allCallTickets, typeCounts };
}

function processTickets(tickets) {
  const rows = [];
  for (const t of tickets) {
    const created   = t.createdAt || t.createdDate;
    const updated   = t.updatedAt;
    const firstAssign = t.firstAssignmentAt;
    const statusRaw = String(t.status || t.bugStatus || 'UNKNOWN').toUpperCase();
    const isClosed  = CLOSED_STATUSES.has(statusRaw);
    const closeTime = isClosed ? updated : null;
    const createdDt = parseDt(created);

    rows.push({
      id:            t._id || t.id || '',
      bugId:         t.bugId || '',
      title:         t.title || '',
      contact:       getContact(t),
      company:       getCompany(t),
      phone:         getPhone(t),
      agent:         getAgent(t),
      status:        statusRaw,
      priority:      String(t.priority || 'MEDIUM').toUpperCase(),
      sentiment:     String(t.sentiment || 'neutral').toLowerCase(),
      type:          String(t.type || '').toUpperCase(),
      createdAt:     created,
      updatedAt:     updated,
      closeTime,
      firstAssignAt: firstAssign,
      assignMins:    minsBetween(created, firstAssign),
      closeMins:     minsBetween(created, closeTime),
      aiSummary:     t.aiSummary || '',
      hasAgentReply: Boolean(t.hasAgentReply),
      slaBreached:   Boolean(t.slaBreached),
      day:           createdDt ? createdDt.toISOString().slice(0,10) : 'unknown',
      hour:          createdDt ? createdDt.getUTCHours() : -1,
      dayOfWeek:     createdDt ? ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][createdDt.getUTCDay()] : 'unknown',
    });
  }
  return rows;
}

function computeStats(rows) {
  const total      = rows.length;
  const openRows   = rows.filter(r => OPEN_STATUSES.has(r.status));
  const closedRows = rows.filter(r => CLOSED_STATUSES.has(r.status));

  // Timing
  const assignVals = rows.map(r => r.assignMins).filter(v => v !== null);
  const closeVals  = rows.map(r => r.closeMins).filter(v => v !== null);
  const avgAssign  = assignVals.length ? assignVals.reduce((a,b)=>a+b,0)/assignVals.length : null;
  const avgClose   = closeVals.length  ? closeVals.reduce((a,b)=>a+b,0)/closeVals.length   : null;

  // Daily volume
  const daily = {};
  for (const r of rows) daily[r.day] = (daily[r.day]||0)+1;

  // Day of week
  const dow = { Monday:0, Tuesday:0, Wednesday:0, Thursday:0, Friday:0, Saturday:0, Sunday:0 };
  for (const r of rows) if (r.dayOfWeek in dow) dow[r.dayOfWeek]++;

  // Hourly
  const hourly = {};
  for (const r of rows) hourly[r.hour] = (hourly[r.hour]||0)+1;

  // Agent stats
  const agentMap = {};
  for (const r of rows) {
    if (!agentMap[r.agent]) agentMap[r.agent] = { handled:0, open:0, closed:0, replied:0, sla:0, assignMins:[], closeMins:[] };
    const a = agentMap[r.agent];
    a.handled++;
    if (OPEN_STATUSES.has(r.status)) a.open++;
    if (CLOSED_STATUSES.has(r.status)) a.closed++;
    if (r.hasAgentReply) a.replied++;
    if (r.slaBreached) a.sla++;
    if (r.assignMins !== null) a.assignMins.push(r.assignMins);
    if (r.closeMins !== null) a.closeMins.push(r.closeMins);
  }
  const agents = Object.entries(agentMap).map(([name, d]) => ({
    name,
    handled:    d.handled,
    open:       d.open,
    closed:     d.closed,
    replied:    d.replied,
    slaBreached:d.sla,
    avgAssign:  d.assignMins.length ? d.assignMins.reduce((a,b)=>a+b,0)/d.assignMins.length : null,
    avgClose:   d.closeMins.length  ? d.closeMins.reduce((a,b)=>a+b,0)/d.closeMins.length   : null,
  })).sort((a,b) => b.handled - a.handled);

  // Top companies
  const companyMap = {};
  for (const r of rows) if (r.company) companyMap[r.company] = (companyMap[r.company]||0)+1;
  const topCompanies = Object.entries(companyMap).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([name,count])=>({name,count}));

  return {
    total, openCount: openRows.length, closedCount: closedRows.length,
    unassigned:  rows.filter(r => r.agent === 'Unassigned').length,
    withReply:   rows.filter(r => r.hasAgentReply).length,
    slaBreached: rows.filter(r => r.slaBreached).length,
    withCompany: rows.filter(r => r.company).length,
    withPhone:   rows.filter(r => r.phone).length,
    avgAssign, avgClose,
    avgAssignFmt: fmtMins(avgAssign), avgCloseFmt: fmtMins(avgClose),
    daily: Object.entries(daily).sort((a,b)=>a[0].localeCompare(b[0])).map(([day,count])=>({day,count})),
    dow:   Object.entries(dow).map(([day,count])=>({day,count})),
    hourly: Object.entries(hourly).sort((a,b)=>+a[0]-+b[0]).map(([hour,count])=>({hour:+hour,count})),
    agents, topCompanies,
    openTickets: openRows,
    tickets: rows,
  };
}

// ── API Routes ───────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.get('/api/analytics', async (req, res) => {
  try {
    const now   = new Date();
    const start = req.query.start || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end   = req.query.end   || now.toISOString();

    const { tickets } = await fetchAllCallRequests(start, end);
    const rows  = processTickets(tickets);
    const stats = computeStats(rows);
    res.json({ ok: true, stats, generatedAt: now.toISOString() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/ai-report', async (req, res) => {
  try {
    const { stats } = req.body;
    const prompt = buildAIPrompt(stats);

    const aiResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://gleap-analytics.app',
        'X-Title':       'Gleap Analytics Dashboard',
      },
      body: JSON.stringify({
        model:       AI_MODEL,
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  2000,
        temperature: 0.2,
      }),
    });

    if (!aiResp.ok) return res.status(502).json({ ok: false, error: `AI API ${aiResp.status}` });
    const data   = await aiResp.json();
    const report = data.choices[0].message.content;
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function buildAIPrompt(stats) {
  const agentTable = (stats.agents || []).map(a =>
    `${a.name}: ${a.handled} handled, ${a.open} open, ${a.closed} closed, avg assign ${fmtMins(a.avgAssign)}, avg close ${fmtMins(a.avgClose)}`
  ).join('\n');

  const openList = (stats.openTickets || []).slice(0,15).map(t =>
    `• #${t.bugId} | ${t.contact} @ ${t.company||'Unknown'} | Agent: ${t.agent} | Replied: ${t.hasAgentReply}`
  ).join('\n');

  return `You are a customer success team lead reviewing your team's "Request a call" submissions.

OVERVIEW:
- Total call requests: ${stats.total}
- Open: ${stats.openCount} | Closed: ${stats.closedCount}
- Unassigned: ${stats.unassigned}
- Agent has replied: ${stats.withReply}/${stats.total}
- SLA breached: ${stats.slaBreached}

TIMING:
- Avg time to assign: ${stats.avgAssignFmt}
- Avg time to close: ${stats.avgCloseFmt}
- Industry benchmark: assign <15 min, close <4 hrs

AGENT PERFORMANCE:
${agentTable}

OPEN REQUESTS PENDING:
${openList || 'None'}

Give me a focused report:

**1. CALL REQUEST HEALTH: X/10** — one sentence why.

**2. CRITICAL OPEN REQUESTS** — which are most urgent? Any unassigned to pick up TODAY?

**3. RESPONSE SPEED** — how fast is the team vs benchmark? Who is fastest/slowest?

**4. UNASSIGNED PROBLEM** — ${stats.unassigned} requests have no agent. What to do?

**5. THIS WEEK'S ACTION PLAN** — exactly 5 things to do as team lead right now.

Use real names and numbers. Be direct.`;
}

// ── Serve SPA ────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ Gleap Analytics running on http://localhost:${PORT}`));
