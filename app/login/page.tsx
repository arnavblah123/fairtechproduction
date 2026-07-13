import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">Fairtech Production</h1>
          <p className="text-sm text-slate-500 mt-1">
            Job tracking across all fabrication units
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
