import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Start your free trial" };

export default function SignupPage() {
  return <SignupForm />;
}
