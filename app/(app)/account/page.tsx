import { requireUser } from "@/lib/permissions";
import { RoleBadge } from "@/components/badges";
import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="bg-white rounded-xl shadow-sm p-4">
        <h1 className="text-xl font-bold">{user.name}</h1>
        <p className="text-sm text-slate-500">{user.email}</p>
        <div className="mt-2">
          <RoleBadge role={user.role} />
        </div>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
