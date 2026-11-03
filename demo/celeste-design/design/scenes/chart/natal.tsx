// Celeste astrology app, Birth chart. A Marver frame: one screen at phone size.
const s = {
  screen: { boxSizing: "border-box", width: 390, minHeight: 844, padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f3fd", color: "#1e1b3a", display: "flex", flexDirection: "column", gap: 12 },
  h1: { fontSize: 26, margin: "4px 0 0" },
  muted: { fontSize: 13, color: "#6b6790", margin: 0 },
  wheel: { alignSelf: "center", width: 220, height: 220, borderRadius: 110, border: "2px solid #c9bdf0", background: "#ece6fb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#6b6790" },
  h2: { fontSize: 15, margin: "8px 0 0", color: "#6b6790" },
  row: { margin: 0, padding: "10px 0", borderBottom: "1px solid #ece8f7", fontSize: 15 },
  actions: { display: "flex", gap: 10, marginTop: "auto" },
  primary: { flex: 1, border: 0, borderRadius: 12, padding: 14, fontSize: 15, background: "#6d4bd8", color: "#fff" },
  link: { border: 0, background: "none", color: "#4f35a8", fontSize: 15, padding: 14 },
} as const;

export const meta = { title: "Birth chart", description: "Chart wheel, the big three (Sun, Moon, Rising), placements, Share chart, Edit birth details" };

export default function NatalFrame() {
  return (
    <main style={s.screen}>
      <h1 style={s.h1}>Your birth chart</h1>
      <p style={s.muted}>Born October 3, 1994 at 7:42 am in Lisbon, Portugal</p>
      <div style={s.wheel}>Chart wheel</div>
      <h2 style={s.h2}>Your big three</h2>
      <p style={s.row}>Sun in Libra</p>
      <p style={s.row}>Moon in Scorpio</p>
      <p style={s.row}>Rising in Virgo</p>
      <h2 style={s.h2}>Placements</h2>
      <p style={s.row}>Mercury in Libra, 1st house</p>
      <p style={s.row}>Venus in Virgo, 12th house</p>
      <p style={s.row}>Mars in Leo, 11th house</p>
      <div style={s.actions}>
        <button style={s.primary}>Share chart</button>
        <button style={s.link} data-goto="onboarding/birth-details">Edit birth details</button>
      </div>
    </main>
  );
}
