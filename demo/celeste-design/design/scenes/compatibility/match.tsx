// Celeste astrology app, Compatibility. A Marver frame: one screen at phone size.
const s = {
  screen: { boxSizing: "border-box", width: 390, minHeight: 844, padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f3fd", color: "#1e1b3a", display: "flex", flexDirection: "column", gap: 12 },
  kicker: { fontSize: 13, color: "#6b6790", margin: 0 },
  picker: { alignSelf: "flex-start", fontSize: 13, padding: "6px 12px", borderRadius: 999, border: "1px solid #d6cdf2", background: "#fff", color: "#4f35a8" },
  h1: { fontSize: 26, margin: "4px 0 0" },
  body: { fontSize: 15, lineHeight: 1.45, margin: 0 },
  h2: { fontSize: 15, margin: "8px 0 0", color: "#6b6790" },
  row: { margin: 0, padding: "10px 0", borderBottom: "1px solid #ece8f7", fontSize: 15 },
  link: { marginTop: "auto", border: 0, background: "none", color: "#4f35a8", fontSize: 15, padding: 14 },
} as const;

export const meta = { title: "Compatibility", description: "You and a friend: which chart to use, the match in words, how you connect, strengths and what to watch for" };

export default function MatchFrame() {
  return (
    <main style={s.screen}>
      <p style={s.kicker}>You and Leo</p>
      <span style={s.picker}>Compare using: My chart</span>
      <h1 style={s.h1}>A lively match</h1>
      <p style={s.body}>Libra and Aries sit opposite each other: you balance each other out, and you will argue about plans.</p>
      <h2 style={s.h2}>How you connect</h2>
      <p style={s.row}>Venus trine Mars: easy attraction</p>
      <p style={s.row}>Moon square Moon: different needs at home</p>
      <p style={s.row}>Mercury sextile Mercury: you talk easily</p>
      <h2 style={s.h2}>Watch for</h2>
      <p style={s.row}>Leo decides fast; you like to weigh things up</p>
      <button style={s.link} data-goto="friends/list">Back to friends</button>
    </main>
  );
}
