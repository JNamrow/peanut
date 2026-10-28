import type { Metadata } from "next";
import { ContactCard } from "@/components/contact-card";

export const metadata: Metadata = { title: "About" };

export default function ContactPage() {
  return <ContactCard />;
}
