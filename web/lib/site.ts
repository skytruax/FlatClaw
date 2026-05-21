// Site-wide constants. Single source of truth for version, external links, and
// the demo-booking URL so the nav button, hero CTA, and pages stay in sync.

export const SITE_VERSION = "v0.2.0";
export const SITE_LICENSE = "Apache 2.0";

export const GITHUB_URL = "https://github.com/skytruax/FlatClaw";
export const GHCR_INFERENCE_URL =
  "https://github.com/skytruax/FlatClaw/pkgs/container/flatclaw-inference";

// Demo video — lives in web/public/branding/, copied to /branding/ on export.
export const DEMO_VIDEO_URL = "/branding/RawDemoFlatClaw.mp4";

// "Schedule Demo" link. Interim Google Calendar event-template link: opens a
// pre-filled "FlatClaw Demo" event with skyler@kirktechsolutions.com invited,
// and the visitor picks the time. This is a real calendar.google.com link, not
// a booking page.
//
// ▶ To upgrade to a true booking page: in Google Calendar (as
//   skyler@kirktechsolutions.com) → Create → "Appointment schedule" → Share →
//   copy the booking-page link (https://calendar.app.google/XXXXXXXX) and
//   replace the value below, then rebuild + redeploy web/.
export const SCHEDULE_DEMO_URL =
  "https://calendar.google.com/calendar/render?action=TEMPLATE&text=FlatClaw%20Demo&details=Demo%20of%20FlatClaw%20%E2%80%94%20the%20open-source%20private-cloud%20AI%20coworker%2C%20delivered%20by%20Kirk%20Tech%20Solutions.%20https%3A%2F%2Fflatclaw.org&add=skyler%40kirktechsolutions.com&add=nate%40kirktechsolutions.com";

// Kirk Tech Solutions partnership press release.
export const KIRK_PRESS_RELEASE_URL =
  "https://www.kirktechsolutions.com/press-releases/kirk-tech-solutions-launches-flatclaw-private-secure-tenant-ai-coworkers-deployed-inside-customers-own-private-cloud/";
export const KIRK_SITE_URL = "https://kirktechsolutions.com";
