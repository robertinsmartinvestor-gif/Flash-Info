import type { MetadataRoute } from "next";
import { listPublished } from "@/src/public/digest";
import { siteUrl } from "@/src/public/site-info";

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const { data } = await listPublished(500);
  const latest = data[0]?.amendedAt ?? data[0]?.publishedAt;
  return [
    { url: `${origin}/`, ...(latest ? { lastModified: latest } : {}), changeFrequency: "hourly", priority: 1 },
    ...["metodo", "chi-siamo", "correzioni", "contatti", "privacy"].map((path) => ({ url: `${origin}/${path}`, changeFrequency: "monthly" as const, priority: 0.3 })),
    ...data.map((item) => ({ url: `${origin}/notizie/${item.slug}`, lastModified: item.amendedAt ?? item.publishedAt, changeFrequency: "daily" as const, priority: 0.7 })),
  ];
}
