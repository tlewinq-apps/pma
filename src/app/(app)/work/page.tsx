import { redirectToLastApp } from "@/lib/legacyRedirect";

// The old /work page: now `/work` inside the app the person last opened.
export default async function OldWorkPage(props: PageProps<"/work">) {
  return redirectToLastApp("/work", await props.searchParams);
}
