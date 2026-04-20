import { signOut } from '@/auth';
import Image from 'next/image';
import { SignInButton } from '@/components/SignInButton';
import { SignOutButton } from '@/components/SignOutButton';
import { clearCookieChannelIds } from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';

export async function AuthButton() {
  const session = await getSession();

  if (session?.user) {
    const signOutAction = async () => {
      'use server';
      await clearCookieChannelIds();
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
        <span className="hidden max-w-[120px] truncate text-sm font-bold sm:inline">
          {session.user.name}
        </span>
        <SignOutButton action={signOutAction} />
      </form>
    );
  }

  return <SignInButton />;
}
