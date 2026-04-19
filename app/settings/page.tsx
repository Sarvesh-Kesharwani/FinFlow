import { AddChannelForm } from '@/components/AddChannelForm';
import { AddSpaceForm } from '@/components/AddSpaceForm';
import { ChannelSettingsRow } from '@/components/ChannelSettingsRow';
import { QuotaCard } from '@/components/QuotaCard';
import { SpaceSettingsRow } from '@/components/SpaceSettingsRow';
import { getSession } from '@/lib/session';
import {
  getEnvChannelIds,
  getWhitelistedChannelPreferences,
  getWhitelistedChannelSpaces,
} from '@/lib/whitelist';
import { getChannels, getYouTubeQuotaSummary } from '@/lib/youtube';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  const [preferences, envIds, spaces] = await Promise.all([
    getWhitelistedChannelPreferences(),
    Promise.resolve(getEnvChannelIds()),
    getWhitelistedChannelSpaces(),
  ]);
  const allIds = preferences.map((channel) => channel.id);
  const quotaViewerEmail = (process.env.YOUTUBE_QUOTA_VIEWER_EMAIL ?? '').trim().toLowerCase();
  const canViewQuota =
    !!quotaViewerEmail && session?.user?.email?.trim().toLowerCase() === quotaViewerEmail;
  const quota = canViewQuota ? await getYouTubeQuotaSummary(allIds.length, session?.accessToken) : null;

  let channels: Awaited<ReturnType<typeof getChannels>> = [];
  try {
    channels = await getChannels(allIds);
  } catch {
    // Show IDs if API fails
  }

  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
  const preferencesBySpace = new Map(
    spaces.map((space) => [
      space,
      preferences.filter((channelPreference) => channelPreference.space === space),
    ]),
  );

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-3xl font-extrabold text-duo-ink flex items-center gap-2">
        <span aria-hidden>⚙️</span> Channels
      </h1>

      <section className="card p-5 space-y-4">
        <h2 className="font-extrabold text-duo-ink">Add a channel</h2>
        <AddChannelForm />
      </section>

      <section className="card p-5 space-y-4">
        <h2 className="font-extrabold text-duo-ink">Create a space</h2>
        <AddSpaceForm />
        {spaces.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-bold text-duo-ink/60">Existing spaces</p>
            {spaces.map((space) => (
              <SpaceSettingsRow key={space} space={space} />
            ))}
          </div>
        )}
      </section>

      {canViewQuota && quota && <QuotaCard quota={quota} />}

      {preferences.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-extrabold text-duo-ink">Your channels</h2>
          <div className="space-y-5">
            {spaces.map((space) => {
              const groupedPreferences = preferencesBySpace.get(space) ?? [];
              if (groupedPreferences.length === 0) return null;

              return (
                <div key={space} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-duo-ink">{space}</h3>
                    <span className="chip cursor-default">{groupedPreferences.length}</span>
                  </div>
                  <ul className="space-y-2">
                    {groupedPreferences.map((channelPreference) => {
                      const channel = channelMap.get(channelPreference.id);
                      return (
                        <ChannelSettingsRow
                          key={channelPreference.id}
                          id={channelPreference.id}
                          title={channel?.title}
                          thumbnail={channel?.thumbnail}
                          fromEnv={envIds.includes(channelPreference.id)}
                          currentSpace={channelPreference.space}
                          spaces={spaces}
                        />
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
