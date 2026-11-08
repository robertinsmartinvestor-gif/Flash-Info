import { redirect } from "next/navigation";

/** The voice moved into Impostazioni; old links keep working. */
export default function VoicePage() {
  redirect("/studio/impostazioni");
}
