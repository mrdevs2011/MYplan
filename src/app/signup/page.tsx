import AuthView from "@/components/auth-view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ro‘yxatdan o‘tish — MyPlan",
  description: "MyPlan da yangi hisob yarating va shaxsiy rejalaringizni boshqaring.",
};

export default function SignupPage() {
  return <AuthView initialMode="signup" />;
}
