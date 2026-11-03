import { redirectToLastApp } from "@/lib/legacyRedirect";

// The old /feedback page: now `/feedback` inside the app the person last opened.
export default async function OldFeedbackPage(props: PageProps<"/feedback">) {
  return redirectToLastApp("/feedback", await props.searchParams);
}
