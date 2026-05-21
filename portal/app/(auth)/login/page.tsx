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
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--brand-primary))]">
      <div className="w-full max-w-sm rounded-lg bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] shadow-xl p-8">
        <Image
          src="/branding/wordmark.svg"
          alt="FlatClaw"
          width={170}
          height={36}
          priority
          className="mb-1"
        />
        <p className="text-sm text-[hsl(var(--fc-fg-secondary))] mb-6">
          Sign in to continue
        </p>
        {error && (
          <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
            Invalid credentials
          </div>
        )}
        <form action={login} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[hsl(var(--fc-fg-secondary))]">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-primary))] px-3 py-2 text-sm text-[hsl(var(--fc-fg-primary))] outline-none focus:ring-2 focus:ring-[hsl(var(--brand-accent))]"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[hsl(var(--fc-fg-secondary))]">
              Password
            </span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-primary))] px-3 py-2 text-sm text-[hsl(var(--fc-fg-primary))] outline-none focus:ring-2 focus:ring-[hsl(var(--brand-accent))]"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-[hsl(var(--brand-accent))] px-4 py-2 text-sm font-semibold text-[hsl(var(--brand-accent-fg))] hover:opacity-90"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
