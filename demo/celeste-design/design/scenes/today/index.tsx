// Celeste astrology app, Today. A Marver frame: one screen at phone size.
const s = {
  screen: { boxSizing: "border-box", width: 390, minHeight: 844, padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f3fd", color: "#1e1b3a", display: "flex", flexDirection: "column", gap: 12 },
  kicker: { fontSize: 13, color: "#6b6790", margin: 0 },
  h1: { fontSize: 26, margin: "4px 0 0" },
  chip: { alignSelf: "flex-start", fontSize: 13, padding: "4px 10px", borderRadius: 999, background: "#ece6fb", color: "#4f35a8" },
  card: { background: "#ffffff", border: "1px solid #e2dcf3", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: 600, margin: 0 },
  body: { fontSize: 15, lineHeight: 1.45, margin: 0 },
  h2: { fontSize: 15, margin: "8px 0 0", color: "#6b6790" },
  row: { margin: 0, padding: "10px 0", borderBottom: "1px solid #ece8f7", fontSize: 15 },
  actions: { display: "flex", flexDirection: "column", gap: 10 },
  primary: { border: 0, borderRadius: 12, padding: 14, fontSize: 15, background: "#6d4bd8", color: "#fff", textAlign: "center" },
  secondary: { border: "1px solid #d6cdf2", borderRadius: 12, padding: 14, fontSize: 15, background: "#fff", color: "#4f35a8", textAlign: "center" },
  banner: { border: 0, borderRadius: 12, padding: 14, fontSize: 14, background: "#1e1b3a", color: "#f6f3fd", textAlign: "left" },
  tabs: { marginTop: "auto", display: "flex", justifyContent: "space-between", padding: "12px 8px 0", borderTop: "1px solid #e2dcf3", fontSize: 13, color: "#6b6790" },
  tabOn: { color: "#4f35a8", fontWeight: 600 },
} as const;

export const meta = { title: "Today", description: "Daily horoscope for your sun sign, the moon phase, today's transits, Journal and Compare shortcuts" };

export default function TodayFrame() {
  return (
    <main style={s.screen}>
      <p style={s.kicker}>Thursday, October 29</p>
      <h1 style={s.h1}>Good morning, Maya</h1>
      <span style={s.chip}>Waxing gibbous, 82% lit</span>
      <section style={s.card}>
        <p style={s.cardTitle}>Your day as a Libra</p>
        <p style={s.body}>The Moon in Pisces softens your edges today. Say the kind thing you have been rehearsing, and leave the big decisions for the weekend.</p>
      </section>
      <h2 style={s.h2}>Your transits</h2>
      <p style={s.row}>Moon in Pisces: rest and reflect</p>
      <p style={s.row}>Venus trine your Sun: a good day to reach out</p>
      <p style={s.row}>Mercury square Mars: think before you reply</p>
      <div style={s.actions}>
        <button style={s.primary} data-goto="journal/entry">Write in journal</button>
        <button style={s.secondary} data-goto="friends/list">Compare with a friend</button>
      </div>
      <button style={s.banner} data-goto="plus/upgrade">See your month ahead with Celeste Plus</button>
      <div style={s.tabs}>
        <span style={s.tabOn}>Today</span>
        <span>Chart</span>
        <span>Friends</span>
        <span>Journal</span>
      </div>
    </main>
  );
}
