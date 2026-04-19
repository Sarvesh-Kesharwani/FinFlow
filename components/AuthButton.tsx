import { auth, signIn, signOut } from '@/auth';
import Image from 'next/image';
import { SignOutButton } from '@/components/SignOutButton';

export async function AuthButton() {
  const session = await auth();

  if (session?.user) {
    const signOutAction = async () => {
      'use server';
      await signOut({ redirectTo: '/' });
    };
    return (
      <form className="flex items-center gap-2 chip">
        {session.user.image && (
          <Image
            src={session.user.image}
            alt={session.user.name ?? 'User'}
            width={24}
            height={24}
            className="rounded-full"
          />
        )}
        <span className="hidden sm:inline text-sm font-bold truncate max-w-[120px]">
          {session.user.name}
        </span>
        <SignOutButton action={signOutAction} />
      </form>
    );
  }

  return (
    <form
      action={async () => {
        'use server';
        await signIn('google', { redirectTo: '/' });
      }}
    >
      <button type="submit" className="btn-duo-green text-sm">
        <span aria-hidden>🔑</span> Sign in
      </button>
    </form>
  );
}
