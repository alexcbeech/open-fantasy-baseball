"use server";

import { redirect } from "next/navigation";
import { getNeonAuth } from "@/lib/auth/neon-auth";

export type AuthFormState = {
  error: string;
} | null;

export async function signUpWithEmail(_previousState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const auth = getNeonAuth();

  if (!auth) {
    return { error: "Neon Auth is not configured." };
  }

  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();

  if (!name || !email || !password) {
    return { error: "Name, email, and password are required." };
  }

  const result = await auth.signUp.email({ email, password, name });

  if (result.error) {
    return { error: result.error.message || "Failed to create account." };
  }

  redirect("/");
}
