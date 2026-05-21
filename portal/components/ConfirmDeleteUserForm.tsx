"use client";

import { useState } from "react";
import { PendingButton } from "@/components/PendingButton";

interface ConfirmDeleteUserFormProps {
  userId: string;
  email: string;
  identityName: string | null;
  action: (formData: FormData) => void;
}

/**
 * Wraps the deleteUser server action in a confirmation dialog. Catches the
 * submit event, asks for explicit confirmation showing the user's email
 * (so an accidental click on the wrong row can't nuke an agent + workspace),
 * then lets the form submit through if confirmed.
 */
export function ConfirmDeleteUserForm({
  userId,
  email,
  identityName,
  action,
}: ConfirmDeleteUserFormProps) {
  const [armed, setArmed] = useState(false);
  const label = identityName ?? email;

  return (
    <form
      action={action}
      className="inline"
      onSubmit={(e) => {
        if (armed) return; // already confirmed inline; let it through
        e.preventDefault();
        const ok = window.confirm(
          `Delete ${label} (${email})?\n\n` +
            `This permanently removes:\n` +
            `  • the user from FlatClaw\n` +
            `  • their OpenClaw agent and workspace files\n` +
            `  • their stored service credentials and OAuth tokens\n\n` +
            `This cannot be undone.`,
        );
        if (ok) {
          setArmed(true);
          // Re-submit programmatically now that it's armed.
          (e.currentTarget as HTMLFormElement).requestSubmit();
        }
      }}
    >
      <input type="hidden" name="id" value={userId} />
      <PendingButton
        pendingLabel="Deleting…"
        className="text-sm text-red-600 hover:underline disabled:opacity-60"
      >
        Delete
      </PendingButton>
    </form>
  );
}
