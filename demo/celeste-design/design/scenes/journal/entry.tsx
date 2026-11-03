// Celeste astrology app, Journal entry. A Marver frame: one screen at phone size.
const s = {
  screen: { boxSizing: "border-box", width: 390, minHeight: 844, padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f3fd", color: "#1e1b3a", display: "flex", flexDirection: "column", gap: 12 },
  kicker: { fontSize: 13, color: "#6b6790", margin: 0 },
  h1: { fontSize: 26, margin: "4px 0 0" },
  chips: { display: "flex", gap: 8 },
  chipOn: { fontSize: 14, padding: "8px 12px", borderRadius: 999, background: "#6d4bd8", color: "#fff" },
  chip: { fontSize: 14, padding: "8px 12px", borderRadius: 999, border: "1px solid #d6cdf2", background: "#fff", color: "#4f35a8" },
  note: { border: "1px solid #d6cdf2", borderRadius: 12, padding: 14, minHeight: 120, fontSize: 15, background: "#fff", color: "#8a86a8" },
  primary: { border: 0, borderRadius: 12, padding: 14, fontSize: 15, background: "#6d4bd8", color: "#fff" },
  h2: { fontSize: 15, margin: "12px 0 0", color: "#6b6790" },
  row: { margin: 0, padding: "10px 0", borderBottom: "1px solid #ece8f7", fontSize: 15 },
  date: { fontSize: 13, color: "#6b6790", marginRight: 8 },
} as const;

export const meta = { title: "Journal entry", description: "Today's moon phase, a mood, a note, Save entry; past entries listed by date" };

export default function JournalFrame() {
  return (
    <main style={s.screen}>
      <p style={s.kicker}>Waxing gibbous in Pisces</p>
      <h1 style={s.h1}>How are you feeling?</h1>
      <div style={s.chips}>
        <span style={s.chipOn}>Calm</span>
        <span style={s.chip}>Restless</span>
        <span style={s.chip}>Hopeful</span>
        <span style={s.chip}>Tired</span>
      </div>
      <div style={s.note}>Write about your day</div>
      <button style={s.primary}>Save entry</button>
      <h2 style={s.h2}>Past entries</h2>
      <p style={s.row}><span style={s.date}>October 27</span> Restless, and a long talk with Leo</p>
      <p style={s.row}><span style={s.date}>October 20</span> Calm after the new moon</p>
      <p style={s.row}><span style={s.date}>October 13</span> Hopeful about the move</p>
    </main>
  );
}
