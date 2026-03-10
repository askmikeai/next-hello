import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  Position,
} from "reactflow";

type Contact = {
  id: string;
  phone_number: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  job_title?: string;
  qualification_tier?: string;
  status?: string;
};

type Activity = {
  id: string;
  correlationId: string;
  agentType: string;
  action: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
};

type SwarmState = {
  correlationId: string;
  phoneNumber: string;
  conversationTurns: number;
  lastActivityAt: string;
};

type SwarmSyncPayload = {
  data?: {
    activities?: Activity[];
    states?: SwarmState[];
  };
};

type ContactMessage = {
  id: string;
  direction: "inbound" | "outbound";
  content: string;
  createdAt?: string;
  messageType?: string;
  moderation?: string;
};

const AGENTS = [
  "openclaw",
  "research",
  "qualification",
  "personalization",
  "video",
  "voice",
  "crm",
  "messaging",
];

const ACTIVE_WINDOW_MS = 12000;
const DEMO_MODE = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_DEMO_MODE ?? "false").toLowerCase()
);

const FRIENDLY_ADJECTIVES = [
  "Sunny",
  "Brave",
  "Kind",
  "Swift",
  "Calm",
  "Happy",
  "Clever",
  "Bright",
  "Curious",
  "Chill",
];

const FRIENDLY_ROLES = [
  "Fox",
  "Dolphin",
  "Panda",
  "Falcon",
  "Otter",
  "Koala",
  "Tiger",
  "Hawk",
  "Bear",
  "Comet",
];

const FRIENDLY_EMOJIS = ["🦊", "🐬", "🐼", "🦅", "🦦", "🐨", "🐯", "🌟", "🚀", "🎉"];

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const friendlyIdentity = (key: string): string => {
  const seed = hashString(key || "unknown");
  const adjective = FRIENDLY_ADJECTIVES[seed % FRIENDLY_ADJECTIVES.length];
  const role = FRIENDLY_ROLES[Math.floor(seed / 7) % FRIENDLY_ROLES.length];
  const emoji = FRIENDLY_EMOJIS[Math.floor(seed / 13) % FRIENDLY_EMOJIS.length];
  return `${emoji} ${adjective} ${role}`;
};

const json = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, init);
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
};

export default function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [states, setStates] = useState<SwarmState[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  const selected = useMemo(
    () => contacts.find((c) => c.phone_number === selectedId || c.id === selectedId) ?? null,
    [contacts, selectedId]
  );

  const displayName = (contact: Contact): string => {
    if (!DEMO_MODE) {
      return [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.phone_number;
    }
    return friendlyIdentity(contact.phone_number ?? "unknown");
  };

  const displayPhone = (phoneNumber?: string | null): string => {
    if (!DEMO_MODE) {
      return phoneNumber || "-";
    }
    return "🔒 Hidden for live demo";
  };

  const refreshCRM = async () => {
    setLoading(true);
    try {
      const [nextContacts, nextStats] = await Promise.all([
        json<Contact[]>("/admin/api/contacts?limit=100"),
        json<Record<string, unknown>>("/admin/api/stats"),
      ]);
      setContacts(nextContacts);
      setStats(nextStats);
      if (!selectedId && nextContacts[0]) {
        setSelectedId(nextContacts[0].phone_number);
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshSwarm = async () => {
    const [nextActivities, nextStates] = await Promise.all([
      json<Activity[]>("/admin/api/activities?limit=50"),
      json<SwarmState[]>("/admin/api/swarm/states"),
    ]);
    setActivities(nextActivities);
    setStates(nextStates);
  };

  useEffect(() => {
    void refreshCRM();
    void refreshSwarm();
  }, []);

  useEffect(() => {
    const sse = new EventSource("/admin/api/swarm/events");
    sse.addEventListener("state:sync", (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as SwarmSyncPayload;
        if (parsed.data?.activities) {
          setActivities(parsed.data.activities);
        }
        if (parsed.data?.states) {
          setStates(parsed.data.states);
        }
      } catch {
        // ignore malformed events
      }
    });

    return () => sse.close();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadMessages = async () => {
      if (!selected?.phone_number) {
        setMessages([]);
        return;
      }

      try {
        const next = await json<ContactMessage[]>(
          `/admin/api/contacts/${encodeURIComponent(selected.phone_number)}/messages?limit=30&safe=${DEMO_MODE ? "true" : "false"}`
        );
        setMessages(next);
      } catch {
        setMessages([]);
      }
    };

    void loadMessages();
  }, [selected?.phone_number, activities]);

  const sendMessage = async () => {
    if (!selected || !message.trim()) return;
    await json("/admin/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_number: selected.phone_number,
        content: message,
      }),
    });
    setMessage("");
  };

  const trigger = async (eventType: string) => {
    if (!selected) return;
    await json(`/admin/api/swarm/trigger/${eventType}/${selected.phone_number}`, {
      method: "POST",
    });
  };

  const deleteContact = async () => {
    if (!selected) return;
    await json("/admin/api/contacts/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: selected.phone_number }),
    });
    await refreshCRM();
  };

  const flow = useMemo(() => {
    const recentByAgent = new Map<string, Activity>();
    for (const activity of activities) {
      if (!AGENTS.includes(activity.agentType)) continue;
      const prev = recentByAgent.get(activity.agentType);
      const prevTime = prev ? Date.parse(prev.startedAt) : 0;
      const thisTime = Date.parse(activity.startedAt);
      if (!prev || thisTime > prevTime) {
        recentByAgent.set(activity.agentType, activity);
      }
    }

    const activeAgents = new Set(
      Array.from(recentByAgent.entries())
        .filter(([, a]) => nowTs - Date.parse(a.startedAt) <= ACTIVE_WINDOW_MS)
        .map(([agent]) => agent)
    );

    const failedAgents = new Set(
      Array.from(recentByAgent.entries())
        .filter(([, a]) => a.status === "failed" && nowTs - Date.parse(a.startedAt) <= ACTIVE_WINDOW_MS)
        .map(([agent]) => agent)
    );

    const coordinatorActive = activeAgents.size > 0;

    const baseNodes: Node[] = [
      {
        id: "coordinator",
        position: { x: 300, y: 40 },
        data: { label: "Swarm Coordinator" },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        className: `coordinator-node${coordinatorActive ? " coordinator-node--active" : ""}`,
        style: { background: "#0b1220", color: "#f8fafc", borderRadius: 10, padding: 10, border: "1px solid #334155" },
      },
      ...AGENTS.map((name, idx) => ({
        id: name,
        position: { x: 70 + idx * 155, y: 220 },
        data: {
          label: `${name}\n${activities.filter((a) => a.agentType === name).length} events`,
        },
        className: `agent-node${activeAgents.has(name) ? " agent-node--active" : ""}${failedAgents.has(name) ? " agent-node--failed" : ""}`,
        style: {
          borderRadius: 10,
          padding: 8,
          background: failedAgents.has(name)
            ? "#7f1d1d"
            : activeAgents.has(name)
              ? "#0c4a6e"
              : "#111827",
          color: failedAgents.has(name) ? "#fee2e2" : activeAgents.has(name) ? "#e0f2fe" : "#e2e8f0",
          border: failedAgents.has(name)
            ? "1px solid #dc2626"
            : activeAgents.has(name)
              ? "1px solid #38bdf8"
              : "1px solid #334155",
          boxShadow: activeAgents.has(name)
            ? "0 0 0 2px rgba(56, 189, 248, 0.35), 0 0 18px rgba(14, 165, 233, 0.45)"
            : "none",
        },
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom,
      })),
    ];

    const contactNodes: Node[] = states.slice(0, 8).map((s, idx) => ({
      id: `contact-${s.phoneNumber}`,
      position: { x: 50 + idx * 160, y: 420 },
      data: {
        label: `${
          DEMO_MODE ? friendlyIdentity(s.phoneNumber ?? "unknown") : s.phoneNumber
        }\nturns: ${s.conversationTurns}`,
      },
      style: { borderRadius: 10, padding: 8, background: "#0f172a", color: "#cbd5e1", border: "1px solid #334155" },
      sourcePosition: Position.Top,
    }));

    const baseEdges: Edge[] = AGENTS.map((name) => ({
      id: `coordinator-${name}`,
      source: "coordinator",
      target: name,
      animated: activeAgents.has(name),
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: failedAgents.has(name) ? "#dc2626" : activeAgents.has(name) ? "#0ea5e9" : "#64748b",
        strokeWidth: activeAgents.has(name) ? 2.5 : 1.5,
      },
    }));

    const dynamicEdges: Edge[] = activities.slice(0, 30).flatMap((a, idx) => {
      const phone = states.find((s) => s.correlationId === a.correlationId)?.phoneNumber;
      if (!phone || !AGENTS.includes(a.agentType)) return [];
      return [
        {
          id: `evt-${idx}`,
          source: `contact-${phone}`,
          target: a.agentType,
          animated: true,
          style: { stroke: a.status === "failed" ? "#dc2626" : "#16a34a" },
          markerEnd: { type: MarkerType.ArrowClosed },
        },
      ];
    });

    return { nodes: [...baseNodes, ...contactNodes], edges: [...baseEdges, ...dynamicEdges] };
  }, [activities, states, nowTs]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="title-row">
          <h1>NextHello CRM + Swarm Live</h1>
          {DEMO_MODE ? <span className="demo-badge">DEMO MODE</span> : null}
        </div>
        <div className="actions">
          <button onClick={refreshCRM} disabled={loading}>Refresh CRM</button>
          <button onClick={refreshSwarm}>Refresh Swarm</button>
        </div>
      </header>

      <section className="stats">
        <div className="card">Contacts: {contacts.length}</div>
        <div className="card">Live States: {states.length}</div>
        <div className="card">Recent Activities: {activities.length}</div>
        <div className="card">Total (stats): {String((stats?.total as number) ?? "-")}</div>
      </section>

      <main className="layout">
        <aside className="panel">
          <h2>CRM Contacts</h2>
          <div className="list">
            {contacts.map((c) => {
              const active = selected?.phone_number === c.phone_number;
              return (
                <button
                  key={c.phone_number}
                  className={`contact ${active ? "active" : ""}`}
                  onClick={() => setSelectedId(c.phone_number)}
                >
                  <span>{displayName(c)}</span>
                  <small>{DEMO_MODE ? "🎭 Demo profile" : c.company_name || "Unknown company"}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel detail">
          <h2>Contact Detail</h2>
          {selected ? (
            <>
              <p><b>Contact:</b> {DEMO_MODE ? friendlyIdentity(selected.phone_number) : displayName(selected)}</p>
              <p><b>Phone:</b> {displayPhone(selected.phone_number)}</p>
              <p><b>Name:</b> {DEMO_MODE ? "🔒 Redacted" : [selected.first_name, selected.last_name].filter(Boolean).join(" ") || "-"}</p>
              <p><b>Company:</b> {DEMO_MODE ? "🔒 Redacted" : selected.company_name || "-"}</p>
              <p><b>Title:</b> {DEMO_MODE ? "🔒 Redacted" : selected.job_title || "-"}</p>
              <p><b>Tier:</b> {selected.qualification_tier || "-"}</p>
              <div className="row">
                <button onClick={() => trigger("research")}>Trigger Research</button>
                <button onClick={() => trigger("qualification")}>Trigger Qualify</button>
                <button onClick={() => trigger("video")}>Trigger Video</button>
                <button onClick={() => trigger("voice")}>Trigger Voice</button>
                <button onClick={() => trigger("crm")}>Trigger CRM</button>
              </div>
              <div className="row">
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Send WhatsApp message"
                />
                <button onClick={sendMessage}>Send</button>
                <button className="danger" onClick={deleteContact}>Delete Contact Data</button>
              </div>
              <div className="messages">
                <h3>{DEMO_MODE ? "Conversation (filtered)" : "Conversation"}</h3>
                <div className="message-list">
                  {messages.length ? (
                    messages.map((m) => (
                      <div key={m.id} className={`message ${m.direction === "inbound" ? "inbound" : "outbound"}`}>
                        <span className="meta">{m.direction === "inbound" ? "Contact" : "Assistant"}</span>
                        <p>{m.content || "-"}</p>
                      </div>
                    ))
                  ) : (
                    <p className="message-empty">No messages yet.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p>Select a contact.</p>
          )}
        </section>

        <section className="panel flow">
          <h2>Swarm (ReactFlow, Live SSE)</h2>
          <div className="flowgrid">
            <div className="flowwrap">
              <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView>
                <Background color="#334155" gap={24} size={1.2} />
                <Controls />
              </ReactFlow>
            </div>
            <div className="events">
              {activities.slice(0, 10).map((a) => (
                <div key={a.id} className="event">
                  <span>{a.agentType}</span>
                  <span>{a.action}</span>
                  <span>{a.status}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
