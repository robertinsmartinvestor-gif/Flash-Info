import type { MetadataRoute } from "next";
import { missingSiteInfo, siteUrl } from "@/src/public/site-info";

export default function robots(): MetadataRoute.Robots {
  // While the publisher's details are missing the whole site stays out of search engines.
  if (missingSiteInfo().length > 0) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/studio", "/dashboard", "/api/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
