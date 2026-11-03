// Celeste astrology app, Celeste Plus. A Marver frame: one screen at phone size.
const s = {
  screen: { boxSizing: "border-box", width: 390, minHeight: 844, padding: 24, fontFamily: "system-ui, sans-serif", background: "#1e1b3a", color: "#f6f3fd", display: "flex", flexDirection: "column", gap: 12 },
  kicker: { fontSize: 13, color: "#c9bdf0", margin: 0 },
  h1: { fontSize: 28, margin: "4px 0 8px" },
  row: { margin: 0, padding: "10px 0", borderBottom: "1px solid #34305c", fontSize: 15 },
  price: { marginTop: 12, background: "#2a2650", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 4 },
  big: { fontSize: 22, fontWeight: 700, margin: 0 },
  fine: { fontSize: 12, color: "#a49fbf", margin: 0 },
  primary: { marginTop: "auto", border: 0, borderRadius: 12, padding: 16, fontSize: 16, background: "#d9b26f", color: "#1e1b3a" },
  link: { border: 0, background: "none", color: "#c9bdf0", fontSize: 14, padding: 8 },
} as const;

export const meta = { title: "Celeste Plus", description: "What Plus adds, the free trial, Start free trial, Restore purchase" };

export default function UpgradeFrame() {
  return (
    <main style={s.screen}>
      <p style={s.kicker}>Celeste Plus</p>
      <h1 style={s.h1}>See further ahead</h1>
      <p style={s.row}>Monthly forecasts</p>
      <p style={s.row}>Unlimited compatibility readings</p>
      <p style={s.row}>Your full transit calendar</p>
      <p style={s.row}>No ads</p>
      <div style={s.price}>
        <p style={s.big}>7 days free</p>
        <p style={s.fine}>Billed automatically after your trial. Cancel anytime.</p>
      </div>
      <button style={s.primary} data-goto="today/index">Start free trial</button>
      <button style={s.link}>Restore purchase</button>
    </main>
  );
}
