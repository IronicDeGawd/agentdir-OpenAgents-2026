import { SnapshotsPanel } from "./snapshots-panel";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ ens?: string }> };

export default async function Page({ searchParams }: PageProps) {
  const sp = await searchParams;
  return <SnapshotsPanel initialEns={sp.ens ?? null} />;
}
