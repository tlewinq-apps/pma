import { redirectToLastApp } from "@/lib/legacyRedirect";

// The old /flows page: now `/flows` inside the app the person last opened.
export default async function OldFlowsPage(props: PageProps<"/flows">) {
  return redirectToLastApp("/flows", await props.searchParams);
}
