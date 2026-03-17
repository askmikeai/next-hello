import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  Position,
} from "reactflow";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Contact = {
  id: string;
  phone_number: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  job_title?: string;
  qualification_tier?: string;
  total_turns?: number;
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
  data?: { activities?: Activity[]; states?: SwarmState[] };
};

type ContactMessage = {
  id: string;
  direction: "inbound" | "outbound";
  content: string;
};

type WhatsAppConnectorStatus = {
  available: boolean;
  connected: boolean;
  qrAvailable: boolean;
};

type SessionUser = {
  name: string;
  email: string;
  status: "approved" | "pending";
};

type SchemaField = {
  key: string;
  label: string;
  type: "text" | "url" | "secret" | "select" | "toggle" | "number" | "textarea";
  options?: string[];
};

type SchemaSection = {
  section: string;
  label: string;
  fields: SchemaField[];
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "nexthello.auth.session";

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

const AGENT_EMOJI: Record<string, string> = {
  openclaw: "\u{1F99E}",
  research: "\u{1F50E}",
  qualification: "\u{1F3AF}",
  personalization: "\u2728",
  video: "\u{1F3AC}",
  voice: "\u{1F399}\uFE0F",
  crm: "\u{1F5C2}\uFE0F",
  messaging: "\u{1F4AC}",
};

const ACTIVE_WINDOW_MS = 30000;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const safeParse = <T,>(v: string | null, fb: T): T => {
  if (!v) return fb;
  try { return JSON.parse(v) as T; } catch { return fb; }
};

const readSession = (): SessionUser | null =>
  safeParse<SessionUser | null>(localStorage.getItem(SESSION_KEY), null);

const writeSession = (s: SessionUser | null) => {
  if (!s) { localStorage.removeItem(SESSION_KEY); return; }
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
};

const apiJson = async <T,>(
  path: string,
  init?: RequestInit,
  ownerId?: string,
): Promise<T> => {
  const h = new Headers(init?.headers ?? {});
  if (ownerId) h.set("X-NextHello-User", ownerId);
  const res = await fetch(path, { ...init, headers: h });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
};

const maskSecret = (v: string) =>
  v.length > 8 ? v.slice(0, 4) + "***" + v.slice(-4) : v ? "***" : "";

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [session, setSession] = useState<SessionUser | null>(() => readSession());
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [page, setPage] = useState<"dashboard" | "settings">("dashboard");

  const ownerId = session?.email.toLowerCase().trim() || "";

  // Dashboard state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [states, setStates] = useState<SwarmState[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [connector, setConnector] = useState<WhatsAppConnectorStatus | null>(null);
  const [qrImageTick, setQrImageTick] = useState(() => Date.now());
  const [qrImageErrored, setQrImageErrored] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  // Settings state
  const [schema, setSchema] = useState<SchemaSection[]>([]);
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [settingsDirty, setSettingsDirty] = useState<Record<string, Record<string, unknown>>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [revealSecrets, setRevealSecrets] = useState<Set<string>>(new Set());
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");

  const api = useCallback(
    <T,>(path: string, init?: RequestInit) => apiJson<T>(path, init, ownerId),
    [ownerId],
  );

  const selected = useMemo(
    () => contacts.find((c) => c.phone_number === selectedId || c.id === selectedId) ?? null,
    [contacts, selectedId],
  );

  const turnsByPhone = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of states) map.set(s.phoneNumber, s.conversationTurns || 0);
    return map;
  }, [states]);

  /* ---- Auth -------------------------------------------------------- */

  const handleAuthSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    setAuthError("");
    const email = authEmail.trim().toLowerCase();
    const password = authPassword.trim();
    const name = authName.trim();
    if (!email || !password || (authMode === "signup" && !name)) {
      setAuthError("Please fill all required fields.");
      return;
    }
    try {
      if (authMode === "signup") {
        const res = await apiJson<{ success: boolean; status?: string; error?: string }>(
          "/admin/api/auth/signup",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, password }),
          },
        );
        if (!res.success) {
          setAuthError(res.error || "Signup failed.");
          return;
        }
        const s: SessionUser = { name, email, status: (res.status as "pending") || "pending" };
        writeSession(s);
        setSession(s);
      } else {
        const res = await apiJson<{
          success: boolean;
          name?: string;
          status?: string;
          error?: string;
        }>("/admin/api/auth/signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!res.success) {
          setAuthError(res.error || "Invalid email or password.");
          return;
        }
        const s: SessionUser = {
          name: res.name || name,
          email,
          status: (res.status as "approved") || "approved",
        };
        writeSession(s);
        setSession(s);
      }
    } catch {
      setAuthError("Server error. Please try again.");
    }
  };

  const signOut = () => {
    writeSession(null);
    setSession(null);
    setContacts([]);
    setSelectedId(null);
    setActivities([]);
    setStates([]);
    setMessages([]);
    setStats(null);
    setSettings({});
    setSettingsDirty({});
  };

  /* ---- Data refresh ------------------------------------------------ */

  const refreshCRM = useCallback(async () => {
    if (!session || session.status !== "approved") return;
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api<Contact[]>("/admin/api/contacts?limit=100"),
        api<Record<string, unknown>>("/admin/api/stats"),
      ]);
      setContacts(c);
      setStats(s);
      if (!selectedId && c[0]) setSelectedId(c[0].phone_number);
    } finally {
      setLoading(false);
    }
  }, [api, session, selectedId]);

  const refreshSwarm = useCallback(async () => {
    if (!session || session.status !== "approved") return;
    const [a, s] = await Promise.all([
      api<Activity[]>("/admin/api/activities?limit=50"),
      api<SwarmState[]>("/admin/api/swarm/states"),
    ]);
    setActivities(a);
    setStates(s);
  }, [api, session]);

  const refreshConnector = useCallback(async () => {
    if (!session || session.status !== "approved") return;
    try {
      const n = await api<WhatsAppConnectorStatus>("/admin/api/whatsapp/connector");
      setConnector(n);
      setQrImageErrored(false);
      if (!n.connected) setQrImageTick(Date.now());
    } catch {
      setConnector(null);
      setQrImageErrored(true);
    }
  }, [api, session]);

  const resetConnectorSession = async () => {
    if (!session) return;
    try {
      await api<unknown>("/admin/api/whatsapp/session/reset", { method: "POST" });
    } finally {
      setQrImageTick(Date.now());
      setQrImageErrored(false);
      window.setTimeout(() => void refreshConnector(), 1200);
    }
  };

  const qrImageSrc = connector?.connected
    ? `/admin/api/whatsapp/qr.png?owner=${encodeURIComponent(ownerId)}`
    : `/admin/api/whatsapp/qr.png?owner=${encodeURIComponent(ownerId)}&t=${qrImageTick}`;

  /* ---- Settings ---------------------------------------------------- */

  const loadSettings = useCallback(async () => {
    if (!session || session.status !== "approved") return;
    try {
      const [sc, cfg] = await Promise.all([
        api<SchemaSection[]>("/admin/api/settings/schema"),
        api<Record<string, Record<string, unknown>>>("/admin/api/settings"),
      ]);
      setSchema(sc);
      setSettings(cfg);
      setSettingsDirty({});
    } catch {
      // ignore
    }
  }, [api, session]);

  const saveSettings = async (evt: FormEvent) => {
    evt.preventDefault();
    setSettingsSaving(true);
    try {
      const cfg = await api<Record<string, Record<string, unknown>>>("/admin/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsDirty),
      });
      setSettings(cfg);
      setSettingsDirty({});
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 1600);
    } finally {
      setSettingsSaving(false);
    }
  };

  const changePassword = async () => {
    setPasswordMsg("");
    if (!currentPassword.trim() || !newPassword.trim()) {
      setPasswordMsg("Enter current and new password.");
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await api<{ success: boolean; error?: string }>(
        "/admin/api/auth/change-password",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword,
          }),
        },
      );
      if (!res.success) {
        setPasswordMsg(res.error || "Password update failed.");
        return;
      }
      setPasswordMsg("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
    } catch {
      setPasswordMsg("Password update failed.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const updateSetting = (section: string, key: string, value: unknown) => {
    setSettingsDirty((prev) => ({
      ...prev,
      [section]: { ...(prev[section] || {}), [key]: value },
    }));
  };

  const getSettingValue = (section: string, key: string): unknown => {
    const dirty = settingsDirty[section]?.[key];
    if (dirty !== undefined) return dirty;
    return settings[section]?.[key] ?? "";
  };

  const toggleReveal = (path: string) => {
    setRevealSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  /* ---- Effects ----------------------------------------------------- */

  useEffect(() => {
    if (!session || session.status !== "approved") return;
    void refreshCRM();
    void refreshSwarm();
    void refreshConnector();
  }, [session]);

  useEffect(() => {
    if (!session || session.status !== "approved") return;
    const t = window.setInterval(() => void refreshConnector(), 5000);
    return () => window.clearInterval(t);
  }, [session, refreshConnector]);

  useEffect(() => {
    if (!session || session.status !== "approved") return;
    let sse: EventSource | null = null;
    let rt: number | null = null;
    const connect = () => {
      sse = new EventSource(`/admin/api/swarm/events?owner=${encodeURIComponent(ownerId)}`);
      sse.addEventListener("state:sync", (evt) => {
        try {
          const p = JSON.parse((evt as MessageEvent).data) as SwarmSyncPayload;
          if (p.data?.activities) setActivities(p.data.activities);
          if (p.data?.states) setStates(p.data.states);
        } catch { /* ignore */ }
      });
      sse.onerror = () => {
        sse?.close();
        sse = null;
        if (rt == null) rt = window.setTimeout(() => { rt = null; connect(); }, 2000);
      };
    };
    connect();
    return () => { if (rt != null) window.clearTimeout(rt); sse?.close(); };
  }, [session, ownerId]);

  useEffect(() => {
    if (!session || session.status !== "approved") return;
    const t = window.setInterval(() => void refreshSwarm(), 5000);
    return () => window.clearInterval(t);
  }, [session, refreshSwarm]);

  useEffect(() => {
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selected?.phone_number || !session || session.status !== "approved") {
      setMessages([]);
      return;
    }
    const load = async () => {
      try {
        const m = await api<ContactMessage[]>(
          `/admin/api/contacts/${encodeURIComponent(selected.phone_number)}/messages?limit=30&safe=false`,
        );
        setMessages(m);
      } catch { setMessages([]); }
    };
    void load();
  }, [selected?.phone_number, activities, session]);

  useEffect(() => {
    if (page === "settings") void loadSettings();
  }, [page, loadSettings]);

  /* ---- Dashboard actions ------------------------------------------- */

  const sendMessage = async () => {
    if (!selected || !message.trim()) return;
    await api("/admin/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: selected.phone_number, content: message }),
    });
    setMessage("");
  };

  const trigger = async (t: string) => {
    if (!selected) return;
    await api(`/admin/api/swarm/trigger/${t}/${selected.phone_number}`, { method: "POST" });
  };

  const deleteContact = async () => {
    if (!selected) return;
    await api("/admin/api/contacts/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: selected.phone_number }),
    });
    await refreshCRM();
  };

  /* ---- Swarm flow graph -------------------------------------------- */

  const flow = useMemo(() => {
    const recentByAgent = new Map<string, Activity>();
    for (const a of activities) {
      if (!AGENTS.includes(a.agentType)) continue;
      const prev = recentByAgent.get(a.agentType);
      if (!prev || Date.parse(a.startedAt) > Date.parse(prev.startedAt))
        recentByAgent.set(a.agentType, a);
    }
    const active = new Set(
      [...recentByAgent].filter(([, a]) => nowTs - Date.parse(a.startedAt) <= ACTIVE_WINDOW_MS).map(([n]) => n),
    );
    const failed = new Set(
      [...recentByAgent].filter(([, a]) => a.status === "failed" && nowTs - Date.parse(a.startedAt) <= ACTIVE_WINDOW_MS).map(([n]) => n),
    );
    const nodes: Node[] = [
      {
        id: "coordinator", position: { x: 300, y: 40 },
        data: { label: "Swarm Coordinator" },
        sourcePosition: Position.Bottom, targetPosition: Position.Top,
        className: `coordinator-node${active.size > 0 ? " coordinator-node--active" : ""}`,
      },
      ...AGENTS.map((n, i) => ({
        id: n, position: { x: 70 + i * 155, y: 220 },
        data: { label: `${AGENT_EMOJI[n] || "\u{1F916}"} ${n}\n${activities.filter((a) => a.agentType === n).length} events` },
        className: `agent-node${active.has(n) ? " agent-node--active" : ""}${failed.has(n) ? " agent-node--failed" : ""}`,
        targetPosition: Position.Top, sourcePosition: Position.Bottom,
      })),
    ];
    const edges: Edge[] = AGENTS.map((n) => ({
      id: `coordinator-${n}`, source: "coordinator", target: n,
      animated: active.has(n),
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: failed.has(n) ? "#b91c1c" : active.has(n) ? "#0ea5e9" : "#64748b",
        strokeWidth: active.has(n) ? 2.5 : 1.5,
      },
    }));
    return { nodes, edges };
  }, [activities, nowTs]);

  /* ================================================================== */
  /*  RENDER                                                             */
  /* ================================================================== */

  /* ---- Auth gate --------------------------------------------------- */
  if (!session) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>NextHello Swarm Console</h1>
          <p>Sign in to configure WhatsApp and guide your swarm goals.</p>
          <div className="auth-tabs">
            <button className={authMode === "signin" ? "active" : ""} onClick={() => setAuthMode("signin")}>Sign In</button>
            <button className={authMode === "signup" ? "active" : ""} onClick={() => setAuthMode("signup")}>Sign Up</button>
          </div>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === "signup" && (
              <label>Full name<input value={authName} onChange={(e) => setAuthName(e.target.value)} /></label>
            )}
            <label>Email<input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} type="email" autoComplete="username" /></label>
            <label>Password<input value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} /></label>
            {authError && <p className="auth-error">{authError}</p>}
            <button type="submit">{authMode === "signin" ? "Enter Dashboard" : "Create Account"}</button>
          </form>
        </div>
      </div>
    );
  }

  /* ---- Pending approval gate --------------------------------------- */
  if (session.status === "pending") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Account Pending</h1>
          <p>Your account <b>{session.email}</b> is pending admin approval.</p>
          <p>You will be able to access the dashboard once an administrator approves your account.</p>
          <button onClick={signOut}>Sign Out</button>
        </div>
      </div>
    );
  }

  /* ---- Settings page ----------------------------------------------- */
  if (page === "settings") {
    return (
      <div className="app">
        <header className="topbar">
          <div className="title-row">
            <h1>Settings</h1>
            <span className="tenant-badge">{session.email}</span>
          </div>
          <div className="actions">
            <button onClick={() => setPage("dashboard")}>Back to Dashboard</button>
            <button onClick={signOut}>Sign Out</button>
          </div>
        </header>
        <form className="settings-form" onSubmit={saveSettings}>
          <fieldset className="panel settings-section">
            <legend>Account Security</legend>
            <div className="settings-subform">
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <div className="actions">
                <button type="button" onClick={changePassword} disabled={passwordSaving}>
                  {passwordSaving ? "Updating..." : "Change Password"}
                </button>
                {passwordMsg && <span className="saved-note">{passwordMsg}</span>}
              </div>
            </div>
          </fieldset>

          {schema.map((sec) => (
            <fieldset key={sec.section} className="panel settings-section">
              <legend>{sec.label}</legend>
              {sec.fields.map((f) => {
                const path = `${sec.section}.${f.key}`;
                const val = getSettingValue(sec.section, f.key);
                if (f.type === "toggle") {
                  return (
                    <label key={path} className="checkbox-row">
                      <input type="checkbox" checked={!!val} onChange={(e) => updateSetting(sec.section, f.key, e.target.checked)} />
                      {f.label}
                    </label>
                  );
                }
                if (f.type === "select") {
                  return (
                    <label key={path}>{f.label}
                      <select value={String(val)} onChange={(e) => updateSetting(sec.section, f.key, e.target.value)}>
                        {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </label>
                  );
                }
                if (f.type === "textarea") {
                  return (
                    <label key={path}>{f.label}
                      <textarea rows={3} value={String(val)} onChange={(e) => updateSetting(sec.section, f.key, e.target.value)} />
                    </label>
                  );
                }
                if (f.type === "secret") {
                  const revealed = revealSecrets.has(path);
                  return (
                    <label key={path}>{f.label}
                      <div className="secret-row">
                        <input
                          type={revealed ? "text" : "password"}
                          value={String(settingsDirty[sec.section]?.[f.key] ?? "")}
                          placeholder={maskSecret(String(val))}
                          onChange={(e) => updateSetting(sec.section, f.key, e.target.value)}
                        />
                        <button type="button" onClick={() => toggleReveal(path)}>{revealed ? "Hide" : "Show"}</button>
                      </div>
                    </label>
                  );
                }
                if (f.type === "number") {
                  return (
                    <label key={path}>{f.label}
                      <input type="number" value={String(val)} onChange={(e) => updateSetting(sec.section, f.key, Number(e.target.value))} />
                    </label>
                  );
                }
                return (
                  <label key={path}>{f.label}
                    <input value={String(val)} onChange={(e) => updateSetting(sec.section, f.key, e.target.value)} />
                  </label>
                );
              })}
            </fieldset>
          ))}
          <div className="actions">
            <button type="submit" disabled={settingsSaving}>{settingsSaving ? "Saving..." : "Save All Settings"}</button>
            {settingsSaved && <span className="saved-note">Saved</span>}
          </div>
        </form>
      </div>
    );
  }

  /* ---- Dashboard --------------------------------------------------- */
  return (
    <div className="app">
      <header className="topbar">
        <div className="title-row">
          <h1>NextHello Swarm Dashboard</h1>
          <span className="tenant-badge">{session.email}</span>
        </div>
        <div className="actions">
          <button onClick={refreshCRM} disabled={loading}>Refresh CRM</button>
          <button onClick={refreshSwarm}>Refresh Swarm</button>
          <button onClick={() => setPage("settings")}>Settings</button>
          <button onClick={signOut}>Sign Out</button>
        </div>
      </header>

      <section className="onboarding">
        <article className="panel onboarding-card">
          <h2>WhatsApp Setup</h2>
          <p className={`qr-status ${connector?.connected ? "ok" : "warn"}`}>
            {connector?.connected ? "Connected and ready" : "Not connected yet"}
          </p>
          {!connector?.connected && !qrImageErrored ? (
            <img className="qr-image" src={qrImageSrc} alt="WhatsApp login QR"
              onLoad={() => setQrImageErrored(false)} onError={() => setQrImageErrored(true)} />
          ) : (
            <p className="qr-empty">{connector?.connected ? "WhatsApp is connected." : "QR not available right now. Click refresh and try again."}</p>
          )}
          <div className="actions">
            <button onClick={refreshConnector}>Refresh QR</button>
            {!connector?.connected && <button onClick={resetConnectorSession}>Generate New QR</button>}
          </div>
        </article>

        <article className="panel onboarding-card">
          <h2>Quick Links</h2>
          <div className="actions" style={{ flexDirection: "column", gap: 6 }}>
            <button onClick={() => setPage("settings")}>Open Settings / API Keys</button>
            <button onClick={refreshCRM} disabled={loading}>Refresh Contacts</button>
          </div>
        </article>
      </section>

      <section className="stats">
        <div className="card">Contacts: {contacts.length}</div>
        <div className="card">Live States: {states.length}</div>
        <div className="card">Recent Activities: {activities.length}</div>
        <div className="card">Total (stats): {String((stats?.total as number) ?? "-")}</div>
      </section>

      <main className="layout">
        <section className="panel flow">
          <h2>Swarm Live</h2>
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
                  <span>{a.agentType}</span><span>{a.action}</span><span>{a.status}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="panel">
          <h2>CRM Contacts</h2>
          <div className="list">
            {contacts.map((c) => (
              <button key={c.phone_number}
                className={`contact ${selected?.phone_number === c.phone_number ? "active" : ""}`}
                onClick={() => setSelectedId(c.phone_number)}>
                <span>{[c.first_name, c.last_name].filter(Boolean).join(" ") || c.phone_number}</span>
                <small>{c.company_name || "Unknown company"} - turns {turnsByPhone.get(c.phone_number) ?? c.total_turns ?? 0}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel detail">
          <h2>Contact Detail</h2>
          {selected ? (
            <>
              <p><b>Contact:</b> {[selected.first_name, selected.last_name].filter(Boolean).join(" ") || "-"}</p>
              <p><b>Phone:</b> {selected.phone_number}</p>
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
                <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Send WhatsApp message" />
                <button onClick={sendMessage}>Send</button>
                <button className="danger" onClick={deleteContact}>Delete Contact Data</button>
              </div>
              <div className="messages">
                <h3>Conversation</h3>
                <div className="message-list">
                  {messages.length ? messages.map((m) => (
                    <div key={m.id} className={`message ${m.direction}`}>
                      <span className="meta">{m.direction === "inbound" ? "Contact" : "Assistant"}</span>
                      <p>{m.content || "-"}</p>
                    </div>
                  )) : <p className="message-empty">No messages yet.</p>}
                </div>
              </div>
            </>
          ) : <p>Select a contact.</p>}
        </section>
      </main>
    </div>
  );
}
