// Celeste astrology app, Friends. A Marver frame: one screen at phone size.
const s = {
  screen: { boxSizing: "border-box", width: 390, minHeight: 844, padding: 24, fontFamily: "system-ui, sans-serif", background: "#f6f3fd", color: "#1e1b3a", display: "flex", flexDirection: "column", gap: 12 },
  h1: { fontSize: 26, margin: "4px 0 0" },
  muted: { fontSize: 14, color: "#6b6790", margin: 0 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #ece8f7" },
  avatar: { width: 40, height: 40, borderRadius: 20, background: "#ece6fb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#4f35a8" },
  who: { display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" },
  name: { border: 0, background: "none", padding: 0, fontSize: 15, color: "#1e1b3a", textAlign: "left" },
  sign: { fontSize: 13, color: "#6b6790" },
  primary: { marginTop: "auto", border: 0, borderRadius: 12, padding: 16, fontSize: 16, background: "#6d4bd8", color: "#fff" },
} as const;

export const meta = { title: "Friends", description: "Friends with their sun signs; tap a friend to open a compatibility reading; Add a friend" };

export default function FriendsFrame() {
  return (
    <main style={s.screen}>
      <h1 style={s.h1}>Friends</h1>
      <p style={s.muted}>Tap a friend to see how your charts get along.</p>
      <div style={s.row}>
        <div style={s.avatar}>LM</div>
        <div style={s.who}><button style={s.name} data-goto="compatibility/match">Leo Martins</button><span style={s.sign}>Aries sun</span></div>
      </div>
      <div style={s.row}>
        <div style={s.avatar}>AS</div>
        <div style={s.who}><button style={s.name}>Ana Souza</button><span style={s.sign}>Cancer sun</span></div>
      </div>
      <div style={s.row}>
        <div style={s.avatar}>CP</div>
        <div style={s.who}><button style={s.name}>Chris Park</button><span style={s.sign}>Libra sun</span></div>
      </div>
      <button style={s.primary}>Add a friend</button>
    </main>
  );
}
