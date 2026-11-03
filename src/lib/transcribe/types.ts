/**
 * A speaker as the transcriber labelled them ("Speaker 0") and who they turned out to be. `role` is one of the app's
 * speakerRolesFor ("member", "staff" or "other" in the demo; "shopper", "staff" or "other" for a fashion app).
 */
export type NamedSpeaker = { label: string; name: string; role: string };
/** A recording turned into `Name: text` lines, the format the extract prompt and countPeople already expect. */
export type Transcript = { text: string; speakers: NamedSpeaker[]; durationSec: number | null };
