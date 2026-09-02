// Cloud partners — the substrates a FlatClaw tenancy deploys onto.
// FlatClaw is a set of containers plus one GPU node; it runs wherever those
// exist. One entry per lane; `lane` is the honest status of that path today.
//
// Logos: official marks, used only to identify the deployment target. They are
// trademarks of their respective owners; no endorsement is implied.

export interface CloudPartner {
  id: string;
  name: string;
  /** Short status of this deployment path. */
  lane: string;
  /** One-line positioning. */
  tagline: string;
  /** What the tenancy looks like on this cloud. */
  blurb: string;
  /** Three concrete fit points, shown as chips. */
  fit: [string, string, string];
  /** Whether bring-up is scripted in the repo today. */
  scripted: boolean;
  /** Official logo under /partners/clouds/, or undefined for a text tile. */
  logo?: string;
  /** Rendered logo height in px (logos have very different aspect ratios). */
  logoHeight?: number;
  /** True when the asset is a logomark only, so the name is set beside it. */
  logoIsMark?: boolean;
}

export const CLOUD_PARTNERS: CloudPartner[] = [
  {
    id: "azure",
    name: "Microsoft Azure",
    lane: "Delivered with an implementation partner",
    tagline: "The lane for Microsoft-first organizations.",
    blurb:
      "A resource group inside the customer's own subscription: AKS or a single GPU virtual machine (NC H100 v5 class), Entra ID for sign-in, private endpoints for everything, and outputs into Fabric and Power BI when the customer wants them.",
    fit: ["Entra ID sign-in", "NC H100 v5 GPU nodes", "Fabric / Power BI hand-off"],
    scripted: false,
    logo: "/partners/clouds/azure.svg",
    logoHeight: 44,
  },
  {
    id: "aws",
    name: "Amazon Web Services",
    lane: "Delivered with an implementation partner",
    tagline: "Your account, your VPC, no public inference endpoint.",
    blurb:
      "An account and VPC the customer owns: EKS or a single GPU instance (p5 or g6e class), IAM roles for access, KMS for secrets, and egress limited to the services users explicitly connect.",
    fit: ["IAM + KMS", "p5 / g6e GPU instances", "Private VPC egress only"],
    scripted: false,
    logo: "/partners/clouds/aws.svg",
    logoHeight: 40,
  },
  {
    id: "gcp",
    name: "Google Cloud",
    lane: "Delivered with an implementation partner",
    tagline: "A project the customer owns, fenced with VPC Service Controls.",
    blurb:
      "GKE with A3 (H100) nodes or a single GPU VM inside the customer's project, Workload Identity for the services, and VPC Service Controls around the tenancy so nothing crosses the boundary unnoticed.",
    fit: ["Workload Identity", "A3 (H100) nodes", "VPC Service Controls"],
    scripted: false,
    logo: "/partners/clouds/gcp.svg",
    logoHeight: 26,
  },
  {
    id: "northflank",
    name: "Northflank",
    lane: "Reference lane · scripted today",
    tagline: "The fastest path from zero to a running tenant.",
    blurb:
      "The managed-GPU platform FlatClaw was built and verified on. One project per tenant, H100 plans by the hour, and the lane scripts in the repository bring inference up and down with one command. Every release is proven here first.",
    fit: ["One project per tenant", "Managed H100 plans", "Lane scripts in the repo"],
    scripted: true,
    logo: "/partners/clouds/northflank.svg",
    logoHeight: 34,
    logoIsMark: true,
  },
  {
    id: "onprem",
    name: "Your own hardware",
    lane: "Bring your own metal",
    tagline: "For data that cannot be in any cloud at all.",
    blurb:
      "Bare metal or a private Kubernetes cluster in your building: an NVIDIA H100 or RTX PRO 6000-class card, the same containers, the same image. No cloud account, no cloud bill, no cloud dependency.",
    fit: ["H100 or RTX PRO 6000 class", "Private Kubernetes or a single host", "Zero cloud dependency"],
    scripted: false,
  },
];

/** What every lane has in common — the part that does not change per cloud. */
export const SHARED_GUARANTEES: [string, string][] = [
  [
    "One image, every lane",
    "The same public inference image from GHCR runs on every cloud. Per-tenant differences live on the weights volume and in the tenancy's secrets, never in the image.",
  ],
  [
    "One tenancy per customer",
    "A resource group, an account, a project, or a rack — one per customer, with the control plane and the GPU inside it. No shared state across tenants.",
  ],
  [
    "The customer holds the account",
    "The cloud bills the customer directly. We never sit between a customer and their substrate, and we never touch the bill or the data.",
  ],
  [
    "Locality you can prove",
    "Run tcpdump on the tenancy's egress for a full session. Zero packets to any third-party inference endpoint, on any of these clouds.",
  ],
];

export const LOGO_NOTICE =
  "Microsoft Azure, Amazon Web Services, Google Cloud and Northflank are trademarks of their respective owners. Logos identify supported deployment targets; no endorsement is implied.";
