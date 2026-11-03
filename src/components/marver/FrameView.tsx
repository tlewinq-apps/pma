// Draws a parsed Marver frame (lib/marver/frame.ts) as flex <div>s and <span>s with inline styles. The same elements
// render in the app and through satori (next/og) for PNG screenshots, so the issue page, the mock pull request and
// Slack show the same pixels. Satori only lays out flexbox, so block flow is drawn as flex columns and inline flow as
// wrapping rows, with the browser defaults the frames rely on when Marver renders them.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { FrameChild, FrameNode, ParsedFrame } from "@/lib/marver/frame";

export const FRAME_W = 390;
export const FRAME_H = 844;
/** PMA blue, for non-text use: the ring around what a proposal adds or changes. */
export const MARK = "#2F5FD0";
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

const BLOCK = new Set(["main", "div", "section", "header", "footer", "nav", "article", "aside", "form", "fieldset", "figure", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "hr"]);
const FIELD = new Set(["input", "textarea", "select"]);
/** Browser defaults the frames lean on (a frame's own style wins). */
const DEFAULTS: Record<string, CSSProperties> = {
  h1: { fontSize: 32, fontWeight: 700, margin: "21px 0" },
  h2: { fontSize: 24, fontWeight: 700, margin: "20px 0" },
  h3: { fontSize: 19, fontWeight: 700, margin: "19px 0" },
  h4: { fontSize: 16, fontWeight: 700, margin: "21px 0" },
  h5: { fontSize: 13, fontWeight: 700, margin: "22px 0" },
  h6: { fontSize: 11, fontWeight: 700, margin: "25px 0" },
  p: { margin: "16px 0" },
  ul: { margin: "16px 0", paddingLeft: 40 },
  ol: { margin: "16px 0", paddingLeft: 40 },
  blockquote: { margin: "16px 40px" },
  strong: { fontWeight: 700 }, b: { fontWeight: 700 }, em: { fontStyle: "italic" }, i: { fontStyle: "italic" }, small: { fontSize: 13 },
  hr: { borderTop: "1px solid #c4c4c4", margin: "8px 0", height: 0 },
  button: { fontSize: 13, padding: "1px 6px", border: "2px solid #767676", backgroundColor: "#efefef", borderRadius: 3, color: "#000" },
  input: { fontSize: 13, padding: "1px 2px", border: "2px solid #767676", backgroundColor: "#fff", color: "#000" },
  textarea: { fontSize: 13, padding: "2px", border: "1px solid #767676", backgroundColor: "#fff", minHeight: 40, color: "#000" },
  select: { fontSize: 13, padding: "1px 2px", border: "1px solid #767676", backgroundColor: "#fff", borderRadius: 3, color: "#000" },
};
/** CSS a frame may set. Everything else is dropped, and so is any value that could load something (url(), @import). */
const PROPS = new Set([
  "flexDirection", "flexWrap", "flex", "flexGrow", "flexShrink", "flexBasis", "alignItems", "alignSelf", "alignContent", "justifyContent",
  "gap", "rowGap", "columnGap", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "border", "borderTop", "borderRight", "borderBottom", "borderLeft", "borderWidth", "borderStyle", "borderColor",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
  "background", "backgroundColor", "backgroundImage", "color", "opacity", "boxShadow",
  "fontSize", "fontWeight", "fontStyle", "fontFamily", "lineHeight", "letterSpacing", "textAlign", "textDecoration", "textTransform", "whiteSpace",
  "overflow", "position", "top", "right", "bottom", "left", "objectFit",
]);
const UNSAFE = /url\(|expression\(|javascript:|@import/i;
const SHORTHAND_BORDER = /^border(Top|Right|Bottom|Left)?$/;

function clean(style: FrameNode["style"]): CSSProperties {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(style)) {
    if (!PROPS.has(k) || (typeof v === "string" && UNSAFE.test(v))) continue;
    if (k === "position" && v !== "relative" && v !== "absolute") continue;
    if (k === "background") { out[typeof v === "string" && /gradient\(/.test(v) ? "backgroundImage" : "backgroundColor"] = v; continue; }
    if (k === "backgroundImage" && !(typeof v === "string" && /^(linear|radial)-gradient\(/.test(v))) continue;
    // Satori parses shorthands as strings: `border: 0` (no border) and `margin: 8` must be written out.
    if (typeof v === "number" && SHORTHAND_BORDER.test(k)) { out[k] = v === 0 ? "0px solid transparent" : `${v}px solid`; continue; }
    if (typeof v === "number" && (k === "margin" || k === "padding")) { out[k] = `${v}px`; continue; }
    out[k] = v;
  }
  return out as CSSProperties;
}

const isInline = (c: FrameChild) => typeof c === "string" || !BLOCK.has(c.tag);
const isMarked = (n: FrameNode) => n.attrs["data-pma"] === "new" || n.attrs["data-pma"] === "changed";
const ring = (s: CSSProperties) => ({ ...s, boxShadow: s.boxShadow ? `0 0 0 2px ${MARK}, ${s.boxShadow}` : `0 0 0 2px ${MARK}` });

/** `marks` rings what a proposal added or changed; only the outermost marked element is ringed, not its contents. */
type Opts = { marks: boolean };

function field(n: FrameNode, style: CSSProperties, key: number | undefined, ringed: boolean): ReactElement {
  const type = typeof n.attrs.type === "string" ? n.attrs.type : "text";
  const on = n.attrs.checked === true || n.attrs.checked === "true" || n.attrs.defaultChecked === true;
  if (n.tag === "input" && (type === "checkbox" || type === "radio")) {
    const box: CSSProperties = { display: "flex", width: 18, height: 18, borderRadius: type === "radio" ? 9 : 4, border: `2px solid ${on ? "#1f1f1d" : "#767676"}`, backgroundColor: on ? "#1f1f1d" : "#fff", ...clean(n.style) };
    return <div key={key} style={ringed ? ring(box) : box} />;
  }
  const valueOf = (v: unknown) => (typeof v === "string" && v ? v : null);
  const option = n.tag === "select" ? n.children.find((c) => typeof c !== "string" && c.attrs.selected) ?? n.children.find((c) => typeof c !== "string") : null;
  const value = valueOf(n.attrs.value) ?? valueOf(n.attrs.defaultValue) ?? (option && typeof option !== "string" ? option.children.filter((c) => typeof c === "string").join(" ") : null);
  const text = value ?? valueOf(n.attrs.placeholder) ?? "";
  const box: CSSProperties = { ...style, flexDirection: "row", alignItems: n.tag === "textarea" ? "flex-start" : "center", overflow: "hidden", whiteSpace: n.tag === "textarea" ? "normal" : "nowrap" };
  return <div key={key} style={box}><span style={{ display: "flex", color: value ? undefined : "#757575" }}>{text}</span></div>;
}

function node(n: FrameNode, o: Opts, parentFlex: boolean, key?: number): ReactElement | null {
  const own = clean(n.style);
  const display = n.style.display;
  if (display === "none" || n.tag === "br" || n.tag === "option") return null;
  const flex = display === "flex" || display === "inline-flex";
  const inline = !BLOCK.has(n.tag) || display === "inline" || display === "inline-block";
  const kids = n.children;
  const onlyText = kids.length === 1 && typeof kids[0] === "string";
  const flow = flex ? (own.flexDirection ?? "row") : n.tag === "button" || (!onlyText && (inline || (kids.length > 0 && kids.every(isInline)))) ? "row" : "column";
  let style: CSSProperties = {
    display: "flex", boxSizing: "border-box", flexDirection: flow,
    ...(flow === "row" && !flex ? { flexWrap: "wrap", alignItems: "center" } : {}),
    // Inline things sit at their own width in a block container; in a flex container they stretch like the browser.
    ...(inline && !parentFlex ? { alignSelf: "flex-start" } : {}),
    ...DEFAULTS[n.tag], ...own,
  };
  style.display = "flex";
  style.flexDirection = flow;
  if (n.tag === "button") style = { alignItems: "center", ...style, justifyContent: own.justifyContent ?? (own.textAlign === "left" ? "flex-start" : own.textAlign === "right" ? "flex-end" : "center") };
  const ringed = o.marks && isMarked(n);
  if (ringed) style = ring(style);
  const inner: Opts = ringed ? { marks: false } : o;
  if (FIELD.has(n.tag)) return field(n, style, key, ringed);
  if (n.tag === "img") {
    // eslint-disable-next-line @next/next/no-img-element -- frames carry data: URIs only (parseFrame drops the rest)
    return typeof n.attrs.src === "string" ? <img key={key} src={n.attrs.src} alt={typeof n.attrs.alt === "string" ? n.attrs.alt : ""} style={style} /> : null;
  }
  const content: ReactNode = onlyText ? (kids[0] as string) : kids.map((c, k) =>
    typeof c === "string" ? <span key={k} style={{ display: "flex" }}>{c}</span> : node(c, inner, flex, k));
  return <div key={key} style={style}>{content}</div>;
}

/** One frame at its full size, as plain elements (for satori, or scaled by FrameThumb): a Marver canvas's 390×844, or
 *  `size` for a screen drawn from an app's code (lib/marver/frameSize.ts). */
export function frameElement(f: ParsedFrame, o: Partial<Opts> & { size?: { w: number; h: number } } = {}): ReactElement {
  const w = o.size?.w ?? FRAME_W, h = o.size?.h ?? FRAME_H;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: w, height: h, overflow: "hidden", backgroundColor: "#ffffff", color: "#000000", fontFamily: FONT, fontSize: 16, lineHeight: 1.2 }}>
      {node(f.root, { marks: o.marks ?? false }, true)}
    </div>
  );
}

/** A frame scaled to `width`, for the issue page and the flow pop-up. Not interactive: it is a picture of the screen. */
export function FrameThumb({ frame, width, marks = false, label, className, style }: { frame: ParsedFrame; width: number; marks?: boolean; label: string; className?: string; style?: CSSProperties }) {
  const scale = width / FRAME_W;
  return (
    <div role="img" aria-label={label} className={className} style={{ position: "relative", width, height: Math.round(FRAME_H * scale), overflow: "hidden", ...style }}>
      <div aria-hidden style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}>
        {frameElement(frame, { marks })}
      </div>
    </div>
  );
}
