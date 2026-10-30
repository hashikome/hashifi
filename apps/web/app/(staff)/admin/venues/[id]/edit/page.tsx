"use client";

import { useParams } from "next/navigation";
import { VenueForm } from "@/components/venue-form";

export default function EditVenuePage() {
  const params = useParams();
  const venueId = params.id as string;

  return <VenueForm mode="edit" venueId={venueId} />;
}
