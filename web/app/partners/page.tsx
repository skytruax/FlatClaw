import type { Metadata } from "next";
import { PartnersMoved } from "@/components/PartnersMoved";

export const metadata: Metadata = {
  title: "Services",
  robots: { index: false, follow: true },
};

/** The partners page became /services: Kirk is the sole services provider. */
export default function PartnersRedirect() {
  return <PartnersMoved />;
}
