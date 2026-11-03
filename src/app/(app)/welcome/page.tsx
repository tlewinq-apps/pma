import { redirectToLastApp } from "@/lib/legacyRedirect";

// The old /welcome page: now `/welcome` inside the app the person last opened.
export default async function OldWelcomePage(props: PageProps<"/welcome">) {
  return redirectToLastApp("/welcome", await props.searchParams);
}
