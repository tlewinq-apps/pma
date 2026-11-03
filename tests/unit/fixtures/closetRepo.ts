// An in-memory stand-in for Closet's repository (acme/Closet), for the first step's code-reading tests: no disk,
// no network. Only src/screens/Studio.tsx says "View Your Look", on line 75.
import type { RepoSnapshot } from "@/lib/repo/snapshot";
import type { ProductProfile } from "@/lib/product/profile";

export const closet: ProductProfile = {
  name: "Closet", one_liner: "an AI fashion app where people save clothes and generate styled outfit photos", audience: "shoppers", audience_one: "shopper", platform: "web and mobile",
};

export function fakeSnap(files: Record<string, string>, extra: Partial<RepoSnapshot> = {}): RepoSnapshot {
  const paths = Object.keys(files).sort();
  return {
    repo: "acme/Closet", ref: "main", source: "local",
    files: () => paths.map((path) => ({ path, size: files[path].length })),
    read: (path) => files[path] ?? null,
    ...extra,
  };
}

/** 150 lines; only line 75 says "View Your Look". */
export const STUDIO = Array.from({ length: 150 }, (_, k) => (k + 1 === 75 ? `        <Text style={styles.cta}>View Your Look</Text>` : `  const row${k + 1} = useRow(${k + 1});`)).join("\n") + "\n";

export const CLOSET_FILES: Record<string, string> = {
  "src/screens/Studio.tsx": STUDIO,
  "src/screens/Home.tsx": "export function Home() {\n  return <Text>Your closet</Text>;\n}\n",
  "package.json": "{ \"name\": \"closet\" }\n",
};

/** 1,000 lines (too long to read whole): "View Your Look" on line 500, and the look's fixed height on line 900, far
 *  from any search hit (what the live run on Closet missed). */
export const MODAL = Array.from({ length: 1000 }, (_, k) => (k + 1 === 500 ? `      <Button title="View Your Look" />` : k + 1 === 900 ? `  lookImage: { height: 520 },` : `  const m${k + 1} = useModal(${k + 1});`)).join("\n") + "\n";
export const MODAL_PATH = "src/screens/TryOnResultModal.tsx";
export const MODAL_FILES: Record<string, string> = {
  [MODAL_PATH]: MODAL,
  "src/screens/StudioScreen.web.tsx": "export function StudioScreen() {\n  return <Look />;\n}\n",
};

/** 2,000 lines, like a big React Native web screen: the first search hits line 100 (which uses styles.cta); a Modal opens
 *  at 400; the sizing that matters is on line 1700, far from any first hit; the style table starts at 1800. */
export const BIG_PATH = "src/screens/BigScreen.web.tsx";
const BIG_LINES: Record<number, string> = {
  1: `import { Modal, StyleSheet, Text } from "react-native";`,
  10: `export default function BigScreen() {`,
  100: `      <Text style={styles.cta}>View Your Look</Text>`,
  400: `      <Modal visible={showResult} transparent>`,
  401: `        <View style={styles.resultModalContainer}>`,
  1700: `  const deepSizing = useWindowDimensions().height * 0.5;`,
  1800: `const styles = StyleSheet.create({`,
  1801: `  cta: {`, 1802: `    fontSize: 16,`, 1803: `  },`,
  1810: `  resultModalContainer: {`, 1811: `    maxHeight: "90%",`, 1812: `    overflow: "hidden",`, 1813: `  },`,
  1999: `});`,
};
export const BIG = Array.from({ length: 2000 }, (_, k) => BIG_LINES[k + 1] ?? `  // line ${k + 1}`).join("\n") + "\n";
