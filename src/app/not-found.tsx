import { ContactCard } from "@/components/contact-card";

/** Unknown URLs land on the about page instead of a bare 404. */
export default function NotFound() {
  return <ContactCard note="That page doesn't exist." />;
}
