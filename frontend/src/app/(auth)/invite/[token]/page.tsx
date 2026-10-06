import type { Metadata } from "next";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = { title: "Join workspace" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  return <AcceptInvitation token={token} />;
}
