import { redirectToLastApp } from "@/lib/legacyRedirect";

// The old /projects page: now `/work` inside the app the person last opened.
export default async function OldProjectsPage(props: PageProps<"/projects">) {
  return redirectToLastApp("/work", await props.searchParams);
}
