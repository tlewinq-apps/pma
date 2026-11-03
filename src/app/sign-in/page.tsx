import { safeNext } from "@/lib/links";
import { SignInForm } from "./SignInForm";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string | string[]; next?: string | string[] }> }) {
  const { error, next } = await searchParams;
  return <SignInForm error={typeof error === "string" ? error : null} next={typeof next === "string" ? safeNext(next) : null} />;
}
