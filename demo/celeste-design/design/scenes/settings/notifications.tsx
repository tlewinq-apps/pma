// Celeste astrology app, Notifications. A Marver frame: one screen at phone size.
const s = {
  screen: { boxSizing: "border-box", width: 390, minHeight: 844, padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f3fd", color: "#1e1b3a", display: "flex", flexDirection: "column", gap: 4 },
  h1: { fontSize: 26, margin: "4px 0 12px" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid #ece8f7", fontSize: 15 },
  value: { fontSize: 15, color: "#4f35a8" },
  on: { width: 44, height: 26, borderRadius: 13, background: "#6d4bd8", display: "flex", justifyContent: "flex-end", alignItems: "center", padding: 3, boxSizing: "border-box" },
  off: { width: 44, height: 26, borderRadius: 13, background: "#d6cdf2", display: "flex", justifyContent: "flex-start", alignItems: "center", padding: 3, boxSizing: "border-box" },
  knob: { width: 20, height: 20, borderRadius: 10, background: "#fff" },
  muted: { fontSize: 13, color: "#6b6790", margin: "12px 0 0" },
} as const;

export const meta = { title: "Notifications", description: "Daily horoscope push and the time it is sent, moon phase alerts, friend activity" };

export default function NotificationsFrame() {
  return (
    <main style={s.screen}>
      <h1 style={s.h1}>Notifications</h1>
      <div style={s.row}><span>Daily horoscope</span><div style={s.on}><div style={s.knob} /></div></div>
      <div style={s.row}><span>Send at</span><span style={s.value}>8:00 am</span></div>
      <div style={s.row}><span>Moon phase alerts</span><div style={s.off}><div style={s.knob} /></div></div>
      <div style={s.row}><span>Friend activity</span><div style={s.on}><div style={s.knob} /></div></div>
      <p style={s.muted}>Times follow your phone's time zone.</p>
    </main>
  );
}
