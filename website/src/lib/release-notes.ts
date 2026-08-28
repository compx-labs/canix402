import { getCollection, type CollectionEntry } from "astro:content";
import { compareSemver, pickLatestReleaseNote } from "./release-version";

export type ReleaseNote = CollectionEntry<"releaseNotes">;

export async function getReleaseNotes(): Promise<ReleaseNote[]> {
  const notes = await getCollection("releaseNotes");
  return notes.sort((a, b) => {
    const byVersion = compareSemver(b.data.version, a.data.version);
    if (byVersion !== 0) {
      return byVersion;
    }
    const byDate = b.data.date.getTime() - a.data.date.getTime();
    if (byDate !== 0) {
      return byDate;
    }
    return b.id.localeCompare(a.id);
  });
}

export async function getLatestReleaseNote(): Promise<ReleaseNote> {
  const notes = await getCollection("releaseNotes");
  const latest = pickLatestReleaseNote(
    notes.map((note) => ({
      id: note.id,
      version: note.data.version,
      date: note.data.date,
      note
    }))
  )?.note;

  if (!latest) {
    throw new Error("No release notes found in docs/release-notes");
  }
  return latest;
}
