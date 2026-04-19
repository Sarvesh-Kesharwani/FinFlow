'use client';

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <button
      type="submit"
      onClick={() => sessionStorage.removeItem('tubeo_drive_pulled')}
      formAction={action}
      className="flex items-center gap-1"
    >
      <span className="text-duo-mute text-xs">Sign out</span>
    </button>
  );
}
