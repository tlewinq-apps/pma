import { redirectToLastApp } from "@/lib/legacyRedirect";

// The old /settings page: now `/settings` inside the app the person last opened.
export default async function OldSettingsPage(props: PageProps<"/settings">) {
  return redirectToLastApp("/settings", await props.searchParams);
}
