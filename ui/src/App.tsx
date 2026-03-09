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

const AGENTS = [
  "research",
  "qualification",
  "personalization",
  "video",
  "voice",
  "crm",
  "messaging",
];

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
  const [loading, setLoading] = useState(false);

  const selected = useMemo(
    () => contacts.find((c) => c.phone_number === selectedId || c.id === selectedId) ?? null,
    [contacts, selectedId]
  );

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
    const baseNodes: Node[] = [
      {
        id: "coordinator",
        position: { x: 300, y: 40 },
        data: { label: "Swarm Coordinator" },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: { background: "#0f172a", color: "#fff", borderRadius: 10, padding: 10 },
      },
      ...AGENTS.map((name, idx) => ({
        id: name,
        position: { x: 70 + idx * 155, y: 220 },
        data: {
          label: `${name}\n${activities.filter((a) => a.agentType === name).length} events`,
        },
        style: { borderRadius: 10, padding: 8, background: "#eef2ff", border: "1px solid #c7d2fe" },
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom,
      })),
    ];

    const contactNodes: Node[] = states.slice(0, 8).map((s, idx) => ({
      id: `contact-${s.phoneNumber}`,
      position: { x: 50 + idx * 160, y: 420 },
      data: { label: `${s.phoneNumber}\nturns: ${s.conversationTurns}` },
      style: { borderRadius: 10, padding: 8, background: "#f8fafc", border: "1px solid #cbd5e1" },
      sourcePosition: Position.Top,
    }));

    const baseEdges: Edge[] = AGENTS.map((name) => ({
      id: `coordinator-${name}`,
      source: "coordinator",
      target: name,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#64748b" },
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
  }, [activities, states]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>NextHello CRM + Swarm Live</h1>
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
                  <span>{[c.first_name, c.last_name].filter(Boolean).join(" ") || c.phone_number}</span>
                  <small>{c.company_name || "Unknown company"}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel detail">
          <h2>Contact Detail</h2>
          {selected ? (
            <>
              <p><b>Phone:</b> {selected.phone_number}</p>
              <p><b>Name:</b> {[selected.first_name, selected.last_name].filter(Boolean).join(" ") || "-"}</p>
              <p><b>Company:</b> {selected.company_name || "-"}</p>
              <p><b>Title:</b> {selected.job_title || "-"}</p>
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
            </>
          ) : (
            <p>Select a contact.</p>
          )}
        </section>

        <section className="panel flow">
          <h2>Swarm (ReactFlow, Live SSE)</h2>
          <div className="flowwrap">
            <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView>
              <Background />
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
        </section>
      </main>
    </div>
  );
}
