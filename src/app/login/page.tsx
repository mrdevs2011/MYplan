import AuthView from "@/components/auth-view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kirish — MyLife",
  description: "MyLife tizimiga kiring va kuningizni samarali rejalashtiring.",
};

export default function LoginPage() {
  return <AuthView initialMode="login" />;
}
