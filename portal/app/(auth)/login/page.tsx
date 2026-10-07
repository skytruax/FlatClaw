import { signIn } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import Image from "next/image";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect(session.user.role === "admin" ? "/admin/users" : "/me/chat");
  }

  const { error, callbackUrl } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/admin/users",
    });
  }

  return (
    <div className="fc-hero fc-dots flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="fc-card p-8 shadow-2xl">
          <Image
            src="/branding/wordmark-tagline.svg"
            alt="FlatClaw, Private AI Platform"
            width={220}
            height={66}
            priority
            className="mb-6 h-14 w-auto"
          />
          <div className="fc-eyebrow mb-1.5">Your tenancy</div>
          <h1 className="fc-title mb-5 text-2xl text-[hsl(var(--fc-fg-primary))]">Sign in</h1>
          {error && (
            <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
              That email and password do not match an account here.
            </div>
          )}
          <form action={login} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-[hsl(var(--fc-fg-secondary))]">Email</span>
              <input name="email" type="email" required autoComplete="email" className="fc-input mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[hsl(var(--fc-fg-secondary))]">Password</span>
              <input name="password" type="password" required autoComplete="current-password" className="fc-input mt-1" />
            </label>
            <button type="submit" className="fc-btn fc-btn-primary w-full">
              Sign in
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-[11px] uppercase tracking-widest text-[hsl(var(--brand-accent-fg))/0.6]">
          <a
            href="https://github.com/skytruax/FlatClaw"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-[hsl(var(--brand-accent))]"
          >
            A Kirk Open Source Community Project
          </a>
        </p>
      </div>
    </div>
  );
}
