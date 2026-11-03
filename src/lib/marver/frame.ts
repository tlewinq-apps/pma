// Marver frames, read without running them. A frame is a TSX file (design/scenes/<scene>/<frame>.tsx) that Marver
// renders in a browser. PMA draws the same frames itself (components/marver/FrameView), and the design agent
// writes new ones from customer feedback, so a frame is parsed into a plain tree here and never executed: only literal
// markup and literal style tables are understood, and anything else is refused with a reason the agent can act on.
import { parse } from "@babel/parser";
import type * as t from "@babel/types";

export type FrameStyle = Record<string, string | number>;
export type FrameNode = { tag: string; style: FrameStyle; attrs: Record<string, string | boolean>; children: FrameChild[] };
export type FrameChild = FrameNode | string;
export type ParsedFrame = { meta: { title?: string; description?: string }; root: FrameNode };

export class FrameParseError extends Error {}
const fail = (reason: string): never => { throw new FrameParseError(reason); };

const MAX_SOURCE = 40_000;
const MAX_NODES = 800;
const MAX_DEPTH = 40;

/** Elements a frame may use. Anything else is refused, so the renderer never meets a tag it can't draw. */
export const FRAME_TAGS = new Set([
  "main", "div", "section", "header", "footer", "nav", "article", "aside", "form", "fieldset", "figure", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "strong", "b", "em", "i", "small", "code", "a", "label",
  "ul", "ol", "li", "hr", "br", "button", "input", "textarea", "select", "option", "img",
]);
/** Attributes worth keeping. Event handlers, class names and links have nothing to draw and are dropped quietly. */
const ATTRS = new Set([
  "placeholder", "value", "defaultValue", "type", "checked", "defaultChecked", "disabled", "selected", "role", "title", "alt", "src",
  "aria-label", "aria-checked", "aria-pressed", "data-goto", "data-pma",
]);

type Value = string | number | boolean | null | Value[] | { [k: string]: Value };
type Scope = Map<string, Value>;
const isObject = (v: Value): v is { [k: string]: Value } => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: object, k: string | number) => Object.prototype.hasOwnProperty.call(o, k);

function describe(n: t.Node): string {
  switch (n.type) {
    case "CallExpression": return "a function call (hooks, .map() and helpers can't be drawn)";
    case "ConditionalExpression": case "LogicalExpression": return "a condition (write the state you want to show)";
    case "ArrowFunctionExpression": case "FunctionExpression": return "a function";
    default: return n.type;
  }
}

/** The value of a literal expression: strings, numbers, objects, arrays, and names or members already defined. */
function evalValue(n: t.Node, scope: Scope): Value {
  switch (n.type) {
    case "StringLiteral": case "NumericLiteral": case "BooleanLiteral": return n.value;
    case "NullLiteral": return null;
    case "TemplateLiteral":
      if (n.expressions.length) fail("Template strings can't contain ${...}; write the text out");
      return n.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
    case "UnaryExpression":
      if (n.operator === "-" && n.argument.type === "NumericLiteral") return -n.argument.value;
      break;
    case "TSAsExpression": case "TSSatisfiesExpression": case "TSNonNullExpression": case "TSTypeAssertion": case "ParenthesizedExpression":
      return evalValue(n.expression, scope);
    case "ArrayExpression":
      return n.elements.map((e) => (e && e.type !== "SpreadElement" ? evalValue(e, scope) : fail("Arrays must list their items")));
    case "ObjectExpression": {
      const out: { [k: string]: Value } = Object.create(null);
      for (const p of n.properties) {
        if (p.type === "SpreadElement") {
          const v = evalValue(p.argument, scope);
          if (!isObject(v)) fail("Only objects can be spread into a style");
          Object.assign(out, v);
        } else if (p.type === "ObjectProperty" && !p.computed) {
          const k = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : p.key.type === "NumericLiteral" ? String(p.key.value) : fail("Object keys must be plain names");
          if (k !== "__proto__") out[k] = evalValue(p.value, scope);
        } else fail("Objects can only hold plain values, not methods or computed keys");
      }
      return out;
    }
    case "Identifier":
      if (scope.has(n.name)) return scope.get(n.name)!;
      return fail(`"${n.name}" isn't defined in this frame`);
    case "MemberExpression": {
      const obj = evalValue(n.object, scope);
      const key = !n.computed && n.property.type === "Identifier" ? n.property.name
        : n.computed && (n.property.type === "StringLiteral" || n.property.type === "NumericLiteral") ? n.property.value : null;
      if (key === null || obj === null || typeof obj !== "object" || !has(obj, key)) return fail(`A style or value this frame uses isn't defined (${n.property.type === "Identifier" ? n.property.name : "?"})`);
      return (obj as Record<string | number, Value>)[key];
    }
  }
  return fail(`Frames can only use literal values, not ${describe(n)}`);
}

const unwrap = (n: t.Node): t.Node =>
  n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression" || n.type === "ParenthesizedExpression" || n.type === "TSNonNullExpression" ? unwrap(n.expression) : n;
type Fn = t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression;
const isFn = (n: t.Node): n is Fn => n.type === "FunctionDeclaration" || n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression";

function declare(d: t.VariableDeclaration, scope: Scope, fns: Map<string, Fn>) {
  for (const v of d.declarations) {
    if (!v.init) fail("Declare each value with a value");
    const init = unwrap(v.init!);
    if (init.type === "CallExpression") fail(`Frames can only use literal values, not ${describe(init)}`);
    if (v.id.type !== "Identifier") fail("Declare each value with a plain name");
    const name = (v.id as t.Identifier).name;
    if (isFn(init)) fns.set(name, init);
    else scope.set(name, evalValue(init, scope));
  }
}

/** JSX text the way React reads it: lines trimmed, blank lines dropped, line breaks become single spaces. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = -1;
  lines.forEach((l, k) => { if (/[^ \t]/.test(l)) lastNonEmpty = k; });
  let out = "";
  lines.forEach((line, k) => {
    let s = line.replace(/\t/g, " ");
    if (k !== 0) s = s.replace(/^ +/, "");
    if (k !== lines.length - 1) s = s.replace(/ +$/, "");
    if (s) out += k === lastNonEmpty ? s : `${s} `;
  });
  return out;
}

type Ctx = { scope: Scope; count: number };

function children(list: t.Node[], ctx: Ctx, depth: number): FrameChild[] {
  const out: FrameChild[] = [];
  for (const c of list) {
    if (c.type === "JSXText") { const s = jsxText(c.value); if (s) out.push(s); continue; }
    if (c.type === "JSXSpreadChild") fail("Spread children ({...x}) can't be drawn");
    if (c.type === "JSXElement") { const n = element(c, ctx, depth); if (n) out.push(n); continue; }
    if (c.type === "JSXFragment") { out.push(...children(c.children, ctx, depth)); continue; }
    if (c.type === "JSXExpressionContainer") {
      const e = c.expression;
      if (e.type === "JSXEmptyExpression") continue; // {/* comments */}
      const inner = unwrap(e);
      if (inner.type === "JSXElement" || inner.type === "JSXFragment") { out.push(...children([inner], ctx, depth)); continue; }
      const v = evalValue(inner, ctx.scope);
      if (typeof v === "string" || typeof v === "number") out.push(String(v));
      else if (v !== null && typeof v !== "boolean") fail("Only text and numbers can go inside {...} in markup");
      continue;
    }
    fail(`Frames can't contain ${describe(c)}`);
  }
  return out;
}

function element(el: t.JSXElement, ctx: Ctx, depth: number): FrameNode {
  if (depth > MAX_DEPTH) fail("The markup is nested too deeply");
  if (++ctx.count > MAX_NODES) fail("The frame has too many elements");
  const name = el.openingElement.name;
  if (name.type !== "JSXIdentifier") fail("Use plain HTML elements, not <a.b> or namespaced tags");
  const tag = (name as t.JSXIdentifier).name;
  if (/^[A-Z]/.test(tag)) fail(`<${tag}> is a component; write its markup out with plain elements instead`);
  if (!FRAME_TAGS.has(tag)) fail(`<${tag}> isn't supported in frames`);
  let style: FrameStyle = {};
  const attrs: Record<string, string | boolean> = {};
  for (const a of el.openingElement.attributes) {
    if (a.type === "JSXSpreadAttribute") fail("Spread props ({...x}) aren't supported; spread inside style={{ ...s.a }} instead");
    const at = a as t.JSXAttribute;
    const key = at.name.type === "JSXIdentifier" ? at.name.name : `${at.name.namespace.name}:${at.name.name.name}`;
    const expr = at.value?.type === "JSXExpressionContainer" && at.value.expression.type !== "JSXEmptyExpression" ? at.value.expression : null;
    if (key === "style") {
      const v = expr ? evalValue(expr, ctx.scope) : fail("style must be an object");
      if (!isObject(v)) fail("style must be an object");
      style = Object.fromEntries(Object.entries(v as Record<string, Value>).filter((e): e is [string, string | number] => typeof e[1] === "string" || typeof e[1] === "number"));
      continue;
    }
    if (!ATTRS.has(key)) continue;
    const v = at.value == null ? true : at.value.type === "StringLiteral" ? at.value.value : expr ? evalValue(expr, ctx.scope) : null;
    if (typeof v === "string" || typeof v === "boolean") attrs[key] = v;
    else if (typeof v === "number") attrs[key] = String(v);
  }
  if (tag === "img" && !(typeof attrs.src === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(attrs.src))) delete attrs.src;
  return { tag, style, attrs, children: children(el.children, ctx, depth + 1) };
}

/** The JSX a frame component returns. Only literal `const` declarations may come before the return. */
function returned(fn: Fn, scope: Scope, fns: Map<string, Fn>): t.Node {
  if (fn.body.type !== "BlockStatement") return unwrap(fn.body);
  for (const st of fn.body.body) {
    if (st.type === "ReturnStatement") return st.argument ? unwrap(st.argument) : fail("The frame component returns nothing");
    if (st.type === "VariableDeclaration") { declare(st, scope, fns); continue; }
    fail(`Frames must be plain markup: found ${st.type === "ExpressionStatement" ? describe(st.expression) : st.type} in the component`);
  }
  return fail("The frame component never returns markup");
}

/** Parses a Marver frame's source. Throws FrameParseError with a readable reason when it can't be drawn safely. */
export function parseFrame(src: string): ParsedFrame {
  if (src.length > MAX_SOURCE) fail("The frame is too long");
  let ast: t.File;
  try { ast = parse(src, { sourceType: "module", plugins: ["jsx", "typescript"] }) as unknown as t.File; }
  catch (e) { return fail(`It doesn't parse: ${(e as Error).message}`); }
  const scope: Scope = new Map();
  const fns = new Map<string, Fn>();
  let main: t.Node | null = null;
  for (const st of ast.program.body) {
    if (st.type === "ImportDeclaration") fail("Frames can't import anything; keep the frame self-contained");
    else if (st.type === "VariableDeclaration") declare(st, scope, fns);
    else if (st.type === "ExportNamedDeclaration" && st.declaration?.type === "VariableDeclaration") declare(st.declaration, scope, fns);
    else if (st.type === "ExportNamedDeclaration" && st.declaration?.type === "FunctionDeclaration" && st.declaration.id) fns.set(st.declaration.id.name, st.declaration);
    else if (st.type === "FunctionDeclaration" && st.id) fns.set(st.id.name, st);
    else if (st.type === "ExportDefaultDeclaration") main = st.declaration;
    else if (st.type === "TSTypeAliasDeclaration" || st.type === "TSInterfaceDeclaration" || st.type === "EmptyStatement" || (st.type === "ExportNamedDeclaration" && !st.declaration)) continue;
    else fail(`Frames can't contain ${st.type === "ExpressionStatement" ? describe(st.expression) : st.type} at the top level`);
  }
  if (!main) return fail("The frame has no default export");
  const target = unwrap(main);
  const fn = isFn(target) ? target : target.type === "Identifier" ? fns.get(target.name) : undefined;
  if (!fn) return fail("The default export must be the frame component");
  const jsx = returned(fn, new Map(scope), fns);
  const ctx: Ctx = { scope, count: 0 };
  let root: FrameNode;
  if (jsx.type === "JSXElement") root = element(jsx, ctx, 0);
  else if (jsx.type === "JSXFragment") root = { tag: "div", style: {}, attrs: {}, children: children(jsx.children, ctx, 1) };
  else return fail("The frame component must return markup");
  const meta = scope.get("meta");
  const text = (k: string) => (isObject(meta ?? null) && typeof (meta as Record<string, Value>)[k] === "string" ? (meta as Record<string, string>)[k] : undefined);
  return { meta: { title: text("title"), description: text("description") }, root };
}

/** parseFrame, or null when the source can't be drawn (current frames in the UI fall back to a placeholder). */
export function tryParseFrame(src: string | null | undefined): ParsedFrame | null {
  if (!src) return null;
  try { return parseFrame(src); } catch { return null; }
}

/** All the text in a node, spaced the way it reads. */
export function frameText(n: FrameChild): string {
  return (typeof n === "string" ? n : n.children.map(frameText).join(" ")).replace(/\s+/g, " ").trim();
}

function find(n: FrameNode, pred: (n: FrameNode) => boolean): FrameNode | null {
  if (pred(n)) return n;
  for (const c of n.children) if (typeof c !== "string") { const hit = find(c, pred); if (hit) return hit; }
  return null;
}

/** What the person taps to get from this frame to `target` ("Compare with a friend"), from the element's data-goto. */
export function gotoLabel(root: FrameNode, target: string): string | null {
  const el = find(root, (n) => n.attrs["data-goto"] === target);
  if (!el) return null;
  const text = frameText(el) || (typeof el.attrs["aria-label"] === "string" ? el.attrs["aria-label"] : "");
  return text ? (text.length > 40 ? `${text.slice(0, 39)}…` : text) : null;
}

/** How many elements are marked new or changed (data-pma). */
export function markCount(root: FrameNode): number {
  const own = root.attrs["data-pma"] === "new" || root.attrs["data-pma"] === "changed" ? 1 : 0;
  return own + root.children.reduce((s, c) => s + (typeof c === "string" ? 0 : markCount(c)), 0);
}
