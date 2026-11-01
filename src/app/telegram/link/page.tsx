"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";

type Draft = Record<string, string> | null;
type Mode = "login" | "register" | "verify" | "done";

const box: CSSProperties = { maxWidth: 420, margin: "32px auto", padding: "0 16px", display: "grid", gap: 12 };
const field: CSSProperties = { padding: 10, fontSize: 16, width: "100%", boxSizing: "border-box" };

async function post(path: string, body: unknown) {
  const response = await fetch(`/api/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!json.success) throw new Error(json.error.fields?.[0]?.message ?? json.error.message);
  return json.data;
}

export default function TelegramLinkPage() {
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState<Draft>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // The token lives in the fragment, which browsers never send to servers.
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    post("/telegram/link/info", { token: value })
      .then((info) => {
        setToken(value);
        if (info.draft) {
          setDraft(info.draft);
          setMobile(info.draft.mobile);
          setMode("register");
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const guard = (run: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault();
    setError("");
    run().catch((e: Error) => setError(e.message));
  };

  const link = async () => {
    await post("/telegram/link/complete", { token, mobile, password });
    setPassword("");
    setMode("done");
  };

  if (mode === "done") return <main style={box}><h1>Linked</h1><p>Return to Telegram to start translating.</p></main>;

  return (
    <main style={box}>
      <h1>Language Manager</h1>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      {mode === "login" && (
        <form onSubmit={guard(link)} style={{ display: "grid", gap: 12 }}>
          <label>Mobile<input style={field} value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+966500000000" autoComplete="tel" required /></label>
          <label>Password<input style={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <button style={field} disabled={!token}>Sign in and link Telegram</button>
        </form>
      )}
      {mode === "register" && draft && (
        <form
          onSubmit={guard(async () => {
            await post("/auth/register", { ...draft, password });
            setMode("verify");
          })}
          style={{ display: "grid", gap: 12 }}
        >
          <p>Create the account for {draft.firstName} {draft.lastName} ({draft.mobile}).</p>
          <label>Choose a password<input style={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></label>
          <button style={field}>Create account</button>
        </form>
      )}
      {mode === "verify" && (
        <form
          onSubmit={guard(async () => {
            await post("/auth/verify-mobile/confirm", { mobile, code });
            await link();
          })}
          style={{ display: "grid", gap: 12 }}
        >
          <p>Enter the code we sent to {mobile}.</p>
          <label>Code<input style={field} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required /></label>
          <button style={field}>Verify and link Telegram</button>
        </form>
      )}
    </main>
  );
}
