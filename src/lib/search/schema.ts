import { z } from "zod";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const staySearchSchema = z
  .object({
    destination: z.string().trim().min(2).max(120),
    checkIn: z.string().regex(isoDate, "La fecha de entrada no es válida"),
    checkOut: z.string().regex(isoDate, "La fecha de salida no es válida"),
    adults: z.coerce.number().int().min(1).max(16),
    rooms: z.coerce.number().int().min(1).max(8),
    currency: z.enum(["USD", "BRL", "ARS"]),
  })
  .refine((value) => value.checkOut > value.checkIn, {
    message: "La salida debe ser posterior a la entrada",
    path: ["checkOut"],
  });

export type StaySearchInput = z.infer<typeof staySearchSchema>;

export type StayOffer = {
  id: string;
  provider: "airbnb" | "booking" | "vrbo" | "google" | "demo";
  name: string;
  propertyType: string;
  location: string;
  imageUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  bedrooms: number | null;
  totalPrice: number | null;
  nightlyPrice: number | null;
  currency: string | null;
  priceBasis: string | null;
  bookingUrl: string;
  fetchedAt: string;
};

export type StaySearchResponse = {
  mode: "live" | "sandbox" | "pending" | "not-configured";
  offers: StayOffer[];
  provider: string;
  fetchedAt: string;
  warning?: string;
  jobId?: string;
};
