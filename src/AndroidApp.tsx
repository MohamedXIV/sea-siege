import { useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import { ANDROID_SERVER_KEY, parseAndroidServerConfig, readAndroidServerConfig } from "./network/android-server-config";

export default function AndroidApp() {
  const android = Capacitor.getPlatform() === "android";
  const existing = android ? readAndroidServerConfig() : null;
  const [editing, setEditing] = useState(android && !existing);
  const [host, setHost] = useState(existing?.host ?? "");
  const [database, setDatabase] = useState(existing?.database ?? "sea-siege-dev");
  const [error, setError] = useState("");
  function save(event: FormEvent) {
    event.preventDefault();
    const config = parseAndroidServerConfig(host, database);
    if (!config) { setError("Enter a valid HTTP(S) server URL and database name. Localhost cannot reach your PC."); return; }
    try {
      localStorage.setItem(ANDROID_SERVER_KEY, JSON.stringify(config));
      window.location.reload();
    } catch { setError("Could not save server settings on this device."); }
  }
  if (!android) return <App />;
  if (editing) return <main className="min-h-svh bg-slate-950 p-6 text-white"><form onSubmit={save} className="mx-auto flex max-w-lg flex-col gap-3"><h1 className="text-xl font-bold">Server settings</h1><label>Server URL<input className="mt-1 w-full rounded bg-slate-800 p-2" value={host} onChange={e => setHost(e.target.value)} placeholder="http://YOUR-PC-IP:3000" /></label><label>Database<input className="mt-1 w-full rounded bg-slate-800 p-2" value={database} onChange={e => setDatabase(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<button className="rounded bg-sky-700 p-2" type="submit">Save and connect</button>{existing && <button type="button" onClick={() => setEditing(false)}>Cancel</button>}</form></main>;
  return <><App /><button type="button" onClick={() => setEditing(true)} className="fixed bottom-2 right-2 z-[100] rounded bg-slate-800 px-3 py-2 text-xs text-white">Server settings</button></>;
}
