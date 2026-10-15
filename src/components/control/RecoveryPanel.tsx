import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateRecoveryToken } from "@/lib/recovery-token";
import { setRecoveryToken, recoverWithToken } from "@/lib/recovery.functions";
import { KeyRound, Copy, Check, RotateCcw, Eye, EyeOff } from "lucide-react";

interface Props {
  deviceId: string;
  ownerUserId?: string | null;
}

export function RecoveryPanel({ deviceId, ownerUserId }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset password form
  const [newPassword, setNewPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const generateToken = async () => {
    if (!ownerUserId) {
      setError("No owner assigned to this device.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const t = generateRecoveryToken();
      await setRecoveryToken({ data: { userId: ownerUserId, token: t } });
      setToken(t);
      setShowToken(true);
      setSuccess("Recovery token generated. Copy it and store it safely — it cannot be shown again after you leave this page.");
    } catch (e: any) {
      setError(e.message ?? "Failed to generate token");
    } finally {
      setBusy(false);
    }
  };

  const copyToken = () => {
    if (!token) return;
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetPassword = async () => {
    if (!ownerUserId || !newPassword) return;
    setResetBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // Get owner username
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", ownerUserId)
        .maybeSingle();
      if (!profile?.username) {
        setError("Could not find the owner's username.");
        return;
      }
      // We need the recovery token to reset — if we just generated one, use it
      if (!token) {
        setError("Generate a recovery token first, then reset the password.");
        return;
      }
      await recoverWithToken({
        data: {
          username: profile.username,
          token,
          newPassword,
        },
      });
      setSuccess("Password has been reset successfully.");
      setNewPassword("");
    } catch (e: any) {
      setError(e.message ?? "Failed to reset password");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Generate recovery token */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-5 backdrop-blur-xl">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Recovery Token</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Generate a one-time recovery token for the device owner. This token can be used to reset their password if they lose access to their account.
        </p>

        {!ownerUserId && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            This device has no owner assigned. Recovery tokens require an owner.
          </div>
        )}

        {ownerUserId && (
          <>
            <button
              onClick={generateToken}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              {token ? "Regenerate Token" : "Generate Token"}
            </button>

            {token && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs break-all">
                    {showToken ? token : "••••••••-••••-••••-••••-••••••••"}
                  </code>
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="rounded-md border border-border/60 p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={copyToken}
                    className="rounded-md border border-border/60 p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Reset password */}
      {ownerUserId && token && (
        <div className="rounded-xl border border-border/60 bg-card/60 p-5 backdrop-blur-xl">
          <h2 className="text-sm font-semibold mb-2">Reset Owner Password</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Use the generated recovery token to set a new password for the device owner.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
              className="flex-1 rounded-md border border-border/60 bg-background px-3 py-2 text-xs placeholder:text-muted-foreground"
            />
            <button
              onClick={resetPassword}
              disabled={resetBusy || newPassword.length < 6}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-500/90 px-3 py-2 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-40"
            >
              Reset Password
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {success}
        </div>
      )}
    </div>
  );
}
