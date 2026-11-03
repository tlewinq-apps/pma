// Celeste astrology app, Birth details. A Marver frame: one screen at phone size.
const s = {
  screen: { boxSizing: "border-box", width: 390, minHeight: 844, padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f3fd", color: "#1e1b3a", display: "flex", flexDirection: "column", gap: 14 },
  kicker: { fontSize: 13, color: "#6b6790", margin: 0 },
  h1: { fontSize: 26, margin: "4px 0 0" },
  muted: { fontSize: 14, color: "#6b6790", margin: 0 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 14 },
  input: { border: "1px solid #d6cdf2", borderRadius: 10, padding: "12px 14px", fontSize: 16, background: "#fff" },
  timeRow: { display: "flex", gap: 8, alignItems: "center" },
  timeInput: { flex: 1, border: "1px solid #d6cdf2", borderRadius: 10, padding: "12px 14px", fontSize: 16, background: "#fff" },
  segment: { display: "flex", fontSize: 14 },
  segOn: { padding: "12px 14px", background: "#6d4bd8", color: "#fff", border: "1px solid #6d4bd8", borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  segOff: { padding: "12px 14px", background: "#fff", color: "#6b6790", border: "1px solid #d6cdf2", borderTopRightRadius: 10, borderBottomRightRadius: 10 },
  primary: { marginTop: "auto", border: 0, borderRadius: 12, padding: 16, fontSize: 16, background: "#6d4bd8", color: "#fff" },
  small: { border: 0, background: "none", color: "#8a86a8", fontSize: 12, padding: 0, alignSelf: "center" },
} as const;

export const meta = { title: "Birth details", description: "Date of birth, birth time with AM or PM, birth place, Continue; a small I don't know my birth time link" };

export default function BirthDetailsFrame() {
  return (
    <main style={s.screen}>
      <p style={s.kicker}>Step 2 of 3</p>
      <h1 style={s.h1}>When and where were you born?</h1>
      <p style={s.muted}>Your birth time sets your rising sign and houses.</p>
      <label style={s.label}>Date of birth<input style={s.input} placeholder="October 3, 1994" /></label>
      <label style={s.label}>Birth time
        <div style={s.timeRow}>
          <input style={s.timeInput} placeholder="7:42" />
          <div style={s.segment}>
            <span style={s.segOn}>AM</span>
            <span style={s.segOff}>PM</span>
          </div>
        </div>
      </label>
      <label style={s.label}>Birth place<input style={s.input} placeholder="Lisbon, Portugal" /></label>
      <button style={s.primary} data-goto="chart/natal">Continue</button>
      <button style={s.small}>I don't know my birth time</button>
    </main>
  );
}
