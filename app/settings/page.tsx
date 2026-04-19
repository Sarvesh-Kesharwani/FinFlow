import { AddChannelForm } from '@/components/AddChannelForm';
import { ChannelSettingsRow } from '@/components/ChannelSettingsRow';
import { getWhitelistedChannelIds, getEnvChannelIds } from '@/lib/whitelist';
import { getChannels } from '@/lib/youtube';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [allIds, envIds] = await Promise.all([
    getWhitelistedChannelIds(),
    Promise.resolve(getEnvChannelIds()),
  ]);

  let channels: Awaited<ReturnType<typeof getChannels>> = [];
  try {
    channels = await getChannels(allIds);
  } catch {
    // Show IDs if API fails
  }

  return (
    <div className="max-w-xl space-y-8">
      <h1 className="text-3xl font-extrabold text-duo-ink flex items-center gap-2">
        <span aria-hidden>⚙️</span> Channels
      </h1>

      <section className="card p-5 space-y-4">
        <h2 className="font-extrabold text-duo-ink">Add a channel</h2>
        <AddChannelForm />
      </section>

      {allIds.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-extrabold text-duo-ink">Your channels</h2>
          <ul className="space-y-2">
            {channels.length > 0
              ? channels.map((ch) => (
                  <ChannelSettingsRow
                    key={ch.id}
                    id={ch.id}
                    title={ch.title}
                    thumbnail={ch.thumbnail}
                    fromEnv={envIds.includes(ch.id)}
                  />
                ))
              : allIds.map((id) => (
                  <ChannelSettingsRow key={id} id={id} fromEnv={envIds.includes(id)} />
                ))}
          </ul>
        </section>
      )}
    </div>
  );
}
