import { getCollection, type CollectionEntry } from "astro:content";

export type ReleaseNote = CollectionEntry<"releaseNotes">;

export async function getReleaseNotes(): Promise<ReleaseNote[]> {
  const notes = await getCollection("releaseNotes");
  return notes.sort((a, b) => {
    const byDate = b.data.date.getTime() - a.data.date.getTime();
    if (byDate !== 0) {
      return byDate;
    }
    return b.id.localeCompare(a.id);
  });
}

export async function getLatestReleaseNote(): Promise<ReleaseNote> {
  const notes = await getReleaseNotes();
  const latest = notes[0];
  if (!latest) {
    throw new Error("No release notes found in docs/release-notes");
  }
  return latest;
}
